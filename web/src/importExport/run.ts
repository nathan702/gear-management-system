import { collection, doc, Timestamp, writeBatch, type WriteBatch } from 'firebase/firestore';
import {
  generateQrCode,
  isPendingRef,
  todayIso,
  type DocData,
  type EntityDef,
  type ExportContext,
  type Gear,
  type ImportContext,
  type ImportPlan,
  type RefKind,
} from '@gear/shared';
import { db } from '../firebase';
import type { Data } from '../data/DataProvider';
import { batchCreateGear, batchUpdateGear, clean, createStamp, updateStamp } from '../data/writes';

function names(map: Map<string, { name: string }>) {
  return new Map([...map.values()].map((v) => [(v as unknown as { id: string }).id, v.name]));
}

export function refNames(data: Data): Record<RefKind, Map<string, string>> {
  return {
    programAreas: names(data.programAreas),
    locations: names(data.locations),
    categories: names(data.categories),
    manufacturers: names(data.manufacturers),
    products: new Map([...data.products.keys()].map((id) => [id, data.productLabel(id)])),
  };
}

export function exportContext(data: Data): ExportContext {
  return {
    names: refNames(data),
    products: data.products as unknown as Map<string, DocData>,
    manufacturers: data.manufacturers,
    categories: data.categories,
  };
}

export function docsFor(def: EntityDef, data: Data): (DocData & { id: string })[] {
  const map = data[def.key as keyof Data] as unknown as Map<string, DocData & { id: string }>;
  const docs = [...map.values()];
  if (def.key === 'users')
    return docs.map((u) => ({ ...u, expiresOn: (u.expiresAt as Timestamp | null)?.toDate().toISOString().slice(0, 10) ?? '' }));
  return docs;
}

export function importContext(def: EntityDef, data: Data, createMissingRefs: boolean): ImportContext {
  const existing = new Map(docsFor(def, data).map((d) => [d.id, d]));
  return {
    refNames: refNames(data),
    existing,
    qrCodes: def.key === 'gear' ? new Map([...data.gear.values()].map((g) => [g.qrCode, g.id])) : undefined,
    createMissingRefs,
    generateQrCode,
  };
}

/** End of the given day, local time. */
function expiry(iso: unknown): Timestamp | null {
  if (typeof iso !== 'string' || !iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  return Timestamp.fromDate(new Date(y, m - 1, d, 23, 59, 59));
}

export interface ImportResult {
  created: number;
  updated: number;
  refsCreated: number;
}

/** Writes an import plan in batches (Firestore allows 500 writes per batch). */
export async function applyPlan(
  def: EntityDef,
  plan: ImportPlan,
  uid: string,
  data: Data,
  onProgress?: (done: number, total: number) => void,
): Promise<ImportResult> {
  if (!navigator.onLine) throw new Error('Imports need an internet connection.');

  // 1. Reference records named in the file that don't exist yet.
  const pending = new Map<string, string>();
  if (plan.newRefs.length) {
    const batch = writeBatch(db);
    for (const r of plan.newRefs) {
      const ref = doc(collection(db, r.kind));
      pending.set(`new:${r.kind}:${r.name.trim().toLowerCase()}`, ref.id);
      batch.set(ref, { name: r.name.trim(), active: true, description: '', ...createStamp(uid) });
    }
    await batch.commit();
  }
  const resolve = (row: DocData) =>
    Object.fromEntries(Object.entries(row).map(([k, v]) => [k, isPendingRef(v) ? (pending.get(v) ?? null) : v]));

  const rows = plan.rows.filter((r) => r.action !== 'error');
  let created = 0;
  let updated = 0;
  let batch: WriteBatch = writeBatch(db);
  let ops = 0;
  const flush = async () => {
    if (ops) await batch.commit();
    batch = writeBatch(db);
    ops = 0;
  };

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const values = resolve(row.data);
    if (ops >= 400) {
      await flush();
      onProgress?.(i, rows.length);
    }

    if (def.key === 'gear') {
      if (row.action === 'create') {
        if (values.status === 'retired' && !values.retiredDate) values.retiredDate = todayIso();
        batchCreateGear(batch, uid, values as never, 'import');
      } else {
        const before = data.gear.get(row.id!) as Gear;
        const changes = values as Partial<Gear>;
        if (changes.status === 'retired' && before.status !== 'retired' && !changes.retiredDate && !before.retiredDate)
          changes.retiredDate = todayIso();
        batchUpdateGear(batch, uid, row.id!, before, changes, { reason: 'Updated by spreadsheet import', source: 'import' });
      }
      ops += 3;
    } else if (def.key === 'users') {
      const { expiresOn, ...rest } = values;
      if (row.action === 'create') {
        const email = String(rest.email);
        batch.set(
          doc(db, 'invites', email),
          clean({ ...rest, email, role: rest.role ?? 'staff', expiresAt: expiry(expiresOn), ...createStamp(uid) }),
        );
      } else {
        const update: DocData = { ...rest };
        delete update.email;
        if (expiresOn !== undefined) update.expiresAt = expiry(expiresOn);
        batch.update(doc(db, 'users', row.id!), clean({ ...update, ...updateStamp(uid) }));
      }
      ops += 1;
    } else {
      const ref = row.action === 'create' ? doc(collection(db, def.collection)) : doc(db, def.collection, row.id!);
      batch.set(ref, clean({ ...values, ...(row.action === 'create' ? createStamp(uid) : updateStamp(uid)) }), { merge: true });
      ops += 1;
    }
    if (row.action === 'create') created++;
    else updated++;
  }
  await flush();
  onProgress?.(rows.length, rows.length);
  return { created, updated, refsCreated: plan.newRefs.length };
}

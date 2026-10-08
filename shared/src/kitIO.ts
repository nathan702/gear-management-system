/** Spreadsheet formats for lists (one row per line, grouped by list name), kits and usage (export only). */
import { newItemId } from './inspections';
import type { GearList, Kit, ListLine, UsageLog } from './types';

export const LIST_HEADERS = ['list', 'list_description', 'program_area', 'quantity', 'product', 'category', 'notes'] as const;

export interface ListLookups {
  productLabel(id: string): string;
  categoryName(id: string): string;
  programAreaName(id: string | null): string;
}

export function listsToRows(lists: Pick<GearList, 'name' | 'description' | 'programAreaId' | 'lines'>[], l: ListLookups) {
  return lists.flatMap((list) =>
    list.lines.map((line) => ({
      list: list.name,
      list_description: list.description ?? '',
      program_area: l.programAreaName(list.programAreaId),
      quantity: line.quantity,
      product: line.productId ? l.productLabel(line.productId) : '',
      category: !line.productId && line.categoryId ? l.categoryName(line.categoryId) : '',
      notes: line.notes ?? '',
    })),
  );
}

export interface ListImportPlan {
  lists: { name: string; id?: string; description: string; programAreaId: string | null; lines: ListLine[]; errors: string[] }[];
}

/** Rows name a product (as exported) or a category. A list matching an existing name replaces its lines. */
export function planListImport(
  records: Record<string, string>[],
  existing: { id: string; name: string }[],
  refs: { products: Map<string, string>; categories: Map<string, string>; programAreas: Map<string, string> },
  random: () => number = Math.random,
): ListImportPlan {
  const norm = (h: string) => h.trim().toLowerCase().replace(/[\s-]+/g, '_');
  const byName = new Map<string, ListImportPlan['lists'][number]>();
  const existingIds = new Map(existing.map((e) => [e.name.trim().toLowerCase(), e.id]));
  records.forEach((raw, i) => {
    const r: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) r[norm(k)] = v == null ? '' : String(v).trim();
    if (!r.list) return;
    const key = r.list.toLowerCase();
    const row = i + 2;
    if (!byName.has(key)) {
      const pa = r.program_area ? refs.programAreas.get(r.program_area.toLowerCase()) : null;
      byName.set(key, {
        name: r.list,
        id: existingIds.get(key),
        description: r.list_description ?? '',
        programAreaId: pa ?? null,
        lines: [],
        errors: r.program_area && !pa ? [`row ${row}: no program area named "${r.program_area}"`] : [],
      });
    }
    const list = byName.get(key)!;
    const qty = Math.round(Number(r.quantity || '1'));
    if (!Number.isFinite(qty) || qty < 1) return void list.errors.push(`row ${row}: quantity must be a whole number of at least 1`);
    const productId = r.product ? refs.products.get(r.product.toLowerCase()) : undefined;
    const categoryId = !r.product && r.category ? refs.categories.get(r.category.toLowerCase()) : undefined;
    if (r.product && !productId) return void list.errors.push(`row ${row}: no product named "${r.product}"`);
    if (!r.product && r.category && !categoryId) return void list.errors.push(`row ${row}: no category named "${r.category}"`);
    if (!productId && !categoryId) return void list.errors.push(`row ${row}: give a product or a category`);
    list.lines.push({ id: newItemId(random), productId: productId ?? null, categoryId: categoryId ?? null, quantity: qty, notes: r.notes ?? '' });
  });
  return { lists: [...byName.values()] };
}

export const KIT_HEADERS = ['kit', 'owner', 'program_area', 'start_date', 'end_date', 'status', 'gear', 'qr_code', 'product'] as const;

export function kitRows(
  kits: (Pick<Kit, 'name' | 'ownerId' | 'programAreaId' | 'startDate' | 'endDate' | 'status' | 'gearIds'> & { id: string })[],
  l: { user(id: string): string; programAreaName(id: string | null): string; gear(id: string): { name: string; qrCode: string; productId: string | null } | undefined; productLabel(id: string | null): string },
) {
  return kits.flatMap((k) =>
    (k.gearIds.length ? k.gearIds : ['']).map((gid) => {
      const g = gid ? l.gear(gid) : undefined;
      return {
        kit: k.name,
        owner: l.user(k.ownerId),
        program_area: l.programAreaName(k.programAreaId),
        start_date: k.startDate ?? '',
        end_date: k.endDate ?? '',
        status: k.status,
        gear: g?.name ?? '',
        qr_code: g?.qrCode ?? '',
        product: g ? l.productLabel(g.productId) : '',
      };
    }),
  );
}

export const USAGE_HEADERS = ['gear', 'qr_code', 'product', 'start_date', 'end_date', 'days_used', 'uses', 'user', 'kit', 'notes'] as const;

export function usageRows(
  logs: (UsageLog & { id: string })[],
  l: { gear(id: string): { name: string; qrCode: string; productId: string | null } | undefined; productLabel(id: string | null): string; user(id: string): string; kit(id: string | null | undefined): string },
) {
  return logs.map((u) => {
    const g = l.gear(u.gearId);
    return {
      gear: g?.name ?? '(deleted)',
      qr_code: g?.qrCode ?? '',
      product: g ? l.productLabel(g.productId) : '',
      start_date: u.startDate,
      end_date: u.endDate,
      days_used: u.daysUsed,
      uses: u.uses ?? '',
      user: l.user(u.userId),
      kit: l.kit(u.kitId),
      notes: u.notes ?? '',
    };
  });
}

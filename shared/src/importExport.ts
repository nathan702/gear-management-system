/**
 * Schema-driven CSV/Excel import and export. Everything here is pure so it
 * can be unit tested; the web app reads files into plain string records,
 * calls `planImport`, shows the plan for review, then writes it.
 */
import { GEAR_STATUSES, ROLES, type Gear, type Link } from './types';

type GearDates = Pick<Gear, 'mfgDate' | 'purchaseDate' | 'firstUseDate' | 'customEol'>;
import { ROLE_LABELS, STATUS_LABELS } from './constants';
import { ageYears, endOfLife, isIsoDate, lifeUsedPercent, productName } from './gear';
import { normalizeQrCode } from './qr';

export type RefKind = 'programAreas' | 'locations' | 'categories' | 'manufacturers' | 'products';

export type FieldType = 'string' | 'text' | 'number' | 'boolean' | 'date' | 'list' | 'links' | 'enum' | 'ref' | 'email';

export interface FieldDef {
  key: string;
  header: string;
  type: FieldType;
  required?: boolean;
  enumValues?: readonly string[];
  enumLabels?: Record<string, string>;
  ref?: RefKind;
  help?: string;
}

export type DocData = Record<string, unknown>;

export interface ExportContext {
  names: Record<RefKind, ReadonlyMap<string, string>>;
  /** Raw docs needed for computed columns. */
  products: ReadonlyMap<string, DocData>;
  manufacturers: ReadonlyMap<string, { name: string }>;
  categories: ReadonlyMap<string, { name: string }>;
}

export type EntityKey =
  | 'programAreas'
  | 'locations'
  | 'categories'
  | 'manufacturers'
  | 'products'
  | 'gear'
  | 'users';

export interface EntityDef {
  key: EntityKey;
  label: string;
  /** Firestore collection written on import. */
  collection: string;
  fields: FieldDef[];
  /** Key that identifies an existing record when the row has no id. */
  matchKey(data: DocData, names: ImportContext['refNames']): string | null;
  /** Read-only columns added to exports only. */
  computed?: { header: string; value(doc: DocData & { id: string }, ctx: ExportContext): string | number | null }[];
  /** Defaults applied when creating. */
  defaults?: DocData;
}

const activeField: FieldDef = { key: 'active', header: 'active', type: 'boolean', help: 'yes/no, defaults to yes' };
const lower = (v: unknown) => (typeof v === 'string' ? v.trim().toLowerCase() : '');

const simpleEntity = (key: EntityKey & RefKind, label: string, extra: FieldDef[] = []): EntityDef => ({
  key,
  label,
  collection: key,
  fields: [{ key: 'name', header: 'name', type: 'string', required: true }, ...extra, activeField],
  matchKey: (d) => lower(d.name) || null,
  defaults: { active: true },
});

export const ENTITIES: Record<EntityKey, EntityDef> = {
  programAreas: simpleEntity('programAreas', 'Program areas', [
    { key: 'description', header: 'description', type: 'text' },
    { key: 'color', header: 'color', type: 'string', help: 'hex color, e.g. #2f7d5b' },
  ]),
  locations: simpleEntity('locations', 'Locations', [
    { key: 'description', header: 'description', type: 'text' },
    { key: 'parentId', header: 'parent_location', type: 'ref', ref: 'locations' },
  ]),
  categories: simpleEntity('categories', 'Categories', [{ key: 'description', header: 'description', type: 'text' }]),
  manufacturers: simpleEntity('manufacturers', 'Manufacturers', [
    { key: 'website', header: 'website', type: 'string' },
    { key: 'notes', header: 'notes', type: 'text' },
  ]),
  products: {
    key: 'products',
    label: 'Products',
    collection: 'products',
    fields: [
      { key: 'manufacturerId', header: 'manufacturer', type: 'ref', ref: 'manufacturers' },
      { key: 'model', header: 'model', type: 'string', required: true },
      { key: 'variant', header: 'variant', type: 'string', help: 'size, length, color…' },
      { key: 'categoryId', header: 'category', type: 'ref', ref: 'categories' },
      { key: 'lifetimeYears', header: 'lifetime_years', type: 'number' },
      { key: 'replacementCost', header: 'replacement_cost', type: 'number' },
      { key: 'isPpe', header: 'is_ppe', type: 'boolean' },
      { key: 'notes', header: 'notes', type: 'text' },
      { key: 'links', header: 'links', type: 'links', help: 'label | url; label | url' },
      activeField,
    ],
    matchKey: (d, names) =>
      lower(
        productName(
          { manufacturerId: (d.manufacturerId as string) ?? null, model: String(d.model ?? ''), variant: d.variant as string },
          new Map([...names.manufacturers].map(([id, name]) => [id, { name }])),
        ),
      ) || null,
    defaults: { active: true, inspectionSchedules: [] },
  },
  gear: {
    key: 'gear',
    label: 'Gear',
    collection: 'gear',
    fields: [
      { key: 'name', header: 'name', type: 'string', required: true },
      { key: 'qrCode', header: 'qr_code', type: 'string', help: 'blank = generate one' },
      { key: 'productId', header: 'product', type: 'ref', ref: 'products', help: 'full product name as exported' },
      { key: 'programAreaId', header: 'program_area', type: 'ref', ref: 'programAreas' },
      { key: 'locationId', header: 'location', type: 'ref', ref: 'locations' },
      { key: 'status', header: 'status', type: 'enum', enumValues: GEAR_STATUSES, enumLabels: STATUS_LABELS },
      { key: 'serialNumber', header: 'serial_number', type: 'string' },
      { key: 'tags', header: 'tags', type: 'list' },
      { key: 'mfgDate', header: 'mfg_date', type: 'date' },
      { key: 'purchaseDate', header: 'purchase_date', type: 'date' },
      { key: 'firstUseDate', header: 'first_use_date', type: 'date' },
      { key: 'purchaseValue', header: 'purchase_value', type: 'number' },
      { key: 'supplier', header: 'supplier', type: 'string' },
      { key: 'customEol', header: 'custom_eol', type: 'date' },
      { key: 'retiredDate', header: 'retired_date', type: 'date' },
      { key: 'retiredReason', header: 'retired_reason', type: 'string' },
      { key: 'notes', header: 'notes', type: 'text' },
      { key: 'links', header: 'links', type: 'links' },
    ],
    matchKey: (d) => {
      const code = typeof d.qrCode === 'string' ? normalizeQrCode(d.qrCode) : null;
      return code ? `qr:${code}` : null;
    },
    computed: [
      {
        header: 'category',
        value: (g, ctx) => {
          const p = ctx.products.get(String(g.productId ?? ''));
          return (p && ctx.categories.get(String(p.categoryId ?? ''))?.name) ?? '';
        },
      },
      {
        header: 'end_of_life',
        value: (g, ctx) => endOfLife(g as GearDates, ctx.products.get(String(g.productId ?? '')) as never) ?? '',
      },
      { header: 'age_years', value: (g) => ageYears(g as GearDates) ?? '' },
      {
        header: 'life_used_pct',
        value: (g, ctx) => lifeUsedPercent(g as GearDates, ctx.products.get(String(g.productId ?? '')) as never) ?? '',
      },
    ],
    defaults: { status: 'active', tags: [], links: [] },
  },
  users: {
    key: 'users',
    label: 'Users',
    collection: 'users',
    fields: [
      { key: 'email', header: 'email', type: 'email', required: true },
      { key: 'displayName', header: 'name', type: 'string' },
      { key: 'role', header: 'role', type: 'enum', enumValues: ROLES, enumLabels: ROLE_LABELS },
      { key: 'expiresOn', header: 'access_expires', type: 'date', help: 'blank = no expiry' },
      { key: 'homeProgramAreaId', header: 'home_program_area', type: 'ref', ref: 'programAreas' },
      { key: 'phone', header: 'phone', type: 'string' },
    ],
    matchKey: (d) => lower(d.email) || null,
    defaults: { role: 'staff' },
  },
};

export const IMPORT_ORDER: EntityKey[] = [
  'programAreas',
  'locations',
  'categories',
  'manufacturers',
  'products',
  'gear',
  'users',
];

/* ------------------------------------------------------------------ export */

export function formatLinks(links: unknown): string {
  if (!Array.isArray(links)) return '';
  return (links as Link[]).map((l) => (l.label ? `${l.label} | ${l.url}` : l.url)).join('; ');
}

export function exportRows(def: EntityDef, docs: (DocData & { id: string })[], ctx: ExportContext) {
  const headers = ['id', ...def.fields.map((f) => f.header), ...(def.computed ?? []).map((c) => c.header)];
  const rows = docs.map((doc) => {
    const row: Record<string, string | number> = { id: doc.id };
    for (const f of def.fields) {
      const v = doc[f.key];
      let out: string | number = '';
      if (v === null || v === undefined) out = '';
      else if (f.type === 'ref') out = ctx.names[f.ref!].get(String(v)) ?? '';
      else if (f.type === 'boolean') out = v ? 'yes' : 'no';
      else if (f.type === 'list') out = Array.isArray(v) ? v.join('; ') : '';
      else if (f.type === 'links') out = formatLinks(v);
      else if (f.type === 'number') out = typeof v === 'number' ? v : '';
      else if (f.type === 'date' && typeof v === 'object' && v && 'toDate' in v)
        out = (v as { toDate(): Date }).toDate().toISOString().slice(0, 10);
      else out = String(v);
      row[f.header] = out;
    }
    for (const c of def.computed ?? []) row[c.header] = c.value(doc, ctx) ?? '';
    return row;
  });
  return { headers, rows };
}

/* ------------------------------------------------------------------ import */

export interface ImportContext {
  /** id → display name, per reference kind (used for ids and match keys). */
  refNames: Record<RefKind, ReadonlyMap<string, string>>;
  /** Existing records of the entity being imported, id → data. */
  existing: ReadonlyMap<string, DocData>;
  /** Existing QR codes → gear id (gear imports only). */
  qrCodes?: ReadonlyMap<string, string>;
  /** Create unknown locations/categories/manufacturers/program areas by name. */
  createMissingRefs: boolean;
  generateQrCode?: () => string;
}

export interface PlannedRow {
  row: number;
  action: 'create' | 'update' | 'error';
  id?: string;
  label: string;
  data: DocData;
  errors: string[];
  warnings: string[];
}

export interface ImportPlan {
  rows: PlannedRow[];
  /** Reference records that will be created first (only with createMissingRefs). */
  newRefs: { kind: RefKind; name: string }[];
  unknownHeaders: string[];
  missingRequiredHeaders: string[];
}

const TRUE = new Set(['yes', 'y', 'true', '1', 'x']);
const FALSE = new Set(['no', 'n', 'false', '0', '']);

export function parseNumber(raw: string): number | null | 'invalid' {
  const s = raw.replace(/[$,\s]/g, '');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : 'invalid';
}

/** Accepts YYYY-MM-DD, YYYY/MM/DD and US-style M/D/YYYY (or M/D/YY). */
export function parseDate(raw: string): string | null | 'invalid' {
  const s = raw.trim();
  if (!s) return null;
  let m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T ].*)?$/.exec(s);
  let iso: string | null = null;
  if (m) iso = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  else if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(s))) {
    const year = m[3].length === 2 ? `20${m[3]}` : m[3];
    iso = `${year}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  }
  return iso && isIsoDate(iso) ? iso : 'invalid';
}

export function parseLinks(raw: string): Link[] | 'invalid' {
  const parts = raw
    .split(/[;\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
  const links: Link[] = [];
  for (const p of parts) {
    const pipe = p.lastIndexOf('|');
    const label = pipe >= 0 ? p.slice(0, pipe).trim() : '';
    const url = (pipe >= 0 ? p.slice(pipe + 1) : p).trim();
    if (!/^https?:\/\/\S+$/i.test(url)) return 'invalid';
    links.push({ label, url });
  }
  return links;
}

export function parseList(raw: string): string[] {
  return [
    ...new Set(
      raw
        .split(/[;,]/)
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ];
}

function normHeader(h: string) {
  return h.trim().toLowerCase().replace(/[\s-]+/g, '_');
}

export function planImport(def: EntityDef, records: Record<string, string>[], ctx: ImportContext): ImportPlan {
  const headerSet = new Set<string>();
  for (const r of records) for (const h of Object.keys(r)) headerSet.add(normHeader(h));
  const known = new Set(['id', ...def.fields.map((f) => f.header), ...(def.computed ?? []).map((c) => c.header)]);
  const unknownHeaders = [...headerSet].filter((h) => !known.has(h));
  const present = def.fields.filter((f) => headerSet.has(f.header));
  const missingRequiredHeaders = def.fields.filter((f) => f.required && !headerSet.has(f.header)).map((f) => f.header);

  // name (lower) → id per ref kind, plus ids themselves.
  const lookup = {} as Record<RefKind, Map<string, string>>;
  for (const kind of Object.keys(ctx.refNames) as RefKind[]) {
    const m = new Map<string, string>();
    for (const [id, name] of ctx.refNames[kind]) {
      m.set(name.trim().toLowerCase(), id);
      m.set(`#id:${id}`, id);
    }
    lookup[kind] = m;
  }
  const newRefs: ImportPlan['newRefs'] = [];
  const pendingRef = (kind: RefKind, name: string) => `new:${kind}:${name.trim().toLowerCase()}`;

  const existingByKey = new Map<string, string>();
  for (const [id, data] of ctx.existing) {
    const k = def.matchKey(data, ctx.refNames);
    if (k) existingByKey.set(k, id);
  }
  const qrCodes = new Map(ctx.qrCodes ?? []);
  const seenIds = new Set<string>();

  const rows: PlannedRow[] = records.map((raw, i) => {
    const rec: Record<string, string> = {};
    for (const [h, v] of Object.entries(raw)) rec[normHeader(h)] = v == null ? '' : String(v);
    const errors: string[] = [];
    const warnings: string[] = [];
    const data: DocData = {};

    for (const f of present) {
      const value = (rec[f.header] ?? '').trim();
      if (!value) {
        // A blank required or choice cell keeps the current value (new records
        // get defaults, and required fields are checked below); other blank
        // cells clear the field.
        if (!f.required && f.type !== 'enum')
          data[f.key] = f.type === 'list' || f.type === 'links' ? [] : f.type === 'boolean' ? false : null;
        continue;
      }
      switch (f.type) {
        case 'string':
        case 'text':
          data[f.key] = value;
          break;
        case 'email':
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) errors.push(`${f.header}: "${value}" is not an email`);
          else data[f.key] = value.toLowerCase();
          break;
        case 'number': {
          const n = parseNumber(value);
          if (n === 'invalid') errors.push(`${f.header}: "${value}" is not a number`);
          else data[f.key] = n;
          break;
        }
        case 'boolean': {
          const v = value.toLowerCase();
          if (TRUE.has(v)) data[f.key] = true;
          else if (FALSE.has(v)) data[f.key] = false;
          else errors.push(`${f.header}: "${value}" should be yes or no`);
          break;
        }
        case 'date': {
          const d = parseDate(value);
          if (d === 'invalid') errors.push(`${f.header}: "${value}" is not a date (use YYYY-MM-DD)`);
          else data[f.key] = d;
          break;
        }
        case 'list':
          data[f.key] = parseList(value);
          break;
        case 'links': {
          const l = parseLinks(value);
          if (l === 'invalid') errors.push(`${f.header}: each link needs an http(s) URL`);
          else data[f.key] = l;
          break;
        }
        case 'enum': {
          const v = value.toLowerCase().replace(/\s+/g, '_');
          const match = f.enumValues!.find(
            (e) => e === v || f.enumLabels?.[e]?.toLowerCase() === value.toLowerCase(),
          );
          if (match) data[f.key] = match;
          else errors.push(`${f.header}: "${value}" must be one of ${f.enumValues!.join(', ')}`);
          break;
        }
        case 'ref': {
          const kind = f.ref!;
          const id = lookup[kind].get(value.toLowerCase()) ?? lookup[kind].get(`#id:${value}`);
          if (id) data[f.key] = id;
          else if (ctx.createMissingRefs && kind !== 'products') {
            const key = pendingRef(kind, value);
            if (!newRefs.some((r) => pendingRef(r.kind, r.name) === key)) newRefs.push({ kind, name: value });
            data[f.key] = key;
            warnings.push(`new ${kind === 'programAreas' ? 'program area' : kind.replace(/s$/, '')} "${value}" will be created`);
          } else errors.push(`${f.header}: no ${kind === 'programAreas' ? 'program area' : kind.replace(/s$/, '')} named "${value}"`);
          break;
        }
      }
    }

    // Find the record this row updates.
    const rowId = (rec.id ?? '').trim();
    let id: string | undefined;
    if (rowId) {
      if (ctx.existing.has(rowId)) id = rowId;
      else errors.push(`id "${rowId}" does not match an existing ${def.label.toLowerCase()} record`);
    } else {
      const k = def.matchKey(data, ctx.refNames);
      if (k) id = existingByKey.get(k);
    }
    if (id && seenIds.has(id)) errors.push('another row in this file updates the same record');
    if (id) seenIds.add(id);

    if (def.key === 'gear') {
      if (typeof data.qrCode === 'string') {
        const code = normalizeQrCode(data.qrCode);
        if (!code) errors.push(`qr_code "${data.qrCode}" may only contain letters, numbers, . _ : -`);
        else {
          const owner = qrCodes.get(code);
          if (owner && owner !== (id ?? `row:${i}`)) errors.push(`qr_code ${code} already belongs to other gear`);
          data.qrCode = code;
          qrCodes.set(code, id ?? `row:${i}`);
        }
      } else if (!id) {
        let code = ctx.generateQrCode?.();
        while (code && qrCodes.has(code)) code = ctx.generateQrCode?.();
        if (code) {
          data.qrCode = code;
          qrCodes.set(code, `row:${i}`);
        }
      } else if (data.qrCode === null) errors.push('qr_code cannot be blank for existing gear');
      if (data.status === 'retired' && !data.retiredDate && !ctx.existing.get(id ?? '')?.retiredDate)
        warnings.push('retired without a retired_date');
    }

    if (!id) {
      for (const f of def.fields)
        if (f.required && !(f.key in data) && !errors.some((e) => e.startsWith(f.header)))
          errors.push(`${f.header} is required`);
      for (const [k, v] of Object.entries(def.defaults ?? {})) if (data[k] === undefined || data[k] === null) data[k] = v;
    }

    const label =
      String(data.name ?? data.email ?? data.model ?? ctx.existing.get(id ?? '')?.name ?? rowId ?? '') ||
      `row ${i + 2}`;
    return {
      row: i + 2, // header is row 1
      action: errors.length ? 'error' : id ? 'update' : 'create',
      id,
      label,
      data,
      errors,
      warnings,
    };
  });

  return { rows, newRefs, unknownHeaders, missingRequiredHeaders };
}

export function isPendingRef(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('new:');
}

/** Template with headers and one example row, for the "download template" button. */
export function templateHeaders(def: EntityDef): string[] {
  return def.fields.map((f) => f.header);
}

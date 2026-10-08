import { useMemo, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { Download } from 'lucide-react';
import { addDays, addMonths, todayIso, type Gear, type IsoDate, type WithId } from '@gear/shared';
import { sortedValues, useData, type Data } from '../data/DataProvider';
import { Button, Input, Select } from '../components/ui';
import { downloadCsv, downloadXlsx, stamp, type Row } from '../importExport/files';

export type GearDoc = Gear & WithId;

/** Read and write one search param, dropping it when empty. */
export function useParam(name: string, fallback = ''): [string, (v: string) => void] {
  const [params, setParams] = useSearchParams();
  return [
    params.get(name) ?? fallback,
    (v) => {
      const n = new URLSearchParams(params);
      if (v && v !== fallback) n.set(name, v);
      else n.delete(name);
      setParams(n, { replace: true });
    },
  ];
}

/* ------------------------------------------------------ gear filters */

/** Program / category / location filters shared by every report. */
export function useGearFilter() {
  const { gear, products } = useData();
  const [program, setProgram] = useParam('program');
  const [category, setCategory] = useParam('category');
  const [location, setLocation] = useParam('location');
  const filtered = useMemo(
    () =>
      [...gear.values()].filter(
        (g) =>
          (!program || g.programAreaId === program) &&
          (!location || g.locationId === location) &&
          (!category || (g.productId && products.get(g.productId)?.categoryId === category)),
      ),
    [gear, products, program, category, location],
  );
  return { gear: filtered, program, setProgram, category, setCategory, location, setLocation, active: !!(program || category || location) };
}

export function GearFilters({ f }: { f: ReturnType<typeof useGearFilter> }) {
  const { programAreas, categories, locations } = useData();
  const pick = (value: string, set: (v: string) => void, all: string, label: string, items: { id: string; name: string }[]) => (
    <Select className="w-auto" value={value} onChange={(e) => set(e.target.value)} aria-label={label}>
      <option value="">{all}</option>
      {items.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </Select>
  );
  return (
    <>
      {pick(f.program, f.setProgram, 'All programs', 'Program area', sortedValues(programAreas))}
      {pick(f.category, f.setCategory, 'All categories', 'Category', sortedValues(categories))}
      {pick(f.location, f.setLocation, 'All locations', 'Location', sortedValues(locations))}
    </>
  );
}

/* --------------------------------------------------------- date range */

const PRESETS = {
  '30d': 'Last 30 days',
  '90d': 'Last 90 days',
  '12m': 'Last 12 months',
  ytd: 'This year',
  lastyear: 'Last year',
  custom: 'Custom dates',
} as const;
type Preset = keyof typeof PRESETS;

function presetRange(p: Preset, today: IsoDate): [IsoDate, IsoDate] {
  const year = Number(today.slice(0, 4));
  switch (p) {
    case '30d':
      return [addDays(today, -29), today];
    case '90d':
      return [addDays(today, -89), today];
    case 'ytd':
      return [`${year}-01-01`, today];
    case 'lastyear':
      return [`${year - 1}-01-01`, `${year - 1}-12-31`];
    default:
      return [addDays(addMonths(today, -12), 1), today];
  }
}

export function useDateRange() {
  const [preset, setPreset] = useParam('range', '12m');
  const [fromP, setFrom] = useParam('from');
  const [toP, setTo] = useParam('to');
  const p = (preset in PRESETS ? preset : '12m') as Preset;
  const today = todayIso();
  const [from, to] = p === 'custom' ? [fromP || presetRange('12m', today)[0], toP || today] : presetRange(p, today);
  return { preset: p, setPreset, from, to: to < from ? from : to, setFrom, setTo, label: p === 'custom' ? null : PRESETS[p] };
}

export function DateRangePicker({ r }: { r: ReturnType<typeof useDateRange> }) {
  return (
    <>
      <Select className="w-auto" value={r.preset} onChange={(e) => r.setPreset(e.target.value)} aria-label="Date range">
        {Object.entries(PRESETS).map(([k, v]) => (
          <option key={k} value={k}>
            {v}
          </option>
        ))}
      </Select>
      {r.preset === 'custom' && (
        <span className="flex items-center gap-1 text-sm text-stone-600">
          <Input type="date" className="w-auto" value={r.from} onChange={(e) => r.setFrom(e.target.value)} aria-label="From" />
          to
          <Input type="date" className="w-auto" value={r.to} onChange={(e) => r.setTo(e.target.value)} aria-label="To" />
        </span>
      )}
    </>
  );
}

/* ------------------------------------------------------------ grouping */

export const GROUP_BY = { program: 'Program area', category: 'Category', location: 'Location', product: 'Product' } as const;
export type GroupBy = keyof typeof GROUP_BY;

export function groupKeyFn(by: GroupBy, data: Pick<Data, 'products'>) {
  return (g: GearDoc): string | null => {
    if (by === 'program') return g.programAreaId;
    if (by === 'location') return g.locationId;
    if (by === 'product') return g.productId;
    return g.productId ? (data.products.get(g.productId)?.categoryId ?? null) : null;
  };
}

export function groupName(by: GroupBy, key: string, data: Data): string {
  if (!key) return by === 'product' ? 'No product' : `No ${GROUP_BY[by].toLowerCase()}`;
  if (by === 'program') return data.programAreas.get(key)?.name ?? 'Deleted';
  if (by === 'location') return data.locations.get(key)?.name ?? 'Deleted';
  if (by === 'category') return data.categories.get(key)?.name ?? 'Deleted';
  return data.productLabel(key);
}

export function GroupBySelect({ value, onChange }: { value: GroupBy; onChange(v: GroupBy): void }) {
  return (
    <label className="flex items-center gap-2 text-sm text-stone-600">
      Group by
      <Select className="w-auto" value={value} onChange={(e) => onChange(e.target.value as GroupBy)}>
        {Object.entries(GROUP_BY).map(([k, v]) => (
          <option key={k} value={k}>
            {v}
          </option>
        ))}
      </Select>
    </label>
  );
}

export function useGroupBy(): [GroupBy, (v: GroupBy) => void] {
  const [v, set] = useParam('group', 'program');
  return [(v in GROUP_BY ? v : 'program') as GroupBy, set];
}

/* --------------------------------------------------------------- table */

export interface Column<T> {
  key: string;
  label: string;
  /** Right-aligned with tabular figures. */
  num?: boolean;
  /** Cell content on screen; the export uses `value`. */
  render?: (row: T) => ReactNode;
  value: (row: T) => string | number | null | undefined;
}

export function ReportTable<T>({ columns, rows, rowKey, foot, empty = 'Nothing to show' }: { columns: Column<T>[]; rows: T[]; rowKey(r: T): string; foot?: ReactNode; empty?: string }) {
  if (!rows.length) return <p className="px-4 py-6 text-center text-sm text-stone-500">{empty}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-stone-200 bg-stone-50 text-xs text-stone-500 uppercase">
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={`px-3 py-2 whitespace-nowrap ${c.num ? 'text-right' : ''}`}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-100">
          {rows.map((r) => (
            <tr key={rowKey(r)} className="hover:bg-stone-50">
              {columns.map((c) => (
                <td key={c.key} className={`px-3 py-2 ${c.num ? 'text-right whitespace-nowrap tabular-nums' : ''}`}>
                  {c.render ? c.render(r) : (c.value(r) ?? '—')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {foot && <tfoot className="border-t border-stone-200 bg-stone-50 font-medium">{foot}</tfoot>}
      </table>
    </div>
  );
}

/** CSV / Excel buttons for a report table. */
export function ExportButtons<T>({ name, columns, rows }: { name: string; columns: Column<T>[]; rows: T[] }) {
  const toRows = (): Row[] => rows.map((r) => Object.fromEntries(columns.map((c) => [c.label, c.value(r) ?? ''])) as Row);
  const headers = columns.map((c) => c.label);
  const file = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${stamp()}`;
  return (
    <span className="flex gap-1">
      <Button size="sm" variant="ghost" disabled={!rows.length} onClick={() => downloadCsv(headers, toRows(), `${file}.csv`)}>
        <Download size={14} /> CSV
      </Button>
      <Button size="sm" variant="ghost" disabled={!rows.length} onClick={() => downloadXlsx([{ name, headers, rows: toRows() }], `${file}.xlsx`)}>
        <Download size={14} /> Excel
      </Button>
    </span>
  );
}

export const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : '—');

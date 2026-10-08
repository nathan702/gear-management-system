import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Plus, Printer, Search } from 'lucide-react';
import { GEAR_STATUSES, STATUS_LABELS, type DueState, type Gear, type WithId } from '@gear/shared';
import { useMe } from '../auth/AuthProvider';
import { byName, sortedValues, useData } from '../data/DataProvider';
import { Button, Empty, Input, LinkButton, PageHeader, Select, StatusBadge } from '../components/ui';
import { plural } from '../lib/format';
import { DueBadge, useInspectionSummaries } from '../inspections/common';

export function GearListPage() {
  const { isManager } = useMe();
  const data = useData();
  const { gear, products, categories, programAreas, locations, productLabel } = data;
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const summaries = useInspectionSummaries();

  const f = {
    q: params.get('q') ?? '',
    status: params.get('status') ?? '',
    program: params.get('program') ?? '',
    location: params.get('location') ?? '',
    category: params.get('category') ?? '',
    product: params.get('product') ?? '',
    inspection: params.get('inspection') ?? '',
  };
  const setF = (key: keyof typeof f, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const list = useMemo(() => {
    const q = f.q.trim().toLowerCase();
    return [...gear.values()]
      .filter((g) => {
        if (f.status === 'all') {
          /* everything */
        } else if (f.status) {
          if (g.status !== f.status) return false;
        } else if (g.status === 'retired') return false;
        if (f.program && g.programAreaId !== f.program) return false;
        if (f.location && g.locationId !== f.location) return false;
        if (f.product && g.productId !== f.product) return false;
        if (f.inspection === 'attention' && !['overdue', 'due_soon'].includes(summaries.get(g.id)?.state ?? '')) return false;
        if ((f.inspection === 'overdue' || f.inspection === 'due_soon') && summaries.get(g.id)?.state !== f.inspection) return false;
        const product = g.productId ? products.get(g.productId) : undefined;
        if (f.category && product?.categoryId !== f.category) return false;
        if (q) {
          const hay = [
            g.name,
            g.qrCode,
            g.serialNumber,
            productLabel(g.productId),
            ...(g.tags ?? []),
            g.locationId ? locations.get(g.locationId)?.name : '',
          ]
            .join(' ')
            .toLowerCase();
          if (!q.split(/\s+/).every((word) => hay.includes(word))) return false;
        }
        return true;
      })
      .sort(byName);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gear, products, locations, params, summaries]);

  const allSelected = list.length > 0 && list.every((g) => selected.has(g.id));
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const chosen = list.filter((g) => selected.has(g.id));

  const name = (map: Map<string, { name: string }>, id: string | null | undefined) => (id ? map.get(id)?.name : '') || '—';

  return (
    <div>
      <PageHeader
        title="Gear"
        subtitle={`${plural(list.length, 'item')} shown`}
        actions={
          isManager && (
            <LinkButton to="/gear/new" variant="primary">
              <Plus size={16} /> Add gear
            </LinkButton>
          )
        }
      />

      <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-7">
        <div className="relative sm:col-span-2">
          <Search size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-stone-400" />
          <Input
            type="search"
            placeholder="Search name, code, product, tag…"
            className="pl-9"
            value={f.q}
            onChange={(e) => setF('q', e.target.value)}
            aria-label="Search gear"
          />
        </div>
        <Select value={f.status} onChange={(e) => setF('status', e.target.value)} aria-label="Status">
          <option value="">In service (not retired)</option>
          {GEAR_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
          <option value="all">All statuses</option>
        </Select>
        <Select value={f.inspection} onChange={(e) => setF('inspection', e.target.value)} aria-label="Inspection">
          <option value="">Any inspection state</option>
          <option value="attention">Overdue or due soon</option>
          <option value="overdue">Inspection overdue</option>
          <option value="due_soon">Inspection due soon</option>
        </Select>
        <Select value={f.program} onChange={(e) => setF('program', e.target.value)} aria-label="Program area">
          <option value="">All programs</option>
          {sortedValues(programAreas).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
        <Select value={f.location} onChange={(e) => setF('location', e.target.value)} aria-label="Location">
          <option value="">All locations</option>
          {sortedValues(locations).map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </Select>
        <Select value={f.category} onChange={(e) => setF('category', e.target.value)} aria-label="Category">
          <option value="">All categories</option>
          {sortedValues(categories).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </div>

      {f.product && (
        <p className="mb-3 text-sm">
          Showing <b>{productLabel(f.product)}</b> only ·{' '}
          <button className="link" onClick={() => setF('product', '')}>
            show all products
          </button>
        </p>
      )}

      {chosen.length > 0 && (
        <div className="sticky top-0 z-10 mb-3 flex flex-wrap items-center gap-2 rounded-lg bg-brand-800 px-4 py-2 text-sm text-white">
          <span className="mr-auto">{plural(chosen.length, 'item')} selected</span>
          <Button size="sm" onClick={() => navigate(`/labels?ids=${chosen.map((g) => g.id).join(',')}`)}>
            <Printer size={14} /> Print labels
          </Button>
          <Button size="sm" variant="ghost" className="text-white hover:bg-brand-700" onClick={() => setSelected(new Set())}>
            Clear
          </Button>
        </div>
      )}

      {list.length === 0 ? (
        <Empty title={gear.size ? 'No gear matches these filters' : 'No gear yet'}>
          {!gear.size && isManager && (
            <Link to="/gear/new" className="link">
              Add the first item
            </Link>
          )}
        </Empty>
      ) : (
        <>
          {/* Desktop table */}
          <div className="card hidden overflow-x-auto md:block">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-stone-200 bg-stone-50 text-xs text-stone-500 uppercase">
                <tr>
                  <th className="w-10 px-3 py-2">
                    <input
                      type="checkbox"
                      className="accent-brand-700"
                      checked={allSelected}
                      onChange={() => setSelected(allSelected ? new Set() : new Set(list.map((g) => g.id)))}
                      aria-label="Select all"
                    />
                  </th>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Product</th>
                  <th className="px-3 py-2">Program</th>
                  <th className="px-3 py-2">Location</th>
                  <th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {list.map((g) => (
                  <GearRow key={g.id} g={g} due={summaries.get(g.id)?.state ?? 'none'} checked={selected.has(g.id)} onToggle={() => toggle(g.id)}>
                    <td className="px-3 py-2 text-stone-700">{productLabel(g.productId) || '—'}</td>
                    <td className="px-3 py-2 text-stone-700">{name(programAreas, g.programAreaId)}</td>
                    <td className="px-3 py-2 text-stone-700">{name(locations, g.locationId)}</td>
                  </GearRow>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <ul className="space-y-2 md:hidden">
            {list.map((g) => (
              <li key={g.id} className="card flex items-center gap-3 p-3">
                <input type="checkbox" className="size-5 accent-brand-700" checked={selected.has(g.id)} onChange={() => toggle(g.id)} aria-label={`Select ${g.name}`} />
                <Link to={`/gear/${g.id}`} className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium">{g.name}</span>
                    <span className="flex shrink-0 gap-1">
                      <DueBadge state={summaries.get(g.id)?.state ?? 'none'} short />
                      <StatusBadge status={g.status} />
                    </span>
                  </div>
                  <div className="truncate text-xs text-stone-500">
                    {productLabel(g.productId) || 'No product'} · {name(locations, g.locationId)}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function GearRow({
  g,
  due,
  checked,
  onToggle,
  children,
}: {
  g: Gear & WithId;
  due: DueState | 'none';
  checked: boolean;
  onToggle(): void;
  children: React.ReactNode;
}) {
  const navigate = useNavigate();
  return (
    <tr className="cursor-pointer hover:bg-stone-50" onClick={() => navigate(`/gear/${g.id}`)}>
      <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
        <input type="checkbox" className="accent-brand-700" checked={checked} onChange={onToggle} aria-label={`Select ${g.name}`} />
      </td>
      <td className="px-3 py-2">
        <Link to={`/gear/${g.id}`} className="font-medium text-stone-900 hover:underline" onClick={(e) => e.stopPropagation()}>
          {g.name}
        </Link>
        <div className="font-mono text-xs text-stone-500">{g.qrCode}</div>
      </td>
      {children}
      <td className="px-3 py-2">
        <span className="flex flex-wrap gap-1">
          <StatusBadge status={g.status} />
          <DueBadge state={due} short />
        </span>
      </td>
    </tr>
  );
}

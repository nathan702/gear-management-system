import { useMemo } from 'react';
import { Link } from 'react-router';
import { usageByGear } from '@gear/shared';
import { useData } from '../data/DataProvider';
import { Card, Checkbox, Spinner } from '../components/ui';
import { fmtDate, plural } from '../lib/format';
import { BarList, StatRow, StatTile } from './charts';
import { useUsageLogs } from './data';
import { ExportButtons, GROUP_BY, GroupBySelect, ReportTable, groupKeyFn, groupName, pct, useGroupBy, useParam, type Column, type GearDoc, type useDateRange } from './common';

interface Row {
  g: GearDoc;
  daysUsed: number;
  uses: number;
}

export function UsageReport({ gear, range }: { gear: GearDoc[]; range: ReturnType<typeof useDateRange> }) {
  const data = useData();
  const { programAreas, locations, productLabel } = data;
  const [by, setBy] = useGroupBy();
  const [unused, setUnused] = useParam('unused');
  const logs = useUsageLogs(range.from);
  const usage = useMemo(() => (logs.data ? usageByGear(logs.data, range.from, range.to) : null), [logs.data, range.from, range.to]);
  const inService = useMemo(() => gear.filter((g) => g.status !== 'retired'), [gear]);
  const rows: Row[] = useMemo(
    () =>
      usage
        ? inService
            .map((g) => ({ g, daysUsed: usage.get(g.id)?.daysUsed ?? 0, uses: usage.get(g.id)?.uses ?? 0 }))
            .filter((r) => (unused ? r.daysUsed === 0 : r.daysUsed > 0))
            .sort((a, b) => b.daysUsed - a.daysUsed || a.g.name.localeCompare(b.g.name))
        : [],
    [usage, inService, unused],
  );
  const keyOf = groupKeyFn(by, data);
  const groups = useMemo(() => {
    const out = new Map<string, { key: string; days: number; items: number; used: number }>();
    for (const g of inService) {
      const key = keyOf(g) ?? '';
      const r = out.get(key) ?? { key, days: 0, items: 0, used: 0 };
      const d = usage?.get(g.id)?.daysUsed ?? 0;
      r.items++;
      r.days = Math.round((r.days + d) * 10) / 10;
      if (d > 0) r.used++;
      out.set(key, r);
    }
    return [...out.values()];
  }, [inService, usage, by, data]);

  if (!usage) return logs.error ? <p className="text-sm text-red-700">{logs.error}</p> : <Spinner />;

  const totalDays = Math.round(inService.reduce((s, g) => s + (usage.get(g.id)?.daysUsed ?? 0), 0) * 10) / 10;
  const usedCount = inService.filter((g) => (usage.get(g.id)?.daysUsed ?? 0) > 0).length;

  const columns: Column<Row>[] = [
    { key: 'gear', label: 'Gear', value: (r) => r.g.name, render: (r) => <Link className="link" to={`/gear/${r.g.id}`}>{r.g.name}</Link> },
    { key: 'product', label: 'Product', value: (r) => productLabel(r.g.productId) },
    { key: 'program', label: 'Program', value: (r) => (r.g.programAreaId ? programAreas.get(r.g.programAreaId)?.name : '') },
    { key: 'location', label: 'Location', value: (r) => (r.g.locationId ? locations.get(r.g.locationId)?.name : '') },
    { key: 'days', label: 'Days used', num: true, value: (r) => r.daysUsed },
    { key: 'uses', label: 'Uses', num: true, value: (r) => r.uses || null },
    { key: 'life', label: 'Days used (all time)', num: true, value: (r) => r.g.stats?.daysUsed ?? 0 },
    { key: 'last', label: 'Last used', value: (r) => r.g.stats?.lastUsedDate ?? '', render: (r) => fmtDate(r.g.stats?.lastUsedDate) },
  ];
  type G = (typeof groups)[number];
  const groupCols: Column<G>[] = [
    { key: 'name', label: GROUP_BY[by], value: (r) => groupName(by, r.key, data) },
    { key: 'items', label: 'Items', num: true, value: (r) => r.items },
    { key: 'used', label: 'Items used', num: true, value: (r) => r.used },
    { key: 'share', label: '% used', num: true, value: (r) => pct(r.used, r.items) },
    { key: 'days', label: 'Days used', num: true, value: (r) => r.days },
    { key: 'avg', label: 'Avg days per item', num: true, value: (r) => (r.items ? Math.round((r.days / r.items) * 10) / 10 : 0) },
  ];

  return (
    <div className="space-y-5">
      <StatRow>
        <StatTile label="Days used" value={totalDays.toLocaleString()} sub={range.label ?? `${fmtDate(range.from)} – ${fmtDate(range.to)}`} />
        <StatTile label="Items used" value={usedCount.toLocaleString()} sub={`${pct(usedCount, inService.length)} of ${plural(inService.length, 'item')} in service`} />
        <StatTile label="Not used" value={(inService.length - usedCount).toLocaleString()} sub="No logged days in this period" />
        <StatTile label="Avg days per item used" value={usedCount ? (Math.round((totalDays / usedCount) * 10) / 10).toLocaleString() : '—'} />
      </StatRow>
      <Card title={`Days used by ${GROUP_BY[by].toLowerCase()}`} actions={<GroupBySelect value={by} onChange={setBy} />}>
        <BarList
          empty="No usage logged in this period"
          data={groups.map((g) => ({ key: g.key, label: groupName(by, g.key, data), value: g.days, detail: `${g.used} of ${g.items} items used` }))}
        />
      </Card>
      <section className="card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-100 px-4 py-3">
          <h2 className="text-sm font-semibold">By {GROUP_BY[by].toLowerCase()}</h2>
          <ExportButtons name={`Usage by ${GROUP_BY[by]}`} columns={groupCols} rows={groups} />
        </div>
        <ReportTable columns={groupCols} rows={[...groups].sort((a, b) => b.days - a.days)} rowKey={(r) => r.key} />
      </section>
      <section className="card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-100 px-4 py-3">
          <h2 className="text-sm font-semibold">{unused ? `${plural(rows.length, 'item')} not used` : `${plural(rows.length, 'item')} used`}</h2>
          <div className="flex items-center gap-3">
            <Checkbox label="Show unused gear instead" checked={!!unused} onChange={(e) => setUnused(e.target.checked ? '1' : '')} />
            <ExportButtons name={unused ? 'Unused gear' : 'Usage by item'} columns={columns} rows={rows} />
          </div>
        </div>
        <ReportTable columns={columns} rows={rows} rowKey={(r) => r.g.id} empty={unused ? 'Every item was used' : 'No usage logged in this period'} />
      </section>
      <p className="text-xs text-stone-500">
        Days come from kit returns, check-ins and logged use. A log that runs past the start or end of the period counts in proportion to the days inside it.
      </p>
    </div>
  );
}

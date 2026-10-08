import { useMemo } from 'react';
import { Link } from 'react-router';
import { SEVERITY_LABELS, monthsBetween, workOrderStats, type IsoDate } from '@gear/shared';
import { useData } from '../data/DataProvider';
import { Card, Spinner } from '../components/ui';
import { fmtDate, fmtMoney, plural, timestampToIso } from '../lib/format';
import { BarList, ColumnChart, StatRow, StatTile } from './charts';
import { useAllWorkOrders } from './data';
import { ExportButtons, ReportTable, type Column, type GearDoc, type useDateRange } from './common';

const SOURCE_LABELS = { inspection: 'Failed inspection', issue: 'Reported issue', manual: 'Manual' } as const;

export function WorkOrderReport({ gear, range }: { gear: GearDoc[]; range: ReturnType<typeof useDateRange> }) {
  const { productLabel } = useData();
  const all = useAllWorkOrders();
  const byId = useMemo(() => new Map(gear.map((g) => [g.id, g])), [gear]);
  const wos = useMemo(
    () =>
      (all.data ?? [])
        .filter((w) => byId.has(w.gearId))
        .map((w) => ({ ...w, created: (timestampToIso(w.createdAt) || null) as IsoDate | null, closed: (timestampToIso(w.closedAt) || null) as IsoDate | null })),
    [all.data, byId],
  );
  const stats = useMemo(() => workOrderStats(wos, range.from, range.to), [wos, range.from, range.to]);

  const months = useMemo(
    () =>
      monthsBetween(range.from, range.to).map((m) => {
        const s = workOrderStats(wos, `${m}-01` < range.from ? range.from : `${m}-01`, `${m}-31` > range.to ? range.to : `${m}-31`);
        return { key: m, opened: s.opened, closed: s.closed, cost: s.cost, hours: s.laborHours, avg: s.avgDaysToClose };
      }),
    [wos, range.from, range.to],
  );
  const monthLabel = (m: string) => new Date(Number(m.slice(0, 4)), Number(m.slice(5)) - 1, 1).toLocaleDateString(undefined, { month: 'short', year: '2-digit' });

  const repeat = useMemo(() => {
    const out = new Map<string, { g: GearDoc; count: number; cost: number }>();
    for (const w of wos) {
      if (!w.created || w.created < range.from || w.created > range.to) continue;
      const g = byId.get(w.gearId)!;
      const r = out.get(g.id) ?? { g, count: 0, cost: 0 };
      r.count++;
      r.cost += w.cost ?? 0;
      out.set(g.id, r);
    }
    return [...out.values()].filter((r) => r.count > 1).sort((a, b) => b.count - a.count || b.cost - a.cost);
  }, [wos, byId, range.from, range.to]);

  if (!all.data) return all.error ? <p className="text-sm text-red-700">{all.error}</p> : <Spinner />;

  type M = (typeof months)[number];
  const monthCols: Column<M>[] = [
    { key: 'month', label: 'Month', value: (r) => r.key, render: (r) => monthLabel(r.key) },
    { key: 'opened', label: 'Opened', num: true, value: (r) => r.opened },
    { key: 'closed', label: 'Closed', num: true, value: (r) => r.closed },
    { key: 'avg', label: 'Avg days to close', num: true, value: (r) => r.avg },
    { key: 'cost', label: 'Cost', num: true, value: (r) => r.cost, render: (r) => fmtMoney(r.cost) },
    { key: 'hours', label: 'Labor hours', num: true, value: (r) => r.hours },
  ];
  type R = (typeof repeat)[number];
  const repeatCols: Column<R>[] = [
    { key: 'gear', label: 'Gear', value: (r) => r.g.name, render: (r) => <Link className="link" to={`/gear/${r.g.id}`}>{r.g.name}</Link> },
    { key: 'product', label: 'Product', value: (r) => productLabel(r.g.productId) },
    { key: 'count', label: 'Work orders', num: true, value: (r) => r.count },
    { key: 'cost', label: 'Cost', num: true, value: (r) => r.cost, render: (r) => fmtMoney(r.cost) },
  ];
  const period = range.label ?? `${fmtDate(range.from)} – ${fmtDate(range.to)}`;

  return (
    <div className="space-y-5">
      <StatRow>
        <StatTile label="Opened" value={stats.opened.toLocaleString()} sub={`${stats.stillOpen} still open · ${period}`} />
        <StatTile label="Closed" value={stats.closed.toLocaleString()} sub={`${stats.completed} done · ${stats.closed - stats.completed} cancelled`} />
        <StatTile
          label="Time to close"
          value={stats.avgDaysToClose === null ? '—' : `${stats.avgDaysToClose} days`}
          sub={stats.medianDaysToClose === null ? 'Average' : `Average · median ${stats.medianDaysToClose} days`}
        />
        <StatTile label="Repair cost" value={fmtMoney(stats.cost)} sub={`${stats.laborHours} labor hours`} />
      </StatRow>
      <Card title="Work orders opened per month">
        <ColumnChart
          ariaLabel="Work orders opened per month"
          format={(n) => n.toLocaleString()}
          data={months.map((m) => ({
            key: m.key,
            label: monthLabel(m.key),
            value: m.opened,
            tooltip: (
              <>
                <div>{plural(m.opened, 'opened', 'opened')}</div>
                <div>
                  {m.closed} closed · {fmtMoney(m.cost)}
                </div>
              </>
            ),
          }))}
        />
      </Card>
      <div className="grid gap-5 md:grid-cols-2">
        <Card title="Opened by source">
          <BarList data={Object.entries(stats.bySource).map(([k, v]) => ({ key: k, label: SOURCE_LABELS[k as keyof typeof SOURCE_LABELS], value: v }))} empty="None opened" />
        </Card>
        <Card title="Opened by severity">
          <BarList data={Object.entries(stats.bySeverity).map(([k, v]) => ({ key: k, label: SEVERITY_LABELS[k as keyof typeof SEVERITY_LABELS], value: v }))} empty="None opened" />
        </Card>
      </div>
      <section className="card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-100 px-4 py-3">
          <h2 className="text-sm font-semibold">By month</h2>
          <ExportButtons name="Work orders by month" columns={monthCols} rows={months} />
        </div>
        <ReportTable columns={monthCols} rows={months} rowKey={(r) => r.key} />
      </section>
      <section className="card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-100 px-4 py-3">
          <h2 className="text-sm font-semibold">Repeat repairs ({plural(repeat.length, 'item')} with 2+ work orders)</h2>
          <ExportButtons name="Repeat repairs" columns={repeatCols} rows={repeat} />
        </div>
        <ReportTable columns={repeatCols} rows={repeat} rowKey={(r) => r.g.id} empty="No item needed more than one work order in this period" />
      </section>
    </div>
  );
}

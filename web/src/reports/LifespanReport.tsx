import { useMemo } from 'react';
import { Link } from 'react-router';
import { addMonths, lifeRow, replacementForecast, todayIso, type ForecastPeriod, type LifeRow } from '@gear/shared';
import { useData } from '../data/DataProvider';
import { Card, Select, StatusBadge } from '../components/ui';
import { fmtDate, fmtMoney, plural } from '../lib/format';
import { ColumnChart, StatRow, StatTile, shortMoney } from './charts';
import { ExportButtons, GROUP_BY, GroupBySelect, ReportTable, groupKeyFn, groupName, useGroupBy, useParam, type Column, type GearDoc } from './common';

type EolRow = LifeRow & { g: GearDoc };

export function LifespanReport({ gear }: { gear: GearDoc[] }) {
  const data = useData();
  const { products, programAreas, locations, productLabel } = data;
  const [periodP, setPeriod] = useParam('period', 'year');
  const [horizonP, setHorizon] = useParam('horizon', '5');
  const [withinP, setWithin] = useParam('within', '12');
  const [by, setBy] = useGroupBy();
  const period = (periodP === 'quarter' ? 'quarter' : 'year') as ForecastPeriod;
  const horizon = Number(horizonP) || 5;
  const within = Number(withinP) || 12;
  const today = todayIso();
  const productOf = (g: GearDoc) => (g.productId ? products.get(g.productId) : null);

  const forecast = useMemo(() => replacementForecast(gear, productOf, today, { period, horizonYears: horizon }), [gear, products, today, period, horizon]);
  const past = forecast.buckets[0];
  const future = forecast.buckets.slice(1);
  const next12 = useMemo(() => replacementForecast(gear, productOf, today, { period: 'year', horizonYears: 1 }), [gear, products, today]);
  const next12Cost = next12.buckets.slice(1).reduce((s, b) => s + b.cost, 0);
  const futureCost = future.reduce((s, b) => s + b.cost, 0);
  const unpriced = forecast.buckets.reduce((s, b) => s + b.unpriced, 0);

  // Forecast by group × period, for budgeting per program.
  const keyOf = groupKeyFn(by, data);
  const byGroup = useMemo(() => {
    const out = new Map<string, { key: string; past: number; periods: Record<string, number>; total: number }>();
    for (const b of forecast.buckets) {
      for (const id of b.gearIds) {
        const g = data.gear.get(id)!;
        const key = keyOf(g) ?? '';
        const row = out.get(key) ?? { key, past: 0, periods: {}, total: 0 };
        const cost = lifeRow(g, productOf(g), today).replacementCost ?? 0;
        if (b.key === 'past') row.past += cost;
        else row.periods[b.key] = (row.periods[b.key] ?? 0) + cost;
        row.total += cost;
        out.set(key, row);
      }
    }
    return [...out.values()].sort((a, b) => b.total - a.total);
  }, [forecast, by, data, today]);
  type GroupRow = (typeof byGroup)[number];
  const groupCols: Column<GroupRow>[] = [
    { key: 'name', label: GROUP_BY[by], value: (r) => groupName(by, r.key, data) },
    { key: 'past', label: 'Past end of life', num: true, value: (r) => r.past, render: (r) => fmtMoney(r.past) },
    ...future.map((b) => ({ key: b.key, label: b.label, num: true, value: (r: GroupRow) => r.periods[b.key] ?? 0, render: (r: GroupRow) => fmtMoney(r.periods[b.key] ?? 0) })),
    { key: 'total', label: 'Total', num: true, value: (r) => r.total, render: (r) => fmtMoney(r.total) },
  ];

  const limit = addMonths(today, within);
  const eolRows: EolRow[] = useMemo(
    () =>
      gear
        .filter((g) => g.status !== 'retired')
        .map((g) => ({ ...lifeRow(g, productOf(g), today), g }))
        .filter((r) => r.endOfLife && r.endOfLife <= limit)
        .sort((a, b) => a.endOfLife!.localeCompare(b.endOfLife!)),
    [gear, products, today, limit],
  );
  const eolCols: Column<EolRow>[] = [
    { key: 'gear', label: 'Gear', value: (r) => r.g.name, render: (r) => <Link className="link" to={`/gear/${r.g.id}`}>{r.g.name}</Link> },
    { key: 'product', label: 'Product', value: (r) => productLabel(r.g.productId) },
    { key: 'program', label: 'Program', value: (r) => (r.g.programAreaId ? programAreas.get(r.g.programAreaId)?.name : '') },
    { key: 'location', label: 'Location', value: (r) => (r.g.locationId ? locations.get(r.g.locationId)?.name : '') },
    { key: 'status', label: 'Status', value: (r) => r.g.status, render: (r) => <StatusBadge status={r.g.status} /> },
    { key: 'age', label: 'Age (yrs)', num: true, value: (r) => r.ageYears },
    { key: 'eol', label: 'End of life', value: (r) => r.endOfLife, render: (r) => <span className={r.endOfLife! < today ? 'font-medium text-red-800' : ''}>{fmtDate(r.endOfLife)}</span> },
    { key: 'used', label: 'Life used', num: true, value: (r) => (r.lifeUsedPercent === null ? null : `${r.lifeUsedPercent}%`) },
    { key: 'cost', label: 'Replacement cost', num: true, value: (r) => r.replacementCost, render: (r) => fmtMoney(r.replacementCost) },
  ];

  return (
    <div className="space-y-5">
      <StatRow>
        <StatTile label="Past end of life" value={fmtMoney(past.cost)} sub={plural(past.count, 'item') + ' still in service'} tone={past.count ? 'bad' : undefined} />
        <StatTile label="Next 12 months" value={fmtMoney(next12Cost)} sub={plural(next12.buckets.slice(1).reduce((s, b) => s + b.count, 0), 'item')} />
        <StatTile label={`Next ${horizon} years`} value={fmtMoney(futureCost)} sub={plural(future.reduce((s, b) => s + b.count, 0), 'item')} />
        <StatTile
          label="Can't forecast"
          value={(forecast.unknownEol.length + unpriced).toLocaleString()}
          sub={`${forecast.unknownEol.length} without a lifetime or dates · ${unpriced} without a cost`}
          tone={forecast.unknownEol.length + unpriced ? 'warn' : undefined}
        />
      </StatRow>

      <Card
        title="Replacement budget forecast"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Select className="w-auto" value={period} onChange={(e) => setPeriod(e.target.value)} aria-label="Period">
              <option value="year">By year</option>
              <option value="quarter">By quarter</option>
            </Select>
            <Select className="w-auto" value={horizon} onChange={(e) => setHorizon(e.target.value)} aria-label="Horizon">
              {[3, 5, 10].map((n) => (
                <option key={n} value={n}>
                  Next {n} years
                </option>
              ))}
            </Select>
          </div>
        }
      >
        <ColumnChart
          ariaLabel="Replacement cost by period"
          format={shortMoney}
          data={future.map((b) => ({
            key: b.key,
            label: b.label,
            short: b.key.includes('-Q') ? `${b.key.slice(5)} '${b.key.slice(2, 4)}` : undefined,
            value: b.cost,
            tooltip: (
              <>
                <div className="tabular-nums">{fmtMoney(b.cost)}</div>
                <div>
                  {plural(b.count, 'item')} reach end of life{b.unpriced ? ` · ${b.unpriced} without a cost` : ''}
                </div>
              </>
            ),
          }))}
        />
        <p className="mt-3 text-xs text-stone-500">
          Each item in service is counted in the period its life ends (custom end of life, else the product’s lifetime from manufacture, first use or purchase), at the product’s
          replacement cost, else its purchase value. {past.count > 0 && `Not charted: ${fmtMoney(past.cost)} for ${plural(past.count, 'item')} already past end of life.`}
        </p>
      </Card>

      <section className="card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-100 px-4 py-3">
          <h2 className="text-sm font-semibold">Forecast by {GROUP_BY[by].toLowerCase()}</h2>
          <div className="flex flex-wrap items-center gap-2">
            <GroupBySelect value={by} onChange={setBy} />
            <ExportButtons name={`Replacement forecast by ${GROUP_BY[by]}`} columns={groupCols} rows={byGroup} />
          </div>
        </div>
        <ReportTable columns={groupCols} rows={byGroup} rowKey={(r) => r.key} empty="Nothing reaches end of life in this period" />
      </section>

      <section className="card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-100 px-4 py-3">
          <h2 className="text-sm font-semibold">
            {plural(eolRows.length, 'item')} past or reaching end of life within{' '}
            <Select className="inline-block w-auto py-1" value={within} onChange={(e) => setWithin(e.target.value)} aria-label="Within">
              {[3, 6, 12, 24, 36].map((n) => (
                <option key={n} value={n}>
                  {n} months
                </option>
              ))}
            </Select>
          </h2>
          <ExportButtons name="End of life" columns={eolCols} rows={eolRows} />
        </div>
        <ReportTable columns={eolCols} rows={eolRows} rowKey={(r) => r.g.id} empty="Nothing reaches end of life in this window" />
      </section>
    </div>
  );
}

import { useMemo } from 'react';
import { scheduleKind, type InspectionKind } from '@gear/shared';
import { useData } from '../data/DataProvider';
import { Card, Spinner } from '../components/ui';
import { fmtDate, plural } from '../lib/format';
import { useInspectionSummaries } from '../inspections/common';
import { BarList, StatRow, StatTile } from './charts';
import { useInspectionsBetween } from './data';
import { ExportButtons, GROUP_BY, GroupBySelect, ReportTable, groupKeyFn, groupName, pct, useGroupBy, type Column, type GearDoc, type useDateRange } from './common';

interface GroupRow {
  key: string;
  scheduled: number;
  upToDate: number;
  dueSoon: number;
  overdue: number;
  done: number;
  inService: number;
  inDepth: number;
  failed: number;
}

export function InspectionReport({ gear, range }: { gear: GearDoc[]; range: ReturnType<typeof useDateRange> }) {
  const data = useData();
  const { products } = data;
  const [by, setBy] = useGroupBy();
  const summaries = useInspectionSummaries();
  const insp = useInspectionsBetween(range.from, range.to);
  const inService = useMemo(() => gear.filter((g) => g.status !== 'retired'), [gear]);
  const ids = useMemo(() => new Set(gear.map((g) => g.id)), [gear]);
  const keyOf = groupKeyFn(by, data);

  /** The kind of schedule an inspection's form is on for that gear's product. */
  const kindOf = (gearId: string, formId: string): InspectionKind | null => {
    const g = data.gear.get(gearId);
    const s = g?.productId ? products.get(g.productId)?.inspectionSchedules?.find((x) => x.formId === formId) : undefined;
    return s ? scheduleKind(s) : null;
  };

  const groups = useMemo(() => {
    const out = new Map<string, GroupRow>();
    const row = (key: string) => {
      let r = out.get(key);
      if (!r) out.set(key, (r = { key, scheduled: 0, upToDate: 0, dueSoon: 0, overdue: 0, done: 0, inService: 0, inDepth: 0, failed: 0 }));
      return r;
    };
    // Compliance now: in-depth schedules only — in-service checks are only due while gear is in use.
    for (const g of inService) {
      const s = summaries.get(g.id);
      if (!s?.schedules.some((x) => x.kind === 'in_depth')) continue;
      const r = row(keyOf(g) ?? '');
      r.scheduled++;
      if (s.inDepthState === 'overdue') r.overdue++;
      else if (s.inDepthState === 'due_soon') r.dueSoon++;
      else r.upToDate++;
    }
    for (const i of insp.data ?? []) {
      const g = data.gear.get(i.gearId);
      if (!g || !ids.has(g.id)) continue;
      const r = row(keyOf(g) ?? '');
      r.done++;
      if (i.failedCount > 0) r.failed++;
      const k = kindOf(i.gearId, i.formId);
      if (k === 'in_service') r.inService++;
      else r.inDepth++;
    }
    return [...out.values()].sort((a, b) => b.overdue - a.overdue || b.scheduled - a.scheduled);
  }, [inService, summaries, insp.data, ids, by, data]);

  const byForm = useMemo(() => {
    const out = new Map<string, { key: string; name: string; done: number; failed: number }>();
    for (const i of insp.data ?? []) {
      if (!ids.has(i.gearId)) continue;
      const r = out.get(i.formId) ?? { key: i.formId, name: i.formName, done: 0, failed: 0 };
      r.done++;
      if (i.failedCount > 0) r.failed++;
      out.set(i.formId, r);
    }
    return [...out.values()];
  }, [insp.data, ids]);

  if (!insp.data) return insp.error ? <p className="text-sm text-red-700">{insp.error}</p> : <Spinner />;

  const t = groups.reduce(
    (s, r) => ({ scheduled: s.scheduled + r.scheduled, upToDate: s.upToDate + r.upToDate, overdue: s.overdue + r.overdue, dueSoon: s.dueSoon + r.dueSoon, done: s.done + r.done, failed: s.failed + r.failed }),
    { scheduled: 0, upToDate: 0, overdue: 0, dueSoon: 0, done: 0, failed: 0 },
  );
  const columns: Column<GroupRow>[] = [
    { key: 'name', label: GROUP_BY[by], value: (r) => groupName(by, r.key, data) },
    { key: 'sched', label: 'On in-depth schedule', num: true, value: (r) => r.scheduled },
    { key: 'ok', label: 'Up to date', num: true, value: (r) => r.upToDate + r.dueSoon },
    { key: 'soon', label: 'Due soon', num: true, value: (r) => r.dueSoon },
    { key: 'over', label: 'Overdue', num: true, value: (r) => r.overdue, render: (r) => <span className={r.overdue ? 'font-medium text-red-800' : ''}>{r.overdue}</span> },
    { key: 'rate', label: '% current', num: true, value: (r) => pct(r.upToDate + r.dueSoon, r.scheduled) },
    { key: 'done', label: 'Inspections done', num: true, value: (r) => r.done },
    { key: 'svc', label: 'In-service', num: true, value: (r) => r.inService },
    { key: 'depth', label: 'In-depth', num: true, value: (r) => r.inDepth },
    { key: 'failed', label: 'With failures', num: true, value: (r) => r.failed },
  ];
  type F = (typeof byForm)[number];
  const formCols: Column<F>[] = [
    { key: 'name', label: 'Form', value: (r) => r.name },
    { key: 'done', label: 'Done', num: true, value: (r) => r.done },
    { key: 'failed', label: 'With failures', num: true, value: (r) => r.failed },
    { key: 'rate', label: 'Failure rate', num: true, value: (r) => pct(r.failed, r.done) },
  ];

  return (
    <div className="space-y-5">
      <StatRow>
        <StatTile label="In-depth inspections current" value={pct(t.upToDate + t.dueSoon, t.scheduled)} sub={`${t.upToDate + t.dueSoon} of ${plural(t.scheduled, 'item')} on a schedule, today`} />
        <StatTile label="Overdue now" value={t.overdue.toLocaleString()} sub={`${t.dueSoon} more due soon`} tone={t.overdue ? 'bad' : undefined} />
        <StatTile label="Inspections done" value={t.done.toLocaleString()} sub={range.label ?? `${fmtDate(range.from)} – ${fmtDate(range.to)}`} />
        <StatTile label="With failed items" value={pct(t.failed, t.done)} sub={plural(t.failed, 'inspection')} />
      </StatRow>
      <Card title={`Overdue in-depth inspections by ${GROUP_BY[by].toLowerCase()}`} actions={<GroupBySelect value={by} onChange={setBy} />}>
        <BarList
          empty="Nothing overdue"
          data={groups.map((g) => ({ key: g.key, label: groupName(by, g.key, data), value: g.overdue, detail: `${g.overdue} of ${g.scheduled} on a schedule` }))}
        />
      </Card>
      <section className="card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-100 px-4 py-3">
          <h2 className="text-sm font-semibold">Completion by {GROUP_BY[by].toLowerCase()}</h2>
          <ExportButtons name={`Inspection completion by ${GROUP_BY[by]}`} columns={columns} rows={groups} />
        </div>
        <ReportTable columns={columns} rows={groups} rowKey={(r) => r.key} />
      </section>
      <section className="card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-100 px-4 py-3">
          <h2 className="text-sm font-semibold">By form</h2>
          <ExportButtons name="Inspections by form" columns={formCols} rows={byForm} />
        </div>
        <ReportTable columns={formCols} rows={[...byForm].sort((a, b) => b.done - a.done)} rowKey={(r) => r.key} empty="No inspections in this period" />
      </section>
      <p className="text-xs text-stone-500">
        “Current” counts in-depth schedules as of today. In-service checks are only due while gear is in use, so they’re counted as inspections done rather than as
        compliance.
      </p>
    </div>
  );
}

import { useMemo } from 'react';
import { groupGear, todayIso, type GroupTotals } from '@gear/shared';
import { useData } from '../data/DataProvider';
import { Card, Checkbox } from '../components/ui';
import { fmtMoney, plural } from '../lib/format';
import { BarList, StatRow, StatTile } from './charts';
import { ExportButtons, GROUP_BY, GroupBySelect, ReportTable, groupKeyFn, groupName, useGroupBy, useParam, type Column, type GearDoc } from './common';

export function InventoryReport({ gear }: { gear: GearDoc[] }) {
  const data = useData();
  const [by, setBy] = useGroupBy();
  const [retired, setRetired] = useParam('retired');
  const today = todayIso();
  const scope = useMemo(() => (retired ? gear : gear.filter((g) => g.status !== 'retired')), [gear, retired]);
  const groups = useMemo(() => groupGear(scope, groupKeyFn(by, data), today), [scope, by, data, today]);
  const all = useMemo(() => groupGear(scope, () => 'all', today)[0], [scope, today]);

  const columns: Column<GroupTotals>[] = [
    { key: 'name', label: GROUP_BY[by], value: (r) => groupName(by, r.key, data) },
    { key: 'count', label: 'Items', num: true, value: (r) => r.count },
    { key: 'active', label: 'Active', num: true, value: (r) => r.byStatus.active },
    { key: 'issues', label: 'Has issues', num: true, value: (r) => r.byStatus.has_issues },
    { key: 'quar', label: 'Quarantined', num: true, value: (r) => r.byStatus.quarantined },
    ...(retired ? [{ key: 'ret', label: 'Retired', num: true, value: (r: GroupTotals) => r.byStatus.retired }] : []),
    { key: 'value', label: 'Purchase value', num: true, value: (r) => r.value, render: (r) => fmtMoney(r.value) },
    { key: 'age', label: 'Avg age (yrs)', num: true, value: (r) => r.avgAgeYears },
  ];

  return (
    <div className="space-y-5">
      <StatRow>
        <StatTile label={retired ? 'Items (incl. retired)' : 'Items in service'} value={(all?.count ?? 0).toLocaleString()} />
        <StatTile label="Purchase value" value={fmtMoney(all?.value ?? 0)} />
        <StatTile label="Average age" value={all?.avgAgeYears != null ? `${all.avgAgeYears} yrs` : '—'} sub="From purchase, else manufacture" />
        <StatTile
          label="Out of service"
          value={((all?.byStatus.quarantined ?? 0) + (all?.byStatus.has_issues ?? 0)).toLocaleString()}
          sub={`${all?.byStatus.quarantined ?? 0} quarantined · ${all?.byStatus.has_issues ?? 0} with issues`}
          tone={all?.byStatus.quarantined ? 'bad' : undefined}
        />
      </StatRow>
      <Card
        title={`Items by ${GROUP_BY[by].toLowerCase()}`}
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <Checkbox label="Include retired" checked={!!retired} onChange={(e) => setRetired(e.target.checked ? '1' : '')} />
            <GroupBySelect value={by} onChange={setBy} />
          </div>
        }
      >
        <BarList
          data={groups.map((g) => ({
            key: g.key,
            label: groupName(by, g.key, data),
            value: g.count,
            detail: `${fmtMoney(g.value)} · ${g.byStatus.quarantined} quarantined`,
          }))}
        />
      </Card>
      <section className="card">
        <div className="flex items-center justify-between gap-2 border-b border-stone-100 px-4 py-3">
          <h2 className="text-sm font-semibold">{plural(groups.length, GROUP_BY[by].toLowerCase())}</h2>
          <ExportButtons name={`Inventory by ${GROUP_BY[by]}`} columns={columns} rows={groups} />
        </div>
        <ReportTable columns={columns} rows={groups} rowKey={(r) => r.key} />
      </section>
    </div>
  );
}

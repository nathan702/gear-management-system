import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ClipboardCheck, ClipboardList, Users } from 'lucide-react';
import { responsibleInspectors, type DueState } from '@gear/shared';
import { useMe } from '../auth/AuthProvider';
import { byName, sortedValues, useData } from '../data/DataProvider';
import { Checkbox, Empty, LinkButton, PageHeader, Select, StatusBadge } from '../components/ui';
import { DueBadge, dueText, useInspectionSummaries } from '../inspections/common';
import { useInspections } from '../inspections/useInspections';
import { fmtDate, plural } from '../lib/format';

export function InspectionsPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'recent' ? 'recent' : 'due';
  const { isManager } = useMe();
  const setTab = (t: string) => setParams(t === 'due' ? {} : { tab: t });

  return (
    <div>
      <PageHeader
        title="Inspections"
        actions={
          <>
            <LinkButton to="/inspections/forms">
              <ClipboardList size={16} /> Forms
            </LinkButton>
            {isManager && (
              <LinkButton to="/inspections/assignments">
                <Users size={16} /> Who inspects what
              </LinkButton>
            )}
          </>
        }
      />
      <div className="mb-4 flex gap-1 border-b border-stone-200">
        {[
          ['due', 'Due'],
          ['recent', 'Recent'],
        ].map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`border-b-2 px-3 py-2 text-sm font-medium ${k === tab ? 'border-brand-700 text-brand-800' : 'border-transparent text-stone-600 hover:text-stone-900'}`}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'due' ? <DueList /> : <RecentList />}
    </div>
  );
}

function DueList() {
  const { uid } = useMe();
  const { gear, products, programAreas, locations, users, inspectionForms, inspectionAssignments, productLabel } = useData();
  const summaries = useInspectionSummaries();
  const [params, setParams] = useSearchParams();
  const mine = params.get('mine') === '1';
  const state = (params.get('state') as DueState | null) ?? '';
  const program = params.get('program') ?? '';
  const location = params.get('location') ?? '';
  const setP = (k: string, v: string) => {
    const n = new URLSearchParams(params);
    if (v) n.set(k, v);
    else n.delete(k);
    setParams(n, { replace: true });
  };

  const rows = useMemo(
    () =>
      [...gear.values()]
        .map((g) => {
          const s = summaries.get(g.id)!;
          const product = g.productId ? products.get(g.productId) : undefined;
          return { g, s, who: responsibleInspectors(g, product, inspectionAssignments) };
        })
        .filter(({ g, s, who }) => {
          if (s.state !== 'overdue' && s.state !== 'due_soon') return false;
          if (state && s.state !== state) return false;
          if (mine && !who?.userIds.includes(uid)) return false;
          if (program && g.programAreaId !== program) return false;
          if (location && g.locationId !== location) return false;
          return true;
        })
        .sort((a, b) => (a.s.state === b.s.state ? (a.s.nextDueDate ?? '').localeCompare(b.s.nextDueDate ?? '') || byName(a.g, b.g) : a.s.state === 'overdue' ? -1 : 1)),
    [gear, products, summaries, inspectionAssignments, mine, state, program, location, uid],
  );

  const overdue = rows.filter((r) => r.s.state === 'overdue').length;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Select className="w-auto" value={state} onChange={(e) => setP('state', e.target.value)} aria-label="Due state">
          <option value="">Overdue and due soon</option>
          <option value="overdue">Overdue only</option>
          <option value="due_soon">Due soon only</option>
        </Select>
        <Select className="w-auto" value={program} onChange={(e) => setP('program', e.target.value)} aria-label="Program area">
          <option value="">All programs</option>
          {sortedValues(programAreas).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
        <Select className="w-auto" value={location} onChange={(e) => setP('location', e.target.value)} aria-label="Location">
          <option value="">All locations</option>
          {sortedValues(locations).map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </Select>
        <Checkbox label="Assigned to me" checked={mine} onChange={(e) => setP('mine', e.target.checked ? '1' : '')} />
        <span className="ml-auto text-sm text-stone-600">
          {plural(rows.length, 'item')}
          {overdue ? ` · ${overdue} overdue` : ''}
        </span>
      </div>
      {rows.length === 0 ? (
        <Empty title="Nothing due">
          {inspectionForms.size === 0 ? (
            <>
              Create <Link className="link" to="/inspections/forms">inspection forms</Link>, then add schedules to products.
            </>
          ) : (
            'All gear with an inspection schedule is up to date.'
          )}
        </Empty>
      ) : (
        <ul className="card divide-y divide-stone-100">
          {rows.map(({ g, s, who }) => {
            const due = s.schedules.filter((x) => x.state !== 'ok');
            return (
              <li key={g.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link to={`/gear/${g.id}`} className="font-medium hover:underline">
                      {g.name}
                    </Link>
                    <DueBadge state={s.state} short />
                    {g.status !== 'active' && <StatusBadge status={g.status} />}
                  </div>
                  <div className="text-xs text-stone-500">
                    {productLabel(g.productId)}
                    {g.locationId && ` · ${locations.get(g.locationId)?.name ?? ''}`}
                    {who && ` · ${who.userIds.map((u) => users.get(u)?.displayName ?? '?').join(', ')}`}
                  </div>
                  <ul className="mt-1 text-xs text-stone-700">
                    {due.map((x) => (
                      <li key={x.schedule.formId}>
                        {inspectionForms.get(x.schedule.formId)?.name ?? 'Deleted form'}: {dueText(x)}
                      </li>
                    ))}
                  </ul>
                </div>
                <LinkButton size="sm" variant="primary" to={due.length === 1 ? `/gear/${g.id}/inspect?form=${due[0].schedule.formId}` : `/gear/${g.id}/inspect`}>
                  <ClipboardCheck size={14} /> Inspect
                </LinkButton>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function RecentList() {
  const { gear, users } = useData();
  const list = useInspections({ max: 100 });
  if (!list) return null;
  if (!list.length) return <Empty title="No inspections yet" />;
  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-stone-200 bg-stone-50 text-xs text-stone-500 uppercase">
          <tr>
            <th className="px-3 py-2">Date</th>
            <th className="px-3 py-2">Gear</th>
            <th className="px-3 py-2">Form</th>
            <th className="px-3 py-2">Inspector</th>
            <th className="px-3 py-2">Result</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-100">
          {list.map((i) => (
            <tr key={i.id} className="hover:bg-stone-50">
              <td className="px-3 py-2 whitespace-nowrap">
                <Link className="link" to={`/inspections/${i.id}`}>
                  {fmtDate(i.date)}
                </Link>
              </td>
              <td className="px-3 py-2">{gear.get(i.gearId)?.name ?? 'Deleted gear'}</td>
              <td className="px-3 py-2">{i.formName}</td>
              <td className="px-3 py-2">{users.get(i.inspectorId)?.displayName ?? '—'}</td>
              <td className="px-3 py-2">
                <span className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={i.override?.status ?? i.calculatedStatus} />
                  {i.failedCount > 0 && <span className="text-xs text-stone-500">{i.failedCount} failed</span>}
                  {i.override && <span className="text-xs text-stone-500">overridden</span>}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

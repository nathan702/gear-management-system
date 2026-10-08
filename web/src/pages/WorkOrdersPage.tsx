import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Plus, Settings2 } from 'lucide-react';
import { PRIORITIES, PRIORITY_LABELS, isOverdue, todayIso, workOrderNumber, type Priority } from '@gear/shared';
import { useMe } from '../auth/AuthProvider';
import { compareText, sortedValues, useData } from '../data/DataProvider';
import { Empty, LinkButton, PageHeader, Select } from '../components/ui';
import { OverdueBadge, PriorityText, SeverityBadge, WoStatusBadge, useClosedWorkOrders, type WorkOrderDoc } from '../workOrders/common';
import { fmtDate, fmtTimestamp, plural } from '../lib/format';

const PRIORITY_RANK: Record<Priority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

export function WorkOrdersPage() {
  const { uid, isManager, isAdmin, profile } = useMe();
  const { openWorkOrders, gear, users, programAreas, productLabel } = useData();
  const [params, setParams] = useSearchParams();
  const defaultView = profile.role === 'technician' ? 'mine' : 'open';
  const view = params.get('view') ?? defaultView;
  const assignee = params.get('assignee') ?? '';
  const priority = params.get('priority') ?? '';
  const program = params.get('program') ?? '';
  const setP = (k: string, v: string) => {
    const n = new URLSearchParams(params);
    if (v) n.set(k, v);
    else n.delete(k);
    setParams(n, { replace: true });
  };
  const closed = useClosedWorkOrders(view === 'closed');
  const today = todayIso();

  const list = useMemo(() => {
    const source: WorkOrderDoc[] = view === 'closed' ? (closed ?? []) : [...openWorkOrders.values()];
    return source
      .filter((w) => {
        if (view === 'mine' && w.assigneeId !== uid) return false;
        if (view === 'overdue' && !isOverdue(w, today)) return false;
        if (view === 'unassigned' && w.assigneeId) return false;
        if (assignee && w.assigneeId !== assignee) return false;
        if (priority && w.priority !== priority) return false;
        if (program && gear.get(w.gearId)?.programAreaId !== program) return false;
        return true;
      })
      .sort((a, b) =>
        view === 'closed'
          ? 0
          : Number(isOverdue(b, today)) - Number(isOverdue(a, today)) ||
            PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
            (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'),
      );
  }, [view, closed, openWorkOrders, uid, today, assignee, priority, program, gear]);

  const all = [...openWorkOrders.values()];
  const tabs: [string, string, number | null][] = [
    ['open', 'Open', all.length],
    ['mine', 'Assigned to me', all.filter((w) => w.assigneeId === uid).length],
    ['overdue', 'Overdue', all.filter((w) => isOverdue(w, today)).length],
    ['unassigned', 'Unassigned', all.filter((w) => !w.assigneeId).length],
    ['closed', 'Closed', null],
  ];
  const people = [...users.values()].filter((u) => u.active).sort((a, b) => compareText(a.displayName, b.displayName));

  return (
    <div>
      <PageHeader
        title="Work orders"
        actions={
          <>
            {isAdmin && (
              <LinkButton to="/work-orders/rules">
                <Settings2 size={16} /> Assignment rules
              </LinkButton>
            )}
            {isManager && (
              <LinkButton to="/work-orders/new" variant="primary">
                <Plus size={16} /> New work order
              </LinkButton>
            )}
          </>
        }
      />
      <div className="mb-4 flex gap-1 overflow-x-auto border-b border-stone-200">
        {tabs.map(([k, label, n]) => (
          <button
            key={k}
            onClick={() => setP('view', k === defaultView ? '' : k)}
            className={`border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap ${k === view ? 'border-brand-700 text-brand-800' : 'border-transparent text-stone-600 hover:text-stone-900'}`}
          >
            {label}
            {n != null && <span className="ml-1.5 rounded-full bg-stone-100 px-1.5 text-xs text-stone-600">{n}</span>}
          </button>
        ))}
      </div>
      <div className="mb-4 flex flex-wrap gap-2">
        <Select className="w-auto" value={assignee} onChange={(e) => setP('assignee', e.target.value)} aria-label="Assignee">
          <option value="">Anyone</option>
          {people.map((u) => (
            <option key={u.id} value={u.id}>
              {u.displayName}
            </option>
          ))}
        </Select>
        <Select className="w-auto" value={priority} onChange={(e) => setP('priority', e.target.value)} aria-label="Priority">
          <option value="">Any priority</option>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {PRIORITY_LABELS[p]}
            </option>
          ))}
        </Select>
        <Select className="w-auto" value={program} onChange={(e) => setP('program', e.target.value)} aria-label="Program area">
          <option value="">All programs</option>
          {sortedValues(programAreas).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
        <span className="ml-auto self-center text-sm text-stone-600">{plural(list.length, 'work order')}</span>
      </div>

      {list.length === 0 ? (
        <Empty title={view === 'closed' ? 'No closed work orders yet' : 'Nothing here'}>
          {view !== 'closed' && 'Failed inspections and reported issues open work orders automatically.'}
        </Empty>
      ) : (
        <ul className="card divide-y divide-stone-100">
          {list.map((w) => {
            const g = gear.get(w.gearId);
            return (
              <li key={w.id}>
                <Link to={`/work-orders/${w.id}`} className="flex flex-wrap items-start gap-x-4 gap-y-1 px-4 py-3 hover:bg-stone-50">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-stone-500">{workOrderNumber(w.number)}</span>
                      <span className="font-medium">{w.title}</span>
                    </div>
                    <div className="text-xs text-stone-500">
                      {g?.name ?? 'Deleted gear'}
                      {g?.productId && ` · ${productLabel(g.productId)}`}
                      {' · '}
                      {w.assigneeId ? (users.get(w.assigneeId)?.displayName ?? 'Unknown') : 'Unassigned'}
                      {view === 'closed' ? ` · closed ${fmtTimestamp(w.closedAt)}` : w.dueDate ? ` · due ${fmtDate(w.dueDate)}` : ''}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <PriorityText priority={w.priority} />
                    <SeverityBadge severity={w.severity} />
                    <OverdueBadge wo={w} />
                    <WoStatusBadge status={w.status} />
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

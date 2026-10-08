import { useState } from 'react';
import { deleteDoc, doc } from 'firebase/firestore';
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from 'lucide-react';
import {
  DEFAULT_WORK_ORDER_RULES,
  FAILURE_OUTCOMES,
  PRIORITIES,
  PRIORITY_LABELS,
  SEVERITY_LABELS,
  type FailureOutcome,
  type Priority,
  type WithId,
  type WorkOrderRule,
} from '@gear/shared';
import { db } from '../firebase';
import { useMe } from '../auth/AuthProvider';
import { compareText, sortedValues, useData } from '../data/DataProvider';
import { saveWorkOrderRule } from '../data/writes';
import { Button, Empty, Field, Input, Modal, PageHeader, Select } from '../components/ui';

type Rule = WorkOrderRule & WithId;

export function WorkOrderRulesPage() {
  const { uid } = useMe();
  const { workOrderRules, programAreas, categories, locations, users } = useData();
  const [editing, setEditing] = useState<Partial<Rule> | null>(null);

  const name = (map: Map<string, { name: string }>, id?: string | null) => (id ? (map.get(id)?.name ?? '?') : null);
  const describe = (r: Rule) =>
    [
      r.severity ? SEVERITY_LABELS[r.severity] : null,
      name(programAreas, r.programAreaId),
      name(categories, r.categoryId),
      name(locations, r.locationId),
    ]
      .filter(Boolean)
      .join(' · ') || 'Everything';

  const swap = async (i: number, j: number) => {
    const a = workOrderRules[i];
    const b = workOrderRules[j];
    const { id: aid, createdAt: _a, createdBy: _b, updatedAt: _c, updatedBy: _d, ...ad } = a;
    const { id: bid, createdAt: _e, createdBy: _f, updatedAt: _g, updatedBy: _h, ...bd } = b;
    await Promise.all([saveWorkOrderRule(uid, aid, { ...ad, order: b.order }), saveWorkOrderRule(uid, bid, { ...bd, order: a.order })]);
  };

  return (
    <div className="max-w-3xl">
      <PageHeader
        back={{ to: '/work-orders', label: 'Work orders' }}
        title="Work order assignment rules"
        subtitle="Work orders opened by failed inspections and reported issues get their assignee, due date and priority from the first rule that matches. Leave a field as “Any” to match everything."
        actions={
          <Button variant="primary" onClick={() => setEditing({ priority: 'normal', dueInDays: 30, assigneeId: null })}>
            <Plus size={16} /> Add rule
          </Button>
        }
      />
      {workOrderRules.length === 0 ? (
        <Empty title="No rules yet">
          <Button
            className="mt-3"
            onClick={async () => {
              for (const r of DEFAULT_WORK_ORDER_RULES) await saveWorkOrderRule(uid, null, { ...r, programAreaId: null, categoryId: null, locationId: null });
            }}
          >
            Add starter rules (7 / 30 / 90 days by severity)
          </Button>
        </Empty>
      ) : (
        <ol className="card divide-y divide-stone-100">
          {workOrderRules.map((r, i) => (
            <li key={r.id} className="flex items-center gap-3 px-4 py-3 text-sm">
              <span className="w-5 text-right text-stone-400 tabular-nums">{i + 1}.</span>
              <div className="min-w-0 flex-1">
                <div className="font-medium">{r.name}</div>
                <div className="text-xs text-stone-500">
                  When: {describe(r)} → {r.assigneeId ? (users.get(r.assigneeId)?.displayName ?? 'Unknown') : 'unassigned'}
                  {r.dueInDays != null ? `, due in ${r.dueInDays} days` : ', no due date'}, {PRIORITY_LABELS[r.priority].toLowerCase()} priority
                </div>
              </div>
              <Button size="sm" variant="ghost" aria-label="Move up" disabled={i === 0} onClick={() => swap(i, i - 1)}>
                <ArrowUp size={16} />
              </Button>
              <Button size="sm" variant="ghost" aria-label="Move down" disabled={i === workOrderRules.length - 1} onClick={() => swap(i, i + 1)}>
                <ArrowDown size={16} />
              </Button>
              <Button size="sm" variant="ghost" aria-label={`Edit ${r.name}`} onClick={() => setEditing(r)}>
                <Pencil size={16} />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-red-700"
                aria-label={`Delete ${r.name}`}
                onClick={() => confirm(`Delete the rule “${r.name}”?`) && deleteDoc(doc(db, 'workOrderRules', r.id))}
              >
                <Trash2 size={16} />
              </Button>
            </li>
          ))}
        </ol>
      )}
      {editing && (
        <RuleModal
          rule={editing}
          nextOrder={(workOrderRules.at(-1)?.order ?? 0) + 10}
          people={[...users.values()].filter((u) => u.active).sort((a, b) => compareText(a.displayName, b.displayName))}
          programAreas={sortedValues(programAreas)}
          categories={sortedValues(categories)}
          locations={sortedValues(locations)}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function RuleModal({
  rule,
  nextOrder,
  people,
  programAreas,
  categories,
  locations,
  onClose,
}: {
  rule: Partial<Rule>;
  nextOrder: number;
  people: { id: string; displayName: string }[];
  programAreas: { id: string; name: string }[];
  categories: { id: string; name: string }[];
  locations: { id: string; name: string }[];
  onClose(): void;
}) {
  const { uid } = useMe();
  const [d, setD] = useState({
    name: rule.name ?? '',
    severity: rule.severity ?? '',
    programAreaId: rule.programAreaId ?? '',
    categoryId: rule.categoryId ?? '',
    locationId: rule.locationId ?? '',
    assigneeId: rule.assigneeId ?? '',
    dueInDays: rule.dueInDays != null ? String(rule.dueInDays) : '',
    priority: rule.priority ?? 'normal',
  });
  const set = (k: keyof typeof d) => (e: { target: { value: string } }) => setD((x) => ({ ...x, [k]: e.target.value }));
  const any = (list: { id: string; name: string }[]) => [
    <option key="" value="">
      Any
    </option>,
    ...list.map((x) => (
      <option key={x.id} value={x.id}>
        {x.name}
      </option>
    )),
  ];
  return (
    <Modal
      open
      onClose={onClose}
      title={rule.id ? 'Edit rule' : 'Add rule'}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!d.name.trim()}
            onClick={async () => {
              await saveWorkOrderRule(uid, rule.id ?? null, {
                order: rule.order ?? nextOrder,
                name: d.name.trim(),
                severity: (d.severity || null) as FailureOutcome | null,
                programAreaId: d.programAreaId || null,
                categoryId: d.categoryId || null,
                locationId: d.locationId || null,
                assigneeId: d.assigneeId || null,
                dueInDays: d.dueInDays.trim() ? Math.max(0, Math.round(Number(d.dueInDays))) : null,
                priority: d.priority as Priority,
              });
              onClose();
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" className="sm:col-span-2">
          <Input value={d.name} onChange={set('name')} placeholder="e.g. River School rafts" autoFocus />
        </Field>
        <p className="text-sm font-medium sm:col-span-2">When the work order is for…</p>
        <Field label="Severity">
          <Select value={d.severity} onChange={set('severity')}>
            <option value="">Any</option>
            {FAILURE_OUTCOMES.map((s) => (
              <option key={s} value={s}>
                {SEVERITY_LABELS[s]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Program area">
          <Select value={d.programAreaId} onChange={set('programAreaId')}>
            {any(programAreas)}
          </Select>
        </Field>
        <Field label="Category">
          <Select value={d.categoryId} onChange={set('categoryId')}>
            {any(categories)}
          </Select>
        </Field>
        <Field label="Location">
          <Select value={d.locationId} onChange={set('locationId')}>
            {any(locations)}
          </Select>
        </Field>
        <p className="text-sm font-medium sm:col-span-2">…then</p>
        <Field label="Assign to">
          <Select value={d.assigneeId} onChange={set('assigneeId')}>
            <option value="">Leave unassigned</option>
            {people.map((u) => (
              <option key={u.id} value={u.id}>
                {u.displayName}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Due in (days)" hint="Blank = no due date">
          <Input inputMode="numeric" value={d.dueInDays} onChange={set('dueInDays')} />
        </Field>
        <Field label="Priority">
          <Select value={d.priority} onChange={set('priority')}>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABELS[p]}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </Modal>
  );
}

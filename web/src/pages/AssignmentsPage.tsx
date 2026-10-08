import { useState } from 'react';
import { ASSIGNMENT_SCOPES, type AssignmentScope } from '@gear/shared';
import { useMe } from '../auth/AuthProvider';
import { compareText, sortedValues, useData } from '../data/DataProvider';
import { saveAssignment } from '../data/writes';
import { Button, Modal, PageHeader } from '../components/ui';

const SCOPE_LABELS: Record<AssignmentScope, string> = {
  product: 'By product',
  category: 'By category',
  location: 'By location',
  programArea: 'By program area',
};

export function AssignmentsPage() {
  const { uid } = useMe();
  const data = useData();
  const [scope, setScope] = useState<AssignmentScope>('programArea');
  const [editing, setEditing] = useState<{ refId: string; name: string } | null>(null);

  const options: { id: string; name: string }[] =
    scope === 'product'
      ? [...data.products.values()].filter((p) => p.active).map((p) => ({ id: p.id, name: data.productLabel(p.id) })).sort((a, b) => compareText(a.name, b.name))
      : sortedValues(data[scope === 'programArea' ? 'programAreas' : scope === 'category' ? 'categories' : 'locations']);
  const assignmentFor = (refId: string) => data.inspectionAssignments.find((a) => a.scope === scope && a.refId === refId);
  const userName = (id: string) => data.users.get(id)?.displayName ?? 'Unknown';

  return (
    <div>
      <PageHeader
        back={{ to: '/inspections', label: 'Inspections' }}
        title="Who inspects what"
        subtitle="Choose who is responsible for inspecting gear. The most specific match wins: product, then category, then location, then program area. These people see the gear under “Assigned to me” and will get reminders."
      />
      <div className="mb-4 flex gap-1 overflow-x-auto border-b border-stone-200">
        {ASSIGNMENT_SCOPES.map((s) => (
          <button
            key={s}
            onClick={() => setScope(s)}
            className={`border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap ${s === scope ? 'border-brand-700 text-brand-800' : 'border-transparent text-stone-600 hover:text-stone-900'}`}
          >
            {SCOPE_LABELS[s]}
          </button>
        ))}
      </div>
      <ul className="card divide-y divide-stone-100">
        {options.map((o) => {
          const a = assignmentFor(o.id);
          return (
            <li key={o.id} className="flex items-center gap-3 px-4 py-3 text-sm">
              <div className="min-w-0 flex-1">
                <div className="font-medium">{o.name}</div>
                <div className="truncate text-xs text-stone-500">{a?.userIds.length ? a.userIds.map(userName).join(', ') : 'No one assigned'}</div>
              </div>
              <Button size="sm" onClick={() => setEditing({ refId: o.id, name: o.name })}>
                {a?.userIds.length ? 'Change' : 'Assign'}
              </Button>
            </li>
          );
        })}
        {!options.length && <li className="px-4 py-6 text-center text-sm text-stone-500">Nothing to assign yet.</li>}
      </ul>
      {editing && (
        <AssignModal
          title={editing.name}
          initial={assignmentFor(editing.refId)?.userIds ?? []}
          onClose={() => setEditing(null)}
          onSave={async (userIds) => {
            await saveAssignment(uid, assignmentFor(editing.refId), { scope, refId: editing.refId, userIds });
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function AssignModal({ title, initial, onClose, onSave }: { title: string; initial: string[]; onClose(): void; onSave(ids: string[]): Promise<void> }) {
  const { users } = useData();
  const [chosen, setChosen] = useState(new Set(initial));
  const people = [...users.values()].filter((u) => u.active || chosen.has(u.id)).sort((a, b) => compareText(a.displayName, b.displayName));
  return (
    <Modal
      open
      onClose={onClose}
      title={`Inspectors for ${title}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => onSave([...chosen])}>
            Save
          </Button>
        </>
      }
    >
      <ul className="space-y-1">
        {people.map((u) => (
          <li key={u.id}>
            <label className="flex items-center gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-stone-50">
              <input
                type="checkbox"
                className="size-4 accent-brand-700"
                checked={chosen.has(u.id)}
                onChange={(e) =>
                  setChosen((s) => {
                    const n = new Set(s);
                    if (e.target.checked) n.add(u.id);
                    else n.delete(u.id);
                    return n;
                  })
                }
              />
              <span className="flex-1">{u.displayName}</span>
              <span className="text-xs text-stone-500">{u.email}</span>
            </label>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { collection, doc } from 'firebase/firestore';
import { applyWorkOrderRules, todayIso, type FailureOutcome, type Priority } from '@gear/shared';
import { db } from '../firebase';
import { useMe } from '../auth/AuthProvider';
import { byName, compareText, useData } from '../data/DataProvider';
import { createWorkOrder } from '../data/writes';
import { Button, Field, PageHeader, Select } from '../components/ui';
import { WorkOrderFields } from './WorkOrderDetailPage';
import { notify } from '../components/toast';

/** Managers open work orders directly — any number per gear. */
export function WorkOrderNewPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { uid } = useMe();
  const { gear, users, products, workOrderRules } = useData();
  const [gearId, setGearId] = useState(params.get('gear') ?? '');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [severity, setSeverity] = useState<FailureOutcome>('note');
  const g = gear.get(gearId);
  const suggested = useMemo(
    () =>
      applyWorkOrderRules(
        workOrderRules,
        { severity, programAreaId: g?.programAreaId, categoryId: g?.productId ? products.get(g.productId)?.categoryId : null, locationId: g?.locationId },
        todayIso(),
      ),
    [workOrderRules, severity, g, products],
  );
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [dueDate, setDueDate] = useState<string | null>(null);
  const [priority, setPriority] = useState<Priority | null>(null);
  const [busy, setBusy] = useState(false);
  const people = [...users.values()].filter((u) => u.active).sort((a, b) => compareText(a.displayName, b.displayName));

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <PageHeader title="New work order" back={{ to: g ? `/gear/${g.id}` : '/work-orders', label: g ? g.name : 'Work orders' }} />
      <div className="card space-y-4 p-5">
        <Field label="Gear">
          <Select value={gearId} onChange={(e) => setGearId(e.target.value)}>
            <option value="">— Choose gear —</option>
            {[...gear.values()]
              .filter((x) => x.status !== 'retired')
              .sort(byName)
              .map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name} ({x.qrCode})
                </option>
              ))}
          </Select>
        </Field>
        <WorkOrderFields
          title={title}
          setTitle={setTitle}
          description={description}
          setDescription={setDescription}
          assigneeId={assigneeId ?? suggested.assigneeId ?? ''}
          setAssigneeId={setAssigneeId}
          dueDate={dueDate ?? suggested.dueDate ?? ''}
          setDueDate={setDueDate}
          priority={priority ?? suggested.priority}
          setPriority={setPriority}
          severity={severity}
          setSeverity={setSeverity}
          people={people}
        />
        {suggested.ruleName && assigneeId === null && dueDate === null && (
          <p className="text-xs text-stone-500">Assignee and due date suggested by the “{suggested.ruleName}” rule.</p>
        )}
      </div>
      <div className="flex justify-end gap-2">
        <Button onClick={() => navigate(-1)}>Cancel</Button>
        <Button
          variant="primary"
          disabled={busy || !g || !title.trim()}
          onClick={async () => {
            if (!g) return;
            setBusy(true);
            try {
              const id = doc(collection(db, 'workOrders')).id;
              await createWorkOrder(uid, id, {
                gearId: g.id,
                productId: g.productId,
                title: title.trim(),
                description: description.trim(),
                severity,
                priority: priority ?? suggested.priority,
                assigneeId: (assigneeId ?? suggested.assigneeId) || null,
                dueDate: (dueDate ?? suggested.dueDate) || null,
                source: 'manual',
              });
              notify('Work order created', 'success');
              navigate(`/work-orders/${id}`, { replace: true });
            } finally {
              setBusy(false);
            }
          }}
        >
          Create work order
        </Button>
      </div>
    </div>
  );
}

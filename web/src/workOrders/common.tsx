import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { collection, doc, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import {
  FAILURE_OUTCOMES,
  PRIORITY_LABELS,
  SEVERITY_LABELS,
  WORK_ORDER_STATUS_LABELS,
  isOverdue,
  todayIso,
  type FailureOutcome,
  type Priority,
  type WithId,
  type WorkOrder,
  type WorkOrderLogEntry,
  type WorkOrderStatus,
} from '@gear/shared';
import { db } from '../firebase';
import { useMe } from '../auth/AuthProvider';
import { useData } from '../data/DataProvider';
import { createWorkOrder } from '../data/writes';
import { Button, Field, Input, Modal, Textarea } from '../components/ui';
import { AddPhotoButton, PhotoGallery, usePhotos } from '../photos/PhotoGallery';
import { notify } from '../components/toast';

export type WorkOrderDoc = WorkOrder & WithId;

const read = (d: { id: string; data(o?: { serverTimestamps: 'estimate' }): unknown }) =>
  ({ id: d.id, ...(d.data({ serverTimestamps: 'estimate' }) as WorkOrder) }) as WorkOrderDoc;

const STATUS_STYLES: Record<WorkOrderStatus, string> = {
  open: 'bg-sky-50 text-sky-800 ring-sky-200',
  in_progress: 'bg-indigo-50 text-indigo-800 ring-indigo-200',
  waiting_parts: 'bg-amber-50 text-amber-800 ring-amber-200',
  done: 'bg-brand-50 text-brand-800 ring-brand-200',
  cancelled: 'bg-stone-100 text-stone-600 ring-stone-300',
};
const PRIORITY_STYLES: Record<Priority, string> = {
  low: 'text-stone-500',
  normal: 'text-stone-700',
  high: 'text-orange-700 font-semibold',
  urgent: 'text-red-700 font-semibold',
};
const SEVERITY_STYLES: Record<FailureOutcome, string> = {
  note: 'bg-stone-50 text-stone-700 ring-stone-200',
  has_issues: 'bg-amber-50 text-amber-800 ring-amber-200',
  quarantined: 'bg-red-50 text-red-800 ring-red-200',
};

const pill = 'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset';

export function WoStatusBadge({ status }: { status: WorkOrderStatus }) {
  return <span className={`${pill} ${STATUS_STYLES[status]}`}>{WORK_ORDER_STATUS_LABELS[status]}</span>;
}
export function SeverityBadge({ severity }: { severity: FailureOutcome }) {
  return <span className={`${pill} ${SEVERITY_STYLES[severity]}`}>{SEVERITY_LABELS[severity]}</span>;
}
export function PriorityText({ priority }: { priority: Priority }) {
  return <span className={`text-xs ${PRIORITY_STYLES[priority]}`}>{PRIORITY_LABELS[priority]} priority</span>;
}
export function OverdueBadge({ wo }: { wo: Pick<WorkOrder, 'status' | 'dueDate'> }) {
  return isOverdue(wo, todayIso()) ? <span className={`${pill} bg-red-50 text-red-800 ring-red-200`}>Overdue</span> : null;
}

/** Work orders for one gear item (open and closed), newest first. */
export function useGearWorkOrders(gearId: string) {
  const [list, setList] = useState<WorkOrderDoc[]>([]);
  useEffect(
    () =>
      onSnapshot(
        query(collection(db, 'workOrders'), where('gearId', '==', gearId), orderBy('createdAt', 'desc'), limit(50)),
        (snap) => setList(snap.docs.map(read)),
        (e) => console.warn('gear work orders', e),
      ),
    [gearId],
  );
  return list;
}

/** Recently closed work orders. */
export function useClosedWorkOrders(enabled: boolean, max = 200) {
  const [list, setList] = useState<WorkOrderDoc[] | null>(null);
  useEffect(() => {
    if (!enabled) return;
    return onSnapshot(
      query(collection(db, 'workOrders'), where('status', 'in', ['done', 'cancelled']), orderBy('closedAt', 'desc'), limit(max)),
      (snap) => setList(snap.docs.map(read)),
      (e) => {
        console.warn('closed work orders', e);
        setList([]);
      },
    );
  }, [enabled, max]);
  return list;
}

export function useWorkOrder(id: string) {
  const [wo, setWo] = useState<WorkOrderDoc | null | undefined>(undefined);
  useEffect(
    () =>
      onSnapshot(
        doc(db, 'workOrders', id),
        (snap) => setWo(snap.exists() ? read(snap) : null),
        () => setWo(null),
      ),
    [id],
  );
  return wo;
}

export function useWorkOrderLog(id: string) {
  const [log, setLog] = useState<(WorkOrderLogEntry & WithId)[]>([]);
  useEffect(
    () =>
      onSnapshot(query(collection(db, 'workOrders', id, 'log'), orderBy('at', 'asc')), (snap) =>
        setLog(snap.docs.map((d) => ({ id: d.id, ...(d.data({ serverTimestamps: 'estimate' }) as WorkOrderLogEntry) }))),
      ),
    [id],
  );
  return log;
}

const SEVERITY_HELP: Record<FailureOutcome, string> = {
  note: 'Worth fixing, but the gear is fine to use. Status unchanged.',
  has_issues: 'Still usable, but needs repair. Gear becomes “Has issues”.',
  quarantined: 'Unsafe — do not use. Gear becomes “Quarantined”.',
};

/** Anyone can report a problem; it opens a work order assigned by the rules. */
export function ReportIssueModal({ gearId, open, onClose }: { gearId: string; open: boolean; onClose(): void }) {
  const { uid } = useMe();
  const { gear } = useData();
  const navigate = useNavigate();
  const g = gear.get(gearId);
  const [id] = useState(() => doc(collection(db, 'workOrders')).id);
  const photos = usePhotos('workOrderId', id);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [severity, setSeverity] = useState<FailureOutcome>('has_issues');
  const [busy, setBusy] = useState(false);
  if (!g) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Report an issue with ${g.name}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={busy || !title.trim()}
            onClick={async () => {
              setBusy(true);
              try {
                await createWorkOrder(uid, id, {
                  gearId: g.id,
                  productId: g.productId,
                  title: title.trim(),
                  description: description.trim(),
                  severity,
                  priority: severity === 'quarantined' ? 'high' : severity === 'has_issues' ? 'normal' : 'low',
                  assigneeId: null,
                  dueDate: null,
                  source: 'issue',
                  autoAssign: true,
                });
                notify('Issue reported — a work order has been opened.', 'success');
                onClose();
                navigate(`/work-orders/${id}`);
              } finally {
                setBusy(false);
              }
            }}
          >
            Report issue
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="What’s wrong?">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Slow leak in the bow tube" autoFocus />
        </Field>
        <Field label="Details (optional)">
          <Textarea className="min-h-20" value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <fieldset>
          <legend className="label">How serious?</legend>
          <div className="grid gap-2">
            {FAILURE_OUTCOMES.map((s) => (
              <label key={s} className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${severity === s ? 'border-brand-500 bg-brand-50' : 'border-stone-200'}`}>
                <input type="radio" name="severity" className="mt-1 accent-brand-700" checked={severity === s} onChange={() => setSeverity(s)} />
                <span>
                  <span className="block text-sm font-medium">{SEVERITY_LABELS[s]}</span>
                  <span className="block text-xs text-stone-600">{SEVERITY_HELP[s]}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <div>
          <p className="label">Photos ({photos.length})</p>
          <div className="space-y-2">
            <PhotoGallery photos={photos} emptyText="Optional." />
            <AddPhotoButton links={{ gearId: g.id, workOrderId: id }} />
          </div>
        </div>
      </div>
    </Modal>
  );
}

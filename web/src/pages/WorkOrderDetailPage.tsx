import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { deleteDoc, doc } from 'firebase/firestore';
import { CheckCircle2, MessageSquare, Pencil, RotateCcw, Trash2, XCircle } from 'lucide-react';
import {
  FAILURE_OUTCOMES,
  PRIORITIES,
  PRIORITY_LABELS,
  SEVERITY_LABELS,
  STATUS_LABELS,
  gearStatusAfterClosing,
  isOpen,
  workOrderNumber,
  type FailureOutcome,
  type Priority,
  type WorkOrderStatus,
} from '@gear/shared';
import { db } from '../firebase';
import { useMe } from '../auth/AuthProvider';
import { compareText, useData } from '../data/DataProvider';
import { addWorkOrderComment, updateWorkOrder } from '../data/writes';
import { Button, Card, Dl, Field, Input, Modal, PageHeader, Select, Spinner, StatusBadge, Textarea } from '../components/ui';
import { AddPhotoButton, PhotoGallery, usePhotos } from '../photos/PhotoGallery';
import { OverdueBadge, PriorityText, SeverityBadge, WoStatusBadge, useWorkOrder, useWorkOrderLog, type WorkOrderDoc } from '../workOrders/common';
import { fmtDate, fmtMoney, fmtTimestamp, numOrNull } from '../lib/format';
import { notify } from '../components/toast';

export function WorkOrderDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { uid, isManager, isAdmin } = useMe();
  const { gear, users, openWorkOrders, productLabel } = useData();
  const wo = useWorkOrder(id);
  const log = useWorkOrderLog(id);
  const photos = usePhotos('workOrderId', id);
  const [closing, setClosing] = useState<'done' | 'cancelled' | null>(null);
  const [editing, setEditing] = useState(false);
  const [comment, setComment] = useState('');

  if (wo === undefined) return <Spinner />;
  if (wo === null) return <PageHeader title="Work order not found" back={{ to: '/work-orders', label: 'Work orders' }} />;

  const g = gear.get(wo.gearId);
  const open = isOpen(wo.status);
  const canWork = isManager || wo.assigneeId === uid;
  const userName = (u: string | null | undefined) => (!u || u === 'system' ? 'System' : (users.get(u)?.displayName ?? 'Unknown'));
  const setStatus = (status: WorkOrderStatus) => updateWorkOrder(uid, wo.id, { status });

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <PageHeader
        back={g ? { to: `/gear/${g.id}`, label: g.name } : { to: '/work-orders', label: 'Work orders' }}
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span className="font-mono text-lg text-stone-500">{workOrderNumber(wo.number)}</span>
            {wo.title}
          </span>
        }
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <WoStatusBadge status={wo.status} />
            <SeverityBadge severity={wo.severity} />
            <PriorityText priority={wo.priority} />
            <OverdueBadge wo={wo} />
          </span>
        }
        actions={
          <>
            {open && canWork && (
              <>
                {wo.status !== 'in_progress' && <Button onClick={() => setStatus('in_progress')}>Start work</Button>}
                {wo.status !== 'waiting_parts' && <Button onClick={() => setStatus('waiting_parts')}>Waiting on parts</Button>}
                <Button variant="primary" onClick={() => setClosing('done')}>
                  <CheckCircle2 size={16} /> Complete
                </Button>
              </>
            )}
            {!open && isManager && (
              <Button onClick={() => setStatus('open')}>
                <RotateCcw size={16} /> Reopen
              </Button>
            )}
            {isManager && (
              <Button onClick={() => setEditing(true)}>
                <Pencil size={16} /> Edit
              </Button>
            )}
          </>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-5">
          <Card title="Details">
            {wo.description && <p className="mb-4 text-sm whitespace-pre-wrap">{wo.description}</p>}
            <Dl
              items={[
                [
                  'Gear',
                  g ? (
                    <span key="g" className="flex flex-wrap items-center gap-2">
                      <Link className="link" to={`/gear/${g.id}`}>
                        {g.name}
                      </Link>
                      <StatusBadge status={g.status} />
                    </span>
                  ) : (
                    'Deleted'
                  ),
                ],
                ['Product', productLabel(wo.productId) || null],
                ['Assigned to', wo.assigneeId ? userName(wo.assigneeId) : 'Unassigned'],
                ['Due', wo.dueDate ? fmtDate(wo.dueDate) : null],
                ['Source', wo.source === 'inspection' ? 'Failed inspection' : wo.source === 'issue' ? 'Reported issue' : 'Created by a manager'],
                ['Opened', `${fmtTimestamp(wo.createdAt, true)} by ${userName(wo.createdBy)}`],
                ...(!open
                  ? ([
                      ['Closed', `${fmtTimestamp(wo.closedAt, true)}${wo.closedBy ? ` by ${userName(wo.closedBy)}` : ''}`],
                      ['Resolution', wo.resolution || null],
                      ['Cost', wo.cost != null ? fmtMoney(wo.cost) : null],
                      ['Labor', wo.laborHours != null ? `${wo.laborHours} h` : null],
                      ['Gear afterwards', wo.gearStatusAfterClose ? <StatusBadge key="s" status={wo.gearStatusAfterClose} /> : 'Updating…'],
                    ] as [string, React.ReactNode][])
                  : []),
              ]}
            />
            {!!wo.inspectionIds?.length && (
              <p className="mt-4 text-sm">
                Inspections:{' '}
                {wo.inspectionIds.map((i, n) => (
                  <span key={i}>
                    {n > 0 && ', '}
                    <Link className="link" to={`/inspections/${i}`}>
                      #{n + 1}
                    </Link>
                  </span>
                ))}
              </p>
            )}
          </Card>

          <Card title={`Photos (${photos.length})`} actions={<AddPhotoButton links={{ gearId: wo.gearId, workOrderId: wo.id }} label="Add" />}>
            <PhotoGallery photos={photos} />
          </Card>
        </div>

        <Card title="Activity">
          <ol className="space-y-3 text-sm">
            {log.map((e) => (
              <li key={e.id} className={`border-l-2 pl-3 ${e.type === 'comment' ? 'border-brand-300' : 'border-stone-200'}`}>
                <p className="whitespace-pre-wrap">
                  {e.type === 'inspection' && e.inspectionId ? (
                    <Link className="link" to={`/inspections/${e.inspectionId}`}>
                      {e.text.split('\n')[0]}
                    </Link>
                  ) : (
                    e.text.split('\n')[0]
                  )}
                </p>
                {e.text.includes('\n') && <p className="text-xs whitespace-pre-wrap text-stone-600">{e.text.split('\n').slice(1).join('\n')}</p>}
                <p className="text-xs text-stone-500">
                  {userName(e.by)} · {fmtTimestamp(e.at, true)}
                </p>
              </li>
            ))}
          </ol>
          <form
            className="mt-4 space-y-2"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!comment.trim()) return;
              await addWorkOrderComment(uid, wo.id, comment.trim());
              setComment('');
            }}
          >
            <Textarea className="min-h-16" placeholder="Add a note…" value={comment} onChange={(e) => setComment(e.target.value)} aria-label="Comment" />
            <Button type="submit" size="sm" disabled={!comment.trim()}>
              <MessageSquare size={14} /> Add note
            </Button>
          </form>
        </Card>
      </div>

      <div className="flex flex-wrap gap-2">
        {open && isManager && (
          <Button variant="ghost" className="text-stone-700" onClick={() => setClosing('cancelled')}>
            <XCircle size={16} /> Cancel work order
          </Button>
        )}
        {isAdmin && (
          <Button
            variant="ghost"
            className="text-red-700"
            onClick={async () => {
              if (!confirm('Delete this work order permanently? Cancelling keeps the record.')) return;
              await deleteDoc(doc(db, 'workOrders', wo.id));
              navigate('/work-orders');
            }}
          >
            <Trash2 size={16} /> Delete record
          </Button>
        )}
      </div>

      {closing && (
        <CloseModal
          wo={wo}
          mode={closing}
          gearStatus={g?.status}
          otherOpen={[...openWorkOrders.values()].filter((w) => w.gearId === wo.gearId && w.id !== wo.id).map((w) => w.severity)}
          onClose={() => setClosing(null)}
        />
      )}
      {editing && <EditModal wo={wo} onClose={() => setEditing(false)} />}
    </div>
  );
}

function CloseModal({
  wo,
  mode,
  gearStatus,
  otherOpen,
  onClose,
}: {
  wo: WorkOrderDoc;
  mode: 'done' | 'cancelled';
  gearStatus: import('@gear/shared').GearStatus | undefined;
  otherOpen: FailureOutcome[];
  onClose(): void;
}) {
  const { uid } = useMe();
  const [resolution, setResolution] = useState('');
  const [cost, setCost] = useState('');
  const [hours, setHours] = useState('');
  const [busy, setBusy] = useState(false);
  const next = gearStatus ? gearStatusAfterClosing(gearStatus, otherOpen) : null;
  return (
    <Modal
      open
      onClose={onClose}
      title={mode === 'done' ? 'Complete work order' : 'Cancel work order'}
      footer={
        <>
          <Button onClick={onClose}>Back</Button>
          <Button
            variant={mode === 'done' ? 'primary' : 'danger'}
            disabled={busy || !resolution.trim()}
            onClick={async () => {
              setBusy(true);
              try {
                await updateWorkOrder(uid, wo.id, {
                  status: mode,
                  resolution: resolution.trim(),
                  ...(mode === 'done' ? { cost: numOrNull(cost), laborHours: numOrNull(hours) } : {}),
                });
                notify(mode === 'done' ? 'Work order completed' : 'Work order cancelled', 'success');
                onClose();
              } finally {
                setBusy(false);
              }
            }}
          >
            {mode === 'done' ? 'Complete' : 'Cancel work order'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={mode === 'done' ? 'What was done? (required)' : 'Why cancel? (required)'}>
          <Textarea value={resolution} onChange={(e) => setResolution(e.target.value)} autoFocus />
        </Field>
        {mode === 'done' && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Cost (USD)">
              <Input inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} />
            </Field>
            <Field label="Labor (hours)">
              <Input inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value)} />
            </Field>
          </div>
        )}
        {next && gearStatus && (
          <p className="rounded-lg bg-stone-50 p-3 text-sm">
            The gear goes from <StatusBadge status={gearStatus} /> to <StatusBadge status={next} />
            {otherOpen.length > 0 && next !== 'active' && ` because it has ${otherOpen.length} other open work order${otherOpen.length === 1 ? '' : 's'}`}.
          </p>
        )}
      </div>
    </Modal>
  );
}

function EditModal({ wo, onClose }: { wo: WorkOrderDoc; onClose(): void }) {
  const { uid } = useMe();
  const { users } = useData();
  const [title, setTitle] = useState(wo.title);
  const [description, setDescription] = useState(wo.description ?? '');
  const [assigneeId, setAssigneeId] = useState(wo.assigneeId ?? '');
  const [dueDate, setDueDate] = useState(wo.dueDate ?? '');
  const [priority, setPriority] = useState<Priority>(wo.priority);
  const [severity, setSeverity] = useState<FailureOutcome>(wo.severity);
  const people = [...users.values()].filter((u) => u.active || u.id === wo.assigneeId).sort((a, b) => compareText(a.displayName, b.displayName));
  return (
    <Modal
      open
      onClose={onClose}
      title={`Edit ${workOrderNumber(wo.number)}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!title.trim()}
            onClick={async () => {
              await updateWorkOrder(uid, wo.id, {
                title: title.trim(),
                description: description.trim(),
                assigneeId: assigneeId || null,
                dueDate: dueDate || null,
                priority,
                severity,
              });
              onClose();
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <WorkOrderFields
        {...{ title, setTitle, description, setDescription, assigneeId, setAssigneeId, dueDate, setDueDate, priority, setPriority, severity, setSeverity, people }}
        currentSeverity={wo.severity}
      />
    </Modal>
  );
}

export function WorkOrderFields(p: {
  title: string;
  setTitle(v: string): void;
  description: string;
  setDescription(v: string): void;
  assigneeId: string;
  setAssigneeId(v: string): void;
  dueDate: string;
  setDueDate(v: string): void;
  priority: Priority;
  setPriority(v: Priority): void;
  severity: FailureOutcome;
  setSeverity(v: FailureOutcome): void;
  people: { id: string; displayName: string }[];
  currentSeverity?: FailureOutcome;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Title" className="sm:col-span-2">
        <Input value={p.title} onChange={(e) => p.setTitle(e.target.value)} />
      </Field>
      <Field label="Description" className="sm:col-span-2">
        <Textarea value={p.description} onChange={(e) => p.setDescription(e.target.value)} />
      </Field>
      <Field label="Assigned to">
        <Select value={p.assigneeId} onChange={(e) => p.setAssigneeId(e.target.value)}>
          <option value="">Unassigned</option>
          {p.people.map((u) => (
            <option key={u.id} value={u.id}>
              {u.displayName}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Due">
        <Input type="date" value={p.dueDate} onChange={(e) => p.setDueDate(e.target.value)} />
      </Field>
      <Field label="Priority">
        <Select value={p.priority} onChange={(e) => p.setPriority(e.target.value as Priority)}>
          {PRIORITIES.map((x) => (
            <option key={x} value={x}>
              {PRIORITY_LABELS[x]}
            </option>
          ))}
        </Select>
      </Field>
      <Field
        label="Severity"
        hint={`While open, the gear is at least ${STATUS_LABELS[p.severity === 'note' ? 'active' : p.severity].toLowerCase()}.${
          p.currentSeverity && p.severity !== p.currentSeverity ? ' Lowering severity doesn’t improve the gear until the work order closes.' : ''
        }`}
      >
        <Select value={p.severity} onChange={(e) => p.setSeverity(e.target.value as FailureOutcome)}>
          {FAILURE_OUTCOMES.map((x) => (
            <option key={x} value={x}>
              {SEVERITY_LABELS[x]}
            </option>
          ))}
        </Select>
      </Field>
    </div>
  );
}

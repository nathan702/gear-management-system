import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { collection, doc } from 'firebase/firestore';
import { Check, CheckCheck, Minus, X } from 'lucide-react';
import {
  FAILURE_OUTCOME_LABELS,
  GEAR_STATUSES,
  STATUS_LABELS,
  calculatedStatus,
  inspectionStatusAfter,
  missingAnswers,
  resultForNumber,
  todayIso,
  type GearStatus,
  type InspectionItem,
  type InspectionResponse,
  type ResponseResult,
} from '@gear/shared';
import { db } from '../firebase';
import { useMe } from '../auth/AuthProvider';
import { compareText, useData } from '../data/DataProvider';
import { submitInspection } from '../data/writes';
import { Button, Card, Checkbox, Field, Input, PageHeader, Select, StatusBadge, Textarea } from '../components/ui';
import { AddPhotoButton, PhotoGallery, usePhotos } from '../photos/PhotoGallery';
import { DueBadge, dueText, useInspectionSummaries } from '../inspections/common';
import { notify } from '../components/toast';

interface Answer {
  result: ResponseResult | null;
  value: string;
  comment: string;
}

export function InspectPage() {
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const { gear, products, inspectionForms, productLabel } = useData();
  const g = gear.get(id);
  const formId = params.get('form');
  const summaries = useInspectionSummaries();

  if (!g) return <PageHeader title="Gear not found" back={{ to: '/gear', label: 'Gear' }} />;
  if (g.status === 'retired')
    return (
      <div>
        <PageHeader title={`Inspect ${g.name}`} back={{ to: `/gear/${g.id}`, label: g.name }} />
        <p className="text-stone-600">Retired gear isn’t inspected.</p>
      </div>
    );

  const form = formId ? inspectionForms.get(formId) : undefined;
  if (form) return <InspectionRun key={form.id} gearId={g.id} formId={form.id} />;

  const product = g.productId ? products.get(g.productId) : undefined;
  const scheduled = summaries.get(g.id)?.schedules ?? [];
  const scheduledIds = new Set(scheduled.map((s) => s.schedule.formId));
  const others = [...inspectionForms.values()].filter((f) => f.active && !scheduledIds.has(f.id)).sort((a, b) => compareText(a.name, b.name));

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <PageHeader title={`Inspect ${g.name}`} subtitle={productLabel(g.productId) || undefined} back={{ to: `/gear/${g.id}`, label: g.name }} />
      {scheduled.length > 0 && (
        <Card title={`Scheduled for ${product ? productLabel(product.id) : 'this product'}`}>
          <ul className="divide-y divide-stone-100">
            {scheduled.map((s) => {
              const f = inspectionForms.get(s.schedule.formId);
              if (!f) return null;
              return (
                <li key={f.id}>
                  <button className="flex w-full items-center justify-between gap-3 py-3 text-left hover:bg-stone-50" onClick={() => setParams({ form: f.id })}>
                    <span>
                      <span className="block font-medium">{f.name}</span>
                      <span className="block text-xs text-stone-500">{dueText(s) || 'No limit set'}</span>
                    </span>
                    <DueBadge state={s.state} short />
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
      <Card title={scheduled.length ? 'Other forms' : 'Choose a form'}>
        {others.length ? (
          <ul className="divide-y divide-stone-100">
            {others.map((f) => (
              <li key={f.id}>
                <button className="w-full py-3 text-left font-medium hover:bg-stone-50" onClick={() => setParams({ form: f.id })}>
                  {f.name}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-stone-600">
            No {scheduled.length ? 'other ' : ''}forms yet.{' '}
            <Link className="link" to="/inspections/forms">
              Manage inspection forms
            </Link>
          </p>
        )}
      </Card>
    </div>
  );
}

const RESULT_BUTTONS: { result: ResponseResult; label: string; icon: React.ReactNode; on: string }[] = [
  { result: 'pass', label: 'Pass', icon: <Check size={16} />, on: 'bg-brand-700 text-white border-brand-700' },
  { result: 'fail', label: 'Fail', icon: <X size={16} />, on: 'bg-red-700 text-white border-red-700' },
  { result: 'na', label: 'N/A', icon: <Minus size={16} />, on: 'bg-stone-600 text-white border-stone-600' },
];

function resultOf(item: InspectionItem, a: Answer | undefined): ResponseResult | null {
  if (!a) return null;
  if (a.result === 'na') return 'na';
  if (item.type === 'number') return resultForNumber(item, a.value.trim() === '' ? null : Number(a.value));
  if (item.type === 'text') return a.value.trim() ? 'pass' : null;
  return a.result;
}

function InspectionRun({ gearId, formId }: { gearId: string; formId: string }) {
  const navigate = useNavigate();
  const { uid } = useMe();
  const { gear, inspectionForms, productLabel } = useData();
  const g = gear.get(gearId)!;
  const form = inspectionForms.get(formId)!;
  // Id chosen up front so photos taken during the inspection can link to it.
  const [inspectionId] = useState(() => doc(collection(db, 'inspections')).id);
  const photos = usePhotos('inspectionId', inspectionId);
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [date, setDate] = useState(todayIso());
  const [notes, setNotes] = useState('');
  const [overriding, setOverriding] = useState(false);
  const [overrideStatus, setOverrideStatus] = useState<GearStatus>('active');
  const [overrideReason, setOverrideReason] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);

  const set = (itemId: string, patch: Partial<Answer>) =>
    setAnswers((a) => ({ ...a, [itemId]: { ...(a[itemId] ?? { result: null, value: '', comment: '' }), ...patch } }));

  const responses: InspectionResponse[] = useMemo(
    () =>
      form.items.map((item) => {
        const a = answers[item.id];
        const result = resultOf(item, a) ?? 'na';
        return {
          itemId: item.id,
          prompt: item.prompt,
          type: item.type,
          failureOutcome: item.failureOutcome,
          result,
          value: item.type === 'number' ? (a?.value.trim() ? Number(a.value) : null) : item.type === 'text' ? (a?.value.trim() ?? '') : null,
          unit: item.unit ?? '',
          comment: a?.comment.trim() ?? '',
        };
      }),
    [form, answers],
  );
  const missing = missingAnswers(
    form,
    form.items.flatMap((item) => {
      const a = answers[item.id];
      const r = resultOf(item, a);
      return r ? [{ itemId: item.id, result: r, value: item.type === 'pass_fail' ? null : a?.value }] : [];
    }),
  );
  const missingIds = new Set(missing.map((m) => m.id));
  const failed = responses.filter((r) => r.result === 'fail');
  const calculated = calculatedStatus(responses);

  async function submit() {
    setAttempted(true);
    if (missing.length) {
      notify(`${missing.length} required item${missing.length === 1 ? '' : 's'} still need an answer.`, 'error');
      document.getElementById(`item-${missing[0].id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    if (overriding && !overrideReason.trim()) return notify('Give a reason for overriding the status.', 'error');
    setBusy(true);
    try {
      await submitInspection(uid, inspectionId, {
        gearId: g.id,
        productId: g.productId,
        formId: form.id,
        formName: form.name,
        formVersion: form.version,
        date,
        inspectorId: uid,
        responses,
        notes: notes.trim(),
        failedCount: failed.length,
        calculatedStatus: calculated,
        override: overriding ? { status: overrideStatus, reason: overrideReason.trim() } : null,
      });
      notify('Inspection saved', 'success');
      navigate(`/inspections/${inspectionId}`, { replace: true });
    } finally {
      setBusy(false);
    }
  }

  const result = overriding ? overrideStatus : calculated;
  const finalStatus = inspectionStatusAfter(g.status, result);

  return (
    <div className="mx-auto max-w-2xl space-y-4 pb-8">
      <PageHeader
        title={form.name}
        subtitle={
          <>
            {g.name} · {productLabel(g.productId) || 'No product'} · currently <StatusBadge status={g.status} />
          </>
        }
        back={{ to: `/gear/${g.id}/inspect`, label: 'Choose another form' }}
      />
      {form.description && <p className="text-sm text-stone-600">{form.description}</p>}

      <div className="flex justify-end">
        <Button
          size="sm"
          onClick={() =>
            form.items.forEach((item) => {
              if (item.type === 'pass_fail' && !answers[item.id]?.result) set(item.id, { result: 'pass' });
            })
          }
        >
          <CheckCheck size={14} /> Pass all unanswered checks
        </Button>
      </div>

      <ol className="space-y-3">
        {form.items.map((item, i) => {
          const a = answers[item.id];
          const r = resultOf(item, a);
          const flagged = attempted && missingIds.has(item.id);
          return (
            <li
              key={item.id}
              id={`item-${item.id}`}
              className={`card p-4 ${r === 'fail' ? 'border-red-300 bg-red-50/40' : flagged ? 'border-amber-400' : ''}`}
            >
              <div className="flex gap-3">
                <span className="w-5 shrink-0 text-sm text-stone-400 tabular-nums">{i + 1}.</span>
                <div className="min-w-0 flex-1 space-y-3">
                  <div>
                    <p className="font-medium">
                      {item.prompt}
                      {item.required && <span className="text-red-700"> *</span>}
                    </p>
                    {item.help && <p className="text-sm text-stone-600">{item.help}</p>}
                    {item.type !== 'text' && (
                      <p className="text-xs text-stone-500">
                        If it fails: {FAILURE_OUTCOME_LABELS[item.failureOutcome]}
                        {item.type === 'number' && (item.min != null || item.max != null) &&
                          ` · OK range ${item.min ?? '−∞'}–${item.max ?? '∞'} ${item.unit ?? ''}`}
                      </p>
                    )}
                  </div>

                  {item.type === 'pass_fail' && (
                    <div className="grid grid-cols-3 gap-2">
                      {RESULT_BUTTONS.map((b) => (
                        <button
                          key={b.result}
                          type="button"
                          aria-pressed={a?.result === b.result}
                          onClick={() => set(item.id, { result: b.result })}
                          className={`flex items-center justify-center gap-1.5 rounded-md border py-2.5 text-sm font-medium ${
                            a?.result === b.result ? b.on : 'border-stone-300 bg-white text-stone-700 hover:bg-stone-50'
                          }`}
                        >
                          {b.icon} {b.label}
                        </button>
                      ))}
                    </div>
                  )}
                  {item.type === 'number' && (
                    <div className="flex items-center gap-2">
                      <Input
                        inputMode="decimal"
                        className="max-w-40"
                        value={a?.value ?? ''}
                        disabled={a?.result === 'na'}
                        onChange={(e) => set(item.id, { value: e.target.value, result: null })}
                        aria-label={item.prompt}
                      />
                      <span className="text-sm text-stone-600">{item.unit}</span>
                      {r === 'pass' && <span className="text-sm font-medium text-brand-700">OK</span>}
                      {r === 'fail' && <span className="text-sm font-medium text-red-700">Out of range</span>}
                      <Checkbox label="N/A" checked={a?.result === 'na'} onChange={(e) => set(item.id, { result: e.target.checked ? 'na' : null })} />
                    </div>
                  )}
                  {item.type === 'text' && (
                    <Textarea className="min-h-16" value={a?.value ?? ''} onChange={(e) => set(item.id, { value: e.target.value })} aria-label={item.prompt} />
                  )}

                  {(r === 'fail' || a?.comment) && (
                    <div className="space-y-2">
                      <Input
                        placeholder="What did you find?"
                        value={a?.comment ?? ''}
                        onChange={(e) => set(item.id, { comment: e.target.value })}
                        aria-label={`Comment for ${item.prompt}`}
                      />
                      <AddPhotoButton links={{ gearId: g.id, inspectionId, inspectionItemId: item.id }} label="Photo of the problem" />
                    </div>
                  )}
                  {flagged && <p className="text-xs text-amber-700">This item needs an answer.</p>}
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      <Card title="Finish">
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Inspection date">
              <Input type="date" value={date} max={todayIso()} onChange={(e) => setDate(e.target.value || todayIso())} />
            </Field>
          </div>
          <Field label="Notes (optional)">
            <Textarea className="min-h-16" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          <div>
            <p className="label">Photos ({photos.length})</p>
            <div className="space-y-2">
              <PhotoGallery photos={photos} emptyText="Optional — add general photos of the gear." />
              <AddPhotoButton links={{ gearId: g.id, inspectionId }} />
            </div>
          </div>

          <div className="rounded-lg bg-stone-50 p-4">
            <p className="text-sm">
              {failed.length ? `${failed.length} item${failed.length === 1 ? '' : 's'} failed` : 'No failures'} → result{' '}
              <StatusBadge status={calculated} />
            </p>
            <div className="mt-3">
              <Checkbox label="Override the result" checked={overriding} onChange={(e) => setOverriding(e.target.checked)} />
            </div>
            {overriding && (
              <div className="mt-3 grid gap-3 sm:grid-cols-[12rem_1fr]">
                <Field label="Result instead">
                  <Select value={overrideStatus} onChange={(e) => setOverrideStatus(e.target.value as GearStatus)}>
                    {GEAR_STATUSES.filter((s) => s !== 'retired').map((s) => (
                      <option key={s} value={s}>
                        {STATUS_LABELS[s]}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Reason (required)">
                  <Input value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} placeholder="Why the calculated result is wrong" />
                </Field>
              </div>
            )}
            {g.status !== 'active' && g.status !== 'retired' && finalStatus === g.status && (
              <p className="mt-3 text-xs text-stone-600">
                This gear is already {STATUS_LABELS[g.status].toLowerCase()}. An inspection can only make its status worse — closing its work order returns it to Active.
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-end gap-3">
            <span className="text-sm text-stone-600">
              Gear will be <StatusBadge status={finalStatus} />
            </span>
            <Button variant="primary" onClick={submit} disabled={busy}>
              Submit inspection
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

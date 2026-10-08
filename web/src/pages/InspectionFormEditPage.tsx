import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import {
  FAILURE_OUTCOMES,
  FAILURE_OUTCOME_LABELS,
  newItemId,
  type InspectionItem,
  type InspectionItemType,
} from '@gear/shared';
import { useMe } from '../auth/AuthProvider';
import { useData } from '../data/DataProvider';
import { deleteDocument, saveInspectionForm } from '../data/writes';
import { Button, Checkbox, Field, Input, PageHeader, Select, Textarea } from '../components/ui';
import { numOrNull } from '../lib/format';
import { notify } from '../components/toast';

const TYPE_LABELS: Record<InspectionItemType, string> = {
  pass_fail: 'Pass / fail',
  number: 'Number reading',
  text: 'Text note (never fails)',
};

const OUTCOME_STYLES: Record<string, string> = {
  note: 'border-stone-200',
  has_issues: 'border-amber-300',
  quarantined: 'border-red-300',
};

type Draft = Omit<InspectionItem, 'min' | 'max'> & { min: string; max: string };

const blankItem = (): Draft => ({
  id: newItemId(),
  prompt: '',
  help: '',
  type: 'pass_fail',
  failureOutcome: 'has_issues',
  required: true,
  min: '',
  max: '',
  unit: '',
});

export function InspectionFormEditPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { uid, isManager, isAdmin } = useMe();
  const { inspectionForms, products, productLabel } = useData();
  const existing = id ? inspectionForms.get(id) : undefined;
  const readOnly = !isManager;

  const [name, setName] = useState(existing?.name ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [active, setActive] = useState(existing?.active ?? true);
  const [items, setItems] = useState<Draft[]>(
    existing?.items.map((i) => ({ ...i, help: i.help ?? '', unit: i.unit ?? '', min: i.min != null ? String(i.min) : '', max: i.max != null ? String(i.max) : '' })) ?? [blankItem()],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (id && !existing) return <PageHeader title="Form not found" back={{ to: '/inspections/forms', label: 'Inspection forms' }} />;

  const usedBy = existing ? [...products.values()].filter((p) => p.inspectionSchedules?.some((s) => s.formId === existing.id)) : [];
  const update = (i: number, patch: Partial<Draft>) => setItems((list) => list.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  const move = (i: number, d: -1 | 1) =>
    setItems((list) => {
      const next = [...list];
      [next[i], next[i + d]] = [next[i + d], next[i]];
      return next;
    });

  async function save() {
    setError(null);
    if (!name.trim()) return setError('Give the form a name.');
    const clean = items.filter((i) => i.prompt.trim());
    if (!clean.length) return setError('Add at least one item.');
    const dup = [...inspectionForms.values()].find((f) => f.id !== id && f.name.trim().toLowerCase() === name.trim().toLowerCase());
    if (dup) return setError('Another form already has this name.');
    setBusy(true);
    try {
      const savedId = await saveInspectionForm(uid, existing?.id ?? null, existing, {
        name: name.trim(),
        description: description.trim(),
        active,
        items: clean.map((i) => ({
          id: i.id,
          prompt: i.prompt.trim(),
          help: i.help?.trim() ?? '',
          type: i.type,
          failureOutcome: i.failureOutcome,
          required: i.required,
          min: i.type === 'number' ? numOrNull(i.min) : null,
          max: i.type === 'number' ? numOrNull(i.max) : null,
          unit: i.type === 'number' ? (i.unit?.trim() ?? '') : '',
        })),
      });
      notify(existing ? `Saved as version ${existing.version + 1}` : 'Form created', 'success');
      navigate(`/inspections/forms/${savedId}`, { replace: true });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        back={{ to: '/inspections/forms', label: 'Inspection forms' }}
        title={existing ? existing.name : 'New inspection form'}
        subtitle={existing ? `Version ${existing.version} — saving creates a new version; past inspections keep the wording they used.` : undefined}
      />

      <div className="card grid gap-4 p-5 sm:grid-cols-2">
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} disabled={readOnly} placeholder="e.g. Raft annual inspection" />
        </Field>
        <div className="flex items-end pb-2">
          <Checkbox label="Active (available for new inspections)" checked={active} disabled={readOnly} onChange={(e) => setActive(e.target.checked)} />
        </div>
        <Field label="Description" className="sm:col-span-2">
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} disabled={readOnly} className="min-h-16" />
        </Field>
        {usedBy.length > 0 && (
          <p className="text-sm text-stone-600 sm:col-span-2">Used by: {usedBy.map((p) => productLabel(p.id)).join(', ')}</p>
        )}
      </div>

      <div className="space-y-3">
        <h2 className="text-sm font-semibold">Items</h2>
        {items.map((item, i) => (
          <div key={item.id} className={`card border-l-4 p-4 ${OUTCOME_STYLES[item.type === 'text' ? 'note' : item.failureOutcome]}`}>
            <div className="flex items-start gap-3">
              <span className="mt-2 w-6 shrink-0 text-right text-sm text-stone-400 tabular-nums">{i + 1}.</span>
              <div className="grid flex-1 gap-3 sm:grid-cols-[1fr_12rem_13rem]">
                <Field label="Check">
                  <Input value={item.prompt} onChange={(e) => update(i, { prompt: e.target.value })} disabled={readOnly} placeholder="e.g. Tubes hold pressure overnight" />
                </Field>
                <Field label="Answer type">
                  <Select value={item.type} disabled={readOnly} onChange={(e) => update(i, { type: e.target.value as InspectionItemType })}>
                    {Object.entries(TYPE_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </Select>
                </Field>
                {item.type !== 'text' ? (
                  <Field label="If it fails">
                    <Select value={item.failureOutcome} disabled={readOnly} onChange={(e) => update(i, { failureOutcome: e.target.value as Draft['failureOutcome'] })}>
                      {FAILURE_OUTCOMES.map((o) => (
                        <option key={o} value={o}>
                          {FAILURE_OUTCOME_LABELS[o]}
                        </option>
                      ))}
                    </Select>
                  </Field>
                ) : (
                  <div />
                )}
                {item.type === 'number' && (
                  <div className="grid grid-cols-3 gap-2 sm:col-span-3 sm:max-w-md">
                    <Field label="Minimum OK">
                      <Input inputMode="decimal" value={item.min} disabled={readOnly} onChange={(e) => update(i, { min: e.target.value })} />
                    </Field>
                    <Field label="Maximum OK">
                      <Input inputMode="decimal" value={item.max} disabled={readOnly} onChange={(e) => update(i, { max: e.target.value })} />
                    </Field>
                    <Field label="Unit">
                      <Input value={item.unit} disabled={readOnly} onChange={(e) => update(i, { unit: e.target.value })} placeholder="psi" />
                    </Field>
                  </div>
                )}
                <Field label="Guidance for the inspector (optional)" className="sm:col-span-2">
                  <Input value={item.help} disabled={readOnly} onChange={(e) => update(i, { help: e.target.value })} />
                </Field>
                <div className="flex items-end pb-2">
                  <Checkbox label="Required" checked={item.required} disabled={readOnly} onChange={(e) => update(i, { required: e.target.checked })} />
                </div>
              </div>
              {!readOnly && (
                <div className="flex shrink-0 flex-col gap-1">
                  <Button size="sm" variant="ghost" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
                    <ArrowUp size={16} />
                  </Button>
                  <Button size="sm" variant="ghost" aria-label="Move down" disabled={i === items.length - 1} onClick={() => move(i, 1)}>
                    <ArrowDown size={16} />
                  </Button>
                  <Button size="sm" variant="ghost" className="text-red-700" aria-label="Remove item" onClick={() => setItems((l) => l.filter((_, j) => j !== i))}>
                    <Trash2 size={16} />
                  </Button>
                </div>
              )}
            </div>
          </div>
        ))}
        {!readOnly && (
          <Button onClick={() => setItems((l) => [...l, blankItem()])}>
            <Plus size={16} /> Add item
          </Button>
        )}
      </div>

      {error && <p className="text-sm text-red-700">{error}</p>}
      {!readOnly && (
        <div className="flex flex-wrap justify-between gap-2">
          <span>
            {isAdmin && existing && usedBy.length === 0 && (
              <Button
                variant="ghost"
                className="text-red-700"
                onClick={async () => {
                  if (!confirm('Delete this form? Past inspections keep their copy of it.')) return;
                  await deleteDocument('inspectionForms', existing.id);
                  navigate('/inspections/forms');
                }}
              >
                <Trash2 size={16} /> Delete form
              </Button>
            )}
          </span>
          <span className="flex gap-2">
            <Button onClick={() => navigate('/inspections/forms')}>Cancel</Button>
            <Button variant="primary" onClick={save} disabled={busy}>
              {existing ? 'Save new version' : 'Create form'}
            </Button>
          </span>
        </div>
      )}
    </div>
  );
}

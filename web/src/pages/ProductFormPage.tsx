import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { DEFAULT_LEAD_DAYS, formatLinks, parseLinks, productName, type InspectionSchedule, type Product } from '@gear/shared';
import { Plus, Trash2 } from 'lucide-react';
import { useMe } from '../auth/AuthProvider';
import { sortedValues, useData } from '../data/DataProvider';
import { Link } from 'react-router';
import { saveProduct, saveReference } from '../data/writes';
import { Button, Checkbox, Field, Input, PageHeader, Select, Textarea } from '../components/ui';
import { numOrNull } from '../lib/format';
import { notify } from '../components/toast';

const NEW = '__new__';

export function ProductFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { uid } = useMe();
  const { products, manufacturers, categories, inspectionForms } = useData();
  const existing = id ? products.get(id) : undefined;
  const [schedules, setSchedules] = useState<ScheduleDraft[]>(() => (existing?.inspectionSchedules ?? []).map(toDraft));

  const [form, setForm] = useState({
    manufacturerId: existing?.manufacturerId ?? '',
    newManufacturer: '',
    model: existing?.model ?? '',
    variant: existing?.variant ?? '',
    categoryId: existing?.categoryId ?? '',
    lifetimeYears: existing?.lifetimeYears != null ? String(existing.lifetimeYears) : '',
    replacementCost: existing?.replacementCost != null ? String(existing.replacementCost) : '',
    isPpe: existing?.isPpe ?? false,
    notes: existing?.notes ?? '',
    links: formatLinks(existing?.links).replaceAll('; ', '\n'),
    active: existing?.active ?? true,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const links = form.links.trim() ? parseLinks(form.links) : [];
    if (links === 'invalid') return setError('Each document link needs a URL starting with http:// or https://');
    if (form.manufacturerId === NEW && !form.newManufacturer.trim()) return setError('Enter the new manufacturer’s name');
    const sched = schedules.filter((x) => x.formId);
    if (new Set(sched.map((x) => x.formId)).size !== sched.length) return setError('Each inspection form can only be scheduled once per product.');
    if (sched.some((x) => x.kind === 'in_depth' && !numOrNull(x.everyMonths) && !numOrNull(x.everyDaysUsed) && !x.beforeEachCheckout))
      return setError('Each in-depth inspection needs a number of months, a number of days used, or “on the day of each check-out”.');

    setBusy(true);
    try {
      let manufacturerId: string | null = form.manufacturerId || null;
      if (manufacturerId === NEW) {
        const name = form.newManufacturer.trim();
        const match = [...manufacturers.values()].find((m) => m.name.toLowerCase() === name.toLowerCase());
        manufacturerId = match?.id ?? (await saveReference(uid, 'manufacturers', null, { name, active: true }));
      }
      const data: Partial<Product> = {
        manufacturerId,
        model: form.model.trim(),
        variant: form.variant.trim(),
        categoryId: form.categoryId || null,
        lifetimeYears: numOrNull(form.lifetimeYears),
        replacementCost: numOrNull(form.replacementCost),
        isPpe: form.isPpe,
        notes: form.notes.trim(),
        links,
        active: form.active,
        inspectionSchedules: sched.map(fromDraft),
      };
      const nameMap = new Map([...manufacturers.values()].map((m) => [m.id, m]));
      const label = productName(data as Product, nameMap).toLowerCase();
      const dup = [...products.values()].find((p) => p.id !== id && productName(p, nameMap).toLowerCase() === label);
      if (dup) {
        setBusy(false);
        return setError('A product with this manufacturer, model and variant already exists.');
      }
      const savedId = await saveProduct(uid, existing?.id ?? null, data);
      notify(existing ? 'Product saved' : 'Product added', 'success');
      navigate(`/products/${savedId}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      <PageHeader title={existing ? 'Edit product' : 'Add product'} back={{ to: existing ? `/products/${existing.id}` : '/products', label: 'Back' }} />
      <div className="card grid gap-4 p-5 sm:grid-cols-2">
        <Field label="Manufacturer">
          <Select value={form.manufacturerId} onChange={set('manufacturerId')}>
            <option value="">— None —</option>
            {sortedValues(manufacturers).map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
            <option value={NEW}>+ New manufacturer…</option>
          </Select>
        </Field>
        {form.manufacturerId === NEW ? (
          <Field label="New manufacturer name">
            <Input value={form.newManufacturer} onChange={set('newManufacturer')} autoFocus />
          </Field>
        ) : (
          <div className="hidden sm:block" />
        )}
        <Field label="Model" hint="e.g. Otter 130">
          <Input value={form.model} onChange={set('model')} required />
        </Field>
        <Field label="Variant" hint="Size, length, color… (optional)">
          <Input value={form.variant} onChange={set('variant')} />
        </Field>
        <Field label="Category">
          <Select value={form.categoryId} onChange={set('categoryId')}>
            <option value="">— None —</option>
            {sortedValues(categories).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Manufacturer’s lifetime (years)" hint="Used to work out end of life.">
          <Input inputMode="decimal" value={form.lifetimeYears} onChange={set('lifetimeYears')} />
        </Field>
        <Field label="Replacement cost (USD)" hint="Used for budget forecasting.">
          <Input inputMode="decimal" value={form.replacementCost} onChange={set('replacementCost')} />
        </Field>
        <div className="flex flex-col gap-2 sm:col-span-2">
          <Checkbox label="Personal protective equipment (PPE)" checked={form.isPpe} onChange={(e) => setForm((f) => ({ ...f, isPpe: e.target.checked }))} />
          <Checkbox label="Active (shown when adding gear)" checked={form.active} onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))} />
        </div>
        <div className="sm:col-span-2">
          <p className="label">Inspection schedule</p>
          <p className="mb-2 text-xs text-stone-500">
            <b>In-service</b> checks are done by whoever is using the gear, every N calendar days — but only enforced while it’s checked out or in a
            current kit. Stored gear is never overdue; it needs one catch-up check on its first day back out. <b>In-depth</b> inspections are routine checks by maintenance staff, due after N months or N days used, whichever comes
            first.{' '}
            <Link className="link" to="/inspections/forms" target="_blank">
              Manage forms
            </Link>
          </p>
          <div className="space-y-2">
            {schedules.map((sc, i) => {
              const set = (patch: Partial<ScheduleDraft>) => setSchedules((l) => l.map((x, j) => (j === i ? { ...x, ...patch } : x)));
              const inService = sc.kind === 'in_service';
              return (
                <div key={i} className="grid items-end gap-2 rounded-lg border border-stone-200 p-3 sm:grid-cols-[9rem_1fr_6rem_6rem_6rem_auto]">
                  <Field label="Type">
                    <Select value={sc.kind} onChange={(e) => set({ kind: e.target.value as ScheduleDraft['kind'] })} aria-label="Inspection type">
                      <option value="in_service">In-service</option>
                      <option value="in_depth">In-depth</option>
                    </Select>
                  </Field>
                  <Field label="Form">
                    <Select value={sc.formId} onChange={(e) => set({ formId: e.target.value })}>
                      <option value="">— Choose —</option>
                      {sortedValues(inspectionForms, true)
                        .filter((f) => f.active || f.id === sc.formId)
                        .map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.name}
                          </option>
                        ))}
                    </Select>
                  </Field>
                  {inService ? (
                    <>
                      <Field label="Every (days)" hint="Calendar days; only enforced while the gear is in use" className="sm:col-span-3">
                        <Input inputMode="numeric" className="sm:max-w-24" value={sc.everyDaysInUse} onChange={(e) => set({ everyDaysInUse: e.target.value })} placeholder="7" />
                      </Field>
                    </>
                  ) : (
                    <>
                      <Field label="Every (months)">
                        <Input inputMode="numeric" value={sc.everyMonths} onChange={(e) => set({ everyMonths: e.target.value })} placeholder="12" />
                      </Field>
                      <Field label="or days used">
                        <Input inputMode="numeric" value={sc.everyDaysUsed} onChange={(e) => set({ everyDaysUsed: e.target.value })} placeholder="—" />
                      </Field>
                      <Field label="Remind (days)">
                        <Input inputMode="numeric" value={sc.reminderLeadDays} onChange={(e) => set({ reminderLeadDays: e.target.value })} placeholder={String(DEFAULT_LEAD_DAYS)} />
                      </Field>
                    </>
                  )}
                  <Button variant="ghost" className="text-red-700" aria-label="Remove schedule" onClick={() => setSchedules((l) => l.filter((_, j) => j !== i))}>
                    <Trash2 size={16} />
                  </Button>
                  <div className="sm:col-span-6">
                    <Checkbox label="Also required on the day of each check-out" checked={sc.beforeEachCheckout} onChange={(e) => set({ beforeEachCheckout: e.target.checked })} />
                  </div>
                </div>
              );
            })}
            <span className="flex gap-2">
              <Button size="sm" onClick={() => setSchedules((l) => [...l, toDraft({ formId: '', kind: 'in_service', everyDaysInUse: 7 })])} disabled={!inspectionForms.size}>
                <Plus size={14} /> In-service check
              </Button>
              <Button size="sm" onClick={() => setSchedules((l) => [...l, toDraft({ formId: '', kind: 'in_depth', everyMonths: 12 })])} disabled={!inspectionForms.size}>
                <Plus size={14} /> In-depth inspection
              </Button>
            </span>
            {!inspectionForms.size && <p className="text-xs text-stone-500">Create an inspection form first.</p>}
          </div>
        </div>
        <Field label="Notes" className="sm:col-span-2">
          <Textarea value={form.notes} onChange={set('notes')} />
        </Field>
        <Field label="Document links" hint="One per line: label | https://… (manuals, technical notices)" className="sm:col-span-2">
          <Textarea value={form.links} onChange={set('links')} placeholder="User manual | https://…" />
        </Field>
      </div>
      {error && <p className="text-sm text-red-700">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button onClick={() => navigate(-1)}>Cancel</Button>
        <Button type="submit" variant="primary" disabled={busy}>
          {existing ? 'Save changes' : 'Add product'}
        </Button>
      </div>
    </form>
  );
}

interface ScheduleDraft {
  formId: string;
  kind: 'in_service' | 'in_depth';
  everyDaysInUse: string;
  everyMonths: string;
  everyDaysUsed: string;
  reminderLeadDays: string;
  beforeEachCheckout: boolean;
}

const str = (n: number | null | undefined) => (n != null ? String(n) : '');

function toDraft(s: InspectionSchedule): ScheduleDraft {
  return {
    formId: s.formId,
    kind: s.kind ?? 'in_depth',
    everyDaysInUse: str(s.everyDaysInUse),
    everyMonths: str(s.everyMonths),
    everyDaysUsed: str(s.everyDaysUsed),
    reminderLeadDays: str(s.reminderLeadDays),
    beforeEachCheckout: !!s.beforeEachCheckout,
  };
}

function fromDraft(d: ScheduleDraft): InspectionSchedule {
  if (d.kind === 'in_service')
    return { formId: d.formId, kind: 'in_service', everyDaysInUse: Math.max(1, Math.round(numOrNull(d.everyDaysInUse) ?? 1)), beforeEachCheckout: d.beforeEachCheckout };
  return {
    formId: d.formId,
    kind: 'in_depth',
    everyMonths: numOrNull(d.everyMonths),
    everyDaysUsed: numOrNull(d.everyDaysUsed),
    reminderLeadDays: numOrNull(d.reminderLeadDays),
    beforeEachCheckout: d.beforeEachCheckout,
  };
}

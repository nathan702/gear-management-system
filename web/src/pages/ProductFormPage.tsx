import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { formatLinks, parseLinks, productName, type Product } from '@gear/shared';
import { useMe } from '../auth/AuthProvider';
import { sortedValues, useData } from '../data/DataProvider';
import { saveProduct, saveReference } from '../data/writes';
import { Button, Checkbox, Field, Input, PageHeader, Select, Textarea } from '../components/ui';
import { numOrNull } from '../lib/format';
import { notify } from '../components/toast';

const NEW = '__new__';

export function ProductFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { uid } = useMe();
  const { products, manufacturers, categories } = useData();
  const existing = id ? products.get(id) : undefined;

  const [form, setForm] = useState({
    manufacturerId: existing?.manufacturerId ?? '',
    newManufacturer: '',
    model: existing?.model ?? '',
    variant: existing?.variant ?? '',
    categoryId: existing?.categoryId ?? '',
    lifetimeYears: existing?.lifetimeYears != null ? String(existing.lifetimeYears) : '',
    replacementCost: existing?.replacementCost != null ? String(existing.replacementCost) : '',
    standards: existing?.standards ?? '',
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
        standards: form.standards.trim(),
        isPpe: form.isPpe,
        notes: form.notes.trim(),
        links,
        active: form.active,
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
        <Field label="Standards / certification" hint="e.g. EN 12492, USCG Type III">
          <Input value={form.standards} onChange={set('standards')} />
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

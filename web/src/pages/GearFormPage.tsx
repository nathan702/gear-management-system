import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { writeBatch } from 'firebase/firestore';
import {
  generateQrCode,
  normalizeQrCode,
  parseLinks,
  parseList,
  formatLinks,
  type Gear,
} from '@gear/shared';
import { db } from '../firebase';
import { useMe } from '../auth/AuthProvider';
import { byName, compareText, sortedValues, useData } from '../data/DataProvider';
import { batchCreateGear, commit, updateGear, type GearInput } from '../data/writes';
import { Button, Field, Input, PageHeader, Select, Textarea } from '../components/ui';
import { numOrNull } from '../lib/format';
import { notify } from '../components/toast';

type FormState = {
  name: string;
  productId: string;
  programAreaId: string;
  locationId: string;
  qrCode: string;
  serialNumber: string;
  tags: string;
  mfgDate: string;
  purchaseDate: string;
  firstUseDate: string;
  purchaseValue: string;
  supplier: string;
  customEol: string;
  notes: string;
  links: string;
};

function toForm(g?: Partial<Gear>): FormState {
  return {
    name: g?.name ?? '',
    productId: g?.productId ?? '',
    programAreaId: g?.programAreaId ?? '',
    locationId: g?.locationId ?? '',
    qrCode: g?.qrCode ?? '',
    serialNumber: g?.serialNumber ?? '',
    tags: (g?.tags ?? []).join(', '),
    mfgDate: g?.mfgDate ?? '',
    purchaseDate: g?.purchaseDate ?? '',
    firstUseDate: g?.firstUseDate ?? '',
    purchaseValue: g?.purchaseValue != null ? String(g.purchaseValue) : '',
    supplier: g?.supplier ?? '',
    customEol: g?.customEol ?? '',
    notes: g?.notes ?? '',
    links: formatLinks(g?.links).replaceAll('; ', '\n'),
  };
}

export function GearFormPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { uid } = useMe();
  const { gear, products, programAreas, locations, categories, productLabel } = useData();
  const existing = id ? gear.get(id) : undefined;

  const [form, setForm] = useState<FormState>(() => {
    if (existing) return toForm(existing);
    const product = params.get('product') ?? '';
    const sibling = product ? [...gear.values()].filter((g) => g.productId === product).sort(byName).at(-1) : undefined;
    return {
      ...toForm({ productId: product, programAreaId: sibling?.programAreaId, locationId: sibling?.locationId }),
      qrCode: params.get('qr') ?? '',
    };
  });
  const [count, setCount] = useState('1');
  const [startNumber, setStartNumber] = useState('1');
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [busy, setBusy] = useState(false);
  const set = (k: keyof FormState) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const productOptions = useMemo(() => {
    const groups = new Map<string, { id: string; label: string }[]>();
    for (const p of products.values()) {
      if (!p.active && p.id !== form.productId) continue;
      const cat = (p.categoryId && categories.get(p.categoryId)?.name) || 'Uncategorized';
      if (!groups.has(cat)) groups.set(cat, []);
      groups.get(cat)!.push({ id: p.id, label: productLabel(p.id) });
    }
    return [...groups.entries()]
      .sort(([a], [b]) => compareText(a, b))
      .map(([cat, list]) => [cat, list.sort((a, b) => compareText(a.label, b.label))] as const);
  }, [products, categories, productLabel, form.productId]);

  const n = Math.max(1, Math.min(200, Math.round(Number(count) || 1)));
  const many = !existing && n > 1;

  function validate(): GearInput | null {
    const errs: typeof errors = {};
    if (!form.name.trim()) errs.name = 'Name is required';
    let qrCode = '';
    if (form.qrCode.trim()) {
      const code = normalizeQrCode(form.qrCode);
      if (!code) errs.qrCode = 'Use letters, numbers, dots, dashes or underscores';
      else {
        const owner = [...gear.values()].find((g) => g.qrCode === code && g.id !== id);
        if (owner) errs.qrCode = `Already used by ${owner.name}`;
        qrCode = code;
      }
    } else if (existing) errs.qrCode = 'A QR code is required';
    const links = form.links.trim() ? parseLinks(form.links) : [];
    if (links === 'invalid') errs.links = 'Each line needs a URL starting with http:// or https://';
    for (const k of ['mfgDate', 'purchaseDate', 'firstUseDate', 'customEol'] as const)
      if (form[k] && !/^\d{4}-\d{2}-\d{2}$/.test(form[k])) errs[k] = 'Invalid date';
    setErrors(errs);
    if (Object.keys(errs).length || links === 'invalid') return null;
    return {
      name: form.name.trim(),
      productId: form.productId || null,
      programAreaId: form.programAreaId || null,
      locationId: form.locationId || null,
      qrCode,
      serialNumber: form.serialNumber.trim(),
      tags: parseList(form.tags),
      mfgDate: form.mfgDate || null,
      purchaseDate: form.purchaseDate || null,
      firstUseDate: form.firstUseDate || null,
      purchaseValue: numOrNull(form.purchaseValue),
      supplier: form.supplier.trim(),
      customEol: form.customEol || null,
      notes: form.notes.trim(),
      links,
    };
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const input = validate();
    if (!input) return;
    setBusy(true);
    try {
      if (existing) {
        await updateGear(uid, existing.id, existing, input);
        navigate(`/gear/${existing.id}`);
        return;
      }
      if (!many) {
        const batch = writeBatch(db);
        const newId = batchCreateGear(batch, uid, input);
        await commit(batch, 'Gear');
        notify(`${input.name} added`, 'success');
        navigate(`/gear/${newId}`);
        return;
      }
      // "Raft" × 4 starting at 3 → Raft 3, Raft 4, Raft 5, Raft 6
      const start = Math.round(Number(startNumber) || 1);
      const used = new Set([...gear.values()].map((g) => g.qrCode));
      const batch = writeBatch(db);
      const ids: string[] = [];
      for (let i = 0; i < n; i++) {
        let code = generateQrCode();
        while (used.has(code)) code = generateQrCode();
        used.add(code);
        ids.push(batchCreateGear(batch, uid, { ...input, name: `${input.name} ${start + i}`, qrCode: code, serialNumber: '' }));
      }
      await commit(batch, 'Gear');
      notify(`${n} items added`, 'success');
      navigate(`/labels?ids=${ids.join(',')}`);
    } finally {
      setBusy(false);
    }
  }

  const backTo = existing ? `/gear/${existing.id}` : '/gear';

  return (
    <form onSubmit={submit} className="space-y-6">
      <PageHeader title={existing ? `Edit ${existing.name}` : 'Add gear'} back={{ to: backTo, label: existing ? existing.name : 'Gear' }} />

      <Section title="Identity">
        <Field label={many ? 'Base name' : 'Name'} error={errors.name} hint={many ? `Creates “${form.name || 'Raft'} ${startNumber || 1}” … “${form.name || 'Raft'} ${(Number(startNumber) || 1) + n - 1}”` : 'e.g. “Raft 1” or “Helmet M-07”'}>
          <Input value={form.name} onChange={set('name')} required autoFocus={!existing} />
        </Field>
        <Field
          label="Product"
          hint={
            <>
              Make and model.{' '}
              <Link className="link" to="/products/new" target="_blank">
                Add a product
              </Link>
            </>
          }
        >
          <Select value={form.productId} onChange={set('productId')}>
            <option value="">— Choose a product —</option>
            {productOptions.map(([cat, list]) => (
              <optgroup key={cat} label={cat}>
                {list.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
        </Field>
        <Field label="Program area">
          <Select value={form.programAreaId} onChange={set('programAreaId')}>
            <option value="">— None —</option>
            {sortedValues(programAreas).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Location">
          <Select value={form.locationId} onChange={set('locationId')}>
            <option value="">— None —</option>
            {sortedValues(locations).map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
        </Field>
        {!existing && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="How many?" hint="Up to 200 at once">
              <Input type="number" min={1} max={200} value={count} onChange={(e) => setCount(e.target.value)} />
            </Field>
            {many && (
              <Field label="Start numbering at">
                <Input type="number" value={startNumber} onChange={(e) => setStartNumber(e.target.value)} />
              </Field>
            )}
          </div>
        )}
        {!many && (
          <Field
            label="QR code"
            error={errors.qrCode}
            hint={existing ? 'Change this to re-tag the item with a different label.' : 'Leave blank to generate one, or scan/type a pre-printed tag’s code.'}
          >
            <Input value={form.qrCode} onChange={set('qrCode')} className="font-mono uppercase" placeholder="CG-XXXXXX" />
          </Field>
        )}
        {!many && (
          <Field label="Serial number">
            <Input value={form.serialNumber} onChange={set('serialNumber')} />
          </Field>
        )}
        <Field label="Tags" hint="Comma separated, e.g. “small, loaner”">
          <Input value={form.tags} onChange={set('tags')} />
        </Field>
      </Section>

      <Section title="Purchase & lifecycle">
        <Field label="Purchase date" error={errors.purchaseDate}>
          <Input type="date" value={form.purchaseDate} onChange={set('purchaseDate')} />
        </Field>
        <Field label="Purchase value (USD, each)">
          <Input inputMode="decimal" value={form.purchaseValue} onChange={set('purchaseValue')} placeholder="0" />
        </Field>
        <Field label="Supplier">
          <Input value={form.supplier} onChange={set('supplier')} />
        </Field>
        <Field label="Manufacturing date" error={errors.mfgDate}>
          <Input type="date" value={form.mfgDate} onChange={set('mfgDate')} />
        </Field>
        <Field label="First use date" error={errors.firstUseDate}>
          <Input type="date" value={form.firstUseDate} onChange={set('firstUseDate')} />
        </Field>
        <Field label="Custom end of life" error={errors.customEol} hint="Overrides the product’s lifetime.">
          <Input type="date" value={form.customEol} onChange={set('customEol')} />
        </Field>
      </Section>

      <Section title="Notes & documents" cols={1}>
        <Field label="Notes">
          <Textarea value={form.notes} onChange={set('notes')} />
        </Field>
        <Field label="Document links" error={errors.links} hint="One per line: label | https://…">
          <Textarea value={form.links} onChange={set('links')} placeholder="Purchase receipt | https://…" />
        </Field>
      </Section>

      <div className="flex justify-end gap-2">
        <Button onClick={() => navigate(backTo)}>Cancel</Button>
        <Button type="submit" variant="primary" disabled={busy}>
          {existing ? 'Save changes' : many ? `Add ${n} items` : 'Add gear'}
        </Button>
      </div>
    </form>
  );
}

function Section({ title, children, cols = 2 }: { title: string; children: React.ReactNode; cols?: 1 | 2 }) {
  return (
    <fieldset className="card p-5">
      <legend className="sr-only">{title}</legend>
      <h2 className="mb-4 text-sm font-semibold text-stone-900">{title}</h2>
      <div className={`grid gap-4 ${cols === 2 ? 'sm:grid-cols-2' : ''}`}>{children}</div>
    </fieldset>
  );
}

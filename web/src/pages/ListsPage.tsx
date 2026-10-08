import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Package, Plus, Trash2 } from 'lucide-react';
import { newItemId, type ListLine } from '@gear/shared';
import { useMe } from '../auth/AuthProvider';
import { compareText, sortedValues, useData } from '../data/DataProvider';
import { deleteDocument, saveList } from '../data/writes';
import { Badge, Button, Checkbox, Empty, Field, Input, LinkButton, PageHeader, Select, Textarea } from '../components/ui';
import { plural } from '../lib/format';
import { notify } from '../components/toast';

/** Readable name for a list line: a product, or "any <category>". */
export function useLineLabel() {
  const { productLabel, categories } = useData();
  return (l: Pick<ListLine, 'productId' | 'categoryId'>) =>
    l.productId ? productLabel(l.productId) : l.categoryId ? `Any ${categories.get(l.categoryId)?.name ?? 'category'}` : '—';
}

export function ListsPage() {
  const { isManager } = useMe();
  const { lists, programAreas } = useData();
  const [showInactive, setShowInactive] = useState(false);
  const all = sortedValues(lists, showInactive);
  return (
    <div>
      <PageHeader
        title="Lists"
        subtitle="What an activity needs, so staff know what to pull. Build a kit from a list to pick the actual gear."
        actions={
          isManager && (
            <LinkButton to="/lists/new" variant="primary">
              <Plus size={16} /> New list
            </LinkButton>
          )
        }
      />
      <div className="mb-3 flex justify-end">
        <Checkbox label="Show inactive" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
      </div>
      {all.length === 0 ? (
        <Empty title="No lists yet">{isManager && 'Create one for each common activity, e.g. “Day raft trip — 6 guests”.'}</Empty>
      ) : (
        <ul className="card divide-y divide-stone-100">
          {all.map((l) => (
            <li key={l.id}>
              <Link to={`/lists/${l.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-stone-50">
                <span className="min-w-0">
                  <span className="flex items-center gap-2 font-medium">
                    {l.name} {!l.active && <Badge>Inactive</Badge>}
                  </span>
                  <span className="block truncate text-xs text-stone-500">
                    {[l.programAreaId && programAreas.get(l.programAreaId)?.name, plural(l.lines.reduce((n, x) => n + x.quantity, 0), 'item'), l.description]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type Draft = Omit<ListLine, 'quantity'> & { quantity: string; kind: 'product' | 'category' };

export function ListEditPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { uid, isManager } = useMe();
  const { lists, programAreas, products, categories, productLabel } = useData();
  const lineLabel = useLineLabel();
  const existing = id ? lists.get(id) : undefined;
  const [name, setName] = useState(existing?.name ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [programAreaId, setProgramAreaId] = useState(existing?.programAreaId ?? '');
  const [active, setActive] = useState(existing?.active ?? true);
  const [lines, setLines] = useState<Draft[]>(
    existing?.lines.map((l) => ({ ...l, quantity: String(l.quantity), kind: l.productId ? 'product' : 'category' })) ?? [],
  );
  const [editing, setEditing] = useState(!existing);
  const [busy, setBusy] = useState(false);

  if (id && !existing) return <PageHeader title="List not found" back={{ to: '/lists', label: 'Lists' }} />;

  const productOptions = [...products.values()]
    .filter((p) => p.active)
    .map((p) => ({ id: p.id, label: productLabel(p.id) }))
    .sort((a, b) => compareText(a.label, b.label));
  const set = (i: number, patch: Partial<Draft>) => setLines((l) => l.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  if (existing && !editing)
    return (
      <div className="max-w-2xl space-y-5">
        <PageHeader
          back={{ to: '/lists', label: 'Lists' }}
          title={existing.name}
          subtitle={[existing.programAreaId && programAreas.get(existing.programAreaId)?.name, existing.description].filter(Boolean).join(' · ')}
          actions={
            <>
              <LinkButton to={`/kits/new?list=${existing.id}`} variant="primary">
                <Package size={16} /> Build a kit from this list
              </LinkButton>
              {isManager && <Button onClick={() => setEditing(true)}>Edit</Button>}
            </>
          }
        />
        <ul className="card divide-y divide-stone-100">
          {existing.lines.map((l) => (
            <li key={l.id} className="flex items-baseline gap-3 px-4 py-2.5 text-sm">
              <span className="w-10 text-right font-semibold tabular-nums">{l.quantity}×</span>
              <span className="flex-1">
                {lineLabel(l)}
                {l.notes && <span className="block text-xs text-stone-500">{l.notes}</span>}
              </span>
            </li>
          ))}
          {!existing.lines.length && <li className="px-4 py-6 text-center text-sm text-stone-500">This list is empty.</li>}
        </ul>
      </div>
    );

  return (
    <div className="max-w-3xl space-y-5">
      <PageHeader back={{ to: existing ? `/lists/${existing.id}` : '/lists', label: 'Back' }} title={existing ? `Edit ${existing.name}` : 'New list'} />
      <div className="card grid gap-4 p-5 sm:grid-cols-2">
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Day raft trip — 6 guests" />
        </Field>
        <Field label="Program area">
          <Select value={programAreaId} onChange={(e) => setProgramAreaId(e.target.value)}>
            <option value="">— None —</option>
            {sortedValues(programAreas).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Description" className="sm:col-span-2">
          <Textarea className="min-h-16" value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <Checkbox label="Active" checked={active} onChange={(e) => setActive(e.target.checked)} />
      </div>
      <div className="space-y-2">
        <h2 className="text-sm font-semibold">Items</h2>
        {lines.map((l, i) => (
          <div key={l.id} className="card grid items-end gap-2 p-3 sm:grid-cols-[5rem_8rem_1fr_1fr_auto]">
            <Field label="Qty">
              <Input inputMode="numeric" value={l.quantity} onChange={(e) => set(i, { quantity: e.target.value })} />
            </Field>
            <Field label="Type">
              <Select value={l.kind} onChange={(e) => set(i, { kind: e.target.value as Draft['kind'], productId: null, categoryId: null })}>
                <option value="product">Product</option>
                <option value="category">Any in category</option>
              </Select>
            </Field>
            {l.kind === 'product' ? (
              <Field label="Product">
                <Select value={l.productId ?? ''} onChange={(e) => set(i, { productId: e.target.value || null })}>
                  <option value="">— Choose —</option>
                  {productOptions.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : (
              <Field label="Category">
                <Select value={l.categoryId ?? ''} onChange={(e) => set(i, { categoryId: e.target.value || null })}>
                  <option value="">— Choose —</option>
                  {sortedValues(categories).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <Field label="Notes">
              <Input value={l.notes ?? ''} onChange={(e) => set(i, { notes: e.target.value })} placeholder="e.g. mix of sizes" />
            </Field>
            <Button variant="ghost" className="text-red-700" aria-label="Remove line" onClick={() => setLines((x) => x.filter((_, j) => j !== i))}>
              <Trash2 size={16} />
            </Button>
          </div>
        ))}
        <Button size="sm" onClick={() => setLines((x) => [...x, { id: newItemId(), kind: 'product', productId: null, categoryId: null, quantity: '1', notes: '' }])}>
          <Plus size={14} /> Add item
        </Button>
      </div>
      <div className="flex flex-wrap justify-between gap-2">
        <span>
          {existing && (
            <Button
              variant="ghost"
              className="text-red-700"
              onClick={async () => {
                if (!confirm('Delete this list? Kits built from it are kept.')) return;
                await deleteDocument('lists', existing.id);
                navigate('/lists');
              }}
            >
              <Trash2 size={16} /> Delete list
            </Button>
          )}
        </span>
        <span className="flex gap-2">
          <Button onClick={() => (existing ? setEditing(false) : navigate('/lists'))}>Cancel</Button>
          <Button
            variant="primary"
            disabled={busy || !name.trim()}
            onClick={async () => {
              const clean = lines
                .filter((l) => (l.kind === 'product' ? l.productId : l.categoryId))
                .map((l) => ({
                  id: l.id,
                  productId: l.kind === 'product' ? l.productId : null,
                  categoryId: l.kind === 'category' ? l.categoryId : null,
                  quantity: Math.max(1, Math.round(Number(l.quantity) || 1)),
                  notes: l.notes?.trim() ?? '',
                }));
              setBusy(true);
              try {
                const savedId = await saveList(uid, existing?.id ?? null, {
                  name: name.trim(),
                  description: description.trim(),
                  programAreaId: programAreaId || null,
                  lines: clean,
                  active,
                });
                notify('List saved', 'success');
                if (existing) setEditing(false);
                else navigate(`/lists/${savedId}`, { replace: true });
              } finally {
                setBusy(false);
              }
            }}
          >
            Save list
          </Button>
        </span>
      </div>
    </div>
  );
}

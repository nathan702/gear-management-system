import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import type { WithId } from '@gear/shared';
import { useMe } from '../auth/AuthProvider';
import { sortedValues, useData } from '../data/DataProvider';
import { deleteDocument, saveReference, type RefCollection } from '../data/writes';
import { Badge, Button, Checkbox, Field, Input, Modal, PageHeader, Select, Textarea } from '../components/ui';
import { plural } from '../lib/format';
import { notify } from '../components/toast';

interface RefDoc extends WithId {
  name: string;
  description?: string;
  active: boolean;
  parentId?: string | null;
  website?: string;
  notes?: string;
  color?: string;
}

const KINDS: { key: RefCollection; label: string; singular: string; help: string }[] = [
  { key: 'programAreas', label: 'Program areas', singular: 'program area', help: 'Each piece of gear is assigned to one program area.' },
  { key: 'locations', label: 'Locations', singular: 'location', help: 'Where each piece of gear lives.' },
  { key: 'categories', label: 'Categories', singular: 'category', help: 'Each product belongs to one category, e.g. Rafts or PFDs.' },
  { key: 'manufacturers', label: 'Manufacturers', singular: 'manufacturer', help: 'Makers of the products we own.' },
];

export function ReferencePage() {
  const { uid, isAdmin } = useMe();
  const data = useData();
  const [params, setParams] = useSearchParams();
  const kind = KINDS.find((k) => k.key === params.get('tab')) ?? KINDS[0];
  const map = data[kind.key] as unknown as Map<string, RefDoc>;
  const [editing, setEditing] = useState<Partial<RefDoc> | null>(null);
  const [showInactive, setShowInactive] = useState(false);

  // How many records point at each entry — deletion is only offered when unused.
  const usage = useMemo(() => {
    const m = new Map<string, number>();
    const bump = (id: string | null | undefined) => id && m.set(id, (m.get(id) ?? 0) + 1);
    if (kind.key === 'programAreas') data.gear.forEach((g) => bump(g.programAreaId));
    if (kind.key === 'locations') {
      data.gear.forEach((g) => bump(g.locationId));
      data.locations.forEach((l) => bump(l.parentId));
    }
    if (kind.key === 'categories') data.products.forEach((p) => bump(p.categoryId));
    if (kind.key === 'manufacturers') data.products.forEach((p) => bump(p.manufacturerId));
    return m;
  }, [kind.key, data.gear, data.products, data.locations]);
  const usedBy = kind.key === 'categories' || kind.key === 'manufacturers' ? 'product' : 'item';

  const list = sortedValues(map, showInactive);

  async function save(entry: Partial<RefDoc>) {
    const name = entry.name?.trim();
    if (!name) return;
    const dup = [...map.values()].find((v) => v.id !== entry.id && v.name.toLowerCase() === name.toLowerCase());
    if (dup) {
      notify(`There is already a ${kind.singular} called “${dup.name}”.`, 'error');
      return;
    }
    const { id, ...rest } = entry;
    await saveReference(uid, kind.key, id ?? null, {
      ...rest,
      name,
      description: rest.description?.trim() ?? '',
      active: rest.active ?? true,
    });
    setEditing(null);
  }

  return (
    <div>
      <PageHeader
        title="Lists & categories"
        subtitle="The building blocks used across gear and products. Deactivate entries you no longer use — history is kept."
      />
      <div className="mb-4 flex gap-1 overflow-x-auto border-b border-stone-200">
        {KINDS.map((k) => (
          <button
            key={k.key}
            onClick={() => setParams({ tab: k.key })}
            className={`border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap ${
              k.key === kind.key ? 'border-brand-700 text-brand-800' : 'border-transparent text-stone-600 hover:text-stone-900'
            }`}
          >
            {k.label}
          </button>
        ))}
      </div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-stone-600">{kind.help}</p>
        <div className="flex items-center gap-3">
          <Checkbox label="Show inactive" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
          <Button variant="primary" onClick={() => setEditing({ active: true })}>
            <Plus size={16} /> Add {kind.singular}
          </Button>
        </div>
      </div>

      <ul className="card divide-y divide-stone-100">
        {list.map((r) => (
          <li key={r.id} className="flex items-center gap-3 px-4 py-3">
            {kind.key === 'programAreas' && <span className="size-3 shrink-0 rounded-full" style={{ background: r.color || '#a8a29e' }} />}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 font-medium">
                {r.name}
                {!r.active && <Badge>Inactive</Badge>}
              </div>
              <div className="truncate text-xs text-stone-500">
                {[
                  r.parentId ? `in ${data.locations.get(r.parentId)?.name ?? '?'}` : null,
                  r.description || r.website,
                  plural(usage.get(r.id) ?? 0, usedBy),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </div>
            </div>
            <Button size="sm" variant="ghost" onClick={() => setEditing(r)} aria-label={`Edit ${r.name}`}>
              <Pencil size={16} />
            </Button>
            {isAdmin && !usage.get(r.id) && (
              <Button
                size="sm"
                variant="ghost"
                className="text-red-700"
                aria-label={`Delete ${r.name}`}
                onClick={async () => {
                  if (!confirm(`Delete ${r.name}?`)) return;
                  await deleteDocument(kind.key, r.id);
                }}
              >
                <Trash2 size={16} />
              </Button>
            )}
          </li>
        ))}
        {!list.length && <li className="px-4 py-6 text-center text-sm text-stone-500">Nothing here yet.</li>}
      </ul>

      <EditModal
        kind={kind}
        entry={editing}
        locations={sortedValues(data.locations as unknown as Map<string, RefDoc>)}
        onClose={() => setEditing(null)}
        onSave={save}
      />
    </div>
  );
}

function EditModal({
  kind,
  entry,
  locations,
  onClose,
  onSave,
}: {
  kind: (typeof KINDS)[number];
  entry: Partial<RefDoc> | null;
  locations: RefDoc[];
  onClose(): void;
  onSave(e: Partial<RefDoc>): Promise<void>;
}) {
  const [draft, setDraft] = useState<Partial<RefDoc>>({});
  const [lastEntry, setLastEntry] = useState<Partial<RefDoc> | null>(null);
  if (entry !== lastEntry) {
    setLastEntry(entry);
    setDraft(entry ?? {});
  }
  const set = (k: keyof RefDoc) => (e: { target: { value: string } }) => setDraft((d) => ({ ...d, [k]: e.target.value }));
  return (
    <Modal
      open={!!entry}
      onClose={onClose}
      title={entry?.id ? `Edit ${kind.singular}` : `Add ${kind.singular}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!draft.name?.trim()} onClick={() => onSave(draft)}>
            Save
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void onSave(draft);
        }}
      >
        <Field label="Name">
          <Input value={draft.name ?? ''} onChange={set('name')} autoFocus required />
        </Field>
        {kind.key === 'locations' && (
          <Field label="Inside another location" hint="Optional, e.g. “Boat shed” inside “Farm”.">
            <Select value={draft.parentId ?? ''} onChange={(e) => setDraft((d) => ({ ...d, parentId: e.target.value || null }))}>
              <option value="">— None —</option>
              {locations
                .filter((l) => l.id !== draft.id)
                .map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
            </Select>
          </Field>
        )}
        {kind.key === 'manufacturers' && (
          <Field label="Website">
            <Input type="url" value={draft.website ?? ''} onChange={set('website')} placeholder="https://" />
          </Field>
        )}
        {kind.key === 'programAreas' && (
          <Field label="Color">
            <Input type="color" className="h-10 w-20 p-1" value={draft.color || '#2f7d5b'} onChange={set('color')} />
          </Field>
        )}
        <Field label={kind.key === 'manufacturers' ? 'Notes (contacts, warranty…)' : 'Description'}>
          <Textarea
            value={(kind.key === 'manufacturers' ? draft.notes : draft.description) ?? ''}
            onChange={set(kind.key === 'manufacturers' ? 'notes' : 'description')}
          />
        </Field>
        <Checkbox label="Active" checked={draft.active ?? true} onChange={(e) => setDraft((d) => ({ ...d, active: e.target.checked }))} />
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

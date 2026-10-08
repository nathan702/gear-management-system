import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import QrScanner from 'qr-scanner';
import { serverTimestamp } from 'firebase/firestore';
import { AlertTriangle, LogIn, LogOut, Pencil, Plus, QrCode, Search, Trash2, X } from 'lucide-react';
import {
  codeFromScan,
  fillFromList,
  inclusiveDays,
  todayIso,
  type Gear,
  type Kit,
  type WithId,
} from '@gear/shared';
import { useMe } from '../auth/AuthProvider';
import { byName, compareText, sortedValues, useData } from '../data/DataProvider';
import { deleteDocument, returnKit, saveKit } from '../data/writes';
import { Button, Card, Field, Input, Modal, PageHeader, Select, StatusBadge, Textarea } from '../components/ui';
import { DueBadge, useInspectionSummaries } from '../inspections/common';
import { KitStatusBadge, availabilityText, canEditKit, inspectionsBeforeCheckout, isBlocked, useAvailability, type KitDoc } from '../kits/common';
import { useLineLabel } from './ListsPage';
import { kitDates } from './KitsPage';
import { fmtDate, plural } from '../lib/format';
import { notify } from '../components/toast';

export function KitPage() {
  const { id } = useParams();
  const { kits } = useData();
  if (!id) return <KitDetailsForm />;
  const kit = kits.get(id);
  if (!kit) return <PageHeader title="Kit not found" back={{ to: '/kits', label: 'Kits' }} />;
  return <KitView kit={kit} />;
}

/* ------------------------------------------------------------ details form */

function KitDetailsForm({ kit, onDone }: { kit?: KitDoc; onDone?(): void }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { uid, isAdmin, profile } = useMe();
  const { users, programAreas, lists, kits } = useData();
  const fromList = params.get('list') ? lists.get(params.get('list')!) : undefined;
  const [name, setName] = useState(kit?.name ?? (fromList ? fromList.name : ''));
  const [ownerId, setOwnerId] = useState(kit?.ownerId ?? uid);
  const [programAreaId, setProgramAreaId] = useState(kit?.programAreaId ?? fromList?.programAreaId ?? profile.homeProgramAreaId ?? '');
  const [startDate, setStartDate] = useState(kit?.startDate ?? '');
  const [endDate, setEndDate] = useState(kit?.endDate ?? '');
  const [listId, setListId] = useState(kit?.listId ?? fromList?.id ?? '');
  const [notes, setNotes] = useState(kit?.notes ?? '');
  const [error, setError] = useState<string | null>(null);
  const availability = useAvailability();
  const { gear } = useData();

  async function save() {
    setError(null);
    if (!name.trim()) return setError('Give the kit a name.');
    if (startDate && endDate && startDate > endDate) return setError('The end date is before the start date.');
    // Changing dates must not double-book gear already in the kit.
    if (kit) {
      const clash = kit.gearIds
        .map((g) => gear.get(g))
        .filter((g): g is Gear & WithId => !!g)
        .map((g) => ({ g, a: availability(g, { id: kit.id, startDate: startDate || null, endDate: endDate || null }) }))
        .filter(({ a }) => a.conflicts.length);
      if (clash.length) return setError(`These dates clash with other kits for: ${clash.map(({ g, a }) => `${g.name} (${a.conflicts.map((k) => k.name).join(', ')})`).join('; ')}`);
    }
    const data: Partial<Kit> = {
      name: name.trim(),
      ownerId,
      programAreaId: programAreaId || null,
      startDate: startDate || null,
      endDate: endDate || null,
      listId: listId || null,
      notes: notes.trim(),
    };
    const savedId = await saveKit(uid, kit?.id ?? null, data);
    if (onDone) onDone();
    else navigate(`/kits/${savedId}`, { replace: true });
  }

  const form = (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Name" className="sm:col-span-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Camp week 3 — canoe group" autoFocus={!kit} />
      </Field>
      <Field label="Start date" hint="Optional">
        <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
      </Field>
      <Field label="End date" hint="Optional — without dates the gear is held until returned">
        <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
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
      <Field label="Build from list" hint="Optional — shows what's still needed">
        <Select value={listId} onChange={(e) => setListId(e.target.value)}>
          <option value="">— None —</option>
          {sortedValues(lists).map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </Select>
      </Field>
      {isAdmin && (
        <Field label="Kit for" hint="Admins can build kits for other people">
          <Select value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
            {[...users.values()]
              .filter((u) => u.active || u.id === ownerId)
              .sort((a, b) => compareText(a.displayName, b.displayName))
              .map((u) => (
                <option key={u.id} value={u.id}>
                  {u.displayName}
                </option>
              ))}
          </Select>
        </Field>
      )}
      <Field label="Notes" className="sm:col-span-2">
        <Textarea className="min-h-16" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      {error && <p className="text-sm text-red-700 sm:col-span-2">{error}</p>}
    </div>
  );

  if (kit)
    return (
      <Modal
        open
        onClose={onDone!}
        title="Edit kit"
        wide
        footer={
          <>
            <Button onClick={onDone}>Cancel</Button>
            <Button variant="primary" onClick={save}>
              Save
            </Button>
          </>
        }
      >
        {form}
      </Modal>
    );

  return (
    <div className="max-w-2xl space-y-5">
      <PageHeader title="New kit" back={{ to: '/kits', label: 'Kits' }} subtitle={kits.size ? undefined : 'A kit is the specific gear someone takes, e.g. for a week of camp.'} />
      <div className="card p-5">{form}</div>
      <div className="flex justify-end gap-2">
        <Button onClick={() => navigate(-1)}>Cancel</Button>
        <Button variant="primary" onClick={save}>
          Create kit and add gear
        </Button>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- kit view */

function KitView({ kit }: { kit: KitDoc }) {
  const navigate = useNavigate();
  const { uid, isAdmin, profile } = useMe();
  const { gear, users, lists, products, programAreas, productLabel } = useData();
  const availability = useAvailability();
  const summaries = useInspectionSummaries();
  const lineLabel = useLineLabel();
  const [editing, setEditing] = useState(false);
  const [checkingOut, setCheckingOut] = useState(false);
  const [returning, setReturning] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [q, setQ] = useState('');
  const canEdit = canEditKit(kit, uid, profile.role) && kit.status !== 'returned';
  const list = kit.listId ? lists.get(kit.listId) : undefined;
  const items = kit.gearIds.map((id) => gear.get(id)).filter((g): g is Gear & WithId => !!g).sort(byName);
  const forKit = { id: kit.id, startDate: kit.startDate, endDate: kit.endDate };

  async function add(ids: string[]) {
    const next = [...new Set([...kit.gearIds, ...ids])];
    await saveKit(uid, kit.id, { gearIds: next });
  }
  async function remove(id: string) {
    await saveKit(uid, kit.id, { gearIds: kit.gearIds.filter((g) => g !== id) });
  }

  /** Adds after checking availability: blocked for most people, a warning for admins. */
  async function tryAdd(g: Gear & WithId) {
    const a = availability(g, forKit);
    if (isBlocked(profile.role, a)) {
      notify(`${g.name} can't be added: ${availabilityText(a)}`, 'error');
      return;
    }
    if (a.problems.length && !confirm(`${g.name}: ${availabilityText(a)}. Add it anyway?`)) return;
    await add([g.id]);
  }

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return [];
    return [...gear.values()]
      .filter((g) => !kit.gearIds.includes(g.id) && g.status !== 'retired')
      .filter((g) => `${g.name} ${g.qrCode} ${productLabel(g.productId)}`.toLowerCase().includes(needle))
      .sort(byName)
      .slice(0, 15);
  }, [q, gear, kit.gearIds, productLabel]);

  const fill = useMemo(() => {
    if (!list) return null;
    // Suggest only trouble-free gear first; usable gear with warnings (has
    // issues, inspection due soon) comes after it.
    const candidates = [...gear.values()]
      .filter((g) => !kit.gearIds.includes(g.id))
      .map((g) => ({ g, a: availability(g, forKit) }))
      .filter(({ a }) => a.problems.length === 0)
      .sort((x, y) => x.a.warnings.length - y.a.warnings.length || byName(x.g, y.g))
      .map(({ g }) => g);
    return fillFromList(list, kit.gearIds, candidates, gear, products);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, gear, kit.gearIds, kit.startDate, kit.endDate, products, availability, profile.role]);
  const suggestions = fill?.flatMap((f) => f.suggest) ?? [];

  return (
    <div className="space-y-5">
      <PageHeader
        back={{ to: '/kits', label: 'Kits' }}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {kit.name} <KitStatusBadge status={kit.status} />
          </span>
        }
        subtitle={[
          kitDates(kit),
          users.get(kit.ownerId)?.displayName,
          kit.programAreaId && programAreas.get(kit.programAreaId)?.name,
          kit.checkedOutDate && `out since ${fmtDate(kit.checkedOutDate)}`,
          kit.returnedDate && `returned ${fmtDate(kit.returnedDate)}`,
        ]
          .filter(Boolean)
          .join(' · ')}
        actions={
          canEdit && (
            <>
              {kit.status === 'planned' && (
                <Button variant="primary" onClick={() => setCheckingOut(true)} disabled={!items.length}>
                  <LogOut size={16} /> Check out
                </Button>
              )}
              {kit.status === 'checked_out' && (
                <Button variant="primary" onClick={() => setReturning(true)}>
                  <LogIn size={16} /> Return
                </Button>
              )}
              <Button onClick={() => setEditing(true)}>
                <Pencil size={16} /> Edit
              </Button>
            </>
          )
        }
      />
      {kit.notes && <p className="text-sm whitespace-pre-wrap text-stone-700">{kit.notes}</p>}

      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <Card title={`Gear (${items.length})`}>
          {items.length ? (
            <ul className="divide-y divide-stone-100">
              {items.map((g) => {
                const a = availability(g, forKit);
                return (
                  <li key={g.id} className="flex items-center gap-3 py-2 text-sm">
                    <div className="min-w-0 flex-1">
                      <Link className="font-medium hover:underline" to={`/gear/${g.id}`}>
                        {g.name}
                      </Link>
                      <div className="truncate text-xs text-stone-500">{productLabel(g.productId)}</div>
                      {(a.problems.length > 0 || a.warnings.length > 0) && kit.status !== 'returned' && (
                        <div className={`flex items-center gap-1 text-xs ${a.problems.length ? 'text-red-700' : 'text-amber-700'}`}>
                          <AlertTriangle size={12} /> {availabilityText(a)}
                        </div>
                      )}
                    </div>
                    <span className="flex shrink-0 gap-1">
                      <DueBadge state={summaries.get(g.id)?.state ?? 'none'} short />
                      <StatusBadge status={g.status} />
                    </span>
                    {canEdit && kit.status === 'planned' && (
                      <Button size="sm" variant="ghost" aria-label={`Remove ${g.name}`} onClick={() => remove(g.id)}>
                        <X size={16} />
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm text-stone-500">No gear yet.{canEdit && ' Search, scan or fill from a list.'}</p>
          )}

          {canEdit && kit.status === 'planned' && (
            <div className="mt-4 space-y-2 border-t border-stone-100 pt-4">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-stone-400" />
                  <Input className="pl-9" placeholder="Add gear: search name or code…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Add gear" />
                </div>
                <Button onClick={() => setScanning(true)}>
                  <QrCode size={16} /> Scan
                </Button>
              </div>
              {results.length > 0 && (
                <ul className="divide-y divide-stone-100 rounded-lg border border-stone-200">
                  {results.map((g) => {
                    const a = availability(g, forKit);
                    const blocked = isBlocked(profile.role, a);
                    return (
                      <li key={g.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                        <div className="min-w-0 flex-1">
                          <div className="font-medium">{g.name}</div>
                          <div className="truncate text-xs text-stone-500">
                            {productLabel(g.productId)}
                            {(a.problems.length > 0 || a.warnings.length > 0) && (
                              <span className={a.problems.length ? ' text-red-700' : ' text-amber-700'}> · {availabilityText(a)}</span>
                            )}
                          </div>
                        </div>
                        <Button size="sm" disabled={blocked} onClick={() => tryAdd(g)}>
                          <Plus size={14} /> {a.problems.length && !blocked ? 'Add anyway' : 'Add'}
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        </Card>

        <div className="space-y-5">
          {list && fill && (
            <Card
              title={
                <>
                  From list: <Link className="link" to={`/lists/${list.id}`}>{list.name}</Link>
                </>
              }
              actions={
                canEdit &&
                kit.status === 'planned' &&
                suggestions.length > 0 && (
                  <Button size="sm" variant="primary" onClick={() => add(suggestions)}>
                    Add {plural(suggestions.length, 'suggestion')}
                  </Button>
                )
              }
            >
              <ul className="space-y-2 text-sm">
                {fill.map((f) => (
                  <li key={f.line.id}>
                    <div className="flex justify-between gap-2">
                      <span>{lineLabel(f.line)}</span>
                      <span className={`tabular-nums ${f.have.length >= f.line.quantity ? 'text-brand-700' : 'text-stone-600'}`}>
                        {f.have.length} / {f.line.quantity}
                      </span>
                    </div>
                    {kit.status === 'planned' && (f.suggest.length > 0 || f.missing > 0) && (
                      <div className="text-xs text-stone-500">
                        {f.suggest.length > 0 && <>Suggested: {f.suggest.map((id) => gear.get(id)?.name).join(', ')}</>}
                        {f.missing > 0 && <span className="text-amber-700"> {f.missing} not available for these dates</span>}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {canEditKit(kit, uid, profile.role) && (
            <Button
              variant="ghost"
              className="text-red-700"
              onClick={async () => {
                if (!confirm(`Delete the kit “${kit.name}”?${kit.status === 'checked_out' ? ' It is checked out — usage won’t be logged.' : ''}`)) return;
                await deleteDocument('kits', kit.id);
                navigate('/kits');
              }}
            >
              <Trash2 size={16} /> Delete kit
            </Button>
          )}
        </div>
      </div>

      {editing && <KitDetailsForm kit={kit} onDone={() => setEditing(false)} />}
      {scanning && (
        <ScanToAdd
          onClose={() => setScanning(false)}
          onCode={async (code) => {
            const g = [...gear.values()].find((x) => x.qrCode === code);
            if (!g) return notify(`No gear has the code ${code}`, 'error');
            if (kit.gearIds.includes(g.id)) return notify(`${g.name} is already in this kit`);
            await tryAdd(g);
          }}
        />
      )}
      {checkingOut && <CheckOutModal kit={kit} items={items} isAdmin={isAdmin} onClose={() => setCheckingOut(false)} />}
      {returning && <ReturnModal kit={kit} items={items} onClose={() => setReturning(false)} />}
    </div>
  );
}

function ScanToAdd({ onClose, onCode }: { onClose(): void; onCode(code: string): Promise<unknown> }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const last = useRef<{ code: string; at: number } | null>(null);
  useEffect(() => {
    if (!video.current) return;
    const s = new QrScanner(
      video.current,
      (r) => {
        const code = codeFromScan(r.data);
        // Ignore the same label being seen again for a couple of seconds.
        if (!code || (last.current?.code === code && Date.now() - last.current.at < 2500)) return;
        last.current = { code, at: Date.now() };
        navigator.vibrate?.(50);
        void onCode(code);
      },
      { preferredCamera: 'environment', highlightScanRegion: true, maxScansPerSecond: 6 },
    );
    s.start().catch(() => setError('Camera not available.'));
    return () => s.destroy();
  }, [onCode]);
  return (
    <Modal open onClose={onClose} title="Scan gear into the kit" footer={<Button onClick={onClose}>Done</Button>}>
      <p className="mb-2 text-sm text-stone-600">Scan labels one after another; each is added if it’s available.</p>
      <div className="relative overflow-hidden rounded-lg bg-stone-900">
        <video ref={video} className="aspect-square w-full object-cover" muted playsInline />
        {error && <div className="absolute inset-0 flex items-center justify-center text-sm text-white">{error}</div>}
      </div>
    </Modal>
  );
}

function CheckOutModal({ kit, items, isAdmin, onClose }: { kit: KitDoc; items: (Gear & WithId)[]; isAdmin: boolean; onClose(): void }) {
  const { uid, profile } = useMe();
  const { products, inspectionForms } = useData();
  const availability = useAvailability();
  const forKit = { id: kit.id, startDate: kit.startDate, endDate: kit.endDate };
  const issues = items
    .map((g) => ({ g, a: availability(g, forKit), needs: inspectionsBeforeCheckout(g, g.productId ? products.get(g.productId) : undefined) }))
    .filter(({ a, needs }) => a.problems.length || needs.length);
  const blocked = issues.filter(({ a, needs }) => isBlocked(profile.role, a) || (needs.length > 0 && !isAdmin));
  return (
    <Modal
      open
      onClose={onClose}
      title={`Check out ${kit.name}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={blocked.length > 0}
            onClick={async () => {
              await saveKit(uid, kit.id, { status: 'checked_out', checkedOutDate: todayIso(), checkedOutAt: serverTimestamp() as never });
              notify(`${kit.name} checked out`, 'success');
              onClose();
            }}
          >
            {issues.length && !blocked.length ? 'Check out anyway' : 'Check out'}
          </Button>
        </>
      }
    >
      <p className="text-sm">{plural(items.length, 'item')} leave today.</p>
      {issues.length > 0 && (
        <ul className="mt-3 space-y-2 text-sm">
          {issues.map(({ g, a, needs }) => (
            <li key={g.id} className="rounded-md bg-red-50 px-3 py-2 text-red-900">
              <b>{g.name}</b>: {[availabilityText(a), ...needs.map((f) => `needs a ${inspectionForms.get(f)?.name ?? 'pre-use inspection'} today`)].filter(Boolean).join(' · ')}
              {needs.length > 0 && (
                <>
                  {' '}
                  <Link className="link" to={`/gear/${g.id}/inspect?form=${needs[0]}`}>
                    Inspect now
                  </Link>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {blocked.length > 0 && <p className="mt-3 text-sm text-stone-700">Remove or sort out the items above before checking out{isAdmin ? '' : ', or ask an admin'}.</p>}
    </Modal>
  );
}

function ReturnModal({ kit, items, onClose }: { kit: KitDoc; items: (Gear & WithId)[]; onClose(): void }) {
  const { uid } = useMe();
  const [returnedDate, setReturnedDate] = useState(todayIso());
  const start = kit.checkedOutDate || kit.startDate || returnedDate;
  const end = kit.endDate && kit.endDate < returnedDate ? kit.endDate : returnedDate;
  const span = inclusiveDays(start, end);
  const [days, setDays] = useState<Record<string, string>>(() => Object.fromEntries(items.map((g) => [g.id, String(span)])));
  const [busy, setBusy] = useState(false);
  const setAll = (v: string) => setDays(Object.fromEntries(items.map((g) => [g.id, v])));
  return (
    <Modal
      open
      onClose={onClose}
      title={`Return ${kit.name}`}
      wide
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await returnKit(
                  uid,
                  kit,
                  returnedDate,
                  items.map((g) => ({ gearId: g.id, daysUsed: Math.max(0, Math.min(366, Math.round(Number(days[g.id]) || 0))) })),
                );
                notify(`${kit.name} returned — usage logged`, 'success');
                onClose();
              } finally {
                setBusy(false);
              }
            }}
          >
            Return and log usage
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Returned on">
            <Input type="date" value={returnedDate} max={todayIso()} onChange={(e) => setReturnedDate(e.target.value || todayIso())} />
          </Field>
          <Button size="sm" onClick={() => setAll(String(span))}>
            Set all to {span}
          </Button>
          <Button size="sm" onClick={() => setAll('0')}>
            Set all to 0
          </Button>
        </div>
        <p className="text-sm text-stone-600">How many days was each item actually used? This counts toward usage-based inspections and reports.</p>
        <ul className="divide-y divide-stone-100">
          {items.map((g) => (
            <li key={g.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span>{g.name}</span>
              <Input
                inputMode="numeric"
                className="w-20"
                value={days[g.id] ?? ''}
                onChange={(e) => setDays((d) => ({ ...d, [g.id]: e.target.value }))}
                aria-label={`Days used for ${g.name}`}
              />
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  );
}

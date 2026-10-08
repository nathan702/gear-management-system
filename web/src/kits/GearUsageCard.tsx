import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { collection, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { LogIn, LogOut, Plus } from 'lucide-react';
import { inclusiveDays, todayIso, type Gear, type UsageLog, type WithId } from '@gear/shared';
import { db } from '../firebase';
import { useMe } from '../auth/AuthProvider';
import { compareText, useData } from '../data/DataProvider';
import { checkOutGear, logUsage, returnGear } from '../data/writes';
import { Button, Card, Field, Input, Modal, Select } from '../components/ui';
import { availabilityText, inspectionsBeforeCheckout, isBlocked, useAvailability, useCommitments } from './common';
import { kitDates } from '../pages/KitsPage';
import { fmtDate } from '../lib/format';
import { notify } from '../components/toast';

function useUsageLogs(gearId: string) {
  const [logs, setLogs] = useState<(UsageLog & WithId)[]>([]);
  useEffect(
    () =>
      onSnapshot(query(collection(db, 'usageLogs'), where('gearId', '==', gearId), orderBy('endDate', 'desc'), limit(10)), (snap) =>
        setLogs(snap.docs.map((d) => ({ id: d.id, ...(d.data() as UsageLog) }))),
      ),
    [gearId],
  );
  return logs;
}

export function GearUsageCard({ gear: g }: { gear: Gear & WithId }) {
  const { uid, isManager } = useMe();
  const { users } = useData();
  const c = useCommitments().get(g.id);
  const logs = useUsageLogs(g.id);
  const [mode, setMode] = useState<'out' | 'return' | 'log' | null>(null);
  const co = c?.checkout ?? null;
  const name = (u: string) => users.get(u)?.displayName ?? 'Someone';

  return (
    <Card
      title="Kits & use"
      actions={
        g.status !== 'retired' && (
          <span className="flex gap-1">
            {co ? (
              (co.userId === uid || isManager) && (
                <Button size="sm" variant="primary" onClick={() => setMode('return')}>
                  <LogIn size={14} /> Return
                </Button>
              )
            ) : (
              <Button size="sm" onClick={() => setMode('out')}>
                <LogOut size={14} /> Check out
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => setMode('log')} aria-label="Log usage">
              <Plus size={14} /> Log use
            </Button>
          </span>
        )
      }
    >
      <div className="space-y-3 text-sm">
        <p>
          <b className="tabular-nums">{g.stats?.daysUsed ?? 0}</b> days used
          {g.stats?.uses ? ` · ${g.stats.uses} uses` : ''}
          {g.stats?.lastUsedDate && <span className="text-stone-500"> · last {fmtDate(g.stats.lastUsedDate)}</span>}
        </p>
        {co && (
          <p className="rounded-md bg-indigo-50 px-3 py-2 text-indigo-900">
            Checked out to <b>{name(co.userId)}</b> since {fmtDate(co.startDate)}
            {co.dueBackDate && `, due back ${fmtDate(co.dueBackDate)}`}
          </p>
        )}
        {c?.kits.length ? (
          <ul className="space-y-1">
            {c.kits.map((k) => (
              <li key={k.id} className="flex justify-between gap-2">
                <Link className="link" to={`/kits/${k.id}`}>
                  {k.name}
                </Link>
                <span className="text-xs text-stone-500">
                  {name(k.ownerId)} · {k.status === 'checked_out' ? 'checked out' : kitDates(k)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          !co && <p className="text-stone-500">Not in any current or upcoming kit.</p>
        )}
        {logs.length > 0 && (
          <details>
            <summary className="cursor-pointer text-xs text-stone-600">Recent use</summary>
            <ul className="mt-1 space-y-0.5 text-xs text-stone-600">
              {logs.map((l) => (
                <li key={l.id}>
                  {fmtDate(l.startDate)} – {fmtDate(l.endDate)}: {l.daysUsed} day{l.daysUsed === 1 ? '' : 's'}
                  {l.uses ? `, ${l.uses} uses` : ''} · {name(l.userId)}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
      {mode === 'out' && <CheckOutGearModal gear={g} onClose={() => setMode(null)} />}
      {mode === 'return' && co && <ReturnGearModal checkoutId={co.id} onClose={() => setMode(null)} />}
      {mode === 'log' && <LogUseModal gear={g} onClose={() => setMode(null)} />}
    </Card>
  );
}

function CheckOutGearModal({ gear: g, onClose }: { gear: Gear & WithId; onClose(): void }) {
  const { uid, isAdmin, profile } = useMe();
  const { users, products, inspectionForms } = useData();
  const a = useAvailability()(g, null);
  const needs = inspectionsBeforeCheckout(g, g.productId ? products.get(g.productId) : undefined);
  const blocked = isBlocked(profile.role, a) || (needs.length > 0 && !isAdmin);
  const [userId, setUserId] = useState(uid);
  const [dueBack, setDueBack] = useState('');
  const [notes, setNotes] = useState('');
  return (
    <Modal
      open
      onClose={onClose}
      title={`Check out ${g.name}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={blocked}
            onClick={async () => {
              await checkOutGear(uid, userId, g.id, todayIso(), dueBack || null, notes.trim());
              notify(`${g.name} checked out`, 'success');
              onClose();
            }}
          >
            {a.problems.length || needs.length ? 'Check out anyway' : 'Check out'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {(a.problems.length > 0 || a.warnings.length > 0 || needs.length > 0) && (
          <p className={`rounded-md px-3 py-2 text-sm ${a.problems.length || needs.length ? 'bg-red-50 text-red-900' : 'bg-amber-50 text-amber-900'}`}>
            {[availabilityText(a), ...needs.map((f) => `Needs a ${inspectionForms.get(f)?.name ?? 'pre-use inspection'} today`)].filter(Boolean).join(' · ')}
            {needs.length > 0 && (
              <>
                {' '}
                <Link className="link" to={`/gear/${g.id}/inspect?form=${needs[0]}`}>
                  Inspect now
                </Link>
              </>
            )}
          </p>
        )}
        {isAdmin && (
          <Field label="Check out to">
            <Select value={userId} onChange={(e) => setUserId(e.target.value)}>
              {[...users.values()]
                .filter((u) => u.active)
                .sort((x, y) => compareText(x.displayName, y.displayName))
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.displayName}
                  </option>
                ))}
            </Select>
          </Field>
        )}
        <Field label="Due back" hint="Optional">
          <Input type="date" value={dueBack} min={todayIso()} onChange={(e) => setDueBack(e.target.value)} />
        </Field>
        <Field label="Notes">
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Staff training day" />
        </Field>
      </div>
    </Modal>
  );
}

function ReturnGearModal({ checkoutId, onClose }: { checkoutId: string; onClose(): void }) {
  const { uid } = useMe();
  const { openCheckouts, gear } = useData();
  const co = openCheckouts.get(checkoutId)!;
  const [date, setDate] = useState(todayIso());
  const [days, setDays] = useState(String(inclusiveDays(co.startDate, todayIso())));
  const [uses, setUses] = useState('');
  return (
    <Modal
      open
      onClose={onClose}
      title={`Return ${gear.get(co.gearId)?.name ?? 'gear'}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            onClick={async () => {
              await returnGear(uid, co, date, Math.max(0, Math.min(366, Math.round(Number(days) || 0))), uses ? Math.round(Number(uses)) : null);
              notify('Returned — usage logged', 'success');
              onClose();
            }}
          >
            Return and log usage
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Returned on">
          <Input type="date" value={date} max={todayIso()} onChange={(e) => setDate(e.target.value || todayIso())} />
        </Field>
        <Field label="Days actually used">
          <Input inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} />
        </Field>
        <Field label="Uses (optional)" hint="e.g. trips, climbs">
          <Input inputMode="numeric" value={uses} onChange={(e) => setUses(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

function LogUseModal({ gear: g, onClose }: { gear: Gear & WithId; onClose(): void }) {
  const { uid } = useMe();
  const [start, setStart] = useState(todayIso());
  const [end, setEnd] = useState(todayIso());
  const [days, setDays] = useState('1');
  const [uses, setUses] = useState('');
  const [notes, setNotes] = useState('');
  return (
    <Modal
      open
      onClose={onClose}
      title={`Log use of ${g.name}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={end < start}
            onClick={async () => {
              await logUsage(uid, g.id, start, end, Math.max(0, Math.min(366, Math.round(Number(days) || 0))), uses ? Math.round(Number(uses)) : null, notes.trim());
              notify('Usage logged', 'success');
              onClose();
            }}
          >
            Log use
          </Button>
        </>
      }
    >
      <p className="mb-3 text-sm text-stone-600">For use that didn’t go through a kit or check-out.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="From">
          <Input type="date" value={start} max={todayIso()} onChange={(e) => {
            setStart(e.target.value);
            setDays(String(inclusiveDays(e.target.value, end)));
          }} />
        </Field>
        <Field label="To">
          <Input type="date" value={end} max={todayIso()} onChange={(e) => {
            setEnd(e.target.value);
            setDays(String(inclusiveDays(start, e.target.value)));
          }} />
        </Field>
        <Field label="Days used">
          <Input inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} />
        </Field>
        <Field label="Uses (optional)">
          <Input inputMode="numeric" value={uses} onChange={(e) => setUses(e.target.value)} />
        </Field>
        <Field label="Notes" className="sm:col-span-2">
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

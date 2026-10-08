import { useMemo, useSyncExternalStore } from 'react';
import { KIND_LABELS, gearInUse, gearInspectionSummary, todayIso, type DueState, type GearInspectionSummary, type InUse } from '@gear/shared';
import { useData } from '../data/DataProvider';
import { fmtDate } from '../lib/format';

/** Which gear is in use today (checked out or in a current kit), and by whom. */
export function useInUse(): Map<string, InUse> {
  const { kits, openCheckouts } = useData();
  return useMemo(() => gearInUse([...kits.values()], [...openCheckouts.values()], todayIso()), [kits, openCheckouts]);
}

/** Inspection due-state for every piece of gear, recomputed when data changes. */
export function useInspectionSummaries(): Map<string, GearInspectionSummary> {
  const { gear, products } = useData();
  const inUse = useInUse();
  return useMemo(() => {
    const today = todayIso();
    const out = new Map<string, GearInspectionSummary>();
    for (const g of gear.values()) out.set(g.id, gearInspectionSummary(g, g.productId ? products.get(g.productId) : null, today, inUse.get(g.id)));
    return out;
  }, [gear, products, inUse]);
}

const DUE_STYLES: Record<DueState, string> = {
  overdue: 'bg-red-50 text-red-800 ring-red-200',
  due_soon: 'bg-amber-50 text-amber-800 ring-amber-200',
  ok: 'bg-stone-50 text-stone-600 ring-stone-200',
};
export const DUE_LABELS: Record<DueState, string> = { overdue: 'Inspection overdue', due_soon: 'Inspection due soon', ok: 'Inspections up to date' };

export function DueBadge({ state, short }: { state: DueState | 'none'; short?: boolean }) {
  if (state === 'none' || (short && state === 'ok')) return null;
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset ${DUE_STYLES[state]}`}>
      {short ? (state === 'overdue' ? 'Overdue' : 'Due soon') : DUE_LABELS[state]}
    </span>
  );
}

/** "daily", "weekly" or "every 10 days". */
export function intervalText(days: number | null | undefined): string {
  const n = Math.max(1, days ?? 1);
  return n === 1 ? 'daily' : n === 7 ? 'weekly' : `every ${n} days`;
}

/** "Due Mar 3, 2026 · 12 of 30 days used", or for in-service "weekly · due today" / "weekly · not in use". */
export function dueText(s: GearInspectionSummary['schedules'][number]): string {
  if (s.kind === 'in_service') {
    const every = intervalText(s.schedule.everyDaysInUse);
    if (!s.inUse) return `${every} · not in use${s.lastDate ? ` · last done ${fmtDate(s.lastDate)}` : ''}`;
    const today = todayIso();
    return `${every} · ${s.dueDate === today ? 'due today' : s.dueDate! < today ? `was due ${fmtDate(s.dueDate!)}` : `next ${fmtDate(s.dueDate!)}`}`;
  }
  const parts: string[] = [];
  if (s.dueDate) parts.push(`${s.state === 'overdue' && s.dueDate < todayIso() ? 'was due' : 'due'} ${fmtDate(s.dueDate)}`);
  if (s.daysUsedLimit) parts.push(`${s.daysUsedSince ?? 0} of ${s.daysUsedLimit} days used`);
  return parts.join(' · ');
}

export function KindTag({ kind }: { kind: 'in_service' | 'in_depth' }) {
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase ${kind === 'in_service' ? 'bg-sky-50 text-sky-800' : 'bg-violet-50 text-violet-800'}`}>
      {KIND_LABELS[kind]}
    </span>
  );
}

/*
 * Inspections submitted on this device in this session. The gear's
 * inspection state is updated by a Cloud Function (and not at all while
 * offline), so lists of checks to do use this to drop ones just done.
 */
let done = new Set<string>();
const listeners = new Set<() => void>();
const doneKey = (gearId: string, formId: string, date: string) => `${gearId}|${formId}|${date}`;

export function markInspected(gearId: string, formId: string, date: string) {
  done = new Set(done).add(doneKey(gearId, formId, date));
  listeners.forEach((l) => l());
}

/** Whether this gear had this form done on `date` from this device, ahead of the server catching up. */
export function useRecentlyInspected(): (gearId: string, formId: string, date: string) => boolean {
  const snapshot = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => done,
  );
  return (gearId, formId, date) => snapshot.has(doneKey(gearId, formId, date));
}

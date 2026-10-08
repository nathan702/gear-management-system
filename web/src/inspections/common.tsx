import { useMemo } from 'react';
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

/** "Due Mar 3, 2026 · 12 of 30 days used", or for in-service "every 7 days in use · due today". */
export function dueText(s: GearInspectionSummary['schedules'][number]): string {
  if (s.kind === 'in_service') {
    const every = s.schedule.everyDaysInUse && s.schedule.everyDaysInUse > 1 ? `every ${s.schedule.everyDaysInUse} days in use` : 'every day in use';
    if (!s.inUse) return `${every} · not in use`;
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

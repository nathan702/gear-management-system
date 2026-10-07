import { useMemo } from 'react';
import { gearInspectionSummary, todayIso, type DueState, type GearInspectionSummary } from '@gear/shared';
import { useData } from '../data/DataProvider';
import { fmtDate } from '../lib/format';

/** Inspection due-state for every piece of gear, recomputed when data changes. */
export function useInspectionSummaries(): Map<string, GearInspectionSummary> {
  const { gear, products } = useData();
  return useMemo(() => {
    const today = todayIso();
    const out = new Map<string, GearInspectionSummary>();
    for (const g of gear.values()) out.set(g.id, gearInspectionSummary(g, g.productId ? products.get(g.productId) : null, today));
    return out;
  }, [gear, products]);
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

/** "Due Mar 3, 2026 · 12 of 30 days used" */
export function dueText(s: GearInspectionSummary['schedules'][number]): string {
  const parts: string[] = [];
  if (s.dueDate) parts.push(`${s.state === 'overdue' && s.dueDate < todayIso() ? 'was due' : 'due'} ${fmtDate(s.dueDate)}`);
  if (s.daysUsedLimit) parts.push(`${s.daysUsedSince ?? 0} of ${s.daysUsedLimit} days used`);
  return parts.join(' · ');
}

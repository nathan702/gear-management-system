import { useMemo } from 'react';
import {
  PROBLEM_LABELS,
  WARNING_LABELS,
  gearAvailability,
  isBlocked,
  kitConflicts,
  kitIsLive,
  todayIso,
  type Availability,
  type Checkout,
  type Gear,
  type Kit,
  type KitStatus,
  type Product,
  type Role,
  type WithId,
} from '@gear/shared';
import { useData } from '../data/DataProvider';
import { useInspectionSummaries } from '../inspections/common';

export type KitDoc = Kit & WithId;

export interface Commitment {
  /** Live kits (planned, current or checked out) holding this gear. */
  kits: KitDoc[];
  /** A kit holding it right now (checked out, or planned and in date). */
  current: KitDoc | null;
  checkout: (Checkout & WithId) | null;
}

/** Where every piece of gear is committed, from all kits and open check-outs. */
export function useCommitments(): Map<string, Commitment> {
  const { kits, openCheckouts } = useData();
  return useMemo(() => {
    const today = todayIso();
    const map = new Map<string, Commitment>();
    const get = (id: string) => {
      if (!map.has(id)) map.set(id, { kits: [], current: null, checkout: null });
      return map.get(id)!;
    };
    for (const k of kits.values()) {
      if (!kitIsLive(k, today)) continue;
      const inDate = (!k.startDate || k.startDate <= today) && (!k.endDate || k.endDate >= today);
      for (const g of k.gearIds) {
        const c = get(g);
        c.kits.push(k);
        if (k.status === 'checked_out') c.current = k;
        else if (inDate && !c.current) c.current = k;
      }
    }
    for (const co of openCheckouts.values()) get(co.gearId).checkout = co;
    return map;
  }, [kits, openCheckouts]);
}

/** Availability of a gear item for a kit (with the kit's dates), or for a check-out today. */
export function useAvailability() {
  const { kits } = useData();
  const summaries = useInspectionSummaries();
  const commitments = useCommitments();
  return useMemo(() => {
    const today = todayIso();
    const all = [...kits.values()];
    return (gear: Gear & WithId, forKit: (Pick<Kit, 'startDate' | 'endDate'> & { id?: string }) | null): Availability & { conflicts: KitDoc[] } => {
      const conflicts = forKit ? (kitConflicts(gear.id, forKit, all, today) as KitDoc[]) : [];
      const c = commitments.get(gear.id);
      // Gear out on its own conflicts with kits that include today; for a
      // check-out, any kit holding it today or a current check-out does.
      const checkedOut = !!c?.checkout && (!forKit || !forKit.startDate || forKit.startDate <= today);
      const inOtherKit = forKit ? conflicts.length > 0 : !!c?.current;
      // Only routine (in-depth) inspections block adding gear; in-service
      // checks are done by whoever takes it.
      return { ...gearAvailability(gear, summaries.get(gear.id)?.inDepthState ?? 'none', { inOtherKit, checkedOut }), conflicts };
    };
  }, [kits, summaries, commitments]);
}

export function availabilityText(a: Availability & { conflicts?: KitDoc[] }): string {
  return [
    ...a.problems.map((p) => (p === 'in_other_kit' && a.conflicts?.length ? `In ${a.conflicts.map((k) => `“${k.name}”`).join(', ')}` : PROBLEM_LABELS[p])),
    ...a.warnings.map((w) => WARNING_LABELS[w]),
  ].join(' · ');
}

export { isBlocked };

/** Forms that must be inspected today before this gear can be checked out. */
export function inspectionsBeforeCheckout(gear: Pick<Gear, 'inspectionState'>, product: Pick<Product, 'inspectionSchedules'> | undefined, today = todayIso()): string[] {
  return (product?.inspectionSchedules ?? [])
    .filter((s) => s.beforeEachCheckout && (gear.inspectionState?.[s.formId]?.lastDate ?? '') < today)
    .map((s) => s.formId);
}

const KIT_STATUS: Record<KitStatus, [string, string]> = {
  planned: ['Planned', 'bg-sky-50 text-sky-800 ring-sky-200'],
  checked_out: ['Checked out', 'bg-indigo-50 text-indigo-800 ring-indigo-200'],
  returned: ['Returned', 'bg-stone-100 text-stone-600 ring-stone-300'],
};

export function KitStatusBadge({ status }: { status: KitStatus }) {
  const [label, cls] = KIT_STATUS[status];
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset ${cls}`}>{label}</span>;
}

export function canEditKit(kit: Pick<Kit, 'ownerId'>, uid: string, role: Role) {
  return kit.ownerId === uid || role === 'admin';
}

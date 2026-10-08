import { daysBetween } from './gear';
import type { DueState, InUse } from './inspections';
import type { Checkout, Gear, GearList, IsoDate, Kit, ListLine, Product, Role } from './types';

const MIN = '0000-01-01';
const MAX = '9999-12-31';

/** A kit's date range; a missing start or end is open-ended. */
export function kitRange(kit: Pick<Kit, 'startDate' | 'endDate'>): [IsoDate, IsoDate] {
  return [kit.startDate || MIN, kit.endDate || MAX];
}

export function rangesOverlap(a: [IsoDate, IsoDate], b: [IsoDate, IsoDate]): boolean {
  return a[0] <= b[1] && b[0] <= a[1];
}

/** Is the kit finished? Returned kits, and planned kits whose end date has passed, don't block anything. */
export function kitIsLive(kit: Pick<Kit, 'status' | 'endDate'>, today: IsoDate): boolean {
  if (kit.status === 'returned') return false;
  if (kit.status === 'checked_out') return true;
  return !kit.endDate || kit.endDate >= today;
}

/** Other live kits holding this gear with overlapping dates. */
export function kitConflicts(
  gearId: string,
  kit: Pick<Kit, 'startDate' | 'endDate'> & { id?: string },
  allKits: (Pick<Kit, 'startDate' | 'endDate' | 'gearIds' | 'status' | 'name'> & { id: string })[],
  today: IsoDate,
) {
  const range = kitRange(kit);
  return allKits.filter((k) => k.id !== kit.id && kitIsLive(k, today) && k.gearIds.includes(gearId) && rangesOverlap(range, kitRange(k)));
}

export type AvailabilityProblem = 'retired' | 'quarantined' | 'inspection_overdue' | 'in_other_kit' | 'checked_out';
export type AvailabilityWarning = 'has_issues' | 'inspection_due_soon';

export const PROBLEM_LABELS: Record<AvailabilityProblem, string> = {
  retired: 'Retired',
  quarantined: 'Quarantined',
  inspection_overdue: 'Inspection overdue',
  in_other_kit: 'In another kit for these dates',
  checked_out: 'Checked out to someone',
};
export const WARNING_LABELS: Record<AvailabilityWarning, string> = {
  has_issues: 'Has issues',
  inspection_due_soon: 'Inspection due soon',
};

export interface Availability {
  problems: AvailabilityProblem[];
  warnings: AvailabilityWarning[];
}

export function gearAvailability(
  gear: Pick<Gear, 'status'>,
  inspectionState: DueState | 'none',
  opts: { inOtherKit: boolean; checkedOut: boolean },
): Availability {
  const problems: AvailabilityProblem[] = [];
  const warnings: AvailabilityWarning[] = [];
  if (gear.status === 'retired') problems.push('retired');
  if (gear.status === 'quarantined') problems.push('quarantined');
  if (inspectionState === 'overdue') problems.push('inspection_overdue');
  if (opts.inOtherKit) problems.push('in_other_kit');
  if (opts.checkedOut) problems.push('checked_out');
  if (gear.status === 'has_issues') warnings.push('has_issues');
  if (inspectionState === 'due_soon') warnings.push('inspection_due_soon');
  return { problems, warnings };
}

/**
 * Admins are warned about problem gear but may add it anyway; everyone else
 * is blocked. Retired gear and double-booking are never allowed.
 */
export function canOverride(role: Role, problem: AvailabilityProblem): boolean {
  return role === 'admin' && problem !== 'retired' && problem !== 'in_other_kit' && problem !== 'checked_out';
}

export function isBlocked(role: Role, a: Availability): boolean {
  return a.problems.some((p) => !canOverride(role, p));
}

/** Inclusive day count, e.g. Mon–Wed = 3. */
export function inclusiveDays(start: IsoDate, end: IsoDate): number {
  return Math.max(0, daysBetween(start, end) + 1);
}

/** Does a gear item satisfy a list line? */
export function lineMatches(line: Pick<ListLine, 'productId' | 'categoryId'>, gear: Pick<Gear, 'productId'>, products: ReadonlyMap<string, Pick<Product, 'categoryId'>>): boolean {
  if (line.productId) return gear.productId === line.productId;
  if (line.categoryId) return !!gear.productId && products.get(gear.productId)?.categoryId === line.categoryId;
  return false;
}

export interface LineFill {
  line: ListLine;
  /** Gear already in the kit counted against this line. */
  have: string[];
  /** Suggested available gear to add. */
  suggest: string[];
  /** Still short after suggestions. */
  missing: number;
}

/**
 * Matches kit contents to a list and suggests available gear for what's
 * missing. Product lines are filled before category lines so a specific
 * request isn't used up by a broader one. Candidates are taken in the order
 * given (callers sort them, e.g. by name).
 */
export function fillFromList(
  list: Pick<GearList, 'lines'>,
  kitGearIds: string[],
  candidates: (Pick<Gear, 'productId'> & { id: string })[],
  gearById: ReadonlyMap<string, Pick<Gear, 'productId'>>,
  products: ReadonlyMap<string, Pick<Product, 'categoryId'>>,
): LineFill[] {
  const used = new Set<string>();
  const order = [...list.lines].sort((a, b) => Number(!!b.productId) - Number(!!a.productId));
  const result = new Map<string, LineFill>();
  for (const line of order) {
    const have: string[] = [];
    for (const id of kitGearIds) {
      if (have.length >= line.quantity) break;
      const g = gearById.get(id);
      if (g && !used.has(id) && lineMatches(line, g, products)) {
        have.push(id);
        used.add(id);
      }
    }
    const suggest: string[] = [];
    for (const c of candidates) {
      if (have.length + suggest.length >= line.quantity) break;
      if (!used.has(c.id) && lineMatches(line, c, products)) {
        suggest.push(c.id);
        used.add(c.id);
      }
    }
    result.set(line.id, { line, have, suggest, missing: Math.max(0, line.quantity - have.length - suggest.length) });
  }
  return list.lines.map((l) => result.get(l.id)!);
}

/**
 * Which gear is in use today, and by whom: anything in a checked-out kit, an
 * open check-out, or a planned kit whose dates include today.
 */
export function gearInUse(
  kits: Pick<Kit, 'ownerId' | 'gearIds' | 'status' | 'startDate' | 'endDate' | 'checkedOutDate'>[],
  checkouts: Pick<Checkout, 'gearId' | 'userId' | 'startDate' | 'status'>[],
  today: IsoDate,
): Map<string, InUse> {
  const map = new Map<string, InUse>();
  const add = (gearId: string, since: IsoDate, holder: string) => {
    const cur = map.get(gearId);
    if (!cur) map.set(gearId, { since, holderIds: [holder] });
    else {
      if (since < cur.since) cur.since = since;
      if (!cur.holderIds.includes(holder)) cur.holderIds.push(holder);
    }
  };
  for (const k of kits) {
    const current =
      k.status === 'checked_out' ||
      (k.status === 'planned' && !!(k.startDate || k.endDate) && (!k.startDate || k.startDate <= today) && (!k.endDate || k.endDate >= today));
    if (!current) continue;
    const since = (k.status === 'checked_out' ? k.checkedOutDate : null) || k.startDate || today;
    for (const g of k.gearIds) add(g, since > today ? today : since, k.ownerId);
  }
  for (const c of checkouts) if (c.status === 'out') add(c.gearId, c.startDate, c.userId);
  return map;
}

import { addMonths, ageYears, daysBetween, endOfLife, lifeUsedPercent } from './gear';
import { isOpen } from './workOrders';
import type { FailureOutcome, Gear, GearStatus, IsoDate, Product, UsageLog, WorkOrder, WorkOrderSource } from './types';

/*
 * Pure calculations behind the Reports page. Everything works on plain
 * arrays so it can be unit-tested and reused (e.g. in exports).
 */

type GearLike = Pick<Gear, 'status' | 'mfgDate' | 'firstUseDate' | 'purchaseDate' | 'customEol' | 'purchaseValue'> & { id: string };
type ProductLike = Pick<Product, 'lifetimeYears' | 'replacementCost'>;

/** What it would cost to replace this item: the product's replacement cost, else what was paid. */
export function replacementCost(gear: Pick<Gear, 'purchaseValue'>, product: Pick<Product, 'replacementCost'> | null | undefined): number | null {
  return product?.replacementCost ?? gear.purchaseValue ?? null;
}

export interface LifeRow {
  gearId: string;
  ageYears: number | null;
  endOfLife: IsoDate | null;
  lifeUsedPercent: number | null;
  /** Whole months until end of life (negative once past it). */
  monthsLeft: number | null;
  replacementCost: number | null;
}

export function lifeRow(gear: GearLike, product: ProductLike | null | undefined, today: IsoDate): LifeRow {
  const eol = endOfLife(gear, product);
  return {
    gearId: gear.id,
    ageYears: ageYears(gear, today),
    endOfLife: eol,
    lifeUsedPercent: lifeUsedPercent(gear, product, today),
    monthsLeft: eol ? Math.floor(daysBetween(today, eol) / 30.44) : null,
    replacementCost: replacementCost(gear, product),
  };
}

/* ------------------------------------------------------------ grouping */

export interface GroupTotals {
  key: string;
  count: number;
  byStatus: Record<GearStatus, number>;
  /** Sum of purchase values (items without one add nothing). */
  value: number;
  /** Mean age in years of items with a known age, or null. */
  avgAgeYears: number | null;
}

/** Counts, status split, value and average age of gear grouped by `keyOf` (null → ''). */
export function groupGear<G extends GearLike>(gear: G[], keyOf: (g: G) => string | null | undefined, today: IsoDate): GroupTotals[] {
  const groups = new Map<string, { totals: GroupTotals; ages: number[] }>();
  for (const g of gear) {
    const key = keyOf(g) ?? '';
    let entry = groups.get(key);
    if (!entry) {
      entry = { totals: { key, count: 0, byStatus: { active: 0, has_issues: 0, quarantined: 0, retired: 0 }, value: 0, avgAgeYears: null }, ages: [] };
      groups.set(key, entry);
    }
    entry.totals.count++;
    entry.totals.byStatus[g.status]++;
    entry.totals.value += g.purchaseValue ?? 0;
    const age = ageYears(g, today);
    if (age !== null) entry.ages.push(age);
  }
  return [...groups.values()]
    .map(({ totals, ages }) => ({ ...totals, avgAgeYears: ages.length ? Math.round((ages.reduce((a, b) => a + b, 0) / ages.length) * 10) / 10 : null }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

/* ------------------------------------------------- replacement forecast */

export type ForecastPeriod = 'year' | 'quarter';

export interface ForecastBucket {
  /** 'past' for gear already past end of life, else '2027' or '2027-Q2'. */
  key: string;
  label: string;
  count: number;
  cost: number;
  /** Items in this bucket with no replacement cost or purchase value. */
  unpriced: number;
  gearIds: string[];
}

export interface Forecast {
  buckets: ForecastBucket[];
  /** In service but no end of life can be worked out (no lifetime or dates). */
  unknownEol: string[];
  /** End of life is beyond the horizon. */
  later: string[];
}

export function periodKey(date: IsoDate, period: ForecastPeriod): string {
  const year = date.slice(0, 4);
  return period === 'year' ? year : `${year}-Q${Math.floor((Number(date.slice(5, 7)) - 1) / 3) + 1}`;
}

export function periodLabel(key: string): string {
  if (key === 'past') return 'Past end of life';
  const [y, q] = key.split('-');
  return q ? `${q} ${y}` : y;
}

/**
 * Replacement spend by period: each in-service item (not retired) lands in
 * the period of its end of life, or in "past end of life" if that's already
 * gone. Periods run from today's through `horizonYears` ahead, all shown even
 * when empty so the chart's time axis is continuous.
 */
export function replacementForecast<G extends GearLike>(
  gear: G[],
  productOf: (g: G) => ProductLike | null | undefined,
  today: IsoDate,
  opts: { period: ForecastPeriod; horizonYears: number },
): Forecast {
  const buckets = new Map<string, ForecastBucket>();
  const add = (key: string) => buckets.set(key, { key, label: periodLabel(key), count: 0, cost: 0, unpriced: 0, gearIds: [] });
  add('past');
  const end = addMonths(today, opts.horizonYears * 12);
  for (let d = today; d <= end; d = addMonths(d, opts.period === 'year' ? 12 : 3)) add(periodKey(d, opts.period));
  // The loop steps from today, so make sure the period containing the horizon's last day exists.
  if (!buckets.has(periodKey(end, opts.period))) add(periodKey(end, opts.period));

  const out: Forecast = { buckets: [], unknownEol: [], later: [] };
  for (const g of gear) {
    if (g.status === 'retired') continue;
    const product = productOf(g);
    const eol = endOfLife(g, product);
    if (!eol) {
      out.unknownEol.push(g.id);
      continue;
    }
    if (eol > end) {
      out.later.push(g.id);
      continue;
    }
    const b = buckets.get(eol < today ? 'past' : periodKey(eol, opts.period))!;
    const cost = replacementCost(g, product);
    b.count++;
    b.gearIds.push(g.id);
    if (cost === null) b.unpriced++;
    else b.cost += cost;
  }
  out.buckets = [...buckets.values()];
  return out;
}

/* --------------------------------------------------------------- usage */

/** Inclusive days two date ranges share (0 if none). */
export function overlapDays(aStart: IsoDate, aEnd: IsoDate, bStart: IsoDate, bEnd: IsoDate): number {
  const start = aStart > bStart ? aStart : bStart;
  const end = aEnd < bEnd ? aEnd : bEnd;
  return end < start ? 0 : daysBetween(start, end) + 1;
}

export interface UsageTotals {
  daysUsed: number;
  uses: number;
  logs: number;
}

/**
 * Days used per gear within [from, to]. A log that straddles the range
 * counts in proportion to how much of it falls inside (one decimal).
 */
export function usageByGear(logs: Pick<UsageLog, 'gearId' | 'startDate' | 'endDate' | 'daysUsed' | 'uses'>[], from: IsoDate, to: IsoDate): Map<string, UsageTotals> {
  const out = new Map<string, UsageTotals>();
  for (const l of logs) {
    const inside = overlapDays(l.startDate, l.endDate, from, to);
    if (!inside) continue;
    const span = daysBetween(l.startDate, l.endDate) + 1;
    const share = Math.min(1, inside / Math.max(1, span));
    const t = out.get(l.gearId) ?? { daysUsed: 0, uses: 0, logs: 0 };
    t.daysUsed = Math.round((t.daysUsed + l.daysUsed * share) * 10) / 10;
    t.uses = Math.round((t.uses + (l.uses ?? 0) * share) * 10) / 10;
    t.logs++;
    out.set(l.gearId, t);
  }
  return out;
}

/* --------------------------------------------------------- work orders */

export interface WorkOrderStats {
  opened: number;
  closed: number;
  /** Closed as done (not cancelled). */
  completed: number;
  stillOpen: number;
  /** Mean days from creation to close, for work orders closed in the range. */
  avgDaysToClose: number | null;
  medianDaysToClose: number | null;
  cost: number;
  laborHours: number;
  bySource: Record<WorkOrderSource, number>;
  bySeverity: Record<FailureOutcome, number>;
}

type WoLike = Pick<WorkOrder, 'status' | 'source' | 'severity' | 'cost' | 'laborHours'> & { created: IsoDate | null; closed: IsoDate | null };

/**
 * Work orders opened in [from, to] (by source and severity) and closed in it
 * (time to close, cost and hours). `created` / `closed` are the local dates
 * of the createdAt / closedAt timestamps.
 */
export function workOrderStats(wos: WoLike[], from: IsoDate, to: IsoDate): WorkOrderStats {
  const s: WorkOrderStats = {
    opened: 0,
    closed: 0,
    completed: 0,
    stillOpen: 0,
    avgDaysToClose: null,
    medianDaysToClose: null,
    cost: 0,
    laborHours: 0,
    bySource: { inspection: 0, issue: 0, manual: 0 },
    bySeverity: { note: 0, has_issues: 0, quarantined: 0 },
  };
  const durations: number[] = [];
  for (const w of wos) {
    if (w.created && w.created >= from && w.created <= to) {
      s.opened++;
      s.bySource[w.source]++;
      s.bySeverity[w.severity]++;
      if (isOpen(w.status)) s.stillOpen++;
    }
    if (!isOpen(w.status) && w.closed && w.closed >= from && w.closed <= to) {
      s.closed++;
      if (w.status === 'done') s.completed++;
      s.cost += w.cost ?? 0;
      s.laborHours += w.laborHours ?? 0;
      if (w.created) durations.push(Math.max(0, daysBetween(w.created, w.closed)));
    }
  }
  if (durations.length) {
    durations.sort((a, b) => a - b);
    s.avgDaysToClose = Math.round((durations.reduce((a, b) => a + b, 0) / durations.length) * 10) / 10;
    const mid = durations.length >> 1;
    s.medianDaysToClose = durations.length % 2 ? durations[mid] : (durations[mid - 1] + durations[mid]) / 2;
  }
  s.laborHours = Math.round(s.laborHours * 10) / 10;
  return s;
}

/** Month keys ('2026-03') from `from` through `to`, for per-month tables. */
export function monthsBetween(from: IsoDate, to: IsoDate): string[] {
  const out: string[] = [];
  for (let d = `${from.slice(0, 7)}-01`; d.slice(0, 7) <= to.slice(0, 7); d = addMonths(d, 1)) out.push(d.slice(0, 7));
  return out;
}

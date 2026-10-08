import { STATUS_SEVERITY } from './constants';
import { addDays, addMonths, daysBetween, todayIso } from './gear';
import type {
  AssignmentScope,
  FailureOutcome,
  Gear,
  GearStatus,
  InspectionAssignment,
  InspectionForm,
  InspectionItem,
  InspectionResponse,
  InspectionKind,
  InspectionSchedule,
  IsoDate,
  Product,
  ResponseResult,
} from './types';

export const DEFAULT_LEAD_DAYS = 14;

const OUTCOME_STATUS: Record<FailureOutcome, GearStatus> = {
  note: 'active',
  has_issues: 'has_issues',
  quarantined: 'quarantined',
};

/** Does a number reading fail the item's limits? */
export function numberFails(item: Pick<InspectionItem, 'min' | 'max'>, value: number): boolean {
  return (item.min != null && value < item.min) || (item.max != null && value > item.max);
}

/** Pass/fail for a number reading, or null while blank. */
export function resultForNumber(item: Pick<InspectionItem, 'min' | 'max'>, value: number | null | undefined): ResponseResult | null {
  if (value == null || Number.isNaN(value)) return null;
  return numberFails(item, value) ? 'fail' : 'pass';
}

/**
 * The gear status an inspection calls for: the worst failure outcome among
 * the failed items ("note only" failures leave it Active).
 */
export function calculatedStatus(responses: Pick<InspectionResponse, 'result' | 'failureOutcome'>[]): GearStatus {
  let worst: GearStatus = 'active';
  for (const r of responses) {
    if (r.result !== 'fail') continue;
    const s = OUTCOME_STATUS[r.failureOutcome];
    if (STATUS_SEVERITY[s] > STATUS_SEVERITY[worst]) worst = s;
  }
  return worst;
}

/**
 * The gear status after an inspection: an inspection can only make things
 * worse (closing a work order is what returns gear to Active), and retired
 * gear stays retired.
 */
export function inspectionStatusAfter(current: GearStatus, result: GearStatus): GearStatus {
  if (current === 'retired') return current;
  return STATUS_SEVERITY[result] > STATUS_SEVERITY[current] ? result : current;
}

/** Items still needing an answer before the inspection can be submitted. */
export function missingAnswers(form: Pick<InspectionForm, 'items'>, responses: Pick<InspectionResponse, 'itemId' | 'result' | 'value'>[]) {
  const byId = new Map(responses.map((r) => [r.itemId, r]));
  return form.items.filter((item) => {
    if (!item.required) return false;
    const r = byId.get(item.id);
    if (!r) return true;
    if (item.type === 'text') return r.result !== 'na' && !String(r.value ?? '').trim();
    if (item.type === 'number') return r.result !== 'na' && (r.value === null || r.value === undefined || r.value === '');
    return !r.result;
  });
}

/* --------------------------------------------------------------- schedules */

export type DueState = 'overdue' | 'due_soon' | 'ok';

export const KIND_LABELS: Record<InspectionKind, string> = {
  in_service: 'In-service',
  in_depth: 'In-depth',
};

export const scheduleKind = (s: Pick<InspectionSchedule, 'kind'>): InspectionKind => s.kind ?? 'in_depth';

/** Gear currently in someone's hands: checked out, or in a current kit. */
export interface InUse {
  /** When this spell of use began. */
  since: IsoDate;
  /** Kit owners / people it's checked out to. */
  holderIds: string[];
}

export interface ScheduleStatus {
  schedule: InspectionSchedule;
  kind: InspectionKind;
  state: DueState;
  lastDate: IsoDate | null;
  /** Date due by the time limit, if any (for in-service: only while in use). */
  dueDate: IsoDate | null;
  /** Days used since the last inspection, and the limit, if usage-based. */
  daysUsedSince: number | null;
  daysUsedLimit: number | null;
  /** In-service only: whether the gear is in use now. */
  inUse: boolean;
}

type GearForSchedule = Pick<Gear, 'inspectionState' | 'stats' | 'firstUseDate' | 'purchaseDate' | 'status'> & {
  createdAt?: { toDate(): Date } | null;
};

/**
 * Where the clock starts for an item never inspected with this form: first
 * use, else purchase, else when it was added to the system.
 */
function baseline(gear: GearForSchedule): IsoDate | null {
  return gear.firstUseDate || gear.purchaseDate || (gear.createdAt ? todayIso(gear.createdAt.toDate()) : null);
}

/**
 * In-service: due N calendar days after the last check, but only enforced
 * while the gear is in use. Not in use → never due or overdue. If the due
 * date passed while it was stored, it's due on the first day of the current
 * use (one catch-up check, however many intervals were missed) and overdue
 * from the day after.
 */
function inServiceStatus(gear: GearForSchedule, schedule: InspectionSchedule, today: IsoDate, inUse: InUse | null | undefined): ScheduleStatus {
  const lastDate = gear.inspectionState?.[schedule.formId]?.lastDate ?? null;
  const base = { schedule, kind: 'in_service' as const, lastDate, daysUsedSince: null, daysUsedLimit: null, inUse: !!inUse };
  if (!inUse) return { ...base, state: 'ok', dueDate: null };
  const interval = Math.max(1, schedule.everyDaysInUse ?? 1);
  const next = lastDate ? addDays(lastDate, interval) : inUse.since;
  const dueDate = next < inUse.since ? inUse.since : next;
  const state: DueState = today > dueDate ? 'overdue' : today === dueDate ? 'due_soon' : 'ok';
  return { ...base, state, dueDate };
}

export function scheduleStatus(gear: GearForSchedule, schedule: InspectionSchedule, today: IsoDate = todayIso(), inUse?: InUse | null): ScheduleStatus {
  if (scheduleKind(schedule) === 'in_service') return inServiceStatus(gear, schedule, today, inUse);
  const last = gear.inspectionState?.[schedule.formId];
  const lastDate = last?.lastDate ?? null;
  const lead = schedule.reminderLeadDays ?? DEFAULT_LEAD_DAYS;
  let state: DueState = 'ok';
  const worse = (s: DueState) => {
    if (s === 'overdue' || (s === 'due_soon' && state === 'ok')) state = s;
  };

  let dueDate: IsoDate | null = null;
  if (schedule.everyMonths) {
    const start = lastDate ?? baseline(gear);
    if (start) {
      dueDate = addMonths(start, schedule.everyMonths);
      const days = daysBetween(today, dueDate);
      if (days < 0) worse('overdue');
      else if (days <= lead) worse('due_soon');
    }
  }

  let daysUsedSince: number | null = null;
  if (schedule.everyDaysUsed) {
    daysUsedSince = (gear.stats?.daysUsed ?? 0) - (last?.daysUsedAtLast ?? 0);
    if (daysUsedSince >= schedule.everyDaysUsed) worse('overdue');
    // Within ~10% of the limit counts as due soon.
    else if (daysUsedSince >= schedule.everyDaysUsed * 0.9) worse('due_soon');
  }

  return { schedule, kind: 'in_depth', state, lastDate, dueDate, daysUsedSince, daysUsedLimit: schedule.everyDaysUsed ?? null, inUse: !!inUse };
}

export interface GearInspectionSummary {
  state: DueState | 'none';
  /** Worst state of the in-depth (routine) schedules only — what blocks adding gear to kits. */
  inDepthState: DueState | 'none';
  /** Worst state of the in-service schedules (only ever due while in use). */
  inServiceState: DueState | 'none';
  schedules: ScheduleStatus[];
  /** Earliest time-based due date across schedules. */
  nextDueDate: IsoDate | null;
}

function worst(list: ScheduleStatus[]): DueState | 'none' {
  if (!list.length) return 'none';
  return list.some((s) => s.state === 'overdue') ? 'overdue' : list.some((s) => s.state === 'due_soon') ? 'due_soon' : 'ok';
}

/** Retired gear and products without schedules are never due. */
export function gearInspectionSummary(
  gear: GearForSchedule,
  product: Pick<Product, 'inspectionSchedules'> | null | undefined,
  today: IsoDate = todayIso(),
  inUse?: InUse | null,
): GearInspectionSummary {
  const schedules = gear.status === 'retired' ? [] : (product?.inspectionSchedules ?? []).map((s) => scheduleStatus(gear, s, today, inUse));
  const dates = schedules.map((s) => s.dueDate).filter((d): d is IsoDate => !!d).sort();
  return {
    state: worst(schedules),
    inDepthState: worst(schedules.filter((s) => s.kind === 'in_depth')),
    inServiceState: worst(schedules.filter((s) => s.kind === 'in_service')),
    schedules,
    nextDueDate: dates[0] ?? null,
  };
}

/* ------------------------------------------------------------- assignments */

export const SCOPE_ORDER: AssignmentScope[] = ['product', 'category', 'location', 'programArea'];

/**
 * Who is responsible for inspecting a piece of gear. The most specific
 * matching assignment wins: product, then category, then location, then
 * program area.
 */
export function responsibleInspectors(
  gear: Pick<Gear, 'productId' | 'locationId' | 'programAreaId'>,
  product: Pick<Product, 'categoryId'> | null | undefined,
  assignments: Pick<InspectionAssignment, 'scope' | 'refId' | 'userIds'>[],
): { scope: AssignmentScope; userIds: string[] } | null {
  const refFor: Record<AssignmentScope, string | null | undefined> = {
    product: gear.productId,
    category: product?.categoryId,
    location: gear.locationId,
    programArea: gear.programAreaId,
  };
  for (const scope of SCOPE_ORDER) {
    const ref = refFor[scope];
    if (!ref) continue;
    const match = assignments.find((a) => a.scope === scope && a.refId === ref && a.userIds.length);
    if (match) return { scope, userIds: match.userIds };
  }
  return null;
}

/* ------------------------------------------------------------ form helpers */

export function newItemId(random: () => number = Math.random): string {
  return Math.floor(random() * 36 ** 8)
    .toString(36)
    .padStart(8, '0');
}

/** Starter forms built from the Gear Register's checklists. */
export function starterForms(checklists: Record<string, string[]>): Pick<InspectionForm, 'name' | 'description' | 'items' | 'active' | 'version'>[] {
  // Life-safety equipment quarantines on any failure; the rest is flagged.
  const quarantine = new Set(['Textile', 'Metal', 'Rope', 'Helmet', 'PFD', 'Hull', 'Inflatable']);
  let n = 0;
  return Object.entries(checklists).map(([name, prompts]) => ({
    name: `${name} inspection`,
    description: `Starter checklist for ${name.toLowerCase()} gear.`,
    version: 1,
    active: true,
    items: prompts.map((prompt) => ({
      id: `i${(n++).toString(36).padStart(4, '0')}`,
      prompt,
      type: 'pass_fail' as const,
      failureOutcome: /legible|marking/i.test(prompt) ? ('has_issues' as const) : quarantine.has(name) ? ('quarantined' as const) : ('has_issues' as const),
      required: true,
    })),
  }));
}

/**
 * People responsible for a gear item's due inspections: whoever has it for
 * in-service checks, the assigned inspectors for in-depth ones.
 */
export function peopleForDue(
  summary: GearInspectionSummary,
  gear: Pick<Gear, 'productId' | 'locationId' | 'programAreaId'>,
  product: Pick<Product, 'categoryId'> | null | undefined,
  assignments: Pick<InspectionAssignment, 'scope' | 'refId' | 'userIds'>[],
  inUse: InUse | null | undefined,
): { inService: string[]; inDepth: string[] } {
  const due = (kind: InspectionKind) => summary.schedules.some((s) => s.kind === kind && s.state !== 'ok');
  return {
    inService: due('in_service') ? (inUse?.holderIds ?? []) : [],
    inDepth: due('in_depth') ? (responsibleInspectors(gear, product, assignments)?.userIds ?? []) : [],
  };
}

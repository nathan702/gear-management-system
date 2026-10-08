import { STATUS_SEVERITY } from './constants';
import { addDays } from './gear';
import {
  OPEN_WORK_ORDER_STATUSES,
  type FailureOutcome,
  type GearStatus,
  type IsoDate,
  type Priority,
  type WorkOrder,
  type WorkOrderRule,
  type WorkOrderStatus,
} from './types';

export const WORK_ORDER_STATUS_LABELS: Record<WorkOrderStatus, string> = {
  open: 'Open',
  in_progress: 'In progress',
  waiting_parts: 'Waiting on parts',
  done: 'Done',
  cancelled: 'Cancelled',
};

export const PRIORITY_LABELS: Record<Priority, string> = { low: 'Low', normal: 'Normal', high: 'High', urgent: 'Urgent' };

export const SEVERITY_LABELS: Record<FailureOutcome, string> = {
  note: 'Note only',
  has_issues: 'Has issues',
  quarantined: 'Quarantine',
};

const SEVERITY_RANK: Record<FailureOutcome, number> = { note: 0, has_issues: 1, quarantined: 2 };
const SEVERITY_STATUS: Record<FailureOutcome, GearStatus> = { note: 'active', has_issues: 'has_issues', quarantined: 'quarantined' };

export const severityStatus = (s: FailureOutcome): GearStatus => SEVERITY_STATUS[s];
export const worseSeverity = (a: FailureOutcome, b: FailureOutcome): FailureOutcome => (SEVERITY_RANK[b] > SEVERITY_RANK[a] ? b : a);

export function isOpen(status: WorkOrderStatus): boolean {
  return OPEN_WORK_ORDER_STATUSES.includes(status);
}

export function workOrderNumber(n: number | null | undefined): string {
  return n ? `WO-${String(n).padStart(4, '0')}` : 'WO-…';
}

export function isOverdue(wo: Pick<WorkOrder, 'status' | 'dueDate'>, today: IsoDate): boolean {
  return isOpen(wo.status) && !!wo.dueDate && wo.dueDate < today;
}

/**
 * The gear status once a work order closes: the worst severity among the
 * gear's other open work orders, or Active when none remain. Retired gear
 * stays retired.
 */
export function gearStatusAfterClosing(current: GearStatus, otherOpenSeverities: FailureOutcome[]): GearStatus {
  if (current === 'retired') return current;
  let worst: GearStatus = 'active';
  for (const s of otherOpenSeverities) {
    const st = SEVERITY_STATUS[s];
    if (STATUS_SEVERITY[st] > STATUS_SEVERITY[worst]) worst = st;
  }
  return worst;
}

export interface RuleContext {
  severity: FailureOutcome;
  programAreaId: string | null | undefined;
  categoryId: string | null | undefined;
  locationId: string | null | undefined;
}

export interface RuleResult {
  ruleName: string | null;
  assigneeId: string | null;
  dueDate: IsoDate | null;
  priority: Priority;
}

const DEFAULT_PRIORITY: Record<FailureOutcome, Priority> = { note: 'low', has_issues: 'normal', quarantined: 'high' };

/** First rule (by order) whose set fields all match. */
export function applyWorkOrderRules(rules: Pick<WorkOrderRule, 'order' | 'name' | 'severity' | 'programAreaId' | 'categoryId' | 'locationId' | 'assigneeId' | 'dueInDays' | 'priority'>[], ctx: RuleContext, today: IsoDate): RuleResult {
  const match = [...rules]
    .sort((a, b) => a.order - b.order)
    .find(
      (r) =>
        (!r.severity || r.severity === ctx.severity) &&
        (!r.programAreaId || r.programAreaId === ctx.programAreaId) &&
        (!r.categoryId || r.categoryId === ctx.categoryId) &&
        (!r.locationId || r.locationId === ctx.locationId),
    );
  if (!match) return { ruleName: null, assigneeId: null, dueDate: null, priority: DEFAULT_PRIORITY[ctx.severity] };
  return {
    ruleName: match.name,
    assigneeId: match.assigneeId ?? null,
    dueDate: match.dueInDays != null ? addDays(today, match.dueInDays) : null,
    priority: match.priority,
  };
}

/** Starter rules: due dates and priorities by severity, no assignee. */
export const DEFAULT_WORK_ORDER_RULES: Pick<WorkOrderRule, 'order' | 'name' | 'severity' | 'assigneeId' | 'dueInDays' | 'priority'>[] = [
  { order: 10, name: 'Quarantined gear', severity: 'quarantined', assigneeId: null, dueInDays: 7, priority: 'high' },
  { order: 20, name: 'Gear with issues', severity: 'has_issues', assigneeId: null, dueInDays: 30, priority: 'normal' },
  { order: 30, name: 'Notes', severity: 'note', assigneeId: null, dueInDays: 90, priority: 'low' },
];

export const WORK_ORDER_LOG_HEADERS = [
  'number',
  'status',
  'gear',
  'qr_code',
  'product',
  'title',
  'description',
  'source',
  'severity',
  'priority',
  'assignee',
  'due_date',
  'created',
  'created_by',
  'closed',
  'resolution',
  'cost',
  'labor_hours',
] as const;

export function workOrderRows(
  list: (WorkOrder & { id: string })[],
  lookup: { gear(id: string): { name: string; qrCode: string } | undefined; product(id: string | null): string; user(id: string | null | undefined): string },
) {
  const day = (t: { toDate(): Date } | null | undefined) => (t ? t.toDate().toISOString().slice(0, 10) : '');
  return list.map((w) => ({
    number: workOrderNumber(w.number),
    status: WORK_ORDER_STATUS_LABELS[w.status],
    gear: lookup.gear(w.gearId)?.name ?? '(deleted)',
    qr_code: lookup.gear(w.gearId)?.qrCode ?? '',
    product: lookup.product(w.productId),
    title: w.title,
    description: w.description ?? '',
    source: w.source,
    severity: SEVERITY_LABELS[w.severity],
    priority: PRIORITY_LABELS[w.priority],
    assignee: lookup.user(w.assigneeId),
    due_date: w.dueDate ?? '',
    created: day(w.createdAt),
    created_by: lookup.user(w.createdBy),
    closed: day(w.closedAt),
    resolution: w.resolution ?? '',
    cost: w.cost ?? '',
    labor_hours: w.laborHours ?? '',
  }));
}

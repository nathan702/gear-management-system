import { gearInspectionSummary, responsibleInspectors, type GearInspectionSummary } from './inspections';
import { addDays } from './gear';
import { gearInUse } from './kits';
import { isOverdue, workOrderNumber } from './workOrders';
import type {
  Checkout,
  Gear,
  InspectionAssignment,
  InspectionForm,
  IsoDate,
  Kit,
  NotificationChannel,
  NotificationEvent,
  NotificationPrefs,
  Product,
  Role,
  UserProfile,
  WorkOrder,
} from './types';

export const EVENT_LABELS: Record<NotificationEvent, { label: string; help: string; managersOnly?: boolean }> = {
  daily_digest: {
    label: 'Daily reminders',
    help: 'In-service inspections due on gear you have out, in-depth inspections assigned to you, and your work orders that are due or overdue.',
  },
  manager_digest: { label: 'Manager summary', help: 'Daily summary of overdue inspections and overdue work orders across all gear.', managersOnly: true },
  work_order_assigned: { label: 'Work order assigned to you', help: 'When a work order is assigned to you.' },
  work_order_created: { label: 'New work orders', help: 'Every new work order (failed inspection, reported issue or manual).', managersOnly: true },
  work_order_closed: { label: 'Your report resolved', help: 'When a work order you reported or opened is completed or cancelled.' },
  gear_quarantined: { label: 'Gear quarantined', help: 'Whenever any gear becomes quarantined.', managersOnly: true },
  kit_gear_flagged: { label: 'Problem with gear in your kit', help: 'When gear in one of your current or upcoming kits is quarantined or gets an issue.' },
};

const DEFAULTS: Record<NotificationEvent, Record<NotificationChannel, boolean>> = {
  daily_digest: { email: true, slack: false },
  manager_digest: { email: true, slack: false },
  work_order_assigned: { email: true, slack: true },
  work_order_created: { email: false, slack: false },
  work_order_closed: { email: true, slack: false },
  gear_quarantined: { email: false, slack: false },
  kit_gear_flagged: { email: true, slack: true },
};

export function isManagerRole(role: Role) {
  return role === 'admin' || role === 'manager';
}

/** The channels a user wants for an event (their choice, else the default). Managers-only events are off for others. */
export function wantedChannels(user: Pick<UserProfile, 'role' | 'notificationPrefs'>, event: NotificationEvent): NotificationChannel[] {
  if (EVENT_LABELS[event].managersOnly && !isManagerRole(user.role)) return [];
  const prefs: NotificationPrefs = user.notificationPrefs ?? {};
  return (['email', 'slack'] as const).filter((c) => prefs[event]?.[c] ?? DEFAULTS[event][c]);
}

export function defaultPref(event: NotificationEvent, channel: NotificationChannel) {
  return DEFAULTS[event][channel];
}

/* ------------------------------------------------------------- digests */

export interface DigestInspection {
  gearId: string;
  gearName: string;
  state: 'overdue' | 'due_soon';
  forms: string[];
  /** in_service: you have the gear; assigned: you inspect it (in-depth). */
  why: 'in_service' | 'assigned';
}

export interface DigestWorkOrder {
  id: string;
  label: string;
  gearName: string;
  dueDate: IsoDate | null;
  overdue: boolean;
}

export interface UserDigest {
  userId: string;
  inspections: DigestInspection[];
  workOrders: DigestWorkOrder[];
}

export interface DigestInput {
  today: IsoDate;
  gear: (Gear & { id: string })[];
  products: ReadonlyMap<string, Product>;
  forms: ReadonlyMap<string, Pick<InspectionForm, 'name'>>;
  assignments: Pick<InspectionAssignment, 'scope' | 'refId' | 'userIds'>[];
  kits: (Pick<Kit, 'ownerId' | 'gearIds' | 'status' | 'startDate' | 'endDate' | 'checkedOutDate'> & { id: string })[];
  checkouts: Pick<Checkout, 'gearId' | 'userId' | 'startDate' | 'status'>[];
  openWorkOrders: (Pick<WorkOrder, 'number' | 'title' | 'gearId' | 'assigneeId' | 'dueDate' | 'status'> & { id: string })[];
}

/**
 * Who should hear about what today. In-service inspections go to whoever
 * has the gear (checked out or in a current kit); in-depth inspections go to
 * the people assigned to inspect it; work orders go to their assignee when
 * overdue or due within 3 days.
 */
export function buildDigests(input: DigestInput): { users: UserDigest[]; summaries: Map<string, GearInspectionSummary> } {
  const soon = addDays(input.today, 3);
  const inUse = gearInUse(input.kits, input.checkouts, input.today);
  const byUser = new Map<string, UserDigest>();
  const get = (uid: string) => {
    if (!byUser.has(uid)) byUser.set(uid, { userId: uid, inspections: [], workOrders: [] });
    return byUser.get(uid)!;
  };
  const summaries = new Map<string, GearInspectionSummary>();

  for (const g of input.gear) {
    const product = g.productId ? input.products.get(g.productId) : undefined;
    const use = inUse.get(g.id);
    const s = gearInspectionSummary(g, product, input.today, use);
    summaries.set(g.id, s);
    for (const kind of ['in_service', 'in_depth'] as const) {
      const due = s.schedules.filter((x) => x.kind === kind && x.state !== 'ok');
      if (!due.length) continue;
      const item: DigestInspection = {
        gearId: g.id,
        gearName: g.name,
        state: due.some((x) => x.state === 'overdue') ? 'overdue' : 'due_soon',
        forms: due.map((x) => input.forms.get(x.schedule.formId)?.name ?? 'Inspection'),
        why: kind === 'in_service' ? 'in_service' : 'assigned',
      };
      const people = kind === 'in_service' ? (use?.holderIds ?? []) : (responsibleInspectors(g, product, input.assignments)?.userIds ?? []);
      for (const uid of people) get(uid).inspections.push(item);
    }
  }

  const gearName = new Map(input.gear.map((g) => [g.id, g.name]));
  for (const w of input.openWorkOrders) {
    if (!w.assigneeId || !w.dueDate || w.dueDate > soon) continue;
    get(w.assigneeId).workOrders.push({
      id: w.id,
      label: `${workOrderNumber(w.number)} ${w.title}`,
      gearName: gearName.get(w.gearId) ?? 'Deleted gear',
      dueDate: w.dueDate,
      overdue: isOverdue(w, input.today),
    });
  }
  const users = [...byUser.values()].filter((d) => d.inspections.length || d.workOrders.length);
  for (const d of users) {
    d.inspections.sort((a, b) => Number(b.state === 'overdue') - Number(a.state === 'overdue') || a.gearName.localeCompare(b.gearName, undefined, { numeric: true }));
    d.workOrders.sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''));
  }
  return { users, summaries };
}

export interface Message {
  subject: string;
  text: string;
  link: string | null;
}

const url = (base: string, path: string) => (base ? `${base.replace(/\/+$/, '')}${path}` : null);

export function digestMessage(d: UserDigest, appUrl: string): Message {
  const lines: string[] = [];
  const overdue = d.inspections.filter((i) => i.state === 'overdue').length;
  if (d.inspections.length) {
    lines.push(`Inspections (${d.inspections.length}${overdue ? `, ${overdue} overdue` : ''}):`);
    for (const i of d.inspections.slice(0, 30))
      lines.push(`• ${i.gearName} — ${i.forms.join(', ')} ${i.state === 'overdue' ? 'OVERDUE' : i.why === 'in_service' ? 'due today' : 'due soon'}${i.why === 'in_service' ? ' (you have it out)' : ''}`);
    if (d.inspections.length > 30) lines.push(`…and ${d.inspections.length - 30} more`);
  }
  if (d.workOrders.length) {
    if (lines.length) lines.push('');
    lines.push(`Work orders assigned to you (${d.workOrders.length}):`);
    for (const w of d.workOrders) lines.push(`• ${w.label} — ${w.gearName}, ${w.overdue ? `OVERDUE (was due ${w.dueDate})` : `due ${w.dueDate}`}`);
  }
  const parts = [d.inspections.length && `${d.inspections.length} inspection${d.inspections.length === 1 ? '' : 's'}`, d.workOrders.length && `${d.workOrders.length} work order${d.workOrders.length === 1 ? '' : 's'}`].filter(Boolean);
  const total = d.inspections.length + d.workOrders.length;
  return { subject: `Gear reminders: ${parts.join(' and ')} ${total === 1 ? 'needs' : 'need'} attention`, text: lines.join('\n'), link: url(appUrl, d.inspections.length ? '/inspections?mine=1' : '/work-orders?view=mine') };
}

export function managerDigestMessage(input: { overdueInspections: { gearName: string }[]; overdueWorkOrders: DigestWorkOrder[]; unassignedWorkOrders: number }, appUrl: string): Message | null {
  const { overdueInspections: oi, overdueWorkOrders: ow, unassignedWorkOrders: un } = input;
  if (!oi.length && !ow.length && !un) return null;
  const lines = [
    `${oi.length} item${oi.length === 1 ? ' has an' : 's have'} overdue inspection${oi.length === 1 ? '' : 's'}${oi.length ? `: ${oi.slice(0, 20).map((g) => g.gearName).join(', ')}${oi.length > 20 ? '…' : ''}` : '.'}`,
    `${ow.length} overdue work order${ow.length === 1 ? '' : 's'}${ow.length ? ':' : '.'}`,
    ...ow.slice(0, 20).map((w) => `• ${w.label} — ${w.gearName}, was due ${w.dueDate}`),
    ...(un ? [`${un} open work order${un === 1 ? ' is' : 's are'} unassigned.`] : []),
  ];
  return { subject: `Gear summary: ${oi.length} overdue inspections, ${ow.length} overdue work orders`, text: lines.join('\n'), link: url(appUrl, '/inspections?state=overdue') };
}

export { url as appLink };

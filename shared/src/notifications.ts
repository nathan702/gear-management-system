import { gearInspectionSummary, responsibleInspectors, type GearInspectionSummary } from './inspections';
import { addDays } from './gear';
import { kitIsLive } from './kits';
import { isOverdue, workOrderNumber } from './workOrders';
import type {
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
  daily_digest: { label: 'Daily reminders', help: 'Inspections you look after or have in a kit that are due, and your work orders that are due or overdue.' },
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
  why: 'assigned' | 'kit';
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
  kits: (Pick<Kit, 'ownerId' | 'gearIds' | 'status' | 'startDate' | 'endDate'> & { id: string })[];
  openWorkOrders: (Pick<WorkOrder, 'number' | 'title' | 'gearId' | 'assigneeId' | 'dueDate' | 'status'> & { id: string })[];
  /** Kit gear counts if the kit is live and starts within this many days. Default 14. */
  kitLookaheadDays?: number;
}

/**
 * Who should hear about what today. Inspections go to the people assigned
 * to inspect the gear and to anyone holding it in a current or soon-starting
 * kit; work orders go to their assignee when overdue or due within 3 days.
 */
export function buildDigests(input: DigestInput): { users: UserDigest[]; summaries: Map<string, GearInspectionSummary> } {
  const lookahead = addDays(input.today, input.kitLookaheadDays ?? 14);
  const soon = addDays(input.today, 3);
  const byUser = new Map<string, UserDigest>();
  const get = (uid: string) => {
    if (!byUser.has(uid)) byUser.set(uid, { userId: uid, inspections: [], workOrders: [] });
    return byUser.get(uid)!;
  };
  const summaries = new Map<string, GearInspectionSummary>();
  const kitHolders = new Map<string, Set<string>>();
  for (const k of input.kits) {
    if (!kitIsLive(k, input.today)) continue;
    if (k.status !== 'checked_out' && k.startDate && k.startDate > lookahead) continue;
    for (const g of k.gearIds) {
      if (!kitHolders.has(g)) kitHolders.set(g, new Set());
      kitHolders.get(g)!.add(k.ownerId);
    }
  }

  for (const g of input.gear) {
    const product = g.productId ? input.products.get(g.productId) : undefined;
    const s = gearInspectionSummary(g, product, input.today);
    summaries.set(g.id, s);
    if (s.state !== 'overdue' && s.state !== 'due_soon') continue;
    const forms = s.schedules.filter((x) => x.state !== 'ok').map((x) => input.forms.get(x.schedule.formId)?.name ?? 'Inspection');
    const item = (why: DigestInspection['why']): DigestInspection => ({ gearId: g.id, gearName: g.name, state: s.state as DigestInspection['state'], forms, why });
    const assigned = new Set(responsibleInspectors(g, product, input.assignments)?.userIds ?? []);
    for (const uid of assigned) get(uid).inspections.push(item('assigned'));
    for (const uid of kitHolders.get(g.id) ?? []) if (!assigned.has(uid)) get(uid).inspections.push(item('kit'));
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
      lines.push(`• ${i.gearName} — ${i.forms.join(', ')} ${i.state === 'overdue' ? 'OVERDUE' : 'due soon'}${i.why === 'kit' ? ' (in your kit)' : ''}`);
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

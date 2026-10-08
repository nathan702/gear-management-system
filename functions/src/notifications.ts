import { FieldValue, getFirestore, type Firestore } from 'firebase-admin/firestore';
import { onDocumentCreated, onDocumentUpdated, onDocumentWritten } from 'firebase-functions/v2/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import nodemailer from 'nodemailer';
import {
  OPEN_WORK_ORDER_STATUSES,
  STATUS_LABELS,
  WORK_ORDER_STATUS_LABELS,
  appLink,
  buildDigests,
  digestMessage,
  isOpen,
  isOverdue,
  kitIsLive,
  managerDigestMessage,
  wantedChannels,
  workOrderNumber,
  type AppSettings,
  type Checkout,
  type Gear,
  type InspectionAssignment,
  type InspectionForm,
  type Kit,
  type Message,
  type NotificationChannel,
  type NotificationEvent,
  type NotificationSettings,
  type OutboundNotification,
  type Product,
  type UserProfile,
  type WorkOrder,
} from '@gear/shared';
import { TIME_ZONE } from './config';
import { localToday } from './workOrders';

const db = () => getFirestore();

interface PrivateConfig {
  slackToken?: string;
  smtp?: { host: string; port: number; secure?: boolean; user?: string; pass?: string; from: string };
}

const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = { enabled: true, digestHour: 7, routes: [] };

async function notificationSettings(): Promise<NotificationSettings> {
  const snap = await db().doc('settings/notifications').get();
  return { ...DEFAULT_NOTIFICATION_SETTINGS, ...(snap.data() as Partial<NotificationSettings> | undefined) };
}

async function appUrl(): Promise<string> {
  return ((await db().doc('settings/app').get()).data() as Partial<AppSettings> | undefined)?.qrBaseUrl ?? '';
}

/** Firestore ids can't contain "/"; keep keys readable but safe. */
const safe = (s: string) => s.replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 300);

/** Queues one notification; the id is the de-duplication key, so repeats are ignored. */
async function enqueue(key: string, n: Omit<OutboundNotification, 'status' | 'createdAt'>) {
  try {
    await db()
      .collection('notifications')
      .doc(safe(key))
      .create({ ...n, status: 'pending', createdAt: FieldValue.serverTimestamp() });
  } catch (e) {
    if ((e as { code?: number }).code !== 6) throw e; // 6 = ALREADY_EXISTS
  }
}

/** Sends an event to each user on the channels they've chosen. */
export async function notifyUsers(event: NotificationEvent, userIds: Iterable<string>, msg: Message, key: string) {
  const settings = await notificationSettings();
  if (!settings.enabled) return;
  for (const uid of new Set(userIds)) {
    const snap = await db().doc(`users/${uid}`).get();
    const user = snap.data() as UserProfile | undefined;
    if (!user?.active) continue;
    for (const channel of wantedChannels(user, event))
      await enqueue(`${key}-${uid}-${channel}`, { event, channel, userId: uid, target: null, subject: msg.subject, text: msg.text, link: msg.link });
  }
}

/** Sends an event to the Slack channels / email lists admins routed it to. */
export async function notifyRoutes(event: NotificationEvent, msg: Message, key: string) {
  const settings = await notificationSettings();
  if (!settings.enabled) return;
  for (const route of settings.routes.filter((r) => r.events.includes(event)))
    await enqueue(`${key}-route-${route.id}`, { event, channel: route.type, userId: null, target: route.target, subject: msg.subject, text: msg.text, link: msg.link });
}

async function managers(): Promise<string[]> {
  const snap = await db().collection('users').where('role', 'in', ['admin', 'manager']).where('active', '==', true).get();
  return snap.docs.map((d) => d.id);
}

/* --------------------------------------------------------------- delivery */

async function slackCall(token: string, method: string, body: Record<string, unknown>) {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as { ok: boolean; error?: string; user?: { id: string } };
  if (!json.ok) throw new Error(`Slack ${method}: ${json.error}`);
  return json;
}

/** Slack id for a user: the one on their profile, else looked up by email and remembered. */
async function slackUserId(token: string, uid: string): Promise<string> {
  const ref = db().doc(`users/${uid}`);
  const user = (await ref.get()).data() as UserProfile | undefined;
  if (!user) throw new Error('user not found');
  if (user.slackUserId) return user.slackUserId;
  const { user: found } = await slackCall(token, 'users.lookupByEmail', { email: user.email });
  await ref.update({ slackUserId: found!.id });
  return found!.id;
}

function html(n: Pick<OutboundNotification, 'text' | 'link'>) {
  const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
  return `<div style="font-family:system-ui,sans-serif;font-size:14px;line-height:1.5;color:#1c1917">
<p style="white-space:pre-wrap">${esc(n.text)}</p>
${n.link ? `<p><a href="${esc(n.link)}" style="background:#1f5c45;color:#fff;padding:8px 14px;border-radius:6px;text-decoration:none">Open Calleva Gear</a></p>` : ''}
<p style="color:#78716c;font-size:12px">You can change which notifications you get on your profile page.</p></div>`;
}

export const deliverNotification = onDocumentCreated('notifications/{id}', async (event) => {
  const ref = event.data?.ref;
  const n = event.data?.data() as OutboundNotification | undefined;
  if (!ref || !n || n.status !== 'pending') return;
  const config = ((await db().doc('private/notifications').get()).data() ?? {}) as PrivateConfig;
  const done = (status: OutboundNotification['status'], error: string | null = null, target?: string) =>
    ref.update({ status, error, sentAt: FieldValue.serverTimestamp(), ...(target ? { target } : {}) });
  try {
    if (n.channel === 'email') {
      if (!config.smtp?.host) return void (await done('skipped', 'Email is not set up yet (Settings → Notifications).'));
      const to = n.target || ((await db().doc(`users/${n.userId}`).get()).get('email') as string | undefined);
      if (!to) return void (await done('skipped', 'No email address.'));
      const transport = nodemailer.createTransport({
        host: config.smtp.host,
        port: config.smtp.port || 587,
        secure: config.smtp.secure ?? config.smtp.port === 465,
        auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
      });
      await transport.sendMail({ from: config.smtp.from, to, subject: n.subject, text: n.link ? `${n.text}\n\n${n.link}` : n.text, html: html(n) });
      await done('sent', null, to);
    } else {
      if (!config.slackToken) return void (await done('skipped', 'Slack is not set up yet (Settings → Notifications).'));
      const channel = n.target || (await slackUserId(config.slackToken, n.userId!));
      await slackCall(config.slackToken, 'chat.postMessage', {
        channel,
        text: `*${n.subject}*\n${n.text}${n.link ? `\n<${n.link}|Open Calleva Gear>` : ''}`,
        unfurl_links: false,
      });
      await done('sent', null, channel);
    }
  } catch (e) {
    await done('failed', (e as Error).message.slice(0, 500));
  }
});

/* --------------------------------------------------------------- triggers */

function woMessage(wo: WorkOrder & { id: string }, gearName: string, base: string, headline: string): Message {
  return {
    subject: `${workOrderNumber(wo.number)} ${headline}: ${wo.title}`,
    text: [
      `${gearName} — ${wo.title}`,
      wo.description ? wo.description : null,
      wo.dueDate ? `Due ${wo.dueDate}` : null,
      wo.resolution && !isOpen(wo.status) ? `${WORK_ORDER_STATUS_LABELS[wo.status]}: ${wo.resolution}` : null,
    ]
      .filter(Boolean)
      .join('\n'),
    link: appLink(base, `/work-orders/${wo.id}`),
  };
}

/**
 * New work orders (to managers and routed channels), assignments (to the
 * assignee) and closures (to whoever opened it). Waits for the number, which
 * a function adds just after creation.
 */
export const notifyWorkOrder = onDocumentWritten('workOrders/{woId}', async (event) => {
  const before = event.data?.before.data() as WorkOrder | undefined;
  const after = event.data?.after.data() as WorkOrder | undefined;
  if (!after?.number) return;
  const wo = { ...after, id: event.params.woId };
  const gearName = ((await db().doc(`gear/${wo.gearId}`).get()).get('name') as string | undefined) ?? 'Deleted gear';
  const base = await appUrl();
  const numbered = !before?.number;

  if (numbered) {
    const msg = woMessage(wo, gearName, base, wo.source === 'issue' ? 'issue reported' : 'opened');
    await notifyUsers('work_order_created', (await managers()).filter((m) => m !== wo.createdBy), msg, `wo-created-${wo.id}`);
    await notifyRoutes('work_order_created', msg, `wo-created-${wo.id}`);
  }
  if (wo.assigneeId && (numbered || before?.assigneeId !== wo.assigneeId) && wo.assigneeId !== wo.updatedBy)
    await notifyUsers('work_order_assigned', [wo.assigneeId], woMessage(wo, gearName, base, 'assigned to you'), `wo-assigned-${wo.id}-${wo.assigneeId}-${event.id}`);
  if (before && isOpen(before.status) && !isOpen(wo.status) && wo.createdBy && wo.createdBy !== wo.updatedBy)
    await notifyUsers('work_order_closed', [wo.createdBy], woMessage(wo, gearName, base, wo.status === 'done' ? 'completed' : 'cancelled'), `wo-closed-${wo.id}-${event.id}`);
});

/** Quarantines (to managers and channels) and problems with gear in someone's kit (to the kit owner). */
export const notifyGearStatus = onDocumentUpdated('gear/{gearId}', async (event) => {
  const before = event.data?.before.data() as Gear | undefined;
  const after = event.data?.after.data() as Gear | undefined;
  if (!before || !after || before.status === after.status) return;
  if (after.status !== 'quarantined' && after.status !== 'has_issues') return;
  const base = await appUrl();
  const msg: Message = {
    subject: `${after.name} is now ${STATUS_LABELS[after.status].toLowerCase()}`,
    text: `${after.name}: ${after.statusReason ?? ''}`.trim(),
    link: appLink(base, `/gear/${event.params.gearId}`),
  };
  const key = `gear-${event.params.gearId}-${after.status}-${event.id}`;
  if (after.status === 'quarantined') {
    await notifyUsers('gear_quarantined', (await managers()).filter((m) => m !== after.updatedBy), msg, key);
    await notifyRoutes('gear_quarantined', msg, key);
  }
  const today = localToday();
  const kits = await db().collection('kits').where('gearIds', 'array-contains', event.params.gearId).get();
  const owners = kits.docs
    .map((d) => ({ id: d.id, ...(d.data() as Kit) }))
    .filter((k) => kitIsLive(k, today))
    .map((k) => k.ownerId)
    .filter((o) => o !== after.updatedBy);
  if (owners.length) await notifyUsers('kit_gear_flagged', owners, { ...msg, subject: `In your kit: ${msg.subject}` }, `kit-${key}`);
});

/* ------------------------------------------------------------ daily digest */

export async function runDigest(store: Firestore, today: string, keySuffix = '') {
  const [gearSnap, productsSnap, formsSnap, assignSnap, kitsSnap, woSnap, base, checkoutSnap] = await Promise.all([
    store.collection('gear').get(),
    store.collection('products').get(),
    store.collection('inspectionForms').get(),
    store.collection('inspectionAssignments').get(),
    store.collection('kits').get(),
    store.collection('workOrders').where('status', 'in', [...OPEN_WORK_ORDER_STATUSES]).get(),
    appUrl(),
    store.collection('checkouts').where('status', '==', 'out').get(),
  ]);
  const gear = gearSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Gear) }));
  const openWorkOrders = woSnap.docs.map((d) => ({ id: d.id, ...(d.data() as WorkOrder) }));
  const { users, summaries } = buildDigests({
    today,
    gear,
    products: new Map(productsSnap.docs.map((d) => [d.id, d.data() as Product])),
    forms: new Map(formsSnap.docs.map((d) => [d.id, d.data() as InspectionForm])),
    assignments: assignSnap.docs.map((d) => d.data() as InspectionAssignment),
    kits: kitsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Kit) })),
    checkouts: checkoutSnap.docs.map((d) => d.data() as Checkout),
    openWorkOrders,
  });
  for (const d of users) await notifyUsers('daily_digest', [d.userId], digestMessage(d, base), `digest-${today}${keySuffix}`);

  const gearName = new Map(gear.map((g) => [g.id, g.name]));
  const summary = managerDigestMessage(
    {
      overdueInspections: gear.filter((g) => summaries.get(g.id)?.state === 'overdue').map((g) => ({ gearName: g.name })),
      overdueWorkOrders: openWorkOrders
        .filter((w) => isOverdue(w, today))
        .map((w) => ({ id: w.id, label: `${workOrderNumber(w.number)} ${w.title}`, gearName: gearName.get(w.gearId) ?? '?', dueDate: w.dueDate, overdue: true })),
      unassignedWorkOrders: openWorkOrders.filter((w) => !w.assigneeId).length,
    },
    base,
  );
  if (summary) {
    await notifyUsers('manager_digest', await managers(), summary, `mgr-digest-${today}${keySuffix}`);
    await notifyRoutes('manager_digest', summary, `mgr-digest-${today}${keySuffix}`);
  }
  return { users: users.length, managerSummary: !!summary };
}

function localHour(): number {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, hour: 'numeric', hourCycle: 'h23' }).format(new Date()));
}

/** Hourly; sends the daily reminders at the hour admins chose. The date in each key stops repeats. */
export const dailyDigest = onSchedule({ schedule: 'every 1 hours', timeZone: TIME_ZONE }, async () => {
  const settings = await notificationSettings();
  if (!settings.enabled || localHour() !== settings.digestHour) return;
  await runDigest(db(), localToday());
});

async function requireAdmin(uid: string | undefined) {
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in first.');
  const user = (await db().doc(`users/${uid}`).get()).data() as UserProfile | undefined;
  if (!user?.active || user.role !== 'admin') throw new HttpsError('permission-denied', 'Admins only.');
}

/** Admin "send reminders now" — re-runs today's digest (with a fresh key so it really sends). */
export const runDigestNow = onCall(async (req) => {
  await requireAdmin(req.auth?.uid);
  return runDigest(db(), localToday(), `-manual-${Date.now()}`);
});

/** Sends a test message to yourself, or (admins) to a configured route. */
export const sendTestNotification = onCall<{ channel: NotificationChannel; routeId?: string }>(async (req) => {
  const uid = req.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in first.');
  const { channel, routeId } = req.data ?? {};
  if (channel !== 'email' && channel !== 'slack') throw new HttpsError('invalid-argument', 'channel must be email or slack');
  const base = await appUrl();
  const msg = { subject: 'Test notification from Calleva Gear', text: 'If you can read this, notifications are working.', link: appLink(base, '/') };
  const key = `test-${uid}-${Date.now()}`;
  if (routeId) {
    await requireAdmin(uid);
    const route = (await notificationSettings()).routes.find((r) => r.id === routeId);
    if (!route) throw new HttpsError('not-found', 'No such channel.');
    await enqueue(key, { event: 'test', channel: route.type, userId: null, target: route.target, ...msg });
  } else await enqueue(key, { event: 'test', channel, userId: uid, target: null, ...msg });
  return { id: safe(key) };
});

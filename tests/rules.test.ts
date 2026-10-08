import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, serverTimestamp, setDoc, Timestamp, updateDoc, writeBatch, type Firestore } from 'firebase/firestore';

let env: RulesTestEnvironment;

const USERS = {
  admin: { role: 'admin', active: true, expiresAt: null },
  manager: { role: 'manager', active: true, expiresAt: null },
  staff: { role: 'staff', active: true, expiresAt: null },
  expired: { role: 'manager', active: true, expiresAt: Timestamp.fromMillis(Date.now() - 60_000) },
  inactive: { role: 'admin', active: false, expiresAt: null },
};

const as = (uid: string) => env.authenticatedContext(uid, { email: `${uid}@calleva.org`, email_verified: true }).firestore();
const stampCreate = (uid: string) => ({ createdAt: serverTimestamp(), createdBy: uid, updatedAt: serverTimestamp(), updatedBy: uid });
const stampUpdate = (uid: string) => ({ updatedAt: serverTimestamp(), updatedBy: uid });

function gearDoc(uid: string, qrCode: string, extra: Record<string, unknown> = {}) {
  return { name: 'Raft 1', status: 'active', qrCode, productId: null, programAreaId: null, locationId: null, ...stampCreate(uid), ...extra };
}

async function createGear(db: Firestore, uid: string, id: string, qrCode: string) {
  const batch = writeBatch(db);
  batch.set(doc(db, 'gear', id), gearDoc(uid, qrCode));
  batch.set(doc(db, 'qrCodes', qrCode), { gearId: id });
  return batch.commit();
}

beforeAll(async () => {
  env = await initializeTestEnvironment({
    // A separate project so Cloud Functions (which watch demo-gear) don't react to these writes.
    projectId: 'demo-rules',
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
  });
});
afterAll(() => env.cleanup());

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const [uid, u] of Object.entries(USERS)) await setDoc(doc(db, 'users', uid), { email: `${uid}@calleva.org`, displayName: uid, ...u });
    await setDoc(doc(db, 'gear', 'existing'), gearDoc('seed', 'CG-EXIST1'));
    await setDoc(doc(db, 'qrCodes', 'CG-EXIST1'), { gearId: 'existing' });
  });
});

describe('access', () => {
  it('lets active users read gear and blocks everyone else', async () => {
    await assertSucceeds(getDoc(doc(as('staff'), 'gear', 'existing')));
    await assertFails(getDoc(doc(as('expired'), 'gear', 'existing')));
    await assertFails(getDoc(doc(as('inactive'), 'gear', 'existing')));
    await assertFails(getDoc(doc(as('stranger'), 'gear', 'existing')));
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'gear', 'existing')));
  });

  it('lets anyone signed in read only their own (possibly missing) profile', async () => {
    await assertSucceeds(getDoc(doc(as('stranger'), 'users', 'stranger')));
    await assertFails(getDoc(doc(as('stranger'), 'users', 'staff')));
    await assertSucceeds(getDoc(doc(as('expired'), 'users', 'expired')));
  });

  it('never lets clients create profiles', async () => {
    await assertFails(setDoc(doc(as('stranger'), 'users', 'stranger'), { role: 'admin', active: true, expiresAt: null }));
  });

  it('lets users edit their own details but not their role or access', async () => {
    const db = as('staff');
    await assertSucceeds(updateDoc(doc(db, 'users', 'staff'), { displayName: 'Sam', phone: '555', ...stampUpdate('staff') }));
    await assertFails(updateDoc(doc(db, 'users', 'staff'), { role: 'admin', ...stampUpdate('staff') }));
    await assertFails(updateDoc(doc(db, 'users', 'staff'), { active: false, ...stampUpdate('staff') }));
    await assertFails(updateDoc(doc(as('expired'), 'users', 'expired'), { expiresAt: null, ...stampUpdate('expired') }));
  });

  it('lets admins manage others but not demote or deactivate themselves', async () => {
    const db = as('admin');
    await assertSucceeds(updateDoc(doc(db, 'users', 'staff'), { role: 'manager', ...stampUpdate('admin') }));
    await assertFails(updateDoc(doc(db, 'users', 'admin'), { role: 'staff', ...stampUpdate('admin') }));
    await assertFails(updateDoc(doc(db, 'users', 'admin'), { active: false, ...stampUpdate('admin') }));
    await assertFails(updateDoc(doc(as('manager'), 'users', 'staff'), { role: 'admin', ...stampUpdate('manager') }));
  });

  it('restricts invites to admins and lower-case ids', async () => {
    const invite = (by: string) => ({ email: 'sam@gmail.com', role: 'staff', expiresAt: null, ...stampCreate(by) });
    await assertSucceeds(setDoc(doc(as('admin'), 'invites', 'sam@gmail.com'), invite('admin')));
    await assertFails(setDoc(doc(as('admin'), 'invites', 'Sam@gmail.com'), { ...invite('admin'), email: 'Sam@gmail.com' }));
    await assertFails(setDoc(doc(as('manager'), 'invites', 'sam@gmail.com'), invite('manager')));
  });
});

describe('reference data and products', () => {
  it('lets managers write, requires stamps, and keeps staff read-only', async () => {
    const loc = (uid: string) => ({ name: 'Boat shed', active: true, ...stampCreate(uid) });
    await assertSucceeds(setDoc(doc(as('manager'), 'locations', 'l1'), loc('manager')));
    await assertFails(setDoc(doc(as('staff'), 'locations', 'l2'), loc('staff')));
    await assertFails(setDoc(doc(as('manager'), 'locations', 'l3'), { ...loc('manager'), createdBy: 'someone-else' }));
    await assertFails(setDoc(doc(as('manager'), 'locations', 'l4'), { ...loc('manager'), name: '' }));
  });

  it('validates products', async () => {
    const p = { model: 'Otter 130', active: true, manufacturerId: null, categoryId: null, lifetimeYears: 10, ...stampCreate('manager') };
    await assertSucceeds(setDoc(doc(as('manager'), 'products', 'p1'), p));
    await assertFails(setDoc(doc(as('manager'), 'products', 'p2'), { ...p, lifetimeYears: 'ten' }));
  });
});

describe('gear', () => {
  it('lets managers create gear that claims its QR code', async () => {
    await assertSucceeds(createGear(as('manager'), 'manager', 'g1', 'CG-NEW001'));
    await assertFails(createGear(as('staff'), 'staff', 'g2', 'CG-NEW002'));
  });

  it('requires the QR code to be claimed in the same write', async () => {
    await assertFails(setDoc(doc(as('manager'), 'gear', 'g1'), gearDoc('manager', 'CG-NEW003')));
  });

  it('keeps QR codes unique', async () => {
    await assertFails(createGear(as('manager'), 'manager', 'g1', 'CG-EXIST1'));
  });

  it('moves the QR claim when re-tagging', async () => {
    const db = as('manager');
    const batch = writeBatch(db);
    batch.update(doc(db, 'gear', 'existing'), { qrCode: 'TAG-0042', ...stampUpdate('manager') });
    batch.set(doc(db, 'qrCodes', 'TAG-0042'), { gearId: 'existing' });
    batch.delete(doc(db, 'qrCodes', 'CG-EXIST1'));
    await assertSucceeds(batch.commit());
    // Can't release a code the gear still uses.
    await assertFails(writeBatch(db).delete(doc(db, 'qrCodes', 'TAG-0042')).commit());
  });

  it('requires a reason and fresh timestamp to change status', async () => {
    const db = as('manager');
    const ref = doc(db, 'gear', 'existing');
    await assertFails(updateDoc(ref, { status: 'quarantined', ...stampUpdate('manager') }));
    await assertFails(updateDoc(ref, { status: 'quarantined', statusReason: '', statusChangedAt: serverTimestamp(), ...stampUpdate('manager') }));
    await assertFails(updateDoc(ref, { status: 'quarantined', statusReason: 'Torn', ...stampUpdate('manager') }));
    await assertSucceeds(updateDoc(ref, { status: 'quarantined', statusReason: 'Torn floor', statusChangedAt: serverTimestamp(), ...stampUpdate('manager') }));
    await assertFails(updateDoc(ref, { status: 'broken', statusReason: 'x', statusChangedAt: serverTimestamp(), ...stampUpdate('manager') }));
  });

  it('protects fields maintained by Cloud Functions and history', async () => {
    const db = as('admin');
    await assertFails(updateDoc(doc(db, 'gear', 'existing'), { openInspectionWorkOrderId: 'wo1', ...stampUpdate('admin') }));
    await assertFails(setDoc(doc(db, 'gear', 'existing', 'statusHistory', 'h1'), { to: 'active' }));
  });

  it('only lets admins delete gear', async () => {
    const mgr = as('manager');
    await assertFails(writeBatch(mgr).delete(doc(mgr, 'gear', 'existing')).commit());
    const db = as('admin');
    const batch = writeBatch(db);
    batch.delete(doc(db, 'gear', 'existing'));
    batch.delete(doc(db, 'qrCodes', 'CG-EXIST1'));
    await assertSucceeds(batch.commit());
  });
});

describe('photos', () => {
  const photo = (uid: string, id: string) => ({
    gearId: 'existing',
    storagePath: `photos/${id}/full.jpg`,
    thumbPath: `photos/${id}/thumb.jpg`,
    uploaded: false,
    uploadedBy: uid,
    ...stampCreate(uid),
  });

  it('lets any active user add photos as themselves', async () => {
    await assertSucceeds(setDoc(doc(as('staff'), 'photos', 'ph1'), photo('staff', 'ph1')));
    await assertFails(setDoc(doc(as('staff'), 'photos', 'ph2'), photo('manager', 'ph2')));
    await assertFails(setDoc(doc(as('staff'), 'photos', 'ph3'), { ...photo('staff', 'ph3'), storagePath: 'photos/other/full.jpg' }));
    await assertFails(setDoc(doc(as('expired'), 'photos', 'ph4'), photo('expired', 'ph4')));
  });

  it('lets the uploader mark it uploaded and others leave it alone', async () => {
    await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'photos', 'ph1'), { ...photo('staff', 'ph1'), createdAt: Timestamp.now(), updatedAt: Timestamp.now() }));
    await assertSucceeds(updateDoc(doc(as('staff'), 'photos', 'ph1'), { uploaded: true, ...stampUpdate('staff') }));
    await assertFails(updateDoc(doc(as('staff'), 'photos', 'ph1'), { gearId: 'other', ...stampUpdate('staff') }));
    await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'users', 'staff2'), { role: 'staff', active: true, expiresAt: null }));
    await assertFails(updateDoc(doc(as('staff2'), 'photos', 'ph1'), { caption: 'x', ...stampUpdate('staff2') }));
  });
});

describe('inspections', () => {
  const form = (uid: string, version = 1) => ({ name: 'Raft check', active: true, version, items: [], ...stampCreate(uid) });
  const inspection = (uid: string, extra: Record<string, unknown> = {}) => ({
    gearId: 'existing',
    productId: null,
    formId: 'f1',
    formName: 'Raft check',
    formVersion: 1,
    date: '2026-10-01',
    inspectorId: uid,
    responses: [{ itemId: 'a', result: 'fail', failureOutcome: 'quarantined' }],
    failedCount: 1,
    calculatedStatus: 'quarantined',
    override: null,
    ...stampCreate(uid),
    ...extra,
  });

  it('lets managers manage forms and requires version bumps', async () => {
    const db = as('manager');
    await assertSucceeds(setDoc(doc(db, 'inspectionForms', 'f1'), form('manager')));
    await assertFails(setDoc(doc(as('staff'), 'inspectionForms', 'f2'), form('staff')));
    await assertFails(setDoc(doc(db, 'inspectionForms', 'f3'), form('manager', 5)));
    await assertFails(updateDoc(doc(db, 'inspectionForms', 'f1'), { name: 'Renamed', ...stampUpdate('manager') }));
    await assertSucceeds(updateDoc(doc(db, 'inspectionForms', 'f1'), { name: 'Renamed', version: 2, ...stampUpdate('manager') }));
  });

  it('lets any active user record an inspection as themselves', async () => {
    await assertSucceeds(setDoc(doc(as('staff'), 'inspections', 'i1'), inspection('staff')));
    await assertFails(setDoc(doc(as('staff'), 'inspections', 'i2'), inspection('manager')));
    await assertFails(setDoc(doc(as('expired'), 'inspections', 'i3'), inspection('expired')));
    await assertFails(setDoc(doc(as('staff'), 'inspections', 'i4'), inspection('staff', { gearId: 'missing' })));
    await assertFails(setDoc(doc(as('staff'), 'inspections', 'i5'), inspection('staff', { date: 'yesterday' })));
  });

  it('requires a reason to override and keeps outcome fields for the server', async () => {
    const db = as('staff');
    await assertFails(setDoc(doc(db, 'inspections', 'i1'), inspection('staff', { override: { status: 'active', reason: '' } })));
    await assertFails(setDoc(doc(db, 'inspections', 'i2'), inspection('staff', { override: { status: 'retired', reason: 'x' } })));
    await assertSucceeds(setDoc(doc(db, 'inspections', 'i3'), inspection('staff', { override: { status: 'active', reason: 'Patched on site' } })));
    await assertFails(setDoc(doc(db, 'inspections', 'i4'), inspection('staff', { statusApplied: 'active' })));
  });

  it('makes inspections permanent except for admin deletion', async () => {
    await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'inspections', 'i1'), inspection('staff')));
    await assertFails(updateDoc(doc(as('staff'), 'inspections', 'i1'), { notes: 'edit' }));
    await assertFails(updateDoc(doc(as('admin'), 'inspections', 'i1'), { notes: 'edit' }));
    const mgr = as('manager');
    await assertFails(writeBatch(mgr).delete(doc(mgr, 'inspections', 'i1')).commit());
    const adm = as('admin');
    await assertSucceeds(writeBatch(adm).delete(doc(adm, 'inspections', 'i1')).commit());
  });

  it('keeps inspection state on gear server-only', async () => {
    await assertFails(updateDoc(doc(as('admin'), 'gear', 'existing'), { 'inspectionState.f1': { lastDate: '2026-01-01' }, ...stampUpdate('admin') }));
  });

  it('lets managers assign inspectors', async () => {
    const a = (uid: string) => ({ scope: 'location', refId: 'l1', userIds: ['staff'], ...stampCreate(uid) });
    await assertSucceeds(setDoc(doc(as('manager'), 'inspectionAssignments', 'a1'), a('manager')));
    await assertFails(setDoc(doc(as('staff'), 'inspectionAssignments', 'a2'), a('staff')));
    await assertFails(setDoc(doc(as('manager'), 'inspectionAssignments', 'a3'), { ...a('manager'), scope: 'planet' }));
  });
});

describe('work orders', () => {
  const wo = (uid: string, extra: Record<string, unknown> = {}) => ({
    gearId: 'existing',
    productId: null,
    title: 'Leaky valve',
    description: '',
    source: 'issue',
    severity: 'has_issues',
    status: 'open',
    priority: 'normal',
    assigneeId: null,
    dueDate: null,
    autoAssign: true,
    ...stampCreate(uid),
    ...extra,
  });
  const seedWo = (extra: Record<string, unknown> = {}) =>
    env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'workOrders', 'w1'), { ...wo('manager'), number: 1, autoAssign: null, createdAt: Timestamp.now(), updatedAt: Timestamp.now(), ...extra }));

  it('lets anyone report an issue, but only managers open manual work orders', async () => {
    await assertSucceeds(setDoc(doc(as('staff'), 'workOrders', 'a'), wo('staff')));
    await assertFails(setDoc(doc(as('staff'), 'workOrders', 'b'), wo('staff', { source: 'manual' })));
    await assertSucceeds(setDoc(doc(as('manager'), 'workOrders', 'c'), wo('manager', { source: 'manual' })));
    await assertFails(setDoc(doc(as('manager'), 'workOrders', 'd'), wo('manager', { source: 'inspection' })));
    await assertFails(setDoc(doc(as('staff'), 'workOrders', 'e'), wo('staff', { number: 99 })));
    await assertFails(setDoc(doc(as('staff'), 'workOrders', 'f'), wo('staff', { status: 'done' })));
    await assertFails(setDoc(doc(as('staff'), 'workOrders', 'g'), wo('staff', { gearId: 'missing' })));
  });

  it('lets the assignee work the order but not reassign it', async () => {
    await seedWo({ assigneeId: 'staff' });
    const db = as('staff');
    await assertSucceeds(updateDoc(doc(db, 'workOrders', 'w1'), { status: 'in_progress', ...stampUpdate('staff') }));
    await assertFails(updateDoc(doc(db, 'workOrders', 'w1'), { assigneeId: 'manager', ...stampUpdate('staff') }));
    await assertFails(updateDoc(doc(db, 'workOrders', 'w1'), { status: 'done', ...stampUpdate('staff') }));
    await assertSucceeds(updateDoc(doc(db, 'workOrders', 'w1'), { status: 'done', resolution: 'Replaced valve', cost: 40, ...stampUpdate('staff') }));
  });

  it('keeps everyone else out and reserves cancelling for managers', async () => {
    await seedWo({ assigneeId: 'staff' });
    await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'users', 'staff2'), { role: 'staff', active: true, expiresAt: null }));
    await assertFails(updateDoc(doc(as('staff2'), 'workOrders', 'w1'), { status: 'in_progress', ...stampUpdate('staff2') }));
    await assertFails(updateDoc(doc(as('staff'), 'workOrders', 'w1'), { status: 'cancelled', resolution: 'x', ...stampUpdate('staff') }));
    await assertSucceeds(updateDoc(doc(as('manager'), 'workOrders', 'w1'), { status: 'cancelled', resolution: 'Duplicate', ...stampUpdate('manager') }));
    await assertFails(updateDoc(doc(as('manager'), 'workOrders', 'w1'), { number: 5, ...stampUpdate('manager') }));
    await assertFails(updateDoc(doc(as('manager'), 'workOrders', 'w1'), { closedAt: serverTimestamp(), ...stampUpdate('manager') }));
  });

  it('allows comments as yourself only, and rules for admins only', async () => {
    await seedWo();
    const db = as('staff');
    await assertSucceeds(setDoc(doc(db, 'workOrders', 'w1', 'log', 'c1'), { type: 'comment', text: 'Ordered part', by: 'staff', at: serverTimestamp() }));
    await assertFails(setDoc(doc(db, 'workOrders', 'w1', 'log', 'c2'), { type: 'status', text: 'Done', by: 'staff', at: serverTimestamp() }));
    await assertFails(setDoc(doc(db, 'workOrders', 'w1', 'log', 'c3'), { type: 'comment', text: 'x', by: 'manager', at: serverTimestamp() }));
    const rule = { order: 1, name: 'r', assigneeId: null, dueInDays: 7, priority: 'high' };
    await assertFails(setDoc(doc(as('manager'), 'workOrderRules', 'r1'), rule));
    await assertSucceeds(setDoc(doc(as('admin'), 'workOrderRules', 'r1'), rule));
    await assertFails(getDoc(doc(as('admin'), 'counters', 'workOrders')));
  });

  it('only lets admins set gear back to Active directly', async () => {
    await env.withSecurityRulesDisabled((ctx) => updateDoc(doc(ctx.firestore(), 'gear', 'existing'), { status: 'quarantined' }));
    const change = { status: 'active', statusReason: 'Fixed', statusChangedAt: serverTimestamp() };
    await assertFails(updateDoc(doc(as('manager'), 'gear', 'existing'), { ...change, ...stampUpdate('manager') }));
    await assertSucceeds(updateDoc(doc(as('manager'), 'gear', 'existing'), { ...change, status: 'retired', ...stampUpdate('manager') }));
    await assertSucceeds(updateDoc(doc(as('admin'), 'gear', 'existing'), { ...change, ...stampUpdate('admin') }));
  });
});

describe('lists, kits, check-outs and usage', () => {
  const kit = (uid: string, extra: Record<string, unknown> = {}) => ({
    name: 'Camp wk1',
    ownerId: uid,
    programAreaId: null,
    startDate: '2026-10-10',
    endDate: '2026-10-16',
    gearIds: ['existing'],
    status: 'planned',
    ...stampCreate(uid),
    ...extra,
  });

  it('lets managers write lists and everyone read them', async () => {
    const list = (uid: string) => ({ name: 'Day trip', active: true, lines: [], programAreaId: null, ...stampCreate(uid) });
    await assertSucceeds(setDoc(doc(as('manager'), 'lists', 'l1'), list('manager')));
    await assertFails(setDoc(doc(as('staff'), 'lists', 'l2'), list('staff')));
    await assertSucceeds(getDoc(doc(as('staff'), 'lists', 'l1')));
  });

  it('lets people manage their own kits and admins anyone’s', async () => {
    await assertSucceeds(setDoc(doc(as('staff'), 'kits', 'k1'), kit('staff')));
    await assertFails(setDoc(doc(as('staff'), 'kits', 'k2'), kit('manager')));
    await assertSucceeds(setDoc(doc(as('admin'), 'kits', 'k3'), { ...kit('staff'), ...stampCreate('admin') }));
    await assertFails(setDoc(doc(as('staff'), 'kits', 'k4'), kit('staff', { startDate: '2026-10-20' })));
    await assertSucceeds(getDoc(doc(as('manager'), 'kits', 'k1')));
    await assertFails(updateDoc(doc(as('manager'), 'kits', 'k1'), { name: 'Mine now', ...stampUpdate('manager') }));
    await assertFails(updateDoc(doc(as('staff'), 'kits', 'k1'), { ownerId: 'manager', ...stampUpdate('staff') }));
    await assertSucceeds(updateDoc(doc(as('staff'), 'kits', 'k1'), { status: 'checked_out', ...stampUpdate('staff') }));
    await assertSucceeds(updateDoc(doc(as('admin'), 'kits', 'k1'), { ownerId: 'manager', ...stampUpdate('admin') }));
  });

  it('records check-outs and permanent usage for yourself', async () => {
    const co = (uid: string, userId = uid) => ({ gearId: 'existing', userId, startDate: '2026-10-08', status: 'out', ...stampCreate(uid) });
    await assertSucceeds(setDoc(doc(as('staff'), 'checkouts', 'c1'), co('staff')));
    await assertFails(setDoc(doc(as('staff'), 'checkouts', 'c2'), co('staff', 'manager')));
    await assertSucceeds(setDoc(doc(as('admin'), 'checkouts', 'c3'), co('admin', 'staff')));
    await assertSucceeds(updateDoc(doc(as('staff'), 'checkouts', 'c1'), { status: 'returned', returnedDate: '2026-10-09', ...stampUpdate('staff') }));

    const log = (uid: string, extra: Record<string, unknown> = {}) => ({ gearId: 'existing', userId: uid, startDate: '2026-10-08', endDate: '2026-10-09', daysUsed: 2, ...stampCreate(uid), ...extra });
    await assertSucceeds(setDoc(doc(as('staff'), 'usageLogs', 'u1'), log('staff')));
    await assertFails(setDoc(doc(as('staff'), 'usageLogs', 'u2'), log('staff', { daysUsed: 400 })));
    await assertFails(setDoc(doc(as('staff'), 'usageLogs', 'u3'), log('staff', { userId: 'manager' })));
    await assertFails(setDoc(doc(as('staff'), 'usageLogs', 'u4'), log('staff', { processedAt: serverTimestamp() })));
    await assertFails(updateDoc(doc(as('admin'), 'usageLogs', 'u1'), { daysUsed: 5 }));
  });

  it('lets an admin return someone else’s big kit in one batch', async () => {
    // Regression: one exists() per usage log hit the 20-lookup limit for kits over ~18 items.
    const ids = Array.from({ length: 40 }, (_, i) => `big${i}`);
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'kits', 'big'), kit('staff', { gearIds: ids, status: 'checked_out' }));
    });
    const db = as('admin');
    const batch = writeBatch(db);
    batch.update(doc(db, 'kits', 'big'), { status: 'returned', returnedDate: '2026-10-16', ...stampUpdate('admin') });
    for (const id of ids)
      batch.set(doc(db, 'usageLogs', `log-${id}`), { gearId: id, userId: 'staff', startDate: '2026-10-10', endDate: '2026-10-16', daysUsed: 3, kitId: 'big', checkoutId: null, ...stampCreate('admin') });
    await assertSucceeds(batch.commit());
  });
});

describe('notifications', () => {
  it('shows people their own notifications and admins everything; nobody writes them', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'notifications', 'n1'), { userId: 'staff', channel: 'email', status: 'sent', subject: 's', text: 't' });
      await setDoc(doc(ctx.firestore(), 'notifications', 'n2'), { userId: 'manager', channel: 'email', status: 'sent', subject: 's', text: 't' });
    });
    await assertSucceeds(getDoc(doc(as('staff'), 'notifications', 'n1')));
    await assertFails(getDoc(doc(as('staff'), 'notifications', 'n2')));
    await assertSucceeds(getDoc(doc(as('admin'), 'notifications', 'n2')));
    await assertFails(setDoc(doc(as('admin'), 'notifications', 'n3'), { userId: 'admin' }));
  });

  it('lets admins set credentials that nobody can read back', async () => {
    await assertSucceeds(setDoc(doc(as('admin'), 'private', 'notifications'), { slackToken: 'xoxb-1' }));
    await assertFails(getDoc(doc(as('admin'), 'private', 'notifications')));
    await assertFails(setDoc(doc(as('manager'), 'private', 'notifications'), { slackToken: 'xoxb-2' }));
  });

  it('lets people choose their own notification settings', async () => {
    await assertSucceeds(updateDoc(doc(as('staff'), 'users', 'staff'), { notificationPrefs: { daily_digest: { email: false } }, slackUserId: 'U1', ...stampUpdate('staff') }));
    await assertFails(updateDoc(doc(as('staff'), 'users', 'staff'), { notificationPrefs: 'all', ...stampUpdate('staff') }));
  });
});

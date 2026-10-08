/**
 * Integration tests for the Cloud Functions, run inside
 * `firebase emulators:exec` (see `npm run test:emulator`).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { deleteApp, initializeApp as initClient, type FirebaseApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { connectFunctionsEmulator, getFunctions, httpsCallable } from 'firebase/functions';
import { initializeApp as initAdmin, type App } from 'firebase-admin/app';
import { getAuth as adminAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= '127.0.0.1:9099';

let admin: App;
let client: FirebaseApp;

async function waitFor<T>(fn: () => Promise<T | undefined | null | false>, timeout = 15_000): Promise<T> {
  const end = Date.now() + timeout;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 250));
  }
}

async function makeAuthUser(email: string) {
  const auth = adminAuth(admin);
  await auth.getUserByEmail(email).then((u) => auth.deleteUser(u.uid)).catch(() => {});
  return auth.createUser({ email, password: 'password', emailVerified: true, displayName: 'Test Person' });
}

async function activateAs(email: string) {
  const auth = getAuth(client);
  await signOut(auth);
  await signInWithEmailAndPassword(auth, email, 'password');
  return httpsCallable<void, { status: string; role: string }>(getFunctions(client, 'us-central1'), 'activateAccount')();
}

beforeAll(() => {
  admin = initAdmin({ projectId: 'demo-gear' }, 'admin');
  client = initClient({ apiKey: 'demo', projectId: 'demo-gear', authDomain: 'demo-gear.firebaseapp.com' }, 'client');
  connectAuthEmulator(getAuth(client), 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFunctionsEmulator(getFunctions(client, 'us-central1'), '127.0.0.1', 5001);
});
afterAll(async () => {
  await deleteApp(client);
});

beforeEach(async () => {
  const db = getFirestore(admin);
  for (const c of ['users', 'invites', 'gear', 'qrCodes', 'inspections', 'workOrders', 'workOrderRules', 'counters']) await db.recursiveDelete(db.collection(c));
});

describe('activateAccount', () => {
  it('creates a profile from an invitation and consumes it', async () => {
    const db = getFirestore(admin);
    const user = await makeAuthUser('seasonal@gmail.com');
    const expires = Timestamp.fromMillis(Date.now() + 30 * 864e5);
    await db.doc('invites/seasonal@gmail.com').set({ email: 'seasonal@gmail.com', role: 'technician', expiresAt: expires, displayName: 'Sea Sonal' });

    const res = await activateAs('seasonal@gmail.com');
    expect(res.data).toEqual({ status: 'created', role: 'technician' });
    const profile = (await db.doc(`users/${user.uid}`).get()).data()!;
    expect(profile).toMatchObject({ role: 'technician', active: true, displayName: 'Sea Sonal', email: 'seasonal@gmail.com' });
    expect(profile.expiresAt.toMillis()).toBe(expires.toMillis());
    expect((await db.doc('invites/seasonal@gmail.com').get()).exists).toBe(false);

    // Second sign-in just records the visit.
    expect((await activateAs('seasonal@gmail.com')).data.status).toBe('existing');
  });

  it('rejects people who were not invited (password accounts never auto-join)', async () => {
    await makeAuthUser('random@calleva.org');
    await expect(activateAs('random@calleva.org')).rejects.toThrow(/hasn't been invited/);
  });

  it('rejects expired invitations and deactivated accounts', async () => {
    const db = getFirestore(admin);
    await makeAuthUser('late@gmail.com');
    await db.doc('invites/late@gmail.com').set({ email: 'late@gmail.com', role: 'staff', expiresAt: Timestamp.fromMillis(Date.now() - 1000) });
    await expect(activateAs('late@gmail.com')).rejects.toThrow(/expired/);

    const gone = await makeAuthUser('gone@gmail.com');
    await db.doc(`users/${gone.uid}`).set({ email: 'gone@gmail.com', role: 'staff', active: false, expiresAt: null });
    await expect(activateAs('gone@gmail.com')).rejects.toThrow(/ended/);
  });
});

describe('gearStatusHistory', () => {
  it('records creation and each status change with its reason', async () => {
    const db = getFirestore(admin);
    const ref = db.doc('gear/g1');
    await ref.set({ name: 'Raft 1', status: 'active', qrCode: 'CG-HIST01', createdBy: 'u1', updatedBy: 'u1' });
    await waitFor(async () => (await ref.collection('statusHistory').get()).size === 1);

    await ref.update({ status: 'quarantined', statusReason: 'Floor torn', statusSource: 'manual', updatedBy: 'u2' });
    const entries = await waitFor(async () => {
      const snap = await ref.collection('statusHistory').orderBy('at').get();
      return snap.size === 2 && snap.docs.map((d) => d.data());
    });
    expect(entries[0]).toMatchObject({ from: null, to: 'active', reason: 'Added to inventory', by: 'u1' });
    expect(entries[1]).toMatchObject({ from: 'active', to: 'quarantined', reason: 'Floor torn', source: 'manual', by: 'u2' });

    // Non-status edits add nothing.
    await ref.update({ name: 'Raft One' });
    await new Promise((r) => setTimeout(r, 1500));
    expect((await ref.collection('statusHistory').get()).size).toBe(2);
  });

  it('releases the QR code when gear is deleted', async () => {
    const db = getFirestore(admin);
    await db.doc('gear/g2').set({ name: 'PFD 1', status: 'active', qrCode: 'CG-DEL001' });
    await db.doc('qrCodes/CG-DEL001').set({ gearId: 'g2' });
    await db.doc('gear/g2').delete();
    await waitFor(async () => !(await db.doc('qrCodes/CG-DEL001').get()).exists);
  });
});

describe('applyInspection', () => {
  const resp = (result: string, failureOutcome: string, prompt = 'Check') => ({ itemId: prompt, prompt, type: 'pass_fail', failureOutcome, result });
  const inspect = (id: string, extra: Record<string, unknown>) =>
    getFirestore(admin)
      .doc(`inspections/${id}`)
      .set({ gearId: 'g1', productId: null, formId: 'f1', formName: 'Raft check', formVersion: 1, date: '2026-09-01', inspectorId: 'u1', notes: '', calculatedStatus: 'active', failedCount: 0, override: null, ...extra });
  const processed = (id: string) =>
    waitFor(async () => {
      const d = await getFirestore(admin).doc(`inspections/${id}`).get();
      return d.get('processedAt') && d.data();
    });
  const gearData = async () => (await getFirestore(admin).doc('gear/g1').get()).data()!;

  beforeEach(async () => {
    await getFirestore(admin).doc('gear/g1').set({ name: 'Raft 1', status: 'active', qrCode: 'CG-INSP01', stats: { daysUsed: 33 } });
  });

  it('applies the worst failure outcome and records the inspection on the gear', async () => {
    // Client claims "active"; the server recalculates.
    await inspect('i1', { responses: [resp('fail', 'has_issues', 'Valves'), resp('fail', 'quarantined', 'Seams'), resp('pass', 'quarantined')] });
    const insp = await processed('i1');
    expect(insp).toMatchObject({ calculatedStatus: 'quarantined', failedCount: 2, statusBefore: 'active', statusApplied: 'quarantined' });
    const g = await gearData();
    expect(g.status).toBe('quarantined');
    expect(g.statusSource).toBe('inspection');
    expect(g.statusReason).toBe('Raft check — quarantined: failed Valves; Seams');
    expect(g.inspectionState.f1).toEqual({ lastDate: '2026-09-01', lastInspectionId: 'i1', failedCount: 2, daysUsedAtLast: 33 });
  });

  it('uses the override, and a clean pass never clears a problem', async () => {
    await inspect('i1', { responses: [resp('fail', 'quarantined')], override: { status: 'has_issues', reason: 'Field patched' } });
    await processed('i1');
    expect((await gearData()).status).toBe('has_issues');

    await inspect('i2', { date: '2026-09-15', responses: [resp('pass', 'quarantined'), resp('fail', 'note')] });
    expect(await processed('i2')).toMatchObject({ calculatedStatus: 'active', statusBefore: 'has_issues', statusApplied: 'has_issues' });
    expect((await gearData()).status).toBe('has_issues');
    expect((await gearData()).inspectionState.f1.lastInspectionId).toBe('i2');
  });

  it('still applies a problem found by an older inspection that syncs late', async () => {
    await inspect('i1', { date: '2026-09-15', responses: [resp('pass', 'quarantined')] });
    await processed('i1');
    await inspect('i0', { date: '2026-08-01', responses: [resp('fail', 'quarantined')] });
    expect(await processed('i0')).toMatchObject({ statusApplied: 'quarantined' });
    const g = await gearData();
    expect(g.status).toBe('quarantined');
    expect(g.inspectionState.f1.lastInspectionId).toBe('i1');
  });

  it('leaves retired gear retired', async () => {
    await getFirestore(admin).doc('gear/g1').update({ status: 'retired' });
    await inspect('i1', { responses: [resp('fail', 'quarantined')] });
    expect(await processed('i1')).toMatchObject({ statusApplied: 'retired', statusBefore: 'retired' });
    expect((await gearData()).status).toBe('retired');
  });
});

describe('work orders', () => {
  const fdb = () => getFirestore(admin);
  const resp = (result: string, failureOutcome: string, prompt = 'Check') => ({ itemId: prompt, prompt, type: 'pass_fail', failureOutcome, result, comment: '' });
  const inspect = (id: string, date: string, responses: unknown[]) =>
    fdb().doc(`inspections/${id}`).set({ gearId: 'g1', productId: 'p1', formId: 'f1', formName: 'Raft check', formVersion: 1, date, inspectorId: 'u1', notes: '', calculatedStatus: 'active', failedCount: 0, override: null, responses });
  const processed = (id: string) =>
    waitFor(async () => {
      const d = await fdb().doc(`inspections/${id}`).get();
      return d.get('processedAt') && d.data();
    });
  const gearData = async () => (await fdb().doc('gear/g1').get()).data()!;
  const woData = async (id: string) => (await fdb().doc(`workOrders/${id}`).get()).data()!;

  beforeEach(async () => {
    await fdb().doc('gear/g1').set({ name: 'Raft 1', status: 'active', qrCode: 'CG-WO0001', productId: 'p1', programAreaId: 'river', locationId: 'rileys' });
    await fdb().doc('products/p1').set({ model: 'Otter', categoryId: 'rafts', active: true });
    await fdb().doc('users/tech').set({ displayName: 'Taylor Tech', role: 'technician', active: true, expiresAt: null });
    await fdb().doc('workOrderRules/r1').set({ order: 1, name: 'River rafts', severity: null, programAreaId: 'river', categoryId: 'rafts', locationId: null, assigneeId: 'tech', dueInDays: 3, priority: 'urgent' });
    await fdb().doc('workOrderRules/r2').set({ order: 2, name: 'Default', severity: null, programAreaId: null, categoryId: null, locationId: null, assigneeId: null, dueInDays: 30, priority: 'normal' });
  });

  it('opens one work order per gear from failed inspections and adds later failures to it', async () => {
    await inspect('i1', '2026-09-01', [resp('fail', 'note', 'Scuffed'), resp('pass', 'quarantined')]);
    const i1 = await processed('i1');
    expect(i1.statusApplied).toBe('active');
    const g = await gearData();
    const woId = g.openInspectionWorkOrderId;
    expect(woId).toBe(i1.workOrderId);
    const wo = await woData(woId);
    expect(wo).toMatchObject({ number: 1, source: 'inspection', severity: 'note', status: 'open', assigneeId: 'tech', priority: 'urgent', inspectionIds: ['i1'] });
    expect(wo.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    await inspect('i2', '2026-09-10', [resp('fail', 'quarantined', 'Seams')]);
    expect(await processed('i2')).toMatchObject({ workOrderId: woId, statusApplied: 'quarantined' });
    expect(await woData(woId)).toMatchObject({ severity: 'quarantined', inspectionIds: ['i1', 'i2'] });
    const log = await fdb().collection(`workOrders/${woId}/log`).get();
    expect(log.docs.map((d) => d.get('type')).sort()).toEqual(['created', 'inspection', 'inspection']);
    expect((await fdb().collection('workOrders').get()).size).toBe(1);
  });

  it('returns gear to Active only when its last open work order closes', async () => {
    await inspect('i1', '2026-09-01', [resp('fail', 'quarantined')]);
    const woId = (await processed('i1')).workOrderId;
    // A second, manual work order on the same gear.
    await fdb().doc('workOrders/m1').set({ gearId: 'g1', productId: 'p1', title: 'Replace D-ring', source: 'manual', severity: 'has_issues', status: 'open', priority: 'normal', assigneeId: null, dueDate: null, createdBy: 'mgr' });
    await waitFor(async () => (await woData('m1')).number === 2);

    await fdb().doc(`workOrders/${woId}`).update({ status: 'done', resolution: 'Patched seam', updatedBy: 'tech' });
    await waitFor(async () => (await woData(woId)).gearStatusAfterClose === 'has_issues');
    let g = await gearData();
    expect(g.status).toBe('has_issues');
    expect(g.openInspectionWorkOrderId).toBeNull();
    expect(g.statusReason).toBe('WO-0001 completed: Patched seam');

    await fdb().doc('workOrders/m1').update({ status: 'cancelled', resolution: 'Not needed', updatedBy: 'mgr' });
    await waitFor(async () => (await gearData()).status === 'active');
    g = await gearData();
    expect(g.statusSource).toBe('work_order');
    expect((await woData('m1')).closedAt).toBeTruthy();

    // The next failed inspection opens a fresh work order.
    await inspect('i3', '2026-09-20', [resp('fail', 'has_issues')]);
    const i3 = await processed('i3');
    expect(i3.workOrderId).not.toBe(woId);
    expect((await woData(i3.workOrderId)).number).toBe(3);
  });

  it('numbers reported issues, applies the rules and flags the gear', async () => {
    await fdb().doc('workOrders/x1').set({ gearId: 'g1', productId: 'p1', title: 'Valve leaks', source: 'issue', severity: 'quarantined', status: 'open', priority: 'normal', assigneeId: null, dueDate: null, autoAssign: true, createdBy: 'staff1' });
    await waitFor(async () => (await woData('x1')).number === 1);
    const wo = await woData('x1');
    expect(wo).toMatchObject({ assigneeId: 'tech', priority: 'urgent' });
    expect(wo.autoAssign).toBeUndefined();
    const g = await gearData();
    expect(g).toMatchObject({ status: 'quarantined', statusSource: 'issue', statusReason: 'WO-0001 issue reported: Valve leaks' });

    // Reopening after closing flags the gear again.
    await fdb().doc('workOrders/x1').update({ status: 'done', resolution: 'Fixed', updatedBy: 'tech' });
    await waitFor(async () => (await gearData()).status === 'active');
    await fdb().doc('workOrders/x1').update({ status: 'open', updatedBy: 'mgr' });
    await waitFor(async () => (await gearData()).status === 'quarantined');
    expect((await woData('x1')).closedAt).toBeNull();
  });
});

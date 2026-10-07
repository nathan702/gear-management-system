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
  for (const c of ['users', 'invites', 'gear', 'qrCodes', 'inspections']) await db.recursiveDelete(db.collection(c));
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

  it('uses the override and restores Active on a clean pass', async () => {
    await inspect('i1', { responses: [resp('fail', 'quarantined')], override: { status: 'has_issues', reason: 'Field patched' } });
    await processed('i1');
    expect((await gearData()).status).toBe('has_issues');

    await inspect('i2', { date: '2026-09-15', responses: [resp('pass', 'quarantined'), resp('fail', 'note')] });
    expect(await processed('i2')).toMatchObject({ statusApplied: 'active', calculatedStatus: 'active' });
    expect((await gearData()).status).toBe('active');
  });

  it('ignores an older inspection that syncs late', async () => {
    await inspect('i1', { date: '2026-09-15', responses: [resp('pass', 'quarantined')] });
    await processed('i1');
    await inspect('i0', { date: '2026-08-01', responses: [resp('fail', 'quarantined')] });
    expect(await processed('i0')).toMatchObject({ statusApplied: null });
    const g = await gearData();
    expect(g.status).toBe('active');
    expect(g.inspectionState.f1.lastInspectionId).toBe('i1');
  });

  it('leaves retired gear retired', async () => {
    await getFirestore(admin).doc('gear/g1').update({ status: 'retired' });
    await inspect('i1', { responses: [resp('fail', 'quarantined')] });
    expect(await processed('i1')).toMatchObject({ statusApplied: null, statusBefore: 'retired' });
    expect((await gearData()).status).toBe('retired');
  });
});

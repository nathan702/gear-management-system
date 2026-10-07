import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { DEFAULT_SETTINGS, type AppSettings, type Invite, type UserProfile } from '@gear/shared';
import { TIME_ZONE } from './config';

const db = () => getFirestore();

function isExpired(expiresAt: Timestamp | null | undefined) {
  return !!expiresAt && expiresAt.toMillis() <= Date.now();
}

/**
 * Called by the app right after sign-in. Creates the user's profile from an
 * invite (any email) or, for verified Google accounts on an auto-join domain
 * (calleva.org), as staff. The very first account on an auto-join domain
 * becomes an admin so a new project can be bootstrapped.
 */
export const activateAccount = onCall(async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  const auth = req.auth;
  const uid = auth.uid;
  const email = String(req.auth.token.email ?? '').toLowerCase();
  if (!email || req.auth.token.email_verified !== true)
    throw new HttpsError('permission-denied', 'Your email address has not been verified.');
  const displayName = String(req.auth.token.name ?? '') || email.split('@')[0];

  const userRef = db().doc(`users/${uid}`);
  const inviteRef = db().doc(`invites/${email}`);
  const settingsRef = db().doc('settings/app');

  return db().runTransaction(async (tx) => {
    const [userSnap, inviteSnap, settingsSnap, anyUser] = await Promise.all([
      tx.get(userRef),
      tx.get(inviteRef),
      tx.get(settingsRef),
      tx.get(db().collection('users').limit(1)),
    ]);
    const now = FieldValue.serverTimestamp();

    if (userSnap.exists) {
      const user = userSnap.data() as UserProfile & { expiresAt: Timestamp | null };
      if (!user.active || isExpired(user.expiresAt))
        throw new HttpsError('permission-denied', 'Your access has ended. Ask an admin to renew it.');
      tx.update(userRef, { lastSignInAt: now, email });
      return { status: 'existing', role: user.role };
    }

    const settings = { ...DEFAULT_SETTINGS, ...(settingsSnap.data() as Partial<AppSettings> | undefined) };
    const domain = email.split('@')[1];
    const base = { email, active: true, lastSignInAt: now, createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid };

    if (inviteSnap.exists) {
      const invite = inviteSnap.data() as Invite & { expiresAt: Timestamp | null };
      if (isExpired(invite.expiresAt))
        throw new HttpsError('permission-denied', 'Your invitation has expired. Ask an admin to renew it.');
      tx.set(userRef, {
        ...base,
        displayName: invite.displayName || displayName,
        role: invite.role,
        expiresAt: invite.expiresAt ?? null,
        homeProgramAreaId: invite.homeProgramAreaId ?? null,
        phone: (invite as { phone?: string }).phone ?? '',
        createdBy: invite.createdBy ?? uid,
      });
      tx.delete(inviteRef);
      return { status: 'created', role: invite.role };
    }

    const isGoogle = auth.token.firebase?.sign_in_provider === 'google.com';
    if (isGoogle && settings.autoJoinDomains.map((d) => d.toLowerCase()).includes(domain)) {
      const role = anyUser.empty ? 'admin' : 'staff';
      tx.set(userRef, { ...base, displayName, role, expiresAt: null, homeProgramAreaId: null });
      return { status: 'created', role };
    }

    throw new HttpsError(
      'permission-denied',
      `${email} hasn't been invited. Ask an admin to invite this address, or sign in with your ${settings.autoJoinDomains[0] ?? 'work'} Google account.`,
    );
  });
});

/** Keeps Firebase Auth's disabled flag in step with the profile's `active`. */
export const syncAuthDisabled = onDocumentWritten('users/{uid}', async (event) => {
  const before = event.data?.before.data() as UserProfile | undefined;
  const after = event.data?.after.data() as UserProfile | undefined;
  if (!after || before?.active === after.active) return;
  try {
    await getAuth().updateUser(event.params.uid, { disabled: !after.active });
  } catch (e) {
    if ((e as { code?: string }).code !== 'auth/user-not-found') throw e;
  }
});

/** Nightly: deactivates accounts whose access has expired. */
export const expireAccounts = onSchedule({ schedule: 'every day 02:00', timeZone: TIME_ZONE }, async () => {
  const snap = await db()
    .collection('users')
    .where('active', '==', true)
    .where('expiresAt', '<=', Timestamp.now())
    .get();
  const batch = db().batch();
  snap.docs.forEach((d) =>
    batch.update(d.ref, { active: false, updatedAt: FieldValue.serverTimestamp(), updatedBy: 'system' }),
  );
  if (!snap.empty) await batch.commit();
});

import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import type { Gear, UsageLog } from '@gear/shared';

/**
 * Adds a usage log's days (and uses) to the gear's running totals, which
 * drive usage-based inspection schedules and the usage reports. Logs are
 * permanent, so totals only ever grow; the processed flag keeps retries from
 * counting twice.
 */
export const onUsageLogged = onDocumentCreated('usageLogs/{logId}', async (event) => {
  const ref = event.data?.ref;
  if (!ref) return;
  const db = getFirestore();
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const log = snap.data() as (UsageLog & { processedAt?: unknown }) | undefined;
    if (!log || log.processedAt) return;
    const gearRef = db.doc(`gear/${log.gearId}`);
    const gearSnap = await tx.get(gearRef);
    if (gearSnap.exists) {
      const gear = gearSnap.data() as Gear;
      const last = gear.stats?.lastUsedDate;
      tx.update(gearRef, {
        'stats.daysUsed': FieldValue.increment(Math.max(0, log.daysUsed)),
        'stats.uses': FieldValue.increment(Math.max(0, log.uses ?? 0)),
        'stats.lastUsedDate': !last || last < log.endDate ? log.endDate : last,
      });
    }
    tx.update(ref, { processedAt: FieldValue.serverTimestamp() });
  });
});

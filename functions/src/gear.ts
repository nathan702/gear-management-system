import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import type { Gear, StatusChange } from '@gear/shared';

/**
 * Records every status change in gear/{id}/statusHistory, using the reason
 * and source the writer put on the gear document. On delete, removes the
 * gear's QR index entry and its history.
 */
export const gearStatusHistory = onDocumentWritten('gear/{gearId}', async (event) => {
  const db = getFirestore();
  const before = event.data?.before.data() as Gear | undefined;
  const after = event.data?.after.data() as Gear | undefined;
  const gearRef = db.doc(`gear/${event.params.gearId}`);

  if (!after) {
    if (before?.qrCode) {
      const qrRef = db.doc(`qrCodes/${before.qrCode}`);
      const qr = await qrRef.get();
      if (qr.exists && qr.get('gearId') === event.params.gearId) await qrRef.delete();
    }
    await db.recursiveDelete(gearRef.collection('statusHistory'));
    return;
  }
  if (before && before.status === after.status) return;

  const entry: Omit<StatusChange, 'at'> & { at: FieldValue } = {
    from: before?.status ?? null,
    to: after.status,
    reason: after.statusReason || (before ? '' : 'Added to inventory'),
    source: after.statusSource ?? (before ? 'manual' : 'created'),
    by: (before ? after.updatedBy : after.createdBy) ?? null,
    at: FieldValue.serverTimestamp(),
  };
  // Event id as doc id makes retries idempotent.
  await gearRef.collection('statusHistory').doc(event.id).set(entry);
});

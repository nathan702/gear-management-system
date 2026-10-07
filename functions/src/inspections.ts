import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { STATUS_LABELS, calculatedStatus, inspectionStatusAfter, type Gear, type GearStatus, type Inspection } from '@gear/shared';

function reasonFor(insp: Inspection, target: GearStatus): string {
  if (insp.override) return `Inspection override (${insp.formName}): ${insp.override.reason}`;
  const failed = insp.responses.filter((r) => r.result === 'fail').map((r) => r.prompt);
  if (!failed.length) return `Passed ${insp.formName}`;
  return `${insp.formName} — ${STATUS_LABELS[target].toLowerCase()}: failed ${failed.join('; ')}`;
}

/**
 * Applies a submitted inspection (which may have been made offline and synced
 * later). Inspections can only make a gear's status worse: the result (the
 * worst failure outcome, or the inspector's override) is applied when it is
 * more severe than the current status. Returning gear to Active is done by
 * closing its work order. Retired gear is left alone. The inspection is
 * recorded as the latest for its form unless a newer one already is.
 */
export const applyInspection = onDocumentCreated('inspections/{inspectionId}', async (event) => {
  const db = getFirestore();
  const inspRef = event.data?.ref;
  if (!inspRef) return;

  await db.runTransaction(async (tx) => {
    const inspSnap = await tx.get(inspRef);
    const insp = inspSnap.data() as Inspection | undefined;
    if (!insp || insp.processedAt) return;
    const gearRef = db.doc(`gear/${insp.gearId}`);
    const gearSnap = await tx.get(gearRef);
    const now = FieldValue.serverTimestamp();
    if (!gearSnap.exists) {
      tx.update(inspRef, { processedAt: now, statusApplied: null });
      return;
    }
    const gear = gearSnap.data() as Gear;
    // Never trust the client's arithmetic.
    const calculated = calculatedStatus(insp.responses);
    const failedCount = insp.responses.filter((r) => r.result === 'fail').length;
    const target = insp.override?.status ?? calculated;
    const previous = gear.inspectionState?.[insp.formId];
    const isLatest = !previous || previous.lastDate <= insp.date;

    const gearUpdate: Record<string, unknown> = {};
    if (isLatest)
      gearUpdate[`inspectionState.${insp.formId}`] = {
        lastDate: insp.date,
        lastInspectionId: inspRef.id,
        failedCount,
        daysUsedAtLast: gear.stats?.daysUsed ?? 0,
      };
    // A problem found by an older inspection that synced late still counts.
    const after: GearStatus = inspectionStatusAfter(gear.status, target);
    if (after !== gear.status)
      Object.assign(gearUpdate, {
        status: after,
        statusReason: reasonFor(insp, after),
        statusSource: 'inspection',
        statusChangedAt: now,
        updatedAt: now,
        updatedBy: insp.inspectorId,
      });
    if (Object.keys(gearUpdate).length) tx.update(gearRef, gearUpdate);
    tx.update(inspRef, { calculatedStatus: calculated, failedCount, statusBefore: gear.status, statusApplied: after, processedAt: now });
  });
});

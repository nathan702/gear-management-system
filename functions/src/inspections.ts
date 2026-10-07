import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { STATUS_LABELS, calculatedStatus, type Gear, type GearStatus, type Inspection } from '@gear/shared';

function reasonFor(insp: Inspection, target: GearStatus): string {
  if (insp.override) return `Inspection override (${insp.formName}): ${insp.override.reason}`;
  const failed = insp.responses.filter((r) => r.result === 'fail').map((r) => r.prompt);
  if (!failed.length) return `Passed ${insp.formName}`;
  return `${insp.formName} — ${STATUS_LABELS[target].toLowerCase()}: failed ${failed.join('; ')}`;
}

/**
 * Applies a submitted inspection (which may have been made offline and synced
 * later): records it as the gear's latest inspection for that form and sets
 * the gear's status to the override, or the worst failure outcome. An
 * inspection older than one already recorded for the same form doesn't
 * change anything. Retired gear keeps its status.
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
    let applied: GearStatus | null = null;
    if (isLatest) {
      gearUpdate[`inspectionState.${insp.formId}`] = {
        lastDate: insp.date,
        lastInspectionId: inspRef.id,
        failedCount,
        daysUsedAtLast: gear.stats?.daysUsed ?? 0,
      };
      if (gear.status !== 'retired') {
        applied = target;
        if (target !== gear.status)
          Object.assign(gearUpdate, {
            status: target,
            statusReason: reasonFor(insp, target),
            statusSource: 'inspection',
            statusChangedAt: now,
            updatedAt: now,
            updatedBy: insp.inspectorId,
          });
      }
      tx.update(gearRef, gearUpdate);
    }
    tx.update(inspRef, { calculatedStatus: calculated, failedCount, statusBefore: gear.status, statusApplied: applied, processedAt: now });
  });
});

import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import {
  STATUS_LABELS,
  calculatedStatus,
  inspectionStatusAfter,
  isOpen,
  worseSeverity,
  type FailureOutcome,
  type Gear,
  type GearStatus,
  type Inspection,
  type WorkOrder,
} from '@gear/shared';
import { addLog, claimNumber, readWorkOrderContext, ruleFor } from './workOrders';

const STATUS_SEVERITY_OUTCOME: Record<GearStatus, FailureOutcome> = { active: 'note', has_issues: 'has_issues', quarantined: 'quarantined', retired: 'quarantined' };

function failureLines(insp: Inspection) {
  return insp.responses
    .filter((r) => r.result === 'fail')
    .map((r) => `• ${r.prompt}${r.value != null && r.value !== '' ? ` (${r.value}${r.unit ? ` ${r.unit}` : ''})` : ''}${r.comment ? ` — ${r.comment}` : ''}`)
    .join('\n');
}

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
 *
 * Any failed item (even "note only") opens a work order — or, if the gear
 * already has an open inspection work order, is added to that one.
 */
export const applyInspection = onDocumentCreated('inspections/{inspectionId}', async (event) => {
  const db = getFirestore();
  const inspRef = event.data?.ref;
  if (!inspRef) return;

  await db.runTransaction(async (tx) => {
    // ---- reads
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

    const needsWorkOrder = failedCount > 0 && gear.status !== 'retired';
    let openWo: { ref: FirebaseFirestore.DocumentReference; data: WorkOrder } | null = null;
    if (needsWorkOrder && gear.openInspectionWorkOrderId) {
      const ref = db.doc(`workOrders/${gear.openInspectionWorkOrderId}`);
      const snap = await tx.get(ref);
      const data = snap.data() as WorkOrder | undefined;
      if (data && isOpen(data.status)) openWo = { ref, data };
    }
    const ctx = needsWorkOrder && !openWo ? await readWorkOrderContext(tx, gear) : null;

    // ---- writes
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

    let workOrderId: string | null = null;
    if (needsWorkOrder) {
      const severity = STATUS_SEVERITY_OUTCOME[target];
      const logText = `${insp.formName} on ${insp.date}: ${failedCount} failed\n${failureLines(insp)}`;
      if (openWo) {
        workOrderId = openWo.ref.id;
        tx.update(openWo.ref, {
          severity: worseSeverity(openWo.data.severity, severity),
          inspectionIds: FieldValue.arrayUnion(inspRef.id),
          updatedAt: now,
          updatedBy: insp.inspectorId,
        });
        addLog(tx, openWo.ref, { type: 'inspection', text: logText, by: insp.inspectorId, inspectionId: inspRef.id }, `insp-${inspRef.id}`);
      } else {
        const ref = db.collection('workOrders').doc();
        workOrderId = ref.id;
        const rule = ruleFor(ctx!, gear, severity);
        tx.set(ref, {
          number: claimNumber(tx, ctx!),
          gearId: insp.gearId,
          productId: gear.productId ?? null,
          title: `Failed ${insp.formName}`,
          description: failureLines(insp),
          source: 'inspection',
          severity,
          status: 'open',
          priority: rule.priority,
          assigneeId: rule.assigneeId,
          dueDate: rule.dueDate,
          inspectionIds: [inspRef.id],
          createdAt: now,
          createdBy: insp.inspectorId,
          updatedAt: now,
          updatedBy: insp.inspectorId,
        });
        addLog(tx, ref, { type: 'created', text: `Opened by a failed inspection${rule.ruleName ? ` (rule: ${rule.ruleName})` : ''}`, by: insp.inspectorId }, 'created');
        addLog(tx, ref, { type: 'inspection', text: logText, by: insp.inspectorId, inspectionId: inspRef.id }, `insp-${inspRef.id}`);
        gearUpdate.openInspectionWorkOrderId = ref.id;
      }
    }

    if (Object.keys(gearUpdate).length) tx.update(gearRef, gearUpdate);
    tx.update(inspRef, {
      calculatedStatus: calculated,
      failedCount,
      statusBefore: gear.status,
      statusApplied: after,
      workOrderId,
      processedAt: now,
    });
  });
});

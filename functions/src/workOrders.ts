import { FieldValue, getFirestore, type DocumentReference, type Transaction } from 'firebase-admin/firestore';
import { onDocumentCreated, onDocumentUpdated } from 'firebase-functions/v2/firestore';
import {
  OPEN_WORK_ORDER_STATUSES,
  STATUS_LABELS,
  WORK_ORDER_STATUS_LABELS,
  applyWorkOrderRules,
  gearStatusAfterClosing,
  inspectionStatusAfter,
  isOpen,
  severityStatus,
  workOrderNumber,
  type FailureOutcome,
  type Gear,
  type Product,
  type WorkOrder,
  type WorkOrderLogEntry,
  type WorkOrderRule,
} from '@gear/shared';
import { TIME_ZONE } from './config';

const db = () => getFirestore();
const now = () => FieldValue.serverTimestamp();

/** Today in Calleva's time zone, for due dates. */
export function localToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

export interface WorkOrderContext {
  counter: number;
  rules: WorkOrderRule[];
  product: Product | undefined;
}

/** Reads everything needed to number and auto-assign a work order. Call before any transaction writes. */
export async function readWorkOrderContext(tx: Transaction, gear: Gear): Promise<WorkOrderContext> {
  const [counterSnap, rulesSnap, productSnap] = await Promise.all([
    tx.get(db().doc('counters/workOrders')),
    tx.get(db().collection('workOrderRules')),
    gear.productId ? tx.get(db().doc(`products/${gear.productId}`)) : Promise.resolve(null),
  ]);
  return {
    counter: (counterSnap.get('next') as number | undefined) ?? 1,
    rules: rulesSnap.docs.map((d) => d.data() as WorkOrderRule),
    product: productSnap?.exists ? (productSnap.data() as Product) : undefined,
  };
}

/** Claims the next work order number (writes the counter). */
export function claimNumber(tx: Transaction, ctx: WorkOrderContext): number {
  const n = ctx.counter;
  ctx.counter++;
  tx.set(db().doc('counters/workOrders'), { next: ctx.counter }, { merge: true });
  return n;
}

export function ruleFor(ctx: WorkOrderContext, gear: Gear, severity: FailureOutcome) {
  return applyWorkOrderRules(
    ctx.rules,
    { severity, programAreaId: gear.programAreaId, categoryId: ctx.product?.categoryId, locationId: gear.locationId },
    localToday(),
  );
}

export function addLog(tx: Transaction, woRef: DocumentReference, entry: Omit<WorkOrderLogEntry, 'at'>, id?: string) {
  const ref = id ? woRef.collection('log').doc(id) : woRef.collection('log').doc();
  tx.set(ref, { ...entry, at: now() });
}

/**
 * Work orders created in the app (issue reports and manual ones): assigns a
 * number, fills assignee/due/priority from the rules when asked, logs the
 * creation, and makes the gear's status reflect the problem (never better).
 * Inspection work orders are created complete by applyInspection.
 */
export const onWorkOrderCreated = onDocumentCreated('workOrders/{woId}', async (event) => {
  const woRef = event.data?.ref;
  if (!woRef) return;
  await db().runTransaction(async (tx) => {
    const woSnap = await tx.get(woRef);
    const wo = woSnap.data() as WorkOrder | undefined;
    if (!wo || wo.number) return;
    const gearRef = db().doc(`gear/${wo.gearId}`);
    const gearSnap = await tx.get(gearRef);
    const gear = gearSnap.data() as Gear | undefined;
    const ctx = gear ? await readWorkOrderContext(tx, gear) : null;

    const number = ctx ? claimNumber(tx, ctx) : null;
    const update: Record<string, unknown> = { number, autoAssign: FieldValue.delete() };
    if (gear && ctx && wo.autoAssign) {
      const r = ruleFor(ctx, gear, wo.severity);
      if (!wo.assigneeId && r.assigneeId) update.assigneeId = r.assigneeId;
      if (!wo.dueDate && r.dueDate) update.dueDate = r.dueDate;
      update.priority = r.priority;
    }
    tx.update(woRef, update);
    addLog(tx, woRef, { type: 'created', text: wo.source === 'issue' ? `Issue reported: ${wo.title}` : `Created: ${wo.title}`, by: wo.createdBy ?? null }, 'created');

    if (gear) {
      const after = inspectionStatusAfter(gear.status, severityStatus(wo.severity));
      if (after !== gear.status)
        tx.update(gearRef, {
          status: after,
          statusReason: `${workOrderNumber(number)} ${wo.source === 'issue' ? 'issue reported' : 'opened'}: ${wo.title}`,
          statusSource: wo.source === 'issue' ? 'issue' : 'work_order',
          statusChangedAt: now(),
          updatedAt: now(),
          updatedBy: wo.createdBy ?? 'system',
        });
    }
  });
});

/**
 * Logs status, assignment and due-date changes, and keeps the gear in step:
 * closing (done or cancelled) sets the gear to the worst severity among its
 * other open work orders, or back to Active when none remain — the only way
 * gear returns to Active. Reopening, or raising the severity of an open work
 * order, makes the gear's status worse again if needed.
 */
export const onWorkOrderUpdated = onDocumentUpdated('workOrders/{woId}', async (event) => {
  const before = event.data?.before.data() as WorkOrder | undefined;
  const after = event.data?.after.data() as WorkOrder | undefined;
  const woRef = event.data?.after.ref;
  if (!before || !after || !woRef) return;
  const by = after.updatedBy ?? null;
  const wasOpen = isOpen(before.status);
  const nowOpen = isOpen(after.status);
  const closing = wasOpen && !nowOpen;
  const reopening = !wasOpen && nowOpen;
  const severityUp = nowOpen && severityStatus(after.severity) !== severityStatus(before.severity);

  await db().runTransaction(async (tx) => {
    const gearRef = db().doc(`gear/${after.gearId}`);
    const gearSnap = closing || reopening || severityUp ? await tx.get(gearRef) : null;
    const gear = gearSnap?.data() as Gear | undefined;
    const others = closing
      ? await tx.get(db().collection('workOrders').where('gearId', '==', after.gearId).where('status', 'in', [...OPEN_WORK_ORDER_STATUSES]))
      : null;
    const assigneeName =
      before.assigneeId !== after.assigneeId && after.assigneeId
        ? ((await tx.get(db().doc(`users/${after.assigneeId}`))).get('displayName') as string | undefined)
        : null;

    // Log entries use the event id so retries don't duplicate them.
    if (before.status !== after.status)
      addLog(
        tx,
        woRef,
        {
          type: 'status',
          text:
            `${WORK_ORDER_STATUS_LABELS[before.status]} → ${WORK_ORDER_STATUS_LABELS[after.status]}` +
            (closing && after.resolution ? ` — ${after.resolution}` : ''),
          by,
        },
        `${event.id}-status`,
      );
    if (before.assigneeId !== after.assigneeId)
      addLog(tx, woRef, { type: 'assigned', text: after.assigneeId ? `Assigned to ${assigneeName ?? 'someone'}` : 'Unassigned', by }, `${event.id}-assigned`);
    if (before.dueDate !== after.dueDate)
      addLog(tx, woRef, { type: 'due', text: after.dueDate ? `Due ${after.dueDate}` : 'Due date removed', by }, `${event.id}-due`);

    if (closing) {
      const woUpdate: Record<string, unknown> = { closedBy: by };
      if (!after.closedAt) woUpdate.closedAt = now();
      if (gear) {
        const otherSeverities = others!.docs.filter((d) => d.id !== woRef.id).map((d) => (d.data() as WorkOrder).severity);
        const status = gearStatusAfterClosing(gear.status, otherSeverities);
        woUpdate.gearStatusAfterClose = status;
        const gearUpdate: Record<string, unknown> = {};
        if (gear.openInspectionWorkOrderId === woRef.id) gearUpdate.openInspectionWorkOrderId = null;
        if (status !== gear.status)
          Object.assign(gearUpdate, {
            status,
            statusReason: `${workOrderNumber(after.number)} ${after.status === 'done' ? 'completed' : 'cancelled'}${after.resolution ? `: ${after.resolution}` : ''}`,
            statusSource: 'work_order',
            statusChangedAt: now(),
            updatedAt: now(),
            updatedBy: by ?? 'system',
          });
        if (Object.keys(gearUpdate).length) tx.update(gearRef, gearUpdate);
      }
      tx.update(woRef, woUpdate);
    } else if ((reopening || severityUp) && gear) {
      if (reopening) tx.update(woRef, { closedAt: null, closedBy: null, gearStatusAfterClose: null });
      const gearUpdate: Record<string, unknown> = {};
      if (reopening && after.source === 'inspection' && !gear.openInspectionWorkOrderId) gearUpdate.openInspectionWorkOrderId = woRef.id;
      const status = inspectionStatusAfter(gear.status, severityStatus(after.severity));
      if (status !== gear.status)
        Object.assign(gearUpdate, {
          status,
          statusReason: `${workOrderNumber(after.number)} ${reopening ? 'reopened' : `now ${STATUS_LABELS[status].toLowerCase()}`}: ${after.title}`,
          statusSource: 'work_order',
          statusChangedAt: now(),
          updatedAt: now(),
          updatedBy: by ?? 'system',
        });
      if (Object.keys(gearUpdate).length) tx.update(gearRef, gearUpdate);
    }
  });
});

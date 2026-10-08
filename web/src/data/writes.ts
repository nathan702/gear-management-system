import {
  collection,
  deleteDoc,
  doc,
  serverTimestamp,
  writeBatch,
  type WriteBatch,
} from 'firebase/firestore';
import {
  generateQrCode,
  type Gear,
  type GearStatus,
  type Inspection,
  type InspectionAssignment,
  type InspectionForm,
  type Product,
  type WorkOrder,
  type WorkOrderRule,
  type GearList,
  type Kit,
  type Checkout,
  type StatusChangeSource,
} from '@gear/shared';
import { db } from '../firebase';
import { notify } from '../components/toast';

export type RefCollection = 'programAreas' | 'locations' | 'categories' | 'manufacturers';

export const createStamp = (uid: string) => ({
  createdAt: serverTimestamp(),
  createdBy: uid,
  updatedAt: serverTimestamp(),
  updatedBy: uid,
});
export const updateStamp = (uid: string) => ({ updatedAt: serverTimestamp(), updatedBy: uid });

/** Drops undefined values, which Firestore rejects. */
export function clean<T extends Record<string, unknown>>(data: T): T {
  return Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined)) as T;
}

/**
 * Commits a batch. Offline, Firestore applies the write locally right away but
 * the promise only settles once the server acknowledges it, so we don't wait:
 * the change is visible immediately and syncs later. A rejection (e.g. a
 * rules failure after reconnecting) is still reported.
 */
export async function commit(batch: WriteBatch, what = 'Change'): Promise<void> {
  const p = batch.commit().catch((e: Error) => {
    notify(`${what} could not be saved: ${e.message}`, 'error');
    throw e;
  });
  if (navigator.onLine) return p;
  p.catch(() => {});
  notify(`${what} saved on this device — it will sync when you're back online.`);
}

export async function saveReference(
  uid: string,
  kind: RefCollection,
  id: string | null,
  data: Record<string, unknown>,
): Promise<string> {
  const ref = id ? doc(db, kind, id) : doc(collection(db, kind));
  const batch = writeBatch(db);
  batch.set(ref, clean({ ...data, ...(id ? updateStamp(uid) : createStamp(uid)) }), { merge: true });
  await commit(batch);
  return ref.id;
}

export async function deleteDocument(kind: string, id: string) {
  const p = deleteDoc(doc(db, kind, id));
  if (navigator.onLine) await p;
}

export async function saveProduct(uid: string, id: string | null, data: Partial<Product>): Promise<string> {
  const ref = id ? doc(db, 'products', id) : doc(collection(db, 'products'));
  const batch = writeBatch(db);
  batch.set(
    ref,
    clean({ inspectionSchedules: id ? undefined : [], ...data, ...(id ? updateStamp(uid) : createStamp(uid)) }),
    { merge: true },
  );
  await commit(batch, 'Product');
  return ref.id;
}

export type GearInput = Omit<Gear, 'status' | 'statusReason' | 'statusSource' | 'createdAt' | 'createdBy' | 'updatedAt' | 'updatedBy'> & {
  status?: GearStatus;
};

/** Adds gear writes to a batch, claiming its QR code in /qrCodes. */
export function batchCreateGear(batch: WriteBatch, uid: string, input: GearInput, source: StatusChangeSource = 'created') {
  const ref = doc(collection(db, 'gear'));
  const qrCode = input.qrCode || generateQrCode();
  batch.set(
    ref,
    clean({
      ...input,
      qrCode,
      status: input.status ?? 'active',
      statusReason: source === 'import' ? 'Imported from file' : 'Added to inventory',
      statusSource: source,
      statusChangedAt: serverTimestamp(),
      ...createStamp(uid),
    }),
  );
  batch.set(doc(db, 'qrCodes', qrCode), { gearId: ref.id });
  return ref.id;
}

/** Adds an update to a batch, moving the QR claim if the code changed. */
export function batchUpdateGear(
  batch: WriteBatch,
  uid: string,
  id: string,
  before: Gear,
  changes: Partial<Gear>,
  statusChange?: { reason: string; source: StatusChangeSource },
) {
  const data: Record<string, unknown> = { ...changes, ...updateStamp(uid) };
  if (changes.status && changes.status !== before.status) {
    if (!statusChange?.reason) throw new Error('A reason is required to change status.');
    data.statusReason = statusChange.reason;
    data.statusSource = statusChange.source;
    data.statusChangedAt = serverTimestamp();
  }
  if (changes.qrCode && changes.qrCode !== before.qrCode) {
    batch.set(doc(db, 'qrCodes', changes.qrCode), { gearId: id });
    batch.delete(doc(db, 'qrCodes', before.qrCode));
  }
  batch.update(doc(db, 'gear', id), clean(data));
}

export async function createGear(uid: string, input: GearInput): Promise<string> {
  const batch = writeBatch(db);
  const id = batchCreateGear(batch, uid, input);
  await commit(batch, 'Gear');
  return id;
}

export async function updateGear(
  uid: string,
  id: string,
  before: Gear,
  changes: Partial<Gear>,
  statusChange?: { reason: string; source: StatusChangeSource },
) {
  const batch = writeBatch(db);
  batchUpdateGear(batch, uid, id, before, changes, statusChange);
  await commit(batch, 'Gear');
}

export async function deleteGear(id: string, qrCode: string) {
  const batch = writeBatch(db);
  batch.delete(doc(db, 'gear', id));
  batch.delete(doc(db, 'qrCodes', qrCode));
  await commit(batch, 'Delete');
}

/* ------------------------------------------------------------ inspections */

export async function saveInspectionForm(
  uid: string,
  id: string | null,
  before: InspectionForm | undefined,
  data: Pick<InspectionForm, 'name' | 'description' | 'items' | 'active'>,
): Promise<string> {
  const ref = id ? doc(db, 'inspectionForms', id) : doc(collection(db, 'inspectionForms'));
  const batch = writeBatch(db);
  if (id && before) batch.update(ref, clean({ ...data, version: before.version + 1, ...updateStamp(uid) }));
  else batch.set(ref, clean({ ...data, version: 1, ...createStamp(uid) }));
  await commit(batch, 'Form');
  return ref.id;
}

/** Inspections are written once (offline is fine); a function applies the result. */
export async function submitInspection(uid: string, id: string, data: Omit<Inspection, 'createdAt' | 'createdBy' | 'updatedAt' | 'updatedBy'>) {
  const batch = writeBatch(db);
  batch.set(doc(db, 'inspections', id), clean({ ...data, ...createStamp(uid) }));
  await commit(batch, 'Inspection');
}

export async function saveAssignment(uid: string, existing: (InspectionAssignment & { id: string }) | undefined, data: Pick<InspectionAssignment, 'scope' | 'refId' | 'userIds'>) {
  const batch = writeBatch(db);
  if (existing && !data.userIds.length) batch.delete(doc(db, 'inspectionAssignments', existing.id));
  else if (existing) batch.update(doc(db, 'inspectionAssignments', existing.id), { userIds: data.userIds, ...updateStamp(uid) });
  else if (data.userIds.length) batch.set(doc(collection(db, 'inspectionAssignments')), { ...data, ...createStamp(uid) });
  await commit(batch, 'Assignment');
}

/* ------------------------------------------------------------ work orders */

export type NewWorkOrder = Pick<WorkOrder, 'gearId' | 'productId' | 'title' | 'description' | 'severity' | 'priority' | 'assigneeId' | 'dueDate'> & {
  source: 'issue' | 'manual';
  /** Let the server fill assignee, due date and priority from the rules. */
  autoAssign?: boolean;
};

/** Works offline; a function numbers it and updates the gear's status. */
export async function createWorkOrder(uid: string, id: string, data: NewWorkOrder) {
  const batch = writeBatch(db);
  batch.set(doc(db, 'workOrders', id), clean({ ...data, status: 'open', ...createStamp(uid) }));
  await commit(batch, 'Work order');
}

export async function updateWorkOrder(uid: string, id: string, changes: Partial<WorkOrder>) {
  const batch = writeBatch(db);
  batch.update(doc(db, 'workOrders', id), clean({ ...changes, ...updateStamp(uid) }));
  await commit(batch, 'Work order');
}

export async function addWorkOrderComment(uid: string, workOrderId: string, text: string) {
  const batch = writeBatch(db);
  batch.set(doc(collection(db, 'workOrders', workOrderId, 'log')), { type: 'comment', text, by: uid, at: serverTimestamp() });
  await commit(batch, 'Comment');
}

export async function saveWorkOrderRule(uid: string, id: string | null, data: Omit<WorkOrderRule, 'createdAt' | 'createdBy' | 'updatedAt' | 'updatedBy'>) {
  const ref = id ? doc(db, 'workOrderRules', id) : doc(collection(db, 'workOrderRules'));
  const batch = writeBatch(db);
  batch.set(ref, clean({ ...data, ...(id ? updateStamp(uid) : createStamp(uid)) }), { merge: true });
  await commit(batch, 'Rule');
}

/* ---------------------------------------------------- lists, kits, usage */

export async function saveList(uid: string, id: string | null, data: Omit<GearList, 'createdAt' | 'createdBy' | 'updatedAt' | 'updatedBy'>) {
  const ref = id ? doc(db, 'lists', id) : doc(collection(db, 'lists'));
  const batch = writeBatch(db);
  batch.set(ref, clean({ ...data, ...(id ? updateStamp(uid) : createStamp(uid)) }), { merge: true });
  await commit(batch, 'List');
  return ref.id;
}

export async function saveKit(uid: string, id: string | null, data: Partial<Kit>) {
  const ref = id ? doc(db, 'kits', id) : doc(collection(db, 'kits'));
  const batch = writeBatch(db);
  if (id) batch.update(ref, clean({ ...data, ...updateStamp(uid) }));
  else batch.set(ref, clean({ status: 'planned', gearIds: [], ...data, ...createStamp(uid) }));
  await commit(batch, 'Kit');
  return ref.id;
}

export interface UsageEntry {
  gearId: string;
  daysUsed: number;
  uses?: number | null;
}

function addUsage(batch: WriteBatch, uid: string, userId: string, entries: UsageEntry[], range: { startDate: string; endDate: string }, link: { kitId?: string; checkoutId?: string }) {
  for (const e of entries)
    batch.set(doc(collection(db, 'usageLogs')), clean({ ...e, userId, ...range, kitId: link.kitId ?? null, checkoutId: link.checkoutId ?? null, ...createStamp(uid) }));
}

/** Returns a kit, logging the days each item was actually used. Works offline. */
export async function returnKit(uid: string, kit: Kit & { id: string }, returnedDate: string, entries: UsageEntry[]) {
  const batch = writeBatch(db);
  batch.update(doc(db, 'kits', kit.id), { status: 'returned', returnedAt: serverTimestamp(), returnedDate, ...updateStamp(uid) });
  addUsage(batch, uid, kit.ownerId, entries, { startDate: kit.checkedOutDate || kit.startDate || returnedDate, endDate: returnedDate }, { kitId: kit.id });
  await commit(batch, 'Return');
}

export async function checkOutGear(uid: string, userId: string, gearId: string, startDate: string, dueBackDate: string | null, notes: string) {
  const ref = doc(collection(db, 'checkouts'));
  const batch = writeBatch(db);
  batch.set(ref, clean({ gearId, userId, startDate, dueBackDate, notes, status: 'out', ...createStamp(uid) }));
  await commit(batch, 'Check-out');
  return ref.id;
}

export async function returnGear(uid: string, co: Checkout & { id: string }, returnedDate: string, daysUsed: number, uses: number | null) {
  const batch = writeBatch(db);
  batch.update(doc(db, 'checkouts', co.id), { status: 'returned', returnedDate, ...updateStamp(uid) });
  addUsage(batch, uid, co.userId, [{ gearId: co.gearId, daysUsed, uses }], { startDate: co.startDate, endDate: returnedDate }, { checkoutId: co.id });
  await commit(batch, 'Return');
}

/** Logs use that didn't go through a kit or check-out (e.g. a day trip). */
export async function logUsage(uid: string, gearId: string, startDate: string, endDate: string, daysUsed: number, uses: number | null, notes: string) {
  const batch = writeBatch(db);
  batch.set(doc(collection(db, 'usageLogs')), clean({ gearId, userId: uid, startDate, endDate, daysUsed, uses, notes, kitId: null, checkoutId: null, ...createStamp(uid) }));
  await commit(batch, 'Usage');
}

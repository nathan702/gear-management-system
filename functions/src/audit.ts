import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';

const IGNORED = new Set(['updatedAt', 'updatedBy', 'lastSignInAt']);

function changedFields(before: Record<string, unknown> | undefined, after: Record<string, unknown> | undefined) {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  return [...keys]
    .filter((k) => !IGNORED.has(k))
    .filter((k) => JSON.stringify(before?.[k]) !== JSON.stringify(after?.[k]))
    .sort();
}

function auditTrigger(collection: string) {
  return onDocumentWritten(`${collection}/{docId}`, async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    const fields = changedFields(before, after);
    const action = !before ? 'create' : !after ? 'delete' : 'update';
    if (action === 'update' && fields.length === 0) return;
    await getFirestore()
      .collection('auditLog')
      .doc(event.id)
      .set({
        collection,
        docId: event.params.docId,
        action,
        by: (after?.updatedBy as string | undefined) ?? (action === 'delete' ? null : (before?.updatedBy ?? null)),
        at: FieldValue.serverTimestamp(),
        changedFields: fields,
      });
  });
}

export const auditGear = auditTrigger('gear');
export const auditProducts = auditTrigger('products');
export const auditUsers = auditTrigger('users');
export const auditInvites = auditTrigger('invites');
export const auditSettings = auditTrigger('settings');
export const auditProgramAreas = auditTrigger('programAreas');
export const auditLocations = auditTrigger('locations');
export const auditCategories = auditTrigger('categories');
export const auditManufacturers = auditTrigger('manufacturers');
export const auditInspectionForms = auditTrigger('inspectionForms');
export const auditInspectionAssignments = auditTrigger('inspectionAssignments');
export const auditWorkOrderRules = auditTrigger('workOrderRules');

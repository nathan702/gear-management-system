import { initializeApp } from 'firebase-admin/app';
import { setGlobalOptions } from 'firebase-functions/v2';

initializeApp();

// Firestore should be created in the nam5 (US multi-region) location so these
// triggers can run in us-central1.
setGlobalOptions({ region: 'us-central1', maxInstances: 10 });

export { activateAccount, syncAuthDisabled, expireAccounts } from './accounts';
export { gearStatusHistory } from './gear';
export { deletePhotoFiles } from './photos';
export { applyInspection } from './inspections';
export * from './audit';

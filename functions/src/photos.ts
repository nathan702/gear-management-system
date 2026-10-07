import { getStorage } from 'firebase-admin/storage';
import { onDocumentDeleted } from 'firebase-functions/v2/firestore';

/** Removes the image files when a photo record is deleted. */
export const deletePhotoFiles = onDocumentDeleted('photos/{photoId}', async (event) => {
  await getStorage()
    .bucket()
    .deleteFiles({ prefix: `photos/${event.params.photoId}/` })
    .catch((e) => console.warn('photo cleanup', e));
});

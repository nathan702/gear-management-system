/**
 * Offline-friendly photo pipeline.
 *
 * 1. The photo is resized on the device (full ≤ 2000px, thumb ≤ 400px).
 * 2. Both images go into IndexedDB and the /photos doc is written with
 *    `uploaded: false` — this works offline, and the photo shows at once.
 * 3. A background loop uploads queued images to Cloud Storage when online
 *    (after the photo doc has synced, which the Storage rules require) and
 *    flips `uploaded` to true.
 */
import { useEffect, useSyncExternalStore } from 'react';
import { collection, doc, serverTimestamp, setDoc, updateDoc, waitForPendingWrites } from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { createStore, del, get, keys, set } from 'idb-keyval';
import type { Photo } from '@gear/shared';
import { db, storage } from '../firebase';
import { createStamp } from '../data/writes';
import { notify } from '../components/toast';

const store = createStore('gear-photos', 'blobs');
const FULL_MAX = 2000;
const THUMB_MAX = 400;

async function resize(file: Blob, max: number, quality: number): Promise<{ blob: Blob; width: number; height: number }> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode image'))), 'image/jpeg', quality),
  );
  return { blob, width, height };
}

/* ---------------------------------------------------------- queue count */

let queued = 0;
const listeners = new Set<() => void>();
function setQueued(n: number) {
  queued = n;
  listeners.forEach((l) => l());
}
async function refreshCount() {
  const k = await keys(store);
  setQueued(k.filter((key) => String(key).startsWith('pending:')).length);
}

export function usePhotoQueueCount() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => queued,
  );
}

/* ------------------------------------------------------------- add photo */

export interface PhotoLinks {
  gearId: string | null;
  inspectionId?: string | null;
  inspectionItemId?: string | null;
  workOrderId?: string | null;
}

export async function addPhotos(uid: string, files: FileList | File[], links: PhotoLinks, caption = '') {
  for (const file of Array.from(files)) {
    if (!file.type.startsWith('image/')) continue;
    const id = doc(collection(db, 'photos')).id;
    const [full, thumb] = await Promise.all([resize(file, FULL_MAX, 0.85), resize(file, THUMB_MAX, 0.75)]);
    await set(`full:${id}`, full.blob, store);
    await set(`thumb:${id}`, thumb.blob, store);
    await set(`pending:${id}`, Date.now(), store);
    const data: Omit<Photo, 'createdAt' | 'updatedAt'> & Record<string, unknown> = {
      gearId: links.gearId,
      inspectionId: links.inspectionId ?? null,
      inspectionItemId: links.inspectionItemId ?? null,
      workOrderId: links.workOrderId ?? null,
      storagePath: `photos/${id}/full.jpg`,
      thumbPath: `photos/${id}/thumb.jpg`,
      caption,
      width: full.width,
      height: full.height,
      uploaded: false,
      uploadedBy: uid,
      takenAt: serverTimestamp() as never,
      ...createStamp(uid),
    };
    // Not awaited: offline, this resolves only once synced.
    setDoc(doc(db, 'photos', id), data).catch((e) => notify(`Photo could not be saved: ${e.message}`, 'error'));
  }
  await refreshCount();
  void processQueue(uid);
}

/* ---------------------------------------------------------------- upload */

let running = false;

export async function processQueue(uid: string) {
  if (running || !navigator.onLine) return;
  running = true;
  try {
    const pending = (await keys(store)).map(String).filter((k) => k.startsWith('pending:'));
    if (pending.length) await waitForPendingWrites(db);
    for (const key of pending) {
      const id = key.slice('pending:'.length);
      const [full, thumb] = await Promise.all([get<Blob>(`full:${id}`, store), get<Blob>(`thumb:${id}`, store)]);
      try {
        if (full) await uploadBytes(ref(storage, `photos/${id}/full.jpg`), full, { contentType: 'image/jpeg' });
        if (thumb) await uploadBytes(ref(storage, `photos/${id}/thumb.jpg`), thumb, { contentType: 'image/jpeg' });
        await updateDoc(doc(db, 'photos', id), { uploaded: true, updatedAt: serverTimestamp(), updatedBy: uid });
        await del(key, store);
        // Keep the local thumb for fast display; drop the large original.
        await del(`full:${id}`, store);
      } catch (e) {
        const code = (e as { code?: string }).code;
        // The photo doc was deleted or we lost access: give up on this one.
        if (code === 'storage/unauthorized' || code === 'not-found') {
          await del(key, store);
          await del(`full:${id}`, store);
        } else {
          console.warn('photo upload failed, will retry', e);
          break;
        }
      }
      await refreshCount();
    }
  } finally {
    running = false;
    await refreshCount();
  }
}

/** Runs the upload loop at start-up, on reconnect and every minute. */
export function usePhotoUploader(uid: string | null) {
  useEffect(() => {
    if (!uid) return;
    void refreshCount();
    void processQueue(uid);
    const onOnline = () => void processQueue(uid);
    window.addEventListener('online', onOnline);
    const timer = setInterval(onOnline, 60_000);
    return () => {
      window.removeEventListener('online', onOnline);
      clearInterval(timer);
    };
  }, [uid]);
}

/* --------------------------------------------------------------- display */

const urlCache = new Map<string, Promise<string | null>>();

/** Local blob first (works offline and before upload), then Cloud Storage. */
export function photoUrl(photo: Photo & { id: string }, size: 'thumb' | 'full'): Promise<string | null> {
  const key = `${photo.id}:${size}:${photo.uploaded}`;
  if (!urlCache.has(key)) {
    urlCache.set(
      key,
      (async () => {
        const local = (await get<Blob>(`${size}:${photo.id}`, store)) ?? (size === 'full' ? await get<Blob>(`thumb:${photo.id}`, store) : undefined);
        if (local && (size === 'thumb' || !photo.uploaded)) return URL.createObjectURL(local);
        if (!photo.uploaded) return local ? URL.createObjectURL(local) : null;
        try {
          return await getDownloadURL(ref(storage, size === 'full' ? photo.storagePath : photo.thumbPath));
        } catch {
          urlCache.delete(key);
          return local ? URL.createObjectURL(local) : null;
        }
      })(),
    );
  }
  return urlCache.get(key)!;
}

export function forgetPhotoUrl(photoId: string) {
  for (const key of urlCache.keys()) if (key.startsWith(`${photoId}:`)) urlCache.delete(key);
}

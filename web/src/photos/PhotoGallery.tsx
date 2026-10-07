import { useEffect, useRef, useState } from 'react';
import { collection, deleteDoc, doc, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { Camera, CloudUpload, ImageOff, Trash2 } from 'lucide-react';
import type { Photo, WithId } from '@gear/shared';
import { db } from '../firebase';
import { useMe } from '../auth/AuthProvider';
import { useData } from '../data/DataProvider';
import { Button, Modal } from '../components/ui';
import { fmtTimestamp } from '../lib/format';
import { addPhotos, forgetPhotoUrl, photoUrl, type PhotoLinks } from './photoQueue';

type PhotoDoc = Photo & WithId;

export function usePhotos(field: 'gearId' | 'inspectionId' | 'workOrderId', id: string | null | undefined) {
  const [photos, setPhotos] = useState<PhotoDoc[]>([]);
  useEffect(() => {
    if (!id) return;
    return onSnapshot(
      query(collection(db, 'photos'), where(field, '==', id), orderBy('createdAt', 'desc')),
      { includeMetadataChanges: false },
      (snap) => setPhotos(snap.docs.map((d) => ({ id: d.id, ...(d.data({ serverTimestamps: 'estimate' }) as Photo) }))),
      (e) => console.warn('photos', e),
    );
  }, [field, id]);
  return photos;
}

export function PhotoThumb({ photo, size = 'thumb', className = '' }: { photo: PhotoDoc; size?: 'thumb' | 'full'; className?: string }) {
  const [url, setUrl] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    photoUrl(photo, size).then((u) => live && setUrl(u));
    return () => {
      live = false;
    };
  }, [photo, size]);
  if (url === undefined) return <div className={`animate-pulse bg-stone-200 ${className}`} />;
  if (url === null)
    return (
      <div className={`flex flex-col items-center justify-center gap-1 bg-stone-100 text-xs text-stone-500 ${className}`}>
        <ImageOff size={18} />
        Not uploaded yet
      </div>
    );
  return <img src={url} alt={photo.caption || 'Gear photo'} className={`object-cover ${className}`} loading="lazy" />;
}

export function AddPhotoButton({ links, label = 'Add photo', variant = 'secondary' as const }: { links: PhotoLinks; label?: string; variant?: 'secondary' | 'primary' }) {
  const { uid } = useMe();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <Button variant={variant} onClick={() => input.current?.click()} disabled={busy}>
        <Camera size={16} /> {busy ? 'Saving…' : label}
      </Button>
      <input
        ref={input}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={async (e) => {
          const files = e.target.files;
          if (!files?.length) return;
          setBusy(true);
          try {
            await addPhotos(uid, files, links);
          } finally {
            setBusy(false);
            e.target.value = '';
          }
        }}
      />
    </>
  );
}

export function PhotoGallery({ photos, emptyText = 'No photos yet.' }: { photos: PhotoDoc[]; emptyText?: string }) {
  const { uid, isManager } = useMe();
  const { users } = useData();
  const [open, setOpen] = useState<PhotoDoc | null>(null);
  if (!photos.length) return <p className="text-sm text-stone-500">{emptyText}</p>;
  return (
    <>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {photos.map((p) => (
          <button key={p.id} onClick={() => setOpen(p)} className="relative aspect-square overflow-hidden rounded-md bg-stone-100">
            <PhotoThumb photo={p} className="size-full" />
            {!p.uploaded && (
              <span className="absolute right-1 bottom-1 rounded bg-white/90 p-0.5 text-sky-700" title="Waiting to upload">
                <CloudUpload size={14} />
              </span>
            )}
          </button>
        ))}
      </div>
      <Modal
        open={!!open}
        onClose={() => setOpen(null)}
        title={open?.caption || 'Photo'}
        wide
        footer={
          open &&
          (open.uploadedBy === uid || isManager) && (
            <Button
              variant="danger"
              onClick={async () => {
                if (!confirm('Delete this photo?')) return;
                const id = open.id;
                setOpen(null);
                forgetPhotoUrl(id);
                await deleteDoc(doc(db, 'photos', id));
              }}
            >
              <Trash2 size={16} /> Delete
            </Button>
          )
        }
      >
        {open && (
          <div className="space-y-2">
            <PhotoThumb photo={open} size="full" className="max-h-[60vh] w-full rounded-md object-contain" />
            <p className="text-xs text-stone-500">
              {users.get(open.uploadedBy)?.displayName ?? 'Someone'} · {fmtTimestamp(open.createdAt, true)}
            </p>
          </div>
        )}
      </Modal>
    </>
  );
}

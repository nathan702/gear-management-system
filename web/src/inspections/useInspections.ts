import { useEffect, useState } from 'react';
import { collection, doc, limit, onSnapshot, orderBy, query, where, type QueryConstraint } from 'firebase/firestore';
import type { Inspection, WithId } from '@gear/shared';
import { db } from '../firebase';

export type InspectionDoc = Inspection & WithId;

const read = (d: { id: string; data(o?: { serverTimestamps: 'estimate' }): unknown }) =>
  ({ id: d.id, ...(d.data({ serverTimestamps: 'estimate' }) as Inspection) }) as InspectionDoc;

/** Most recent inspections, optionally for one gear item. */
export function useInspections(opts: { gearId?: string; max?: number } = {}) {
  const [list, setList] = useState<InspectionDoc[] | null>(null);
  useEffect(() => {
    const c: QueryConstraint[] = [];
    if (opts.gearId) c.push(where('gearId', '==', opts.gearId));
    c.push(orderBy('date', 'desc'), limit(opts.max ?? 100));
    return onSnapshot(
      query(collection(db, 'inspections'), ...c),
      (snap) => setList(snap.docs.map(read)),
      (e) => {
        console.warn('inspections', e);
        setList([]);
      },
    );
  }, [opts.gearId, opts.max]);
  return list;
}

export function useInspection(id: string) {
  const [insp, setInsp] = useState<InspectionDoc | null | undefined>(undefined);
  useEffect(
    () =>
      onSnapshot(
        doc(db, 'inspections', id),
        (snap) => setInsp(snap.exists() ? read(snap) : null),
        () => setInsp(null),
      ),
    [id],
  );
  return insp;
}

import { useEffect, useState } from 'react';
import { collection, getDocs, orderBy, query, where } from 'firebase/firestore';
import type { Inspection, IsoDate, UsageLog, WithId, WorkOrder } from '@gear/shared';
import { db } from '../firebase';

type Loaded<T> = { data: T[] | null; error: string | null };

function useQueryOnce<T>(make: () => ReturnType<typeof query>, deps: unknown[]): Loaded<T & WithId> {
  const [state, setState] = useState<Loaded<T & WithId>>({ data: null, error: null });
  useEffect(() => {
    let live = true;
    setState({ data: null, error: null });
    getDocs(make())
      .then((snap) => live && setState({ data: snap.docs.map((d) => ({ id: d.id, ...(d.data() as T) }) as T & WithId), error: null }))
      .catch((e: Error) => live && setState({ data: [], error: e.message }));
    return () => {
      live = false;
    };
  }, deps);
  return state;
}

/** Usage logs that end on or after `from` (callers clip to the range). */
export function useUsageLogs(from: IsoDate) {
  return useQueryOnce<UsageLog>(() => query(collection(db, 'usageLogs'), where('endDate', '>=', from), orderBy('endDate')), [from]);
}

export function useInspectionsBetween(from: IsoDate, to: IsoDate) {
  return useQueryOnce<Inspection>(() => query(collection(db, 'inspections'), where('date', '>=', from), where('date', '<=', to), orderBy('date')), [from, to]);
}

/** Every work order: at Calleva's scale this is a few hundred a year. */
export function useAllWorkOrders() {
  return useQueryOnce<WorkOrder>(() => query(collection(db, 'workOrders')), []);
}

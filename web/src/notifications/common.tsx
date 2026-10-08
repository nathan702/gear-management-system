import { useEffect, useState } from 'react';
import { collection, limit, onSnapshot, orderBy, query, where, type QueryConstraint } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import type { NotificationChannel, OutboundNotification, WithId } from '@gear/shared';
import { db, functions } from '../firebase';
import { fmtTimestamp } from '../lib/format';

export const sendTest = httpsCallable<{ channel: NotificationChannel; routeId?: string }, { id: string }>(functions, 'sendTestNotification');
export const runDigestNow = httpsCallable<void, { users: number; managerSummary: boolean }>(functions, 'runDigestNow');

export function useOutbox(userId: string | null, max = 50) {
  const [list, setList] = useState<(OutboundNotification & WithId)[]>([]);
  useEffect(() => {
    const c: QueryConstraint[] = [];
    if (userId) c.push(where('userId', '==', userId));
    c.push(orderBy('createdAt', 'desc'), limit(max));
    return onSnapshot(
      query(collection(db, 'notifications'), ...c),
      (snap) => setList(snap.docs.map((d) => ({ id: d.id, ...(d.data({ serverTimestamps: 'estimate' }) as OutboundNotification) }))),
      (e) => console.warn('notifications', e),
    );
  }, [userId, max]);
  return list;
}

const STATUS: Record<OutboundNotification['status'], string> = {
  pending: 'text-sky-700',
  sent: 'text-brand-700',
  skipped: 'text-stone-500',
  failed: 'text-red-700',
};

export function OutboxList({ items, showTarget }: { items: (OutboundNotification & WithId)[]; showTarget?: boolean }) {
  if (!items.length) return <p className="text-sm text-stone-500">Nothing sent yet.</p>;
  return (
    <ul className="divide-y divide-stone-100 text-sm">
      {items.map((n) => (
        <li key={n.id} className="py-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="font-medium">{n.subject}</span>
            <span className={`text-xs font-medium ${STATUS[n.status]}`}>
              {n.status} · {n.channel}
            </span>
          </div>
          <div className="text-xs text-stone-500">
            {fmtTimestamp(n.createdAt, true)}
            {showTarget && n.target && ` · to ${n.target}`}
            {n.error && <span className="text-stone-600"> · {n.error}</span>}
          </div>
        </li>
      ))}
    </ul>
  );
}

import { useState } from 'react';
import { doc, updateDoc } from 'firebase/firestore';
import { NOTIFICATION_EVENTS, EVENT_LABELS, isManagerRole, wantedChannels, type NotificationChannel, type NotificationPrefs } from '@gear/shared';
import { db } from '../firebase';
import { useMe } from '../auth/AuthProvider';
import { updateStamp } from '../data/writes';
import { Button, Card, Field, Input } from '../components/ui';
import { notify } from '../components/toast';
import { OutboxList, sendTest, useOutbox } from './common';

export function NotificationPrefsCard() {
  const { profile, uid } = useMe();
  const [prefs, setPrefs] = useState<NotificationPrefs>(profile.notificationPrefs ?? {});
  const [slackId, setSlackId] = useState(profile.slackUserId ?? '');
  const [busy, setBusy] = useState(false);
  const outbox = useOutbox(uid, 10);
  const events = NOTIFICATION_EVENTS.filter((e) => !EVENT_LABELS[e].managersOnly || isManagerRole(profile.role));
  const on = (e: (typeof events)[number], c: NotificationChannel) => wantedChannels({ role: profile.role, notificationPrefs: prefs }, e).includes(c);

  return (
    <Card title="Notifications">
      <div className="space-y-4">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-stone-500 uppercase">
              <th className="py-1 font-medium">Tell me about</th>
              <th className="w-16 py-1 text-center font-medium">Email</th>
              <th className="w-16 py-1 text-center font-medium">Slack</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {events.map((e) => (
              <tr key={e}>
                <td className="py-2 pr-2">
                  <div className="font-medium">{EVENT_LABELS[e].label}</div>
                  <div className="text-xs text-stone-500">{EVENT_LABELS[e].help}</div>
                </td>
                {(['email', 'slack'] as const).map((c) => (
                  <td key={c} className="text-center">
                    <input
                      type="checkbox"
                      className="size-4 accent-brand-700"
                      aria-label={`${EVENT_LABELS[e].label} by ${c}`}
                      checked={on(e, c)}
                      onChange={(ev) => setPrefs((p) => ({ ...p, [e]: { ...p[e], [c]: ev.target.checked } }))}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <Field label="Slack member ID (optional)" hint="Found automatically from your email. Only needed if your Slack email is different — Slack profile → ⋮ → Copy member ID.">
          <Input value={slackId} onChange={(e) => setSlackId(e.target.value.trim())} placeholder="U0123ABCD" />
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await updateDoc(doc(db, 'users', uid), { notificationPrefs: prefs, slackUserId: slackId, ...updateStamp(uid) });
                notify('Notification settings saved', 'success');
              } catch (e) {
                notify((e as Error).message, 'error');
              } finally {
                setBusy(false);
              }
            }}
          >
            Save
          </Button>
          {(['email', 'slack'] as const).map((c) => (
            <Button
              key={c}
              onClick={() =>
                sendTest({ channel: c })
                  .then(() => notify(`Test ${c} queued — see below for the result.`))
                  .catch((e: Error) => notify(e.message, 'error'))
              }
            >
              Send me a test {c === 'email' ? 'email' : 'Slack message'}
            </Button>
          ))}
        </div>
        <div>
          <p className="label">Recently sent to you</p>
          <OutboxList items={outbox} />
        </div>
      </div>
    </Card>
  );
}

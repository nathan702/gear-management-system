import { useEffect, useState } from 'react';
import { doc, onSnapshot, setDoc, writeBatch } from 'firebase/firestore';
import { Plus, Send, Trash2 } from 'lucide-react';
import {
  EVENT_LABELS,
  NOTIFICATION_EVENTS,
  newItemId,
  type NotificationEvent,
  type NotificationRoute,
  type NotificationSettings,
} from '@gear/shared';
import { db } from '../firebase';
import { Button, Card, Checkbox, Field, Input, PageHeader, Select } from '../components/ui';
import { OutboxList, runDigestNow, sendTest, useOutbox } from '../notifications/common';
import { notify } from '../components/toast';

const DEFAULTS: NotificationSettings = { enabled: true, digestHour: 7, routes: [] };
const hourLabel = (h: number) => new Date(2000, 0, 1, h).toLocaleTimeString(undefined, { hour: 'numeric' });

export function NotificationsAdminPage() {
  const [settings, setSettings] = useState<NotificationSettings | null>(null);
  const outbox = useOutbox(null, 100);
  useEffect(
    () => onSnapshot(doc(db, 'settings', 'notifications'), (s) => setSettings({ ...DEFAULTS, ...(s.data() as Partial<NotificationSettings> | undefined) })),
    [],
  );
  if (!settings) return null;
  const save = (patch: Partial<NotificationSettings>) => setDoc(doc(db, 'settings', 'notifications'), patch, { merge: true }).catch((e: Error) => notify(e.message, 'error'));

  return (
    <div className="max-w-3xl space-y-5">
      <PageHeader
        title="Notifications"
        subtitle="Reminders and alerts by email and Slack. Each person chooses what they get on their profile page; here you connect email and Slack and send events to shared channels."
      />

      <Card title="General">
        <div className="flex flex-wrap items-end gap-4">
          <Checkbox label="Notifications on" checked={settings.enabled} onChange={(e) => save({ enabled: e.target.checked })} />
          <Field label="Daily reminders at (Eastern time)">
            <Select className="w-36" value={settings.digestHour} onChange={(e) => save({ digestHour: Number(e.target.value) })}>
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>
                  {hourLabel(h)}
                </option>
              ))}
            </Select>
          </Field>
          <Button
            onClick={() =>
              runDigestNow()
                .then((r) => notify(`Reminders queued for ${r.data.users} people${r.data.managerSummary ? ', plus the manager summary' : ''}.`, 'success'))
                .catch((e: Error) => notify(e.message, 'error'))
            }
          >
            <Send size={16} /> Send today’s reminders now
          </Button>
        </div>
      </Card>

      <EmailCard configured={!!settings.emailConfigured} />
      <SlackCard configured={!!settings.slackConfigured} />
      <RoutesCard routes={settings.routes} onChange={(routes) => save({ routes })} />

      <Card title="Delivery log (latest 100)">
        <OutboxList items={outbox} showTarget />
      </Card>
    </div>
  );
}

/** Credentials go to private/notifications, which the app can write but never read back. */
async function saveCredentials(patch: Record<string, unknown>, flag: Partial<NotificationSettings>) {
  const batch = writeBatch(db);
  batch.set(doc(db, 'private', 'notifications'), patch, { merge: true });
  batch.set(doc(db, 'settings', 'notifications'), flag, { merge: true });
  await batch.commit();
}

function EmailCard({ configured }: { configured: boolean }) {
  const [smtp, setSmtp] = useState({ host: 'smtp.gmail.com', port: '587', user: '', pass: '', from: '' });
  const set = (k: keyof typeof smtp) => (e: { target: { value: string } }) => setSmtp((s) => ({ ...s, [k]: e.target.value }));
  return (
    <Card title={`Email ${configured ? '— connected' : '— not set up'}`}>
      <p className="mb-3 text-sm text-stone-600">
        With Google Workspace, create an <b>app password</b> for a sending account (e.g. gear@calleva.org: Google Account → Security → App passwords) and use
        smtp.gmail.com, port 587. Saved details can be replaced but not viewed.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="SMTP server">
          <Input value={smtp.host} onChange={set('host')} />
        </Field>
        <Field label="Port">
          <Input inputMode="numeric" value={smtp.port} onChange={set('port')} />
        </Field>
        <Field label="Username">
          <Input value={smtp.user} onChange={set('user')} placeholder="gear@calleva.org" autoComplete="off" />
        </Field>
        <Field label="Password / app password">
          <Input type="password" value={smtp.pass} onChange={set('pass')} autoComplete="new-password" />
        </Field>
        <Field label="Send as" hint="e.g. Calleva Gear <gear@calleva.org>" className="sm:col-span-2">
          <Input value={smtp.from} onChange={set('from')} />
        </Field>
      </div>
      <div className="mt-3 flex gap-2">
        <Button
          variant="primary"
          disabled={!smtp.host || !smtp.from}
          onClick={async () => {
            await saveCredentials(
              { smtp: { host: smtp.host.trim(), port: Number(smtp.port) || 587, secure: Number(smtp.port) === 465, user: smtp.user.trim(), pass: smtp.pass, from: smtp.from.trim() } },
              { emailConfigured: true },
            );
            setSmtp((s) => ({ ...s, pass: '' }));
            notify('Email settings saved', 'success');
          }}
        >
          Save email settings
        </Button>
        {configured && (
          <Button onClick={() => sendTest({ channel: 'email' }).then(() => notify('Test email queued — check the delivery log.'))}>Send me a test</Button>
        )}
      </div>
    </Card>
  );
}

function SlackCard({ configured }: { configured: boolean }) {
  const [token, setToken] = useState('');
  return (
    <Card title={`Slack ${configured ? '— connected' : '— not set up'}`}>
      <ol className="mb-3 list-decimal space-y-1 pl-5 text-sm text-stone-600">
        <li>
          At <span className="font-mono">api.slack.com/apps</span>, create an app “Calleva Gear” in your workspace.
        </li>
        <li>
          Under <b>OAuth &amp; Permissions</b>, add bot scopes <span className="font-mono">chat:write</span>, <span className="font-mono">users:read</span> and{' '}
          <span className="font-mono">users:read.email</span>, then install it to the workspace.
        </li>
        <li>Paste the <b>Bot User OAuth Token</b> (starts with xoxb-) below. Invite the app to any channel you route events to.</li>
      </ol>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Bot token" className="min-w-72 flex-1">
          <Input type="password" value={token} onChange={(e) => setToken(e.target.value.trim())} placeholder={configured ? '•••••••• (saved)' : 'xoxb-…'} autoComplete="off" />
        </Field>
        <Button
          variant="primary"
          disabled={!token.startsWith('xoxb-')}
          onClick={async () => {
            await saveCredentials({ slackToken: token }, { slackConfigured: true });
            setToken('');
            notify('Slack connected', 'success');
          }}
        >
          Save token
        </Button>
        {configured && <Button onClick={() => sendTest({ channel: 'slack' }).then(() => notify('Test Slack message queued — check the delivery log.'))}>Send me a test</Button>}
      </div>
    </Card>
  );
}

function RoutesCard({ routes, onChange }: { routes: NotificationRoute[]; onChange(r: NotificationRoute[]): void }) {
  const [draft, setDraft] = useState<NotificationRoute[]>(routes);
  useEffect(() => setDraft(routes), [routes]);
  const set = (i: number, patch: Partial<NotificationRoute>) => setDraft((d) => d.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const toggle = (i: number, e: NotificationEvent) =>
    set(i, { events: draft[i].events.includes(e) ? draft[i].events.filter((x) => x !== e) : [...draft[i].events, e] });
  return (
    <Card
      title="Shared channels"
      actions={
        <Button size="sm" onClick={() => setDraft((d) => [...d, { id: newItemId(), name: '', type: 'slack', target: '', events: ['gear_quarantined'] }])}>
          <Plus size={14} /> Add
        </Button>
      }
    >
      <p className="mb-3 text-sm text-stone-600">Send events to a Slack channel (use its channel ID, e.g. C0123ABCD) or a shared email address, as well as to individuals.</p>
      <div className="space-y-3">
        {draft.map((r, i) => (
          <div key={r.id} className="rounded-lg border border-stone-200 p-3">
            <div className="grid items-end gap-2 sm:grid-cols-[1fr_7rem_1fr_auto]">
              <Field label="Name">
                <Input value={r.name} onChange={(e) => set(i, { name: e.target.value })} placeholder="#gear-alerts" />
              </Field>
              <Field label="Type">
                <Select value={r.type} onChange={(e) => set(i, { type: e.target.value as NotificationRoute['type'] })}>
                  <option value="slack">Slack</option>
                  <option value="email">Email</option>
                </Select>
              </Field>
              <Field label={r.type === 'slack' ? 'Channel ID' : 'Email address'}>
                <Input value={r.target} onChange={(e) => set(i, { target: e.target.value.trim() })} />
              </Field>
              <Button variant="ghost" className="text-red-700" aria-label="Remove channel" onClick={() => setDraft((d) => d.filter((_, j) => j !== i))}>
                <Trash2 size={16} />
              </Button>
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
              {NOTIFICATION_EVENTS.filter((e) => e !== 'daily_digest' && e !== 'work_order_assigned' && e !== 'work_order_closed' && e !== 'kit_gear_flagged').map((e) => (
                <Checkbox key={e} label={EVENT_LABELS[e].label} checked={r.events.includes(e)} onChange={() => toggle(i, e)} />
              ))}
            </div>
            {routes.some((x) => x.id === r.id) && (
              <Button size="sm" variant="ghost" className="mt-1" onClick={() => sendTest({ channel: r.type, routeId: r.id }).then(() => notify('Test queued — check the delivery log.'))}>
                Send a test here
              </Button>
            )}
          </div>
        ))}
        {!draft.length && <p className="text-sm text-stone-500">No shared channels.</p>}
      </div>
      <div className="mt-3">
        <Button variant="primary" disabled={draft.some((r) => !r.name.trim() || !r.target)} onClick={() => onChange(draft.map((r) => ({ ...r, name: r.name.trim() })))}>
          Save channels
        </Button>
      </div>
    </Card>
  );
}

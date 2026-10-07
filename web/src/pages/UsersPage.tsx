import { useEffect, useState } from 'react';
import { collection, deleteDoc, doc, onSnapshot, serverTimestamp, setDoc, Timestamp, updateDoc } from 'firebase/firestore';
import { MailPlus, Pencil, Trash2 } from 'lucide-react';
import { ROLES, ROLE_DESCRIPTIONS, ROLE_LABELS, type Invite, type Role, type TimestampLike, type UserProfile, type WithId } from '@gear/shared';
import { db } from '../firebase';
import { useMe } from '../auth/AuthProvider';
import { compareText, sortedValues, useData } from '../data/DataProvider';
import { updateStamp } from '../data/writes';
import { Badge, Button, Checkbox, Field, Input, Modal, PageHeader, Select, Textarea } from '../components/ui';
import { fmtTimestamp, timestampToIso } from '../lib/format';
import { notify } from '../components/toast';

/** End of the chosen day, local time. */
function expiryFromDate(iso: string): Timestamp | null {
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  return Timestamp.fromDate(new Date(y, m - 1, d, 23, 59, 59));
}

function accessLabel(u: { active?: boolean; expiresAt: TimestampLike | null }) {
  if (u.active === false) return <Badge>Deactivated</Badge>;
  if (u.expiresAt && u.expiresAt.toMillis() < Date.now()) return <Badge className="bg-red-50 text-red-800">Expired</Badge>;
  if (u.expiresAt) return <Badge className="bg-amber-50 text-amber-800">Until {fmtTimestamp(u.expiresAt)}</Badge>;
  return null;
}

export function UsersPage() {
  const { uid } = useMe();
  const { users, programAreas } = useData();
  const [invites, setInvites] = useState<(Invite & WithId)[]>([]);
  const [editing, setEditing] = useState<(UserProfile & WithId) | null>(null);
  const [inviting, setInviting] = useState(false);
  const [showInactive, setShowInactive] = useState(false);

  useEffect(
    () => onSnapshot(collection(db, 'invites'), (snap) => setInvites(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Invite) })))),
    [],
  );

  const list = [...users.values()]
    .filter((u) => showInactive || (u.active && !(u.expiresAt && u.expiresAt.toMillis() < Date.now())))
    .sort((a, b) => compareText(a.displayName, b.displayName));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Users"
        subtitle="Anyone with a calleva.org Google account can sign in as staff. Invite other emails here — seasonal staff can be given an end date."
        actions={
          <Button variant="primary" onClick={() => setInviting(true)}>
            <MailPlus size={16} /> Invite people
          </Button>
        }
      />

      <div className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
        {ROLES.map((r) => (
          <div key={r} className="rounded-lg bg-white p-3 ring-1 ring-stone-200">
            <div className="font-medium">{ROLE_LABELS[r]}</div>
            <div className="text-xs text-stone-600">{ROLE_DESCRIPTIONS[r]}</div>
          </div>
        ))}
      </div>

      {invites.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold">Pending invitations</h2>
          <ul className="card divide-y divide-stone-100">
            {invites
              .sort((a, b) => compareText(a.email, b.email))
              .map((inv) => (
                <li key={inv.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{inv.displayName || inv.email}</div>
                    <div className="truncate text-xs text-stone-500">
                      {inv.email} · {ROLE_LABELS[inv.role]} · invited {fmtTimestamp(inv.updatedAt)}
                    </div>
                  </div>
                  {accessLabel({ expiresAt: inv.expiresAt })}
                  <Button size="sm" variant="ghost" className="text-red-700" aria-label="Cancel invitation" onClick={() => deleteDoc(doc(db, 'invites', inv.id))}>
                    <Trash2 size={16} />
                  </Button>
                </li>
              ))}
          </ul>
        </section>
      )}

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold">People ({list.length})</h2>
          <Checkbox label="Show deactivated & expired" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
        </div>
        <ul className="card divide-y divide-stone-100">
          {list.map((u) => (
            <li key={u.id} className="flex items-center gap-3 px-4 py-3 text-sm">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{u.displayName}</span>
                  <Badge className={u.role === 'admin' ? 'bg-brand-50 text-brand-800' : ''}>{ROLE_LABELS[u.role]}</Badge>
                  {accessLabel(u)}
                </div>
                <div className="truncate text-xs text-stone-500">
                  {u.email}
                  {u.homeProgramAreaId && ` · ${programAreas.get(u.homeProgramAreaId)?.name ?? ''}`}
                  {u.lastSignInAt && ` · last seen ${fmtTimestamp(u.lastSignInAt)}`}
                </div>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setEditing(u)} aria-label={`Edit ${u.displayName}`}>
                <Pencil size={16} />
              </Button>
            </li>
          ))}
        </ul>
      </section>

      <EditUserModal user={editing} self={editing?.id === uid} onClose={() => setEditing(null)} />
      <InviteModal open={inviting} onClose={() => setInviting(false)} />
    </div>
  );
}

function EditUserModal({ user, self, onClose }: { user: (UserProfile & WithId) | null; self: boolean; onClose(): void }) {
  const { uid } = useMe();
  const { programAreas } = useData();
  const [draft, setDraft] = useState({ displayName: '', role: 'staff' as Role, expires: '', active: true, home: '', phone: '' });
  useEffect(() => {
    if (user)
      setDraft({
        displayName: user.displayName,
        role: user.role,
        expires: timestampToIso(user.expiresAt),
        active: user.active,
        home: user.homeProgramAreaId ?? '',
        phone: user.phone ?? '',
      });
  }, [user]);
  if (!user) return null;
  return (
    <Modal
      open
      onClose={onClose}
      title={`Edit ${user.displayName}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            onClick={async () => {
              try {
                await updateDoc(doc(db, 'users', user.id), {
                  displayName: draft.displayName.trim() || user.displayName,
                  role: draft.role,
                  expiresAt: expiryFromDate(draft.expires),
                  active: draft.active,
                  homeProgramAreaId: draft.home || null,
                  phone: draft.phone.trim(),
                  ...updateStamp(uid),
                });
                onClose();
              } catch (e) {
                notify((e as Error).message, 'error');
              }
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-stone-600">{user.email}</p>
        <Field label="Name">
          <Input value={draft.displayName} onChange={(e) => setDraft((d) => ({ ...d, displayName: e.target.value }))} />
        </Field>
        <Field label="Role" hint={self ? 'You can’t change your own role.' : ROLE_DESCRIPTIONS[draft.role]}>
          <Select value={draft.role} disabled={self} onChange={(e) => setDraft((d) => ({ ...d, role: e.target.value as Role }))}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Access ends" hint="Leave blank for permanent staff. Access stops at the end of this day.">
          <Input type="date" value={draft.expires} disabled={self} onChange={(e) => setDraft((d) => ({ ...d, expires: e.target.value }))} />
        </Field>
        <Field label="Home program area">
          <Select value={draft.home} onChange={(e) => setDraft((d) => ({ ...d, home: e.target.value }))}>
            <option value="">— None —</option>
            {sortedValues(programAreas).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Phone">
          <Input type="tel" value={draft.phone} onChange={(e) => setDraft((d) => ({ ...d, phone: e.target.value }))} />
        </Field>
        <Checkbox
          label="Active (unticking blocks sign-in immediately)"
          checked={draft.active}
          disabled={self}
          onChange={(e) => setDraft((d) => ({ ...d, active: e.target.checked }))}
        />
      </div>
    </Modal>
  );
}

function InviteModal({ open, onClose }: { open: boolean; onClose(): void }) {
  const { uid } = useMe();
  const { users, programAreas } = useData();
  const [emails, setEmails] = useState('');
  const [role, setRole] = useState<Role>('staff');
  const [expires, setExpires] = useState('');
  const [home, setHome] = useState('');
  const [busy, setBusy] = useState(false);

  const parsed = emails
    .split(/[\s,;]+/)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  const invalid = parsed.filter((e) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
  const existing = parsed.filter((e) => [...users.values()].some((u) => u.email === e));

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Invite people"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={busy || !parsed.length || invalid.length > 0}
            onClick={async () => {
              setBusy(true);
              try {
                const toInvite = parsed.filter((e) => !existing.includes(e));
                await Promise.all(
                  toInvite.map((email) =>
                    setDoc(doc(db, 'invites', email), {
                      email,
                      role,
                      expiresAt: expiryFromDate(expires),
                      homeProgramAreaId: home || null,
                      createdAt: serverTimestamp(),
                      createdBy: uid,
                      ...updateStamp(uid),
                    }),
                  ),
                );
                notify(`${toInvite.length} invitation${toInvite.length === 1 ? '' : 's'} created. Ask them to sign in at ${window.location.origin}.`, 'success');
                setEmails('');
                onClose();
              } catch (e) {
                notify((e as Error).message, 'error');
              } finally {
                setBusy(false);
              }
            }}
          >
            Invite {parsed.length - existing.length || ''}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field
          label="Email addresses"
          hint="One or more, separated by commas or new lines. Google accounts can use “Sign in with Google”; other addresses get an emailed sign-in link."
          error={invalid.length ? `Not valid: ${invalid.join(', ')}` : existing.length ? `Already users (skipped): ${existing.join(', ')}` : null}
        >
          <Textarea value={emails} onChange={(e) => setEmails(e.target.value)} placeholder="sam@gmail.com, alex@example.org" />
        </Field>
        <Field label="Role">
          <Select value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Access ends" hint="Optional — e.g. the last day of summer camp.">
          <Input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
        </Field>
        <Field label="Home program area">
          <Select value={home} onChange={(e) => setHome(e.target.value)}>
            <option value="">— None —</option>
            {sortedValues(programAreas).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </Modal>
  );
}

import { useState } from 'react';
import { doc, updateDoc } from 'firebase/firestore';
import { ROLE_DESCRIPTIONS, ROLE_LABELS } from '@gear/shared';
import { db } from '../firebase';
import { useMe } from '../auth/AuthProvider';
import { sortedValues, useData } from '../data/DataProvider';
import { updateStamp } from '../data/writes';
import { Button, Card, Dl, Field, Input, PageHeader, Select } from '../components/ui';
import { fmtTimestamp } from '../lib/format';
import { notify } from '../components/toast';
import { NotificationPrefsCard } from '../notifications/PrefsCard';

export function ProfilePage() {
  const { profile, uid } = useMe();
  const { programAreas } = useData();
  const [name, setName] = useState(profile.displayName);
  const [phone, setPhone] = useState(profile.phone ?? '');
  const [home, setHome] = useState(profile.homeProgramAreaId ?? '');

  return (
    <div className="max-w-xl space-y-5">
      <PageHeader title="My profile" />
      <Card title="Account">
        <Dl
          items={[
            ['Email', profile.email],
            ['Role', `${ROLE_LABELS[profile.role]} — ${ROLE_DESCRIPTIONS[profile.role]}`],
            ['Access ends', profile.expiresAt ? fmtTimestamp(profile.expiresAt) : 'No end date'],
          ]}
        />
      </Card>
      <Card title="Details">
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await updateDoc(doc(db, 'users', uid), {
                displayName: name.trim() || profile.displayName,
                phone: phone.trim(),
                homeProgramAreaId: home || null,
                ...updateStamp(uid),
              });
              notify('Profile saved', 'success');
            } catch (err) {
              notify((err as Error).message, 'error');
            }
          }}
        >
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Mobile phone">
            <Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
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
          <div className="flex justify-end">
            <Button type="submit" variant="primary">
              Save
            </Button>
          </div>
        </form>
      </Card>
      <NotificationPrefsCard />
    </div>
  );
}

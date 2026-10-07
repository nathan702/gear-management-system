import { useState } from 'react';
import { doc, setDoc } from 'firebase/firestore';
import type { AppSettings } from '@gear/shared';
import { db } from '../firebase';
import { useData } from '../data/DataProvider';
import { Button, Card, Field, Input, PageHeader, Select } from '../components/ui';
import { LABEL_TEMPLATES } from '../qr/labels';
import { notify } from '../components/toast';

export function SettingsPage() {
  const { settings } = useData();
  const [draft, setDraft] = useState<AppSettings>(settings);
  const [domains, setDomains] = useState(settings.autoJoinDomains.join(', '));
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      const next: AppSettings = {
        ...draft,
        orgName: draft.orgName.trim() || 'Calleva',
        qrBaseUrl: draft.qrBaseUrl.trim().replace(/\/+$/, ''),
        autoJoinDomains: domains
          .split(/[\s,]+/)
          .map((d) => d.trim().toLowerCase().replace(/^@/, ''))
          .filter(Boolean),
      };
      await setDoc(doc(db, 'settings', 'app'), next);
      notify('Settings saved', 'success');
    } catch (e) {
      notify((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-5">
      <PageHeader title="Settings" />
      <Card title="Organization">
        <div className="space-y-4">
          <Field label="Organization name">
            <Input value={draft.orgName} onChange={(e) => setDraft({ ...draft, orgName: e.target.value })} />
          </Field>
          <Field
            label="Auto-join email domains"
            hint="Verified Google accounts on these domains can sign in as staff without an invitation. Everyone else needs an invite."
          >
            <Input value={domains} onChange={(e) => setDomains(e.target.value)} placeholder="calleva.org" />
          </Field>
        </div>
      </Card>
      <Card title="QR labels">
        <div className="space-y-4">
          <Field
            label="Label link address"
            hint={`QR codes open ${draft.qrBaseUrl || window.location.origin}/q/<code>. Set this once you have a permanent web address — labels already printed keep the old address.`}
          >
            <Input value={draft.qrBaseUrl} placeholder={window.location.origin} onChange={(e) => setDraft({ ...draft, qrBaseUrl: e.target.value })} />
          </Field>
          <Field label="Default label sheet">
            <Select value={draft.labels.templateId} onChange={(e) => setDraft({ ...draft, labels: { ...draft.labels, templateId: e.target.value } })}>
              {LABEL_TEMPLATES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Printer offset → (inches)" hint="Positive moves right">
              <Input type="number" step="0.01" value={draft.labels.offsetX} onChange={(e) => setDraft({ ...draft, labels: { ...draft.labels, offsetX: Number(e.target.value) || 0 } })} />
            </Field>
            <Field label="Printer offset ↓ (inches)" hint="Positive moves down">
              <Input type="number" step="0.01" value={draft.labels.offsetY} onChange={(e) => setDraft({ ...draft, labels: { ...draft.labels, offsetY: Number(e.target.value) || 0 } })} />
            </Field>
          </div>
          <p className="text-xs text-stone-500">Print a test sheet with outlines on plain paper, hold it over a label sheet against the light, and adjust the offsets until they line up.</p>
        </div>
      </Card>
      <div className="flex justify-end">
        <Button variant="primary" onClick={save} disabled={busy}>
          Save settings
        </Button>
      </div>
    </div>
  );
}

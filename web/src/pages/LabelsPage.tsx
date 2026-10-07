import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Download, Printer } from 'lucide-react';
import { useData, byName } from '../data/DataProvider';
import { Button, Card, Checkbox, Field, Input, PageHeader, Select } from '../components/ui';
import { buildLabelPdf, LABEL_TEMPLATES, templateById } from '../qr/labels';
import { plural } from '../lib/format';
import { notify } from '../components/toast';

export function LabelsPage() {
  const [params] = useSearchParams();
  const { gear, settings } = useData();
  const ids = (params.get('ids') ?? '').split(',').filter(Boolean);
  const items = useMemo(() => ids.map((id) => gear.get(id)).filter((g) => !!g).sort(byName), [ids.join(','), gear]); // eslint-disable-line react-hooks/exhaustive-deps

  const [templateId, setTemplateId] = useState(settings.labels.templateId);
  const [startAt, setStartAt] = useState(1);
  const [copies, setCopies] = useState(1);
  const [outlines, setOutlines] = useState(false);
  const [busy, setBusy] = useState(false);
  const template = templateById(templateId);
  const perSheet = template.cols * template.rows;
  const total = items.length * copies;
  const sheets = Math.ceil((total + startAt - 1) / perSheet);

  async function make(action: 'print' | 'download') {
    setBusy(true);
    try {
      const labels = items.flatMap((g) => Array.from({ length: copies }, () => ({ name: g.name, code: g.qrCode })));
      const blob = await buildLabelPdf(labels, {
        template,
        baseUrl: settings.qrBaseUrl || window.location.origin,
        orgName: settings.orgName,
        startAt,
        offsetX: settings.labels.offsetX,
        offsetY: settings.labels.offsetY,
        outlines,
      });
      const url = URL.createObjectURL(blob);
      if (action === 'download') {
        const a = document.createElement('a');
        a.href = url;
        a.download = `gear-labels-${template.id}.pdf`;
        a.click();
      } else {
        window.open(url, '_blank');
      }
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      notify(`Could not build labels: ${(e as Error).message}`, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-3xl space-y-5">
      <PageHeader
        title="Print QR labels"
        back={{ to: '/gear', label: 'Gear' }}
        subtitle={items.length ? plural(items.length, 'item') : 'Select gear on the Gear page, then choose “Print labels”.'}
      />
      {items.length > 0 && (
        <>
          <Card title="Sheet">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Label sheet" className="sm:col-span-2">
                <Select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                  {LABEL_TEMPLATES.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Start at label #" hint={`Skip used labels on a partial sheet (1–${perSheet}, left to right, top to bottom).`}>
                <Input type="number" min={1} max={perSheet} value={startAt} onChange={(e) => setStartAt(Math.max(1, Math.min(perSheet, Number(e.target.value) || 1)))} />
              </Field>
              <Field label="Copies of each">
                <Input type="number" min={1} max={10} value={copies} onChange={(e) => setCopies(Math.max(1, Math.min(10, Number(e.target.value) || 1)))} />
              </Field>
              <div className="sm:col-span-2">
                <Checkbox label="Draw label outlines (for a plain-paper alignment test)" checked={outlines} onChange={(e) => setOutlines(e.target.checked)} />
              </div>
            </div>
            <p className="mt-4 text-sm text-stone-600">
              {plural(total, 'label')} on {plural(sheets, 'sheet')}. Print at <b>100% / actual size</b> — not “fit to page”.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button variant="primary" onClick={() => make('print')} disabled={busy}>
                <Printer size={16} /> Open PDF to print
              </Button>
              <Button onClick={() => make('download')} disabled={busy}>
                <Download size={16} /> Download PDF
              </Button>
            </div>
          </Card>
          <Card title="Items">
            <ul className="columns-1 gap-6 text-sm sm:columns-2">
              {items.map((g) => (
                <li key={g.id} className="flex justify-between gap-2 py-0.5">
                  <span className="truncate">{g.name}</span>
                  <span className="font-mono text-stone-500">{g.qrCode}</span>
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}
    </div>
  );
}

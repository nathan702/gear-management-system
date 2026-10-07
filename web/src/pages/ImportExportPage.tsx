import { useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Upload } from 'lucide-react';
import {
  ENTITIES,
  IMPORT_ORDER,
  exportRows,
  planImport,
  templateHeaders,
  type EntityKey,
  type ImportPlan,
} from '@gear/shared';
import { useMe } from '../auth/AuthProvider';
import { useData } from '../data/DataProvider';
import { Button, Card, Checkbox, Field, PageHeader, Select } from '../components/ui';
import { downloadCsv, downloadXlsx, readSpreadsheet, stamp } from '../importExport/files';
import { applyPlan, docsFor, exportContext, importContext } from '../importExport/run';
import { plural } from '../lib/format';
import { notify } from '../components/toast';

export function ImportExportPage() {
  const { isAdmin } = useMe();
  const keys = IMPORT_ORDER.filter((k) => k !== 'users' || isAdmin);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Import / export"
        subtitle="Download any list as CSV or Excel, or bulk-add and update records from a spreadsheet."
      />
      <ExportCard keys={keys} />
      <ImportCard keys={keys} />
    </div>
  );
}

function ExportCard({ keys }: { keys: EntityKey[] }) {
  const data = useData();
  const ctx = exportContext(data);
  const build = (key: EntityKey) => {
    const def = ENTITIES[key];
    const { headers, rows } = exportRows(def, docsFor(def, data), ctx);
    return { name: def.label, headers, rows };
  };
  return (
    <Card
      title="Export"
      actions={
        <Button size="sm" onClick={() => downloadXlsx(keys.map(build), `gear-backup-${stamp()}.xlsx`)}>
          <FileSpreadsheet size={14} /> Everything (Excel)
        </Button>
      }
    >
      <ul className="divide-y divide-stone-100">
        {keys.map((key) => {
          const def = ENTITIES[key];
          const count = docsFor(def, data).length;
          return (
            <li key={key} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="text-sm">
                <b>{def.label}</b> <span className="text-stone-500">· {count}</span>
              </span>
              <span className="flex gap-2">
                <Button
                  size="sm"
                  onClick={() => {
                    const s = build(key);
                    downloadCsv(s.headers, s.rows, `${key}-${stamp()}.csv`);
                  }}
                >
                  <Download size={14} /> CSV
                </Button>
                <Button size="sm" onClick={() => downloadXlsx([build(key)], `${key}-${stamp()}.xlsx`)}>
                  <Download size={14} /> Excel
                </Button>
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function ImportCard({ keys }: { keys: EntityKey[] }) {
  const { uid } = useMe();
  const data = useData();
  const [entity, setEntity] = useState<EntityKey>('gear');
  const [createRefs, setCreateRefs] = useState(false);
  const [records, setRecords] = useState<Record<string, string>[] | null>(null);
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const def = ENTITIES[entity];

    // Memoized so generated QR codes stay the same between preview and import.
  const plan: ImportPlan | null = useMemo(
    () => (records ? planImport(def, records, importContext(def, data, createRefs)) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [records, def, createRefs],
  );
  const counts = plan
    ? {
        create: plan.rows.filter((r) => r.action === 'create').length,
        update: plan.rows.filter((r) => r.action === 'update').length,
        error: plan.rows.filter((r) => r.action === 'error').length,
      }
    : null;

  const reset = () => {
    setRecords(null);
    setFileName('');
    setProgress(null);
  };

  return (
    <Card title="Import">
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="What are you importing?">
            <Select
              value={entity}
              onChange={(e) => {
                setEntity(e.target.value as EntityKey);
                reset();
              }}
            >
              {keys.map((k) => (
                <option key={k} value={k}>
                  {ENTITIES[k].label}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex items-end gap-2">
            <Button onClick={() => downloadCsv(templateHeaders(def), [], `${entity}-template.csv`)}>
              <Download size={16} /> Blank template
            </Button>
          </div>
        </div>

        <details className="rounded-lg bg-stone-50 p-3 text-sm">
          <summary className="cursor-pointer font-medium">Columns for {def.label.toLowerCase()}</summary>
          <ul className="mt-2 grid gap-1 sm:grid-cols-2">
            <li>
              <code>id</code> — <span className="text-stone-600">leave blank for new records; keep it from an export to update</span>
            </li>
            {def.fields.map((f) => (
              <li key={f.header}>
                <code>{f.header}</code>
                {f.required && <span className="text-red-700"> *</span>}
                {f.help && <span className="text-stone-600"> — {f.help}</span>}
                {f.type === 'date' && <span className="text-stone-600"> — YYYY-MM-DD or M/D/YYYY</span>}
                {f.type === 'enum' && <span className="text-stone-600"> — {f.enumValues!.join(', ')}</span>}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-stone-600">
            Rows without an <code>id</code> are matched to existing records by{' '}
            {entity === 'gear' ? 'qr_code' : entity === 'products' ? 'manufacturer + model + variant' : entity === 'users' ? 'email' : 'name'}. Only columns in your
            file are changed; an empty cell clears that field. New users become invitations.
          </p>
        </details>

        <Checkbox
          label="Create missing program areas, locations, categories and manufacturers by name"
          checked={createRefs}
          onChange={(e) => setCreateRefs(e.target.checked)}
        />

        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" onClick={() => fileInput.current?.click()} disabled={busy}>
            <Upload size={16} /> Choose CSV or Excel file
          </Button>
          {fileName && <span className="text-sm text-stone-600">{fileName}</span>}
          <input
            ref={fileInput}
            type="file"
            accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            hidden
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              setProgress(null);
              try {
                const rows = await readSpreadsheet(file);
                setRecords(rows);
                setFileName(`${file.name} · ${plural(rows.length, 'row')}`);
              } catch (err) {
                notify((err as Error).message, 'error');
              }
            }}
          />
        </div>

        {plan && counts && (
          <div className="space-y-3">
            {plan.missingRequiredHeaders.length > 0 && (
              <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">
                Missing column{plan.missingRequiredHeaders.length > 1 ? 's' : ''} <b>{plan.missingRequiredHeaders.join(', ')}</b> — rows can only update existing records.
              </p>
            )}
            {plan.unknownHeaders.length > 0 && (
              <p className="text-sm text-stone-600">Ignored columns: {plan.unknownHeaders.join(', ')}</p>
            )}
            <div className="flex flex-wrap gap-2 text-sm">
              <span className="rounded-full bg-brand-50 px-3 py-1 text-brand-800">{counts.create} new</span>
              <span className="rounded-full bg-sky-50 px-3 py-1 text-sky-800">{counts.update} updates</span>
              {counts.error > 0 && <span className="rounded-full bg-red-50 px-3 py-1 text-red-800">{counts.error} with errors (skipped)</span>}
              {plan.newRefs.length > 0 && (
                <span className="rounded-full bg-amber-50 px-3 py-1 text-amber-800">{plural(plan.newRefs.length, 'new list entry', 'new list entries')}</span>
              )}
            </div>
            <div className="max-h-96 overflow-auto rounded-lg border border-stone-200">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 bg-stone-50 text-xs text-stone-500 uppercase">
                  <tr>
                    <th className="px-3 py-2">Row</th>
                    <th className="px-3 py-2">Record</th>
                    <th className="px-3 py-2">Action</th>
                    <th className="px-3 py-2">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {plan.rows.map((r) => (
                    <tr key={r.row} className={r.action === 'error' ? 'bg-red-50/50' : ''}>
                      <td className="px-3 py-1.5 tabular-nums text-stone-500">{r.row}</td>
                      <td className="px-3 py-1.5">{r.label}</td>
                      <td className="px-3 py-1.5">
                        {r.action === 'error' ? (
                          <span className="inline-flex items-center gap-1 text-red-700">
                            <AlertTriangle size={14} /> Error
                          </span>
                        ) : r.action === 'create' ? (
                          'New'
                        ) : (
                          'Update'
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-xs">
                        {r.errors.map((e, i) => (
                          <div key={i} className="text-red-700">
                            {e}
                          </div>
                        ))}
                        {r.warnings.map((w, i) => (
                          <div key={i} className="text-amber-700">
                            {w}
                          </div>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="primary"
                disabled={busy || counts.create + counts.update === 0}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const res = await applyPlan(def, plan, uid, data, (done, total) => setProgress(`Writing ${done} of ${total}…`));
                    setRecords(null);
                    setProgress(
                      `Imported: ${res.created} new, ${res.updated} updated${res.refsCreated ? `, ${res.refsCreated} list entries created` : ''}.`,
                    );
                    notify('Import complete', 'success');
                  } catch (err) {
                    notify(`Import stopped: ${(err as Error).message}`, 'error');
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Import {counts.create + counts.update} rows
              </Button>
              <Button onClick={reset} disabled={busy}>
                Cancel
              </Button>
            </div>
          </div>
        )}
        {progress && (
          <p className="flex items-center gap-2 text-sm text-brand-800">
            <CheckCircle2 size={16} /> {progress}
          </p>
        )}
      </div>
    </Card>
  );
}

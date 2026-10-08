import { useState } from 'react';
import { Link } from 'react-router';
import { ClipboardList, Plus } from 'lucide-react';
import { SEED_CHECKLISTS, starterForms } from '@gear/shared';
import { useMe } from '../auth/AuthProvider';
import { sortedValues, useData } from '../data/DataProvider';
import { saveInspectionForm } from '../data/writes';
import { Badge, Button, Checkbox, Empty, LinkButton, PageHeader } from '../components/ui';
import { plural } from '../lib/format';
import { notify } from '../components/toast';

export function InspectionFormsPage() {
  const { uid, isManager } = useMe();
  const { inspectionForms, products } = useData();
  const [showInactive, setShowInactive] = useState(false);
  const [busy, setBusy] = useState(false);
  const forms = sortedValues(inspectionForms, showInactive);

  const usage = (formId: string) => [...products.values()].filter((p) => p.inspectionSchedules?.some((s) => s.formId === formId)).length;

  return (
    <div>
      <PageHeader
        title="Inspection forms"
        back={{ to: '/inspections', label: 'Inspections' }}
        subtitle="Checklists used to inspect gear. Each item says what failing it does to the gear’s status; products choose which forms they need and how often."
        actions={
          isManager && (
            <LinkButton to="/inspections/forms/new" variant="primary">
              <Plus size={16} /> New form
            </LinkButton>
          )
        }
      />
      <div className="mb-3 flex justify-end">
        <Checkbox label="Show inactive" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
      </div>
      {forms.length === 0 ? (
        <Empty title="No inspection forms yet">
          {isManager && (
            <div className="mt-3 flex flex-col items-center gap-2">
              <p>Start from the Gear Register’s checklists (textile, metal, rope, helmet, PFD, hull, inflatable, bike, paddle, general) and adjust them.</p>
              <Button
                variant="primary"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    for (const f of starterForms(SEED_CHECKLISTS)) await saveInspectionForm(uid, null, undefined, f);
                    notify('Starter forms added', 'success');
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <ClipboardList size={16} /> Add starter forms
              </Button>
            </div>
          )}
        </Empty>
      ) : (
        <ul className="card divide-y divide-stone-100">
          {forms.map((f) => (
            <li key={f.id}>
              <Link to={`/inspections/forms/${f.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-stone-50">
                <span className="min-w-0">
                  <span className="flex items-center gap-2 font-medium">
                    {f.name} {!f.active && <Badge>Inactive</Badge>}
                  </span>
                  <span className="block truncate text-xs text-stone-500">
                    {plural(f.items.length, 'item')} · version {f.version} · used by {plural(usage(f.id), 'product')}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

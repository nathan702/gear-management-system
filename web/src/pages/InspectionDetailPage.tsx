import { Link, useNavigate, useParams } from 'react-router';
import { deleteDoc, doc } from 'firebase/firestore';
import { Check, Minus, Trash2, X } from 'lucide-react';
import { STATUS_LABELS, type InspectionResponse } from '@gear/shared';
import { db } from '../firebase';
import { useMe } from '../auth/AuthProvider';
import { useData } from '../data/DataProvider';
import { Button, Card, Dl, PageHeader, Spinner, StatusBadge } from '../components/ui';
import { PhotoGallery, usePhotos } from '../photos/PhotoGallery';
import { useInspection } from '../inspections/useInspections';
import { fmtDate, fmtTimestamp } from '../lib/format';

const ICON = {
  pass: <Check size={16} className="text-brand-700" aria-label="Pass" />,
  fail: <X size={16} className="text-red-700" aria-label="Fail" />,
  na: <Minus size={16} className="text-stone-400" aria-label="Not applicable" />,
};

function answer(r: InspectionResponse) {
  if (r.type === 'number' && r.value != null && r.value !== '') return `${r.value} ${r.unit ?? ''}`.trim();
  if (r.type === 'text') return r.value ? String(r.value) : null;
  return null;
}

export function InspectionDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { isAdmin } = useMe();
  const { gear, users, productLabel } = useData();
  const insp = useInspection(id);
  const photos = usePhotos('inspectionId', id);

  if (insp === undefined) return <Spinner />;
  if (insp === null) return <PageHeader title="Inspection not found" back={{ to: '/inspections', label: 'Inspections' }} />;

  const g = gear.get(insp.gearId);
  const general = photos.filter((p) => !p.inspectionItemId);
  const processed = !!insp.processedAt;
  const failed = insp.responses.filter((r) => r.result === 'fail');

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader
        back={g ? { to: `/gear/${g.id}`, label: g.name } : { to: '/inspections', label: 'Inspections' }}
        title={insp.formName}
        subtitle={
          <>
            {g ? (
              <Link className="link" to={`/gear/${g.id}`}>
                {g.name}
              </Link>
            ) : (
              'Deleted gear'
            )}
            {insp.productId && ` · ${productLabel(insp.productId)}`} · {fmtDate(insp.date)} · {users.get(insp.inspectorId)?.displayName ?? 'Unknown inspector'}
          </>
        }
      />

      <Card title="Result">
        <Dl
          items={[
            ['Failed items', `${failed.length} of ${insp.responses.length}`],
            ['Calculated status', <StatusBadge key="c" status={insp.calculatedStatus} />],
            ...(insp.override
              ? ([['Overridden to', <span key="o"><StatusBadge status={insp.override.status} /> — {insp.override.reason}</span>]] as [string, React.ReactNode][])
              : []),
            [
              'Gear status',
              processed ? (
                insp.statusApplied ? (
                  insp.statusBefore && insp.statusBefore !== insp.statusApplied ? (
                    <span key="a">
                      <StatusBadge status={insp.statusBefore} /> → <StatusBadge status={insp.statusApplied} />
                    </span>
                  ) : (
                    <span key="a">
                      Stayed <StatusBadge status={insp.statusApplied} />
                    </span>
                  )
                ) : (
                  'Not changed (a newer inspection with this form was already recorded, or the gear is retired)'
                )
              ) : (
                <span key="p" className="text-sky-800">
                  Will be set to {STATUS_LABELS[insp.override?.status ?? insp.calculatedStatus]} once this syncs
                </span>
              ),
            ],
            ['Form version', insp.formVersion],
            ['Recorded', fmtTimestamp(insp.createdAt, true)],
          ]}
        />
        {insp.notes && <p className="mt-4 text-sm whitespace-pre-wrap">{insp.notes}</p>}
      </Card>

      <Card title="Checklist">
        <ol className="divide-y divide-stone-100">
          {insp.responses.map((r, i) => {
            const itemPhotos = photos.filter((p) => p.inspectionItemId === r.itemId);
            return (
              <li key={r.itemId} className={`flex gap-3 py-3 ${r.result === 'fail' ? 'bg-red-50/50' : ''}`}>
                <span className="w-5 shrink-0 text-right text-sm text-stone-400 tabular-nums">{i + 1}.</span>
                <span className="mt-0.5 shrink-0">{ICON[r.result]}</span>
                <div className="min-w-0 flex-1 text-sm">
                  <p className={r.result === 'fail' ? 'font-medium text-red-900' : ''}>{r.prompt}</p>
                  {answer(r) && <p className="text-stone-700">{answer(r)}</p>}
                  {r.comment && <p className="text-stone-600 italic">{r.comment}</p>}
                  {itemPhotos.length > 0 && (
                    <div className="mt-2 max-w-sm">
                      <PhotoGallery photos={itemPhotos} />
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </Card>

      {general.length > 0 && (
        <Card title="Photos">
          <PhotoGallery photos={general} />
        </Card>
      )}

      {isAdmin && (
        <Button
          variant="ghost"
          className="text-red-700"
          onClick={async () => {
            if (!confirm('Delete this inspection record? The gear’s status is not changed back.')) return;
            await deleteDoc(doc(db, 'inspections', insp.id));
            navigate(g ? `/gear/${g.id}` : '/inspections');
          }}
        >
          <Trash2 size={16} /> Delete record
        </Button>
      )}
    </div>
  );
}

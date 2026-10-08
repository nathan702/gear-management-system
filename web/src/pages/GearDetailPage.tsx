import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import { ArrowRightLeft, ClipboardCheck, Pencil, Printer, Trash2 } from 'lucide-react';
import QRCode from 'qrcode';
import {
  GEAR_STATUSES,
  STATUS_DESCRIPTIONS,
  STATUS_LABELS,
  ageYears,
  endOfLife,
  lifeUsedPercent,
  qrUrl,
  todayIso,
  type GearStatus,
  type StatusChange,
  type WithId,
} from '@gear/shared';
import { db } from '../firebase';
import { useMe } from '../auth/AuthProvider';
import { useData } from '../data/DataProvider';
import { deleteGear, updateGear } from '../data/writes';
import { Button, Card, Dl, Field, LinkButton, Modal, PageHeader, StatusBadge, Textarea } from '../components/ui';
import { AddPhotoButton, PhotoGallery, usePhotos } from '../photos/PhotoGallery';
import { fmtDate, fmtMoney, fmtTimestamp } from '../lib/format';
import { notify } from '../components/toast';
import { DueBadge, dueText, useInspectionSummaries } from '../inspections/common';
import { useInspections } from '../inspections/useInspections';

export function GearDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { uid, isManager, isAdmin } = useMe();
  const { gear, products, categories, programAreas, locations, users, settings, inspectionForms, productLabel } = useData();
  const g = gear.get(id);
  const photos = usePhotos('gearId', id);
  const [history, setHistory] = useState<(StatusChange & WithId)[]>([]);
  const [qr, setQr] = useState<string>('');
  const [statusOpen, setStatusOpen] = useState(false);
  const summary = useInspectionSummaries().get(id);
  const inspections = useInspections({ gearId: id, max: 20 });

  useEffect(
    () =>
      onSnapshot(query(collection(db, 'gear', id, 'statusHistory'), orderBy('at', 'desc')), (snap) =>
        setHistory(snap.docs.map((d) => ({ id: d.id, ...(d.data({ serverTimestamps: 'estimate' }) as StatusChange) }))),
      ),
    [id],
  );

  const base = settings.qrBaseUrl || window.location.origin;
  useEffect(() => {
    if (g) QRCode.toDataURL(qrUrl(base, g.qrCode), { margin: 1, width: 240 }).then(setQr);
  }, [g?.qrCode, base]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!g)
    return (
      <div>
        <PageHeader title="Gear not found" back={{ to: '/gear', label: 'Gear' }} />
        <p className="text-stone-600">This item may have been deleted.</p>
      </div>
    );

  const product = g.productId ? products.get(g.productId) : undefined;
  const category = product?.categoryId ? categories.get(product.categoryId) : undefined;
  const eol = endOfLife(g, product);
  const lifePct = lifeUsedPercent(g, product);
  const age = ageYears(g);
  const userName = (u: string | null | undefined) =>
    !u || u === 'system' || u === 'seed' ? 'System' : (users.get(u)?.displayName ?? 'Unknown user');

  return (
    <div className="space-y-5">
      <PageHeader
        back={{ to: '/gear', label: 'Gear' }}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {g.name} <StatusBadge status={g.status} />
          </span>
        }
        subtitle={
          <>
            {product ? <Link className="link" to={`/products/${product.id}`}>{productLabel(product.id)}</Link> : 'No product set'}
            {category && ` · ${category.name}`}
            {' · '}
            <span className="font-mono whitespace-nowrap">{g.qrCode}</span>
          </>
        }
        actions={
          <>
            {g.status !== 'retired' && (
              <LinkButton to={`/gear/${g.id}/inspect`} variant="primary">
                <ClipboardCheck size={16} /> Inspect
              </LinkButton>
            )}
            <AddPhotoButton links={{ gearId: g.id }} />
            {isManager && (
              <>
                <Button onClick={() => setStatusOpen(true)}>
                  <ArrowRightLeft size={16} /> Change status
                </Button>
                <LinkButton to={`/gear/${g.id}/edit`}>
                  <Pencil size={16} /> Edit
                </LinkButton>
              </>
            )}
          </>
        }
      />

      {g.status !== 'active' && g.statusReason && (
        <div
          className={`rounded-lg px-4 py-3 text-sm ${
            g.status === 'quarantined' ? 'bg-red-50 text-red-900' : g.status === 'has_issues' ? 'bg-amber-50 text-amber-900' : 'bg-stone-100 text-stone-700'
          }`}
        >
          <b>{STATUS_LABELS[g.status]}:</b> {g.statusReason}
          {g.status === 'retired' && g.retiredDate && ` (retired ${fmtDate(g.retiredDate)})`}
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-5">
          <Card title="Details">
            <Dl
              items={[
                ['Program area', g.programAreaId ? programAreas.get(g.programAreaId)?.name : null],
                ['Location', g.locationId ? locations.get(g.locationId)?.name : null],
                ['Serial number', g.serialNumber || null],
                ['Tags', g.tags?.length ? g.tags.join(', ') : null],
                ['Supplier', g.supplier || null],
                ['Purchased', g.purchaseDate ? `${fmtDate(g.purchaseDate)}${g.purchaseValue != null ? ` · ${fmtMoney(g.purchaseValue)}` : ''}` : g.purchaseValue != null ? fmtMoney(g.purchaseValue) : null],
                ['Standards', product?.standards || null],
              ]}
            />
          </Card>

          <Card title="Lifecycle">
            <Dl
              items={[
                ['Manufactured', g.mfgDate ? fmtDate(g.mfgDate) : null],
                ['First used', g.firstUseDate ? fmtDate(g.firstUseDate) : null],
                ['Age', age != null ? `${age} years` : null],
                ['Manufacturer lifetime', product?.lifetimeYears ? `${product.lifetimeYears} years` : null],
                ['End of life', eol ? `${fmtDate(eol)}${g.customEol ? ' (custom)' : ''}${eol < todayIso() ? ' — past end of life' : ''}` : null],
              ]}
            />
            {lifePct != null && (
              <div className="mt-4">
                <div className="h-2 overflow-hidden rounded-full bg-stone-200" role="img" aria-label={`${lifePct}% of service life used`}>
                  <div
                    className={`h-full ${lifePct >= 100 ? 'bg-red-600' : lifePct >= 80 ? 'bg-amber-500' : 'bg-brand-500'}`}
                    style={{ width: `${Math.min(100, lifePct)}%` }}
                  />
                </div>
                <p className="mt-1 text-xs text-stone-500">{lifePct}% of service life used</p>
              </div>
            )}
          </Card>

          <Card title={`Photos (${photos.length})`} actions={<AddPhotoButton links={{ gearId: g.id }} label="Add" />}>
            <PhotoGallery photos={photos} />
          </Card>

          {!!(g.notes || g.links?.length || product?.links?.length) && (
            <Card title="Notes & documents">
              {g.notes && <p className="mb-3 text-sm whitespace-pre-wrap">{g.notes}</p>}
              <ul className="space-y-1 text-sm">
                {[...(g.links ?? []), ...(product?.links ?? [])].map((l, i) => (
                  <li key={i}>
                    <a className="link" href={l.url} target="_blank" rel="noreferrer">
                      {l.label || l.url}
                    </a>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        <div className="space-y-5">
          <Card title="QR label" actions={<LinkButton size="sm" to={`/labels?ids=${g.id}`}><Printer size={14} /> Print</LinkButton>}>
            <div className="flex items-center gap-4">
              {qr && <img src={qr} alt={`QR code ${g.qrCode}`} className="size-28 rounded border border-stone-200" />}
              <div className="text-sm">
                <div className="font-mono text-base font-semibold">{g.qrCode}</div>
                <p className="mt-1 text-stone-600">Scanning opens this page.</p>
              </div>
            </div>
          </Card>

          <Card title="Inspections" actions={summary && <DueBadge state={summary.state} />}>
            {summary && summary.schedules.length > 0 ? (
              <ul className="mb-4 space-y-2 text-sm">
                {summary.schedules.map((s) => (
                  <li key={s.schedule.formId} className="flex items-center justify-between gap-2">
                    <span className="min-w-0">
                      <Link className="link" to={`/gear/${g.id}/inspect?form=${s.schedule.formId}`}>
                        {inspectionForms.get(s.schedule.formId)?.name ?? 'Deleted form'}
                      </Link>
                      <span className="block text-xs text-stone-500">
                        {s.lastDate ? `Last ${fmtDate(s.lastDate)}` : 'Never inspected'}
                        {dueText(s) && ` · ${dueText(s)}`}
                      </span>
                    </span>
                    <DueBadge state={s.state} short />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mb-4 text-sm text-stone-500">
                {g.status === 'retired' ? 'Retired gear isn’t inspected.' : 'No inspection schedule for this product.'}
              </p>
            )}
            {inspections && inspections.length > 0 && (
              <ul className="divide-y divide-stone-100 border-t border-stone-100 text-sm">
                {inspections.map((i) => (
                  <li key={i.id}>
                    <Link to={`/inspections/${i.id}`} className="flex items-center justify-between gap-2 py-2 hover:bg-stone-50">
                      <span className="min-w-0">
                        <span className="block truncate">{i.formName}</span>
                        <span className="block text-xs text-stone-500">
                          {fmtDate(i.date)} · {userName(i.inspectorId)}
                          {i.failedCount > 0 && ` · ${i.failedCount} failed`}
                        </span>
                      </span>
                      <StatusBadge status={i.override?.status ?? i.calculatedStatus} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Status history">
            {history.length ? (
              <ol className="space-y-3 text-sm">
                {history.map((h) => (
                  <li key={h.id} className="border-l-2 border-stone-200 pl-3">
                    <div className="flex flex-wrap items-center gap-2">
                      {h.from && (
                        <>
                          <StatusBadge status={h.from} /> →
                        </>
                      )}
                      <StatusBadge status={h.to} />
                    </div>
                    {h.reason && <p className="mt-1">{h.reason}</p>}
                    <p className="text-xs text-stone-500">
                      {userName(h.by)} · {fmtTimestamp(h.at, true)}
                      {h.source !== 'manual' && h.source !== 'created' && ` · via ${h.source.replace('_', ' ')}`}
                    </p>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-sm text-stone-500">No changes recorded yet.</p>
            )}
          </Card>

          <p className="px-1 text-xs text-stone-500">
            Added {fmtTimestamp(g.createdAt)} by {userName(g.createdBy)} · updated {fmtTimestamp(g.updatedAt)} by {userName(g.updatedBy)}
          </p>
          {isAdmin && (
            <Button
              variant="ghost"
              className="text-red-700"
              onClick={async () => {
                if (!confirm(`Delete ${g.name} permanently? Retiring keeps its history — delete only records added by mistake.`)) return;
                await deleteGear(g.id, g.qrCode);
                notify(`${g.name} deleted`);
                navigate('/gear');
              }}
            >
              <Trash2 size={16} /> Delete record
            </Button>
          )}
        </div>
      </div>

      <StatusModal
        open={statusOpen}
        onClose={() => setStatusOpen(false)}
        current={g.status}
        onSave={async (status, reason) => {
          await updateGear(
            uid,
            g.id,
            g,
            { status, ...(status === 'retired' ? { retiredDate: g.retiredDate || todayIso(), retiredReason: reason } : {}) },
            { reason, source: 'manual' },
          );
          setStatusOpen(false);
          notify(`${g.name}: status set to ${STATUS_LABELS[status]}`, 'success');
        }}
      />
    </div>
  );
}

function StatusModal({
  open,
  onClose,
  current,
  onSave,
}: {
  open: boolean;
  onClose(): void;
  current: GearStatus;
  onSave(status: GearStatus, reason: string): Promise<void>;
}) {
  const [status, setStatus] = useState<GearStatus>(current);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setStatus(current);
      setReason('');
    }
  }, [open, current]);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Change status"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={busy || status === current || !reason.trim()}
            onClick={async () => {
              setBusy(true);
              try {
                await onSave(status, reason.trim());
              } finally {
                setBusy(false);
              }
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-2">
          {GEAR_STATUSES.map((s) => (
            <label key={s} className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${status === s ? 'border-brand-500 bg-brand-50' : 'border-stone-200'}`}>
              <input type="radio" name="status" className="mt-1 accent-brand-700" checked={status === s} onChange={() => setStatus(s)} />
              <span>
                <span className="block text-sm font-medium">
                  {STATUS_LABELS[s]} {s === current && <span className="text-stone-500">(current)</span>}
                </span>
                <span className="block text-xs text-stone-600">{STATUS_DESCRIPTIONS[s]}</span>
              </span>
            </label>
          ))}
        </div>
        <Field label="Reason (required)" hint="Recorded in the status history.">
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Repaired tube seam, passed pressure test" />
        </Field>
      </div>
    </Modal>
  );
}

import { Link, useNavigate, useParams } from 'react-router';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { GEAR_STATUSES, STATUS_LABELS, ageYears } from '@gear/shared';
import { useMe } from '../auth/AuthProvider';
import { byName, useData } from '../data/DataProvider';
import { deleteDocument } from '../data/writes';
import { Badge, Button, Card, Dl, Empty, LinkButton, PageHeader, StatusBadge } from '../components/ui';
import { fmtMoney } from '../lib/format';
import { notify } from '../components/toast';

export function ProductDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { isManager, isAdmin } = useMe();
  const { products, categories, manufacturers, gear, locations, inspectionForms, productLabel } = useData();
  const p = products.get(id);
  if (!p) return <PageHeader title="Product not found" back={{ to: '/products', label: 'Products' }} />;

  const items = [...gear.values()].filter((g) => g.productId === id).sort(byName);
  const inService = items.filter((g) => g.status !== 'retired');
  const ages = inService.map((g) => ageYears(g)).filter((a): a is number => a != null);
  const avgAge = ages.length ? Math.round((ages.reduce((s, a) => s + a, 0) / ages.length) * 10) / 10 : null;
  const maker = p.manufacturerId ? manufacturers.get(p.manufacturerId) : undefined;

  return (
    <div className="space-y-5">
      <PageHeader
        back={{ to: '/products', label: 'Products' }}
        title={
          <span className="flex flex-wrap items-center gap-2">
            {productLabel(p.id)}
            {p.isPpe && <Badge className="bg-sky-50 text-sky-800">PPE</Badge>}
            {!p.active && <Badge>Inactive</Badge>}
          </span>
        }
        subtitle={(p.categoryId && categories.get(p.categoryId)?.name) || 'Uncategorized'}
        actions={
          isManager && (
            <>
              <LinkButton to={`/gear/new?product=${p.id}`} variant="primary">
                <Plus size={16} /> Add gear
              </LinkButton>
              <LinkButton to={`/products/${p.id}/edit`}>
                <Pencil size={16} /> Edit
              </LinkButton>
            </>
          )
        }
      />

      <div className="grid gap-5 lg:grid-cols-[1fr_1.4fr]">
        <div className="space-y-5">
          <Card title="Details">
            <Dl
              items={[
                ['Manufacturer', maker ? (maker.website ? <a className="link" href={maker.website} target="_blank" rel="noreferrer">{maker.name}</a> : maker.name) : null],
                ['Model', p.model],
                ['Variant', p.variant || null],
                ['Lifetime', p.lifetimeYears ? `${p.lifetimeYears} years` : null],
                ['Replacement cost', p.replacementCost != null ? fmtMoney(p.replacementCost) : null],
                ['Standards', p.standards || null],
              ]}
            />
            {p.notes && <p className="mt-4 text-sm whitespace-pre-wrap">{p.notes}</p>}
            {!!p.links?.length && (
              <ul className="mt-4 space-y-1 text-sm">
                {p.links.map((l, i) => (
                  <li key={i}>
                    <a className="link" href={l.url} target="_blank" rel="noreferrer">
                      {l.label || l.url}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Inspection schedule">
            {p.inspectionSchedules?.length ? (
              <ul className="space-y-1 text-sm">
                {p.inspectionSchedules.map((s) => (
                  <li key={s.formId}>
                    <Link className="link" to={`/inspections/forms/${s.formId}`}>
                      {inspectionForms.get(s.formId)?.name ?? 'Deleted form'}
                    </Link>
                    <span className="text-stone-600">
                      {' — '}
                      {[
                        s.kind === 'in_service' ? `in-service, every ${s.everyDaysInUse && s.everyDaysInUse > 1 ? `${s.everyDaysInUse} days` : 'day'} in use` : null,
                        s.kind !== 'in_service' && s.everyMonths ? `every ${s.everyMonths} month${s.everyMonths === 1 ? '' : 's'}` : null,
                        s.everyDaysUsed ? `every ${s.everyDaysUsed} days used` : null,
                        s.beforeEachCheckout ? 'before each check-out' : null,
                      ]
                        .filter(Boolean)
                        .join(', or ')}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-stone-500">Not inspected on a schedule.</p>
            )}
          </Card>
          <Card title="Fleet">
            <Dl
              items={[
                ...GEAR_STATUSES.map((s) => [STATUS_LABELS[s], items.filter((g) => g.status === s).length] as [string, number]),
                ['Average age', avgAge != null ? `${avgAge} years` : null],
              ]}
            />
          </Card>
          {isAdmin && items.length === 0 && (
            <Button
              variant="ghost"
              className="text-red-700"
              onClick={async () => {
                if (!confirm('Delete this product?')) return;
                await deleteDocument('products', p.id);
                notify('Product deleted');
                navigate('/products');
              }}
            >
              <Trash2 size={16} /> Delete product
            </Button>
          )}
        </div>
        <Card title={`Gear (${items.length})`}>
          {items.length ? (
            <ul className="divide-y divide-stone-100">
              {items.map((g) => (
                <li key={g.id}>
                  <Link to={`/gear/${g.id}`} className="flex items-center justify-between gap-3 py-2 hover:bg-stone-50">
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{g.name}</span>
                      <span className="block text-xs text-stone-500">
                        <span className="font-mono">{g.qrCode}</span>
                        {g.locationId && ` · ${locations.get(g.locationId)?.name ?? ''}`}
                      </span>
                    </span>
                    <StatusBadge status={g.status} />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <Empty title="No gear of this product yet" />
          )}
        </Card>
      </div>
    </div>
  );
}

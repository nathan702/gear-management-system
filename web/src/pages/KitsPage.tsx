import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Plus } from 'lucide-react';
import { kitIsLive, todayIso } from '@gear/shared';
import { useMe } from '../auth/AuthProvider';
import { useData } from '../data/DataProvider';
import { Empty, LinkButton, PageHeader } from '../components/ui';
import { KitStatusBadge, type KitDoc } from '../kits/common';
import { fmtDate, plural } from '../lib/format';

const VIEWS = [
  ['mine', 'My kits'],
  ['current', 'Current'],
  ['upcoming', 'Upcoming'],
  ['all', 'All active'],
  ['past', 'Past'],
] as const;

export function kitDates(k: Pick<KitDoc, 'startDate' | 'endDate'>) {
  if (!k.startDate && !k.endDate) return 'No dates';
  if (k.startDate && k.endDate) return `${fmtDate(k.startDate)} – ${fmtDate(k.endDate)}`;
  return k.startDate ? `From ${fmtDate(k.startDate)}` : `Until ${fmtDate(k.endDate)}`;
}

export function KitsPage() {
  const { uid } = useMe();
  const { kits, users, programAreas } = useData();
  const [params, setParams] = useSearchParams();
  const view = (params.get('view') ?? 'mine') as (typeof VIEWS)[number][0];
  const today = todayIso();

  const list = useMemo(() => {
    const all = [...kits.values()];
    const live = (k: KitDoc) => kitIsLive(k, today);
    const current = (k: KitDoc) => k.status === 'checked_out' || (live(k) && (!k.startDate || k.startDate <= today));
    const filtered = all.filter((k) => {
      switch (view) {
        case 'mine':
          return k.ownerId === uid && live(k);
        case 'current':
          return current(k);
        case 'upcoming':
          return live(k) && k.status === 'planned' && !!k.startDate && k.startDate > today;
        case 'all':
          return live(k);
        case 'past':
          return !live(k);
      }
    });
    return filtered.sort((a, b) =>
      view === 'past' ? (b.endDate ?? b.returnedDate ?? '').localeCompare(a.endDate ?? a.returnedDate ?? '') : (a.startDate ?? '').localeCompare(b.startDate ?? ''),
    );
  }, [kits, view, uid, today]);

  return (
    <div>
      <PageHeader
        title="Kits"
        subtitle="The actual gear someone is using — for a camp week, a trip or a season. Everyone can see every kit."
        actions={
          <LinkButton to="/kits/new" variant="primary">
            <Plus size={16} /> New kit
          </LinkButton>
        }
      />
      <div className="mb-4 flex gap-1 overflow-x-auto border-b border-stone-200">
        {VIEWS.map(([k, label]) => (
          <button
            key={k}
            onClick={() => setParams(k === 'mine' ? {} : { view: k })}
            className={`border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap ${k === view ? 'border-brand-700 text-brand-800' : 'border-transparent text-stone-600 hover:text-stone-900'}`}
          >
            {label}
          </button>
        ))}
      </div>
      {list.length === 0 ? (
        <Empty title="No kits here">
          {view === 'mine' && (
            <>
              <Link className="link" to="/kits/new">
                Build a kit
              </Link>{' '}
              — start from a <Link className="link" to="/lists">list</Link> to pick gear quickly.
            </>
          )}
        </Empty>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {list.map((k) => (
            <li key={k.id}>
              <Link to={`/kits/${k.id}`} className="card block p-4 hover:shadow-md">
                <div className="flex items-start justify-between gap-2">
                  <span className="font-medium">{k.name}</span>
                  <KitStatusBadge status={k.status} />
                </div>
                <div className="mt-1 text-sm text-stone-600">{kitDates(k)}</div>
                <div className="mt-1 text-xs text-stone-500">
                  {[users.get(k.ownerId)?.displayName, k.programAreaId && programAreas.get(k.programAreaId)?.name, plural(k.gearIds.length, 'item')]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

import { Link } from 'react-router';
import { Plus, QrCode } from 'lucide-react';
import { GEAR_STATUSES, STATUS_DESCRIPTIONS, STATUS_LABELS, type GearStatus } from '@gear/shared';
import { useMe } from '../auth/AuthProvider';
import { byName, useData } from '../data/DataProvider';
import { Card, Empty, LinkButton, StatusBadge } from '../components/ui';
import { fmtMoney, fmtTimestamp, plural } from '../lib/format';

const TILE: Record<GearStatus, string> = {
  active: 'border-brand-200 bg-brand-50 text-brand-900',
  has_issues: 'border-amber-200 bg-amber-50 text-amber-900',
  quarantined: 'border-red-200 bg-red-50 text-red-900',
  retired: 'border-stone-200 bg-stone-100 text-stone-700',
};

export function HomePage() {
  const { profile, isManager } = useMe();
  const { gear, programAreas } = useData();
  const all = [...gear.values()];
  const counts = Object.fromEntries(GEAR_STATUSES.map((s) => [s, all.filter((g) => g.status === s).length])) as Record<GearStatus, number>;
  const inService = all.filter((g) => g.status !== 'retired');
  const value = inService.reduce((s, g) => s + (g.purchaseValue ?? 0), 0);
  const needsAttention = all.filter((g) => g.status === 'quarantined' || g.status === 'has_issues').sort(byName);
  const byProgram = [...programAreas.values()]
    .map((p) => ({ p, n: inService.filter((g) => g.programAreaId === p.id).length }))
    .filter((x) => x.n)
    .sort((a, b) => b.n - a.n);
  const recent = [...all].sort((a, b) => (b.createdAt?.toMillis() ?? 0) - (a.createdAt?.toMillis() ?? 0)).slice(0, 6);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Hi, {profile.displayName.split(' ')[0]}</h1>
          <p className="text-sm text-stone-600">
            {plural(inService.length, 'item')} in service{value ? ` · ${fmtMoney(value)} purchase value` : ''}
          </p>
        </div>
        <div className="flex gap-2">
          <LinkButton to="/scan" variant="primary">
            <QrCode size={16} /> Scan gear
          </LinkButton>
          {isManager && (
            <LinkButton to="/gear/new">
              <Plus size={16} /> Add gear
            </LinkButton>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {GEAR_STATUSES.map((s) => (
          <Link key={s} to={`/gear?status=${s}`} className={`rounded-xl border p-4 transition hover:shadow-sm ${TILE[s]}`}>
            <div className="text-3xl font-semibold tabular-nums">{counts[s]}</div>
            <div className="text-sm font-medium">{STATUS_LABELS[s]}</div>
            <div className="text-xs opacity-75">{STATUS_DESCRIPTIONS[s]}</div>
          </Link>
        ))}
      </div>

      {all.length === 0 ? (
        <Empty title="No gear yet">
          {isManager ? (
            <>
              Start by adding <Link className="link" to="/products/new">products</Link>, then{' '}
              <Link className="link" to="/gear/new">gear</Link> — or bulk-load a spreadsheet from{' '}
              <Link className="link" to="/admin/import-export">Import / export</Link>.
            </>
          ) : (
            'A manager will add the gear inventory soon.'
          )}
        </Empty>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
          <Card title="Needs attention">
            {needsAttention.length ? (
              <ul className="divide-y divide-stone-100">
                {needsAttention.slice(0, 12).map((g) => (
                  <li key={g.id}>
                    <Link to={`/gear/${g.id}`} className="flex items-center justify-between gap-3 py-2 hover:bg-stone-50">
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{g.name}</span>
                        <span className="block truncate text-xs text-stone-500">{g.statusReason}</span>
                      </span>
                      <StatusBadge status={g.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-stone-600">Nothing quarantined or flagged with issues.</p>
            )}
          </Card>
          <div className="space-y-4">
            <Card title="In service by program">
              <ul className="space-y-1 text-sm">
                {byProgram.map(({ p, n }) => (
                  <li key={p.id} className="flex justify-between">
                    <Link className="hover:underline" to={`/gear?program=${p.id}`}>
                      {p.name}
                    </Link>
                    <span className="tabular-nums text-stone-600">{n}</span>
                  </li>
                ))}
                {!byProgram.length && <li className="text-stone-500">No gear assigned to programs yet.</li>}
              </ul>
            </Card>
            <Card title="Recently added">
              <ul className="space-y-1 text-sm">
                {recent.map((g) => (
                  <li key={g.id} className="flex justify-between gap-2">
                    <Link className="truncate hover:underline" to={`/gear/${g.id}`}>
                      {g.name}
                    </Link>
                    <span className="shrink-0 text-stone-500">{fmtTimestamp(g.createdAt)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

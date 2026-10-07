import { useMemo, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router';
import { Link2, Plus, QrCode } from 'lucide-react';
import { normalizeQrCode } from '@gear/shared';
import { useMe } from '../auth/AuthProvider';
import { byName, useData } from '../data/DataProvider';
import { updateGear } from '../data/writes';
import { Button, Card, Input, LinkButton, PageHeader, StatusBadge } from '../components/ui';
import { notify } from '../components/toast';

/** /q/:code — where every QR label points. */
export function QrResolvePage() {
  const { code: raw = '' } = useParams();
  const code = normalizeQrCode(decodeURIComponent(raw));
  const { gear } = useData();
  const match = code ? [...gear.values()].find((g) => g.qrCode === code) : undefined;
  if (match) return <Navigate to={`/gear/${match.id}`} replace />;
  return <UnassignedTag code={code} />;
}

function UnassignedTag({ code }: { code: string | null }) {
  const { uid, isManager } = useMe();
  const { gear, productLabel } = useData();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return [];
    return [...gear.values()]
      .filter((g) => `${g.name} ${g.qrCode} ${g.serialNumber ?? ''} ${productLabel(g.productId)}`.toLowerCase().includes(needle))
      .sort(byName)
      .slice(0, 20);
  }, [q, gear, productLabel]);

  if (!code)
    return (
      <div>
        <PageHeader title="Unreadable code" back={{ to: '/scan', label: 'Scan again' }} />
        <p className="text-stone-600">That QR code doesn’t contain a gear code this app understands.</p>
      </div>
    );

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <PageHeader
        back={{ to: '/scan', label: 'Scan again' }}
        title={
          <span className="flex items-center gap-2">
            <QrCode size={22} /> <span className="font-mono">{code}</span>
          </span>
        }
        subtitle="This tag isn’t attached to any gear yet."
      />
      {isManager ? (
        <>
          <Card title="New gear with this tag">
            <p className="mb-3 text-sm text-stone-600">Use this for a pre-printed tag on an item that isn’t in the system yet.</p>
            <LinkButton to={`/gear/new?qr=${encodeURIComponent(code)}`} variant="primary">
              <Plus size={16} /> Add gear with this tag
            </LinkButton>
          </Card>
          <Card title="Attach to existing gear">
            <p className="mb-3 text-sm text-stone-600">
              Replaces the item’s current code — its old label will stop working.
            </p>
            <Input type="search" placeholder="Search gear by name, code or serial…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
            <ul className="mt-3 divide-y divide-stone-100">
              {results.map((g) => (
                <li key={g.id} className="flex items-center justify-between gap-3 py-2">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{g.name}</span>
                    <span className="block truncate text-xs text-stone-500">
                      <span className="font-mono">{g.qrCode}</span> · {productLabel(g.productId) || 'No product'}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <StatusBadge status={g.status} />
                    <Button
                      size="sm"
                      onClick={async () => {
                        if (!confirm(`Attach ${code} to ${g.name}? Its current code ${g.qrCode} will stop working.`)) return;
                        await updateGear(uid, g.id, g, { qrCode: code });
                        notify(`${code} attached to ${g.name}`, 'success');
                        navigate(`/gear/${g.id}`, { replace: true });
                      }}
                    >
                      <Link2 size={14} /> Attach
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </>
      ) : (
        <p className="text-stone-600">Ask a manager to attach this tag to a piece of gear.</p>
      )}
    </div>
  );
}

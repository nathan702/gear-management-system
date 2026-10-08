import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Plus, Search } from 'lucide-react';
import { useMe } from '../auth/AuthProvider';
import { compareText, sortedValues, useData } from '../data/DataProvider';
import { Badge, Checkbox, Empty, Input, LinkButton, PageHeader, Select } from '../components/ui';
import { fmtMoney, plural } from '../lib/format';

export function ProductsPage() {
  const { isManager } = useMe();
  const { products, categories, gear, productLabel } = useData();
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [showInactive, setShowInactive] = useState(false);

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const g of gear.values()) if (g.productId && g.status !== 'retired') m.set(g.productId, (m.get(g.productId) ?? 0) + 1);
    return m;
  }, [gear]);

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = [...products.values()].filter(
      (p) =>
        (showInactive || p.active) &&
        (!category || p.categoryId === category) &&
        (!needle || productLabel(p.id).toLowerCase().includes(needle)),
    );
    const byCat = new Map<string, typeof list>();
    for (const p of list) {
      const key = (p.categoryId && categories.get(p.categoryId)?.name) || 'Uncategorized';
      if (!byCat.has(key)) byCat.set(key, []);
      byCat.get(key)!.push(p);
    }
    return [...byCat.entries()]
      .sort(([a], [b]) => compareText(a, b))
      .map(([cat, ps]) => [cat, ps.sort((a, b) => compareText(productLabel(a.id), productLabel(b.id)))] as const);
  }, [products, categories, q, category, showInactive, productLabel]);

  return (
    <div>
      <PageHeader
        title="Products"
        subtitle="Makes and models we own — each piece of gear belongs to one."
        actions={
          isManager && (
            <LinkButton to="/products/new" variant="primary">
              <Plus size={16} /> Add product
            </LinkButton>
          )
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-60 flex-1">
          <Search size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-stone-400" />
          <Input type="search" className="pl-9" placeholder="Search products…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search products" />
        </div>
        <Select className="w-auto" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
          <option value="">All categories</option>
          {sortedValues(categories).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <Checkbox label="Show inactive" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
      </div>

      {groups.length === 0 ? (
        <Empty title={products.size ? 'No products match' : 'No products yet'}>
          {!products.size && isManager && (
            <Link className="link" to="/products/new">
              Add the first product
            </Link>
          )}
        </Empty>
      ) : (
        <div className="space-y-6">
          {groups.map(([cat, list]) => (
            <section key={cat}>
              <h2 className="mb-2 text-xs font-semibold tracking-wide text-stone-500 uppercase">{cat}</h2>
              <ul className="card divide-y divide-stone-100">
                {list.map((p) => (
                  <li key={p.id}>
                    <Link to={`/products/${p.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-stone-50">
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{productLabel(p.id)}</span>
                        <span className="block text-xs text-stone-500">
                          {[p.lifetimeYears ? `${p.lifetimeYears}-yr life` : null, p.replacementCost != null ? `${fmtMoney(p.replacementCost)} to replace` : null]
                            .filter(Boolean)
                            .join(' · ') || ' '}
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        {p.isPpe && <Badge className="bg-sky-50 text-sky-800">PPE</Badge>}
                        {!p.active && <Badge>Inactive</Badge>}
                        <span className="text-sm text-stone-600 tabular-nums">{plural(counts.get(p.id) ?? 0, 'item')}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

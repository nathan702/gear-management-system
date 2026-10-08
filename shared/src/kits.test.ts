import { describe, expect, it } from 'vitest';
import { fillFromList, gearAvailability, inclusiveDays, isBlocked, kitConflicts, kitIsLive, rangesOverlap } from './kits';

const today = '2026-10-08';

describe('kit dates', () => {
  it('treats missing dates as open-ended', () => {
    expect(rangesOverlap(['2026-06-01', '2026-06-07'], ['2026-06-07', '2026-06-14'])).toBe(true);
    expect(rangesOverlap(['2026-06-01', '2026-06-06'], ['2026-06-07', '2026-06-14'])).toBe(false);
  });

  it('finds other live kits holding the gear on overlapping dates', () => {
    const kits = [
      { id: 'a', name: 'Camp wk1', startDate: '2026-10-10', endDate: '2026-10-16', gearIds: ['g1'], status: 'planned' as const },
      { id: 'b', name: 'Camp wk2', startDate: '2026-10-17', endDate: '2026-10-23', gearIds: ['g1'], status: 'planned' as const },
      { id: 'c', name: 'Undated', startDate: null, endDate: null, gearIds: ['g2'], status: 'planned' as const },
      { id: 'd', name: 'Old', startDate: '2026-09-01', endDate: '2026-09-05', gearIds: ['g1'], status: 'planned' as const },
      { id: 'e', name: 'Returned', startDate: null, endDate: null, gearIds: ['g1'], status: 'returned' as const },
    ];
    const mine = { startDate: '2026-10-15', endDate: '2026-10-18' };
    expect(kitConflicts('g1', mine, kits, today).map((k) => k.id)).toEqual(['a', 'b']);
    expect(kitConflicts('g1', { startDate: '2026-10-24', endDate: null }, kits, today)).toEqual([]);
    // An undated kit holds its gear indefinitely.
    expect(kitConflicts('g2', { startDate: '2030-01-01', endDate: '2030-01-02' }, kits, today).map((k) => k.id)).toEqual(['c']);
    // The kit being edited doesn't conflict with itself.
    expect(kitConflicts('g1', { ...mine, id: 'a' }, kits, today).map((k) => k.id)).toEqual(['b']);
  });

  it('knows which kits are still live', () => {
    expect(kitIsLive({ status: 'planned', endDate: '2026-10-07' }, today)).toBe(false);
    expect(kitIsLive({ status: 'checked_out', endDate: '2026-10-01' }, today)).toBe(true);
    expect(kitIsLive({ status: 'planned', endDate: null }, today)).toBe(true);
  });

  it('counts days inclusively', () => {
    expect(inclusiveDays('2026-06-01', '2026-06-05')).toBe(5);
    expect(inclusiveDays('2026-06-05', '2026-06-01')).toBe(0);
  });
});

describe('availability', () => {
  const ok = { inOtherKit: false, checkedOut: false };
  it('blocks staff and warns admins about problem gear', () => {
    const q = gearAvailability({ status: 'quarantined' }, 'ok', ok);
    expect(q.problems).toEqual(['quarantined']);
    expect(isBlocked('staff', q)).toBe(true);
    expect(isBlocked('manager', q)).toBe(true);
    expect(isBlocked('admin', q)).toBe(false);
    const overdue = gearAvailability({ status: 'active' }, 'overdue', ok);
    expect(isBlocked('admin', overdue)).toBe(false);
    expect(isBlocked('staff', overdue)).toBe(true);
  });
  it('never allows retired or double-booked gear', () => {
    expect(isBlocked('admin', gearAvailability({ status: 'retired' }, 'none', ok))).toBe(true);
    expect(isBlocked('admin', gearAvailability({ status: 'active' }, 'ok', { inOtherKit: true, checkedOut: false }))).toBe(true);
  });
  it('only warns about gear with issues or due soon', () => {
    const a = gearAvailability({ status: 'has_issues' }, 'due_soon', ok);
    expect(a).toEqual({ problems: [], warnings: ['has_issues', 'inspection_due_soon'] });
    expect(isBlocked('staff', a)).toBe(false);
  });
});

describe('fillFromList', () => {
  const products = new Map([
    ['otter', { categoryId: 'rafts' }],
    ['pfd-m', { categoryId: 'pfds' }],
    ['pfd-l', { categoryId: 'pfds' }],
  ]);
  const gear = new Map([
    ['r1', { productId: 'otter' }],
    ['r2', { productId: 'otter' }],
    ['p1', { productId: 'pfd-m' }],
    ['p2', { productId: 'pfd-l' }],
    ['p3', { productId: 'pfd-m' }],
  ]);
  const candidates = [...gear].map(([id, g]) => ({ id, ...g }));

  it('counts what the kit has and suggests the rest, products before categories', () => {
    const list = {
      lines: [
        { id: 'l1', categoryId: 'pfds', quantity: 2 },
        { id: 'l2', productId: 'pfd-m', quantity: 2 },
        { id: 'l3', productId: 'otter', quantity: 3 },
      ],
    };
    const fill = fillFromList(list, ['r1', 'p1'], candidates, gear, products);
    expect(fill[1]).toMatchObject({ have: ['p1'], suggest: ['p3'], missing: 0 });
    expect(fill[0]).toMatchObject({ have: [], suggest: ['p2'], missing: 1 });
    expect(fill[2]).toMatchObject({ have: ['r1'], suggest: ['r2'], missing: 1 });
  });
});

describe('list spreadsheets', () => {
  it('round-trips lists and reports bad rows', async () => {
    const { listsToRows, planListImport } = await import('./kitIO');
    const lookups = { productLabel: (id: string) => (id === 'otter' ? 'NRS Otter 130' : '?'), categoryName: (id: string) => (id === 'pfds' ? 'PFDs' : '?'), programAreaName: (id: string | null) => (id ? 'River School' : '') };
    const list = { name: 'Day trip', description: '', programAreaId: 'river', lines: [{ id: 'a', productId: 'otter', quantity: 2 }, { id: 'b', categoryId: 'pfds', quantity: 12, notes: 'mixed sizes' }] };
    const rows = listsToRows([list], lookups).map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, String(v)])));
    const refs = { products: new Map([['nrs otter 130', 'otter']]), categories: new Map([['pfds', 'pfds']]), programAreas: new Map([['river school', 'river']]) };
    const plan = planListImport([...rows, { list: 'Day trip', quantity: '0', product: 'NRS Otter 130' }, { list: 'Day trip', product: 'Mystery' }], [{ id: 'L1', name: 'day trip' }], refs);
    expect(plan.lists[0]).toMatchObject({ id: 'L1', programAreaId: 'river' });
    expect(plan.lists[0].lines.map(({ productId, categoryId, quantity, notes }) => ({ productId, categoryId, quantity, notes }))).toEqual([
      { productId: 'otter', categoryId: null, quantity: 2, notes: '' },
      { productId: null, categoryId: 'pfds', quantity: 12, notes: 'mixed sizes' },
    ]);
    expect(plan.lists[0].errors).toEqual(['row 4: quantity must be a whole number of at least 1', 'row 5: no product named "Mystery"']);
  });
});

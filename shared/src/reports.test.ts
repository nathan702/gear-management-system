import { describe, expect, it } from 'vitest';
import { groupGear, lifeRow, monthsBetween, overlapDays, periodKey, replacementForecast, usageByGear, workOrderStats } from './reports';

const g = (id: string, extra: Record<string, unknown> = {}) => ({ id, status: 'active' as const, purchaseDate: '2020-01-01', purchaseValue: 100, ...extra });

describe('lifecycle rows', () => {
  it('works out age, end of life, months left and replacement cost', () => {
    const r = lifeRow(g('a'), { lifetimeYears: 10, replacementCost: 250 }, '2026-01-01');
    expect(r).toMatchObject({ ageYears: 6, endOfLife: '2030-01-01', lifeUsedPercent: 60, monthsLeft: 47, replacementCost: 250 });
    expect(lifeRow(g('b'), { lifetimeYears: null }, '2026-01-01').replacementCost).toBe(100);
  });
});

describe('grouping', () => {
  it('counts statuses, sums value and averages age', () => {
    const rows = groupGear([g('a', { programAreaId: 'x' }), g('b', { programAreaId: 'x', status: 'quarantined', purchaseDate: '2024-01-01' }), g('c', { purchaseDate: null })], (x) => (x as { programAreaId?: string }).programAreaId, '2026-01-01');
    expect(rows[0]).toMatchObject({ key: 'x', count: 2, value: 200, avgAgeYears: 4 });
    expect(rows[0].byStatus.quarantined).toBe(1);
    expect(rows[1]).toMatchObject({ key: '', count: 1, avgAgeYears: null });
  });
});

describe('replacement forecast', () => {
  const product = { lifetimeYears: 5, replacementCost: 300 };
  it('buckets by year from today, with past-due and unknown', () => {
    const gear = [
      g('old', { purchaseDate: '2018-06-01' }), // eol 2023 → past
      g('soon', { purchaseDate: '2021-09-01' }), // eol 2026-09 → 2026
      g('mid', { purchaseDate: '2023-03-01' }), // eol 2028
      g('far', { purchaseDate: '2025-01-01', customEol: '2040-01-01' }),
      g('nodate', { purchaseDate: null }),
      g('gone', { status: 'retired', purchaseDate: '2018-01-01' }),
    ];
    const f = replacementForecast(gear, () => product, '2026-03-15', { period: 'year', horizonYears: 3 });
    expect(f.buckets.map((b) => b.key)).toEqual(['past', '2026', '2027', '2028', '2029']);
    expect(f.buckets[0]).toMatchObject({ count: 1, cost: 300 });
    expect(f.buckets[1].gearIds).toEqual(['soon']);
    expect(f.buckets[3].gearIds).toEqual(['mid']);
    expect(f.later).toEqual(['far']);
    expect(f.unknownEol).toEqual(['nodate']);
  });
  it('supports quarters and counts unpriced items', () => {
    expect(periodKey('2026-05-02', 'quarter')).toBe('2026-Q2');
    const f = replacementForecast([g('a', { purchaseDate: '2021-11-01', purchaseValue: null })], () => ({ lifetimeYears: 5 }), '2026-03-15', { period: 'quarter', horizonYears: 1 });
    expect(f.buckets[0].key).toBe('past');
    expect(f.buckets[1].key).toBe('2026-Q1');
    expect(f.buckets.at(-1)!.key).toBe('2027-Q1');
    expect(f.buckets.find((b) => b.key === '2026-Q4')).toMatchObject({ count: 1, cost: 0, unpriced: 1 });
  });
});

describe('usage', () => {
  it('pro-rates logs that straddle the range', () => {
    expect(overlapDays('2026-01-01', '2026-01-10', '2026-01-06', '2026-02-01')).toBe(5);
    expect(overlapDays('2026-01-01', '2026-01-10', '2026-02-01', '2026-02-02')).toBe(0);
    const u = usageByGear(
      [
        { gearId: 'a', startDate: '2026-01-01', endDate: '2026-01-10', daysUsed: 8, uses: 4 },
        { gearId: 'a', startDate: '2026-01-20', endDate: '2026-01-20', daysUsed: 1 },
        { gearId: 'b', startDate: '2025-01-01', endDate: '2025-01-03', daysUsed: 3 },
      ],
      '2026-01-06',
      '2026-01-31',
    );
    expect(u.get('a')).toEqual({ daysUsed: 5, uses: 2, logs: 2 });
    expect(u.has('b')).toBe(false);
  });
});

describe('work order stats', () => {
  it('counts opened and closed in range and times to close', () => {
    const base = { source: 'inspection' as const, severity: 'has_issues' as const, cost: null, laborHours: null };
    const s = workOrderStats(
      [
        { ...base, status: 'done', created: '2026-01-01', closed: '2026-01-05', cost: 40, laborHours: 1.5 },
        { ...base, status: 'cancelled', source: 'manual', created: '2026-01-10', closed: '2026-01-20' },
        { ...base, status: 'open', severity: 'quarantined', created: '2026-01-15', closed: null },
        { ...base, status: 'done', created: '2025-12-01', closed: '2026-01-02', cost: 10 },
        { ...base, status: 'done', created: '2025-01-01', closed: '2025-02-01' },
      ],
      '2026-01-01',
      '2026-01-31',
    );
    expect(s).toMatchObject({ opened: 3, closed: 3, completed: 2, stillOpen: 1, cost: 50, laborHours: 1.5, avgDaysToClose: 15.3, medianDaysToClose: 10 });
    expect(s.bySource).toEqual({ inspection: 2, issue: 0, manual: 1 });
    expect(s.bySeverity.quarantined).toBe(1);
  });
  it('lists months', () => {
    expect(monthsBetween('2025-11-20', '2026-02-01')).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
  });
});

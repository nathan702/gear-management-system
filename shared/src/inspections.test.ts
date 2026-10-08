import { describe, expect, it } from 'vitest';
import { addDays } from './gear';
import {
  calculatedStatus,
  gearInspectionSummary,
  inspectionStatusAfter,
  missingAnswers,
  resultForNumber,
  responsibleInspectors,
  scheduleStatus,
  starterForms,
} from './inspections';
import { formsToRows, planFormImport } from './inspectionIO';
import { SEED_CHECKLISTS } from './constants';
import type { InspectionForm } from './types';

describe('calculatedStatus', () => {
  it('takes the worst failure outcome', () => {
    expect(calculatedStatus([{ result: 'pass', failureOutcome: 'quarantined' }])).toBe('active');
    expect(calculatedStatus([{ result: 'fail', failureOutcome: 'note' }])).toBe('active');
    expect(
      calculatedStatus([
        { result: 'fail', failureOutcome: 'has_issues' },
        { result: 'fail', failureOutcome: 'note' },
      ]),
    ).toBe('has_issues');
    expect(
      calculatedStatus([
        { result: 'fail', failureOutcome: 'has_issues' },
        { result: 'fail', failureOutcome: 'quarantined' },
        { result: 'na', failureOutcome: 'quarantined' },
      ]),
    ).toBe('quarantined');
  });
});

describe('inspectionStatusAfter', () => {
  it('only ever makes the status worse', () => {
    expect(inspectionStatusAfter('active', 'has_issues')).toBe('has_issues');
    expect(inspectionStatusAfter('has_issues', 'quarantined')).toBe('quarantined');
    expect(inspectionStatusAfter('quarantined', 'active')).toBe('quarantined');
    expect(inspectionStatusAfter('has_issues', 'active')).toBe('has_issues');
    expect(inspectionStatusAfter('retired', 'quarantined')).toBe('retired');
  });
});

describe('items', () => {
  it('fails number readings outside the limits', () => {
    expect(resultForNumber({ min: 2, max: 3 }, 2.5)).toBe('pass');
    expect(resultForNumber({ min: 2, max: 3 }, 1.9)).toBe('fail');
    expect(resultForNumber({ min: null, max: 3 }, 4)).toBe('fail');
    expect(resultForNumber({ min: 2 }, null)).toBeNull();
  });
  it('lists required items without answers', () => {
    const form = {
      items: [
        { id: 'a', prompt: 'A', type: 'pass_fail', failureOutcome: 'note', required: true },
        { id: 'b', prompt: 'B', type: 'number', failureOutcome: 'note', required: true },
        { id: 'c', prompt: 'C', type: 'text', failureOutcome: 'note', required: false },
      ],
    } as Pick<InspectionForm, 'items'>;
    expect(missingAnswers(form, []).map((i) => i.id)).toEqual(['a', 'b']);
    expect(missingAnswers(form, [{ itemId: 'a', result: 'pass' }, { itemId: 'b', result: 'na' }])).toEqual([]);
  });
});

describe('schedules', () => {
  const base = { status: 'active' as const, firstUseDate: '2025-01-10' };

  it('counts months from the last inspection, else first use', () => {
    const never = scheduleStatus(base, { formId: 'f', everyMonths: 12 }, '2025-12-30');
    expect(never).toMatchObject({ dueDate: '2026-01-10', state: 'due_soon', lastDate: null });
    expect(scheduleStatus(base, { formId: 'f', everyMonths: 12 }, '2026-02-01').state).toBe('overdue');
    const inspected = { ...base, inspectionState: { f: { lastDate: '2025-11-01', lastInspectionId: 'i', failedCount: 0, daysUsedAtLast: 0 } } };
    expect(scheduleStatus(inspected, { formId: 'f', everyMonths: 12 }, '2026-02-01')).toMatchObject({ dueDate: '2026-11-01', state: 'ok' });
  });

  it('respects the reminder lead time', () => {
    expect(scheduleStatus(base, { formId: 'f', everyMonths: 12, reminderLeadDays: 30 }, '2025-12-15').state).toBe('due_soon');
    expect(scheduleStatus(base, { formId: 'f', everyMonths: 12, reminderLeadDays: 3 }, '2025-12-15').state).toBe('ok');
  });

  it('is due after a number of days used, whichever comes first', () => {
    const gear = {
      ...base,
      stats: { daysUsed: 48 },
      inspectionState: { f: { lastDate: '2025-11-01', lastInspectionId: 'i', failedCount: 0, daysUsedAtLast: 20 } },
    };
    expect(scheduleStatus(gear, { formId: 'f', everyDaysUsed: 30 }, '2025-12-01')).toMatchObject({ state: 'due_soon', daysUsedSince: 28 });
    expect(scheduleStatus({ ...gear, stats: { daysUsed: 50 } }, { formId: 'f', everyMonths: 12, everyDaysUsed: 30 }, '2025-12-01').state).toBe('overdue');
  });

  it('summarises the worst schedule and ignores retired gear', () => {
    const product = { inspectionSchedules: [{ formId: 'a', everyMonths: 12 }, { formId: 'b', everyMonths: 1 }] };
    const s = gearInspectionSummary(base, product, '2025-03-01');
    expect(s.state).toBe('overdue');
    expect(s.nextDueDate).toBe('2025-02-10');
    expect(gearInspectionSummary({ ...base, status: 'retired' }, product, '2025-03-01').state).toBe('none');
    expect(gearInspectionSummary(base, { inspectionSchedules: [] }).state).toBe('none');
  });
});

describe('responsibleInspectors', () => {
  const gear = { productId: 'p', locationId: 'l', programAreaId: 'pa' };
  it('picks the most specific assignment', () => {
    const assignments = [
      { scope: 'programArea' as const, refId: 'pa', userIds: ['u1'] },
      { scope: 'location' as const, refId: 'l', userIds: ['u2'] },
      { scope: 'category' as const, refId: 'c', userIds: ['u3'] },
    ];
    expect(responsibleInspectors(gear, { categoryId: 'c' }, assignments)).toEqual({ scope: 'category', userIds: ['u3'] });
    expect(responsibleInspectors(gear, { categoryId: 'x' }, assignments)).toEqual({ scope: 'location', userIds: ['u2'] });
    expect(responsibleInspectors({ ...gear, locationId: null }, null, assignments)).toEqual({ scope: 'programArea', userIds: ['u1'] });
    expect(responsibleInspectors({ productId: null, locationId: null, programAreaId: null }, null, assignments)).toBeNull();
  });
});

describe('form spreadsheets', () => {
  it('builds starter forms with sensible outcomes', () => {
    const forms = starterForms(SEED_CHECKLISTS);
    const helmet = forms.find((f) => f.name === 'Helmet inspection')!;
    expect(helmet.items.find((i) => i.prompt.startsWith('Shell'))!.failureOutcome).toBe('quarantined');
    expect(helmet.items.find((i) => i.prompt === 'Markings legible')!.failureOutcome).toBe('has_issues');
    expect(forms.find((f) => f.name === 'Bike inspection')!.items[0].failureOutcome).toBe('has_issues');
    const ids = forms.flatMap((f) => f.items.map((i) => i.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('round-trips forms through rows', () => {
    const forms = starterForms({ Rope: SEED_CHECKLISTS.Rope }).map((f, i) => ({ ...f, id: `f${i}` }));
    forms[0].items.push({ id: 'pres', prompt: 'Pressure', type: 'number', failureOutcome: 'note', required: false, min: 2, max: 3, unit: 'psi' });
    const rows = formsToRows(forms).map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, String(v)])));
    const plan = planFormImport(rows, forms);
    expect(plan.forms).toHaveLength(1);
    expect(plan.forms[0]).toMatchObject({ id: 'f0', errors: [], active: true });
    expect(plan.forms[0].items).toEqual(forms[0].items.map((i) => ({ help: '', min: null, max: null, unit: '', ...i })));
  });

  it('reports bad rows and accepts friendly values', () => {
    const plan = planFormImport(
      [
        { Form: 'Raft check', Prompt: 'Tubes hold air', Type: 'Pass/Fail', 'Failure outcome': 'Quarantine' },
        { Form: 'raft check', Prompt: '', Type: '' },
        { Form: 'Raft check', Prompt: 'Odd', Type: 'photo', 'Failure outcome': 'explode' },
      ],
      [],
    );
    const f = plan.forms[0];
    expect(f.items[0]).toMatchObject({ type: 'pass_fail', failureOutcome: 'quarantined', required: true });
    expect(f.errors).toEqual([
      'row 3: prompt is required',
      'row 4: type must be pass/fail, number or text',
      'row 4: failure_outcome must be note, has_issues or quarantined',
    ]);
  });
});

describe('in-service schedules', () => {
  const weekly = { formId: 'pre', kind: 'in_service' as const, everyDaysInUse: 7 };
  const gear = (lastDate?: string) => ({
    status: 'active' as const,
    inspectionState: lastDate ? { pre: { lastDate, lastInspectionId: 'i', failedCount: 0, daysUsedAtLast: 0 } } : undefined,
  });

  it('is never due while the gear sits unused', () => {
    expect(scheduleStatus(gear('2026-01-01'), weekly, '2026-10-08', null)).toMatchObject({ state: 'ok', dueDate: null, inUse: false });
  });

  it('is due the day use resumes after time idle, and overdue after that', () => {
    const use = { since: '2026-10-08', holderIds: ['u'] };
    expect(scheduleStatus(gear('2026-09-01'), weekly, '2026-10-08', use)).toMatchObject({ state: 'due_soon', dueDate: '2026-10-08' });
    expect(scheduleStatus(gear('2026-09-01'), weekly, '2026-10-09', use)).toMatchObject({ state: 'overdue' });
    expect(scheduleStatus(gear(), weekly, '2026-10-08', use)).toMatchObject({ state: 'due_soon', dueDate: '2026-10-08' });
  });

  it('comes due every N days during continuous use', () => {
    const use = { since: '2026-09-01', holderIds: ['u'] };
    expect(scheduleStatus(gear('2026-10-05'), weekly, '2026-10-08', use)).toMatchObject({ state: 'ok', dueDate: '2026-10-12' });
    expect(scheduleStatus(gear('2026-10-05'), weekly, '2026-10-12', use).state).toBe('due_soon');
    expect(scheduleStatus(gear('2026-10-07'), { ...weekly, everyDaysInUse: 1 }, '2026-10-08', use)).toMatchObject({ state: 'due_soon', dueDate: '2026-10-08' });
  });

  /**
   * Replays days 1..N. Each in-use day, whoever has the gear does the check if
   * it shows as due (or overdue). Returns the days checks were done on and
   * every day's state.
   */
  function simulate(periods: [number, number][], days: number) {
    const day = (n: number) => addDays('2026-01-01', n - 1);
    let last: string | undefined;
    const checks: number[] = [];
    const states: string[] = [];
    for (let n = 1; n <= days; n++) {
      const period = periods.find(([a, b]) => n >= a && n <= b);
      const inUse = period ? { since: day(period[0]), holderIds: ['u'] } : null;
      const st = scheduleStatus(gear(last), weekly, day(n), inUse);
      states.push(st.state);
      if (st.state !== 'ok') {
        checks.push(n);
        last = day(n);
      }
    }
    return { checks, states };
  }

  it('needs four weekly checks over 28 days of continuous use', () => {
    expect(simulate([[1, 28]], 28).checks).toEqual([1, 8, 15, 22]);
  });

  it('needs one catch-up check after storage, not one per missed week', () => {
    // Used a week, stored three weeks, used two more weeks.
    const { checks, states } = simulate([[1, 7], [29, 42]], 42);
    expect(checks).toEqual([1, 29, 36]);
    // Days 8–28 in storage: the day-8 check had passed, but nothing is due or overdue.
    expect(states.slice(7, 28).every((s) => s === 'ok')).toBe(true);
  });

  it('needs nothing extra after a short break inside the interval', () => {
    // Checked day 1, stored days 2–4, out again day 5: next check is still day 8.
    expect(simulate([[1, 1], [5, 14]], 14).checks).toEqual([1, 8]);
  });

  it('is due today on the due day and overdue from the day after while in use', () => {
    const use = { since: '2026-01-01', holderIds: ['u'] };
    expect(scheduleStatus(gear('2026-01-01'), weekly, '2026-01-08', use).state).toBe('due_soon');
    expect(scheduleStatus(gear('2026-01-01'), weekly, '2026-01-09', use).state).toBe('overdue');
  });

  it('keeps in-service and in-depth states apart', () => {
    const product = { inspectionSchedules: [weekly, { formId: 'annual', everyMonths: 12 }] };
    const g = { ...gear('2026-09-01'), firstUseDate: '2026-06-01' };
    const s = gearInspectionSummary(g, product, '2026-10-09', { since: '2026-10-08', holderIds: ['u'] });
    expect(s).toMatchObject({ state: 'overdue', inServiceState: 'overdue', inDepthState: 'ok' });
  });
});

describe('gearInUse', () => {
  it('counts checked-out kits, in-date kits and open check-outs', async () => {
    const { gearInUse } = await import('./kits');
    const m = gearInUse(
      [
        { ownerId: 'a', gearIds: ['g1'], status: 'checked_out', startDate: '2026-10-10', endDate: null, checkedOutDate: '2026-10-07' },
        { ownerId: 'b', gearIds: ['g2'], status: 'planned', startDate: '2026-10-01', endDate: '2026-10-09' },
        { ownerId: 'c', gearIds: ['g3'], status: 'planned', startDate: '2026-10-20', endDate: null },
        { ownerId: 'd', gearIds: ['g4'], status: 'planned', startDate: null, endDate: null },
        { ownerId: 'e', gearIds: ['g5'], status: 'returned', startDate: '2026-10-01', endDate: '2026-10-09' },
      ],
      [{ gearId: 'g1', userId: 'f', startDate: '2026-10-05', status: 'out' }],
      '2026-10-08',
    );
    expect(Object.fromEntries(m)).toEqual({
      g1: { since: '2026-10-05', holderIds: ['a', 'f'] },
      g2: { since: '2026-10-01', holderIds: ['b'] },
    });
  });
});

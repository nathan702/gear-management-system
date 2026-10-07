import { describe, expect, it } from 'vitest';
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

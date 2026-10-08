import { describe, expect, it } from 'vitest';
import { DEFAULT_WORK_ORDER_RULES, applyWorkOrderRules, gearStatusAfterClosing, isOverdue, workOrderNumber, worseSeverity } from './workOrders';
import { addDays } from './gear';

describe('work order helpers', () => {
  it('formats numbers', () => {
    expect(workOrderNumber(7)).toBe('WO-0007');
    expect(workOrderNumber(12345)).toBe('WO-12345');
    expect(workOrderNumber(null)).toBe('WO-…');
  });
  it('adds days', () => {
    expect(addDays('2026-12-28', 7)).toBe('2027-01-04');
  });
  it('escalates severity', () => {
    expect(worseSeverity('note', 'has_issues')).toBe('has_issues');
    expect(worseSeverity('quarantined', 'has_issues')).toBe('quarantined');
  });
  it('knows when open work is overdue', () => {
    expect(isOverdue({ status: 'open', dueDate: '2026-10-01' }, '2026-10-08')).toBe(true);
    expect(isOverdue({ status: 'done', dueDate: '2026-10-01' }, '2026-10-08')).toBe(false);
    expect(isOverdue({ status: 'in_progress', dueDate: null }, '2026-10-08')).toBe(false);
  });
});

describe('gearStatusAfterClosing', () => {
  it('returns to Active only when nothing else is open', () => {
    expect(gearStatusAfterClosing('quarantined', [])).toBe('active');
    expect(gearStatusAfterClosing('quarantined', ['note'])).toBe('active');
    expect(gearStatusAfterClosing('quarantined', ['has_issues', 'note'])).toBe('has_issues');
    expect(gearStatusAfterClosing('has_issues', ['quarantined'])).toBe('quarantined');
    expect(gearStatusAfterClosing('retired', [])).toBe('retired');
  });
});

describe('applyWorkOrderRules', () => {
  const ctx = { severity: 'quarantined' as const, programAreaId: 'river', categoryId: 'rafts', locationId: 'rileys' };
  it('uses the first matching rule by order', () => {
    const rules = [
      ...DEFAULT_WORK_ORDER_RULES,
      { order: 1, name: 'River rafts', severity: null, programAreaId: 'river', categoryId: 'rafts', locationId: null, assigneeId: 'tech1', dueInDays: 3, priority: 'urgent' as const },
    ];
    expect(applyWorkOrderRules(rules, ctx, '2026-10-08')).toEqual({ ruleName: 'River rafts', assigneeId: 'tech1', dueDate: '2026-10-11', priority: 'urgent' });
    expect(applyWorkOrderRules(rules, { ...ctx, categoryId: 'pfds' }, '2026-10-08')).toEqual({
      ruleName: 'Quarantined gear',
      assigneeId: null,
      dueDate: '2026-10-15',
      priority: 'high',
    });
  });
  it('falls back to a priority by severity when nothing matches', () => {
    expect(applyWorkOrderRules([], { ...ctx, severity: 'note' }, '2026-10-08')).toEqual({ ruleName: null, assigneeId: null, dueDate: null, priority: 'low' });
  });
});

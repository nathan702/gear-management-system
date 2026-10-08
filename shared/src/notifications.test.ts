import { describe, expect, it } from 'vitest';
import { buildDigests, digestMessage, managerDigestMessage, wantedChannels } from './notifications';
import type { Gear, Product } from './types';

describe('wantedChannels', () => {
  it('uses defaults, the user’s choices, and hides manager-only events from others', () => {
    expect(wantedChannels({ role: 'staff' }, 'work_order_assigned')).toEqual(['email', 'slack']);
    expect(wantedChannels({ role: 'staff', notificationPrefs: { work_order_assigned: { email: false } } }, 'work_order_assigned')).toEqual(['slack']);
    expect(wantedChannels({ role: 'staff', notificationPrefs: { manager_digest: { email: true } } }, 'manager_digest')).toEqual([]);
    expect(wantedChannels({ role: 'manager' }, 'manager_digest')).toEqual(['email']);
  });
});

describe('buildDigests', () => {
  const today = '2026-10-08';
  const product: Product = {
    manufacturerId: null,
    model: 'Otter',
    categoryId: 'rafts',
    active: true,
    inspectionSchedules: [
      { formId: 'f', kind: 'in_depth', everyMonths: 12 },
      { formId: 'pre', kind: 'in_service', everyDaysInUse: 7 },
    ],
  };
  const gear = (id: string, lastDate: string, extra: Partial<Gear> = {}) =>
    ({
      id,
      name: id,
      status: 'active',
      qrCode: id,
      productId: 'p',
      programAreaId: 'river',
      locationId: null,
      inspectionState: {
        f: { lastDate, lastInspectionId: 'x', failedCount: 0, daysUsedAtLast: 0 },
        pre: { lastDate: '2026-09-01', lastInspectionId: 'y', failedCount: 0, daysUsedAtLast: 0 },
      },
      ...extra,
    }) as Gear & { id: string };

  const input = {
    today,
    gear: [gear('Raft 1', '2025-09-01'), gear('Raft 2', '2025-10-15'), gear('Raft 3', '2026-06-01'), gear('Raft 4', '2025-01-01', { status: 'retired' })],
    products: new Map([['p', product]]),
    forms: new Map([
      ['f', { name: 'Raft check' }],
      ['pre', { name: 'Pre-trip check' }],
    ]),
    assignments: [{ scope: 'programArea' as const, refId: 'river', userIds: ['insp'] }],
    kits: [
      // In use now: Raft 3's weekly in-service check is due to the leader.
      { id: 'k1', ownerId: 'leader', gearIds: ['Raft 3'], status: 'checked_out' as const, startDate: '2026-10-06', endDate: '2026-10-10', checkedOutDate: '2026-10-06' },
      // Not started yet: nothing in-service is due.
      { id: 'k2', ownerId: 'later', gearIds: ['Raft 1'], status: 'planned' as const, startDate: '2026-12-01', endDate: null },
    ],
    checkouts: [],
    openWorkOrders: [
      { id: 'w1', number: 4, title: 'Valve', gearId: 'Raft 1', assigneeId: 'tech', dueDate: '2026-10-01', status: 'open' as const },
      { id: 'w2', number: 5, title: 'Seam', gearId: 'Raft 2', assigneeId: 'tech', dueDate: '2026-10-10', status: 'in_progress' as const },
      { id: 'w3', number: 6, title: 'Later', gearId: 'Raft 3', assigneeId: 'tech', dueDate: '2026-11-30', status: 'open' as const },
    ],
  };

  it('sends in-depth inspections to inspectors, in-service ones to whoever has the gear, and work to assignees', () => {
    const { users } = buildDigests(input);
    const by = Object.fromEntries(users.map((u) => [u.userId, u]));
    expect(by.insp.inspections.map((i) => [i.gearName, i.state, i.forms])).toEqual([
      ['Raft 1', 'overdue', ['Raft check']],
      ['Raft 2', 'due_soon', ['Raft check']],
    ]);
    // Last pre-trip check Sep 1, back in use Oct 6 → due Oct 6, so overdue today.
    expect(by.leader.inspections).toEqual([{ gearId: 'Raft 3', gearName: 'Raft 3', state: 'overdue', forms: ['Pre-trip check'], why: 'in_service' }]);
    expect(by.later).toBeUndefined();
    expect(by.tech.workOrders.map((w) => [w.label, w.overdue])).toEqual([
      ['WO-0004 Valve', true],
      ['WO-0005 Seam', false],
    ]);
  });

  it('writes readable messages', () => {
    const { users } = buildDigests(input);
    const m = digestMessage(users.find((u) => u.userId === 'insp')!, 'https://gear.calleva.org/');
    expect(m.subject).toBe('Gear reminders: 2 inspections need attention');
    expect(m.text).toContain('• Raft 1 — Raft check OVERDUE');
    expect(m.link).toBe('https://gear.calleva.org/inspections?mine=1');
    const leader = digestMessage(users.find((u) => u.userId === 'leader')!, '');
    expect(leader.subject).toBe('Gear reminders: 1 inspection needs attention');
    expect(leader.text).toContain('Raft 3 — Pre-trip check OVERDUE (you have it out)');
    expect(managerDigestMessage({ overdueInspections: [], overdueWorkOrders: [], unassignedWorkOrders: 0 }, '')).toBeNull();
  });
});

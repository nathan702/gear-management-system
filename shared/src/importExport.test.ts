import { describe, expect, it } from 'vitest';
import { ENTITIES, exportRows, parseDate, parseLinks, planImport, type ImportContext } from './importExport';

const refNames: ImportContext['refNames'] = {
  programAreas: new Map([['pa1', 'River School']]),
  locations: new Map([['loc1', "Riley's"]]),
  categories: new Map([['cat1', 'Rafts']]),
  manufacturers: new Map([['m1', 'NRS']]),
  products: new Map([['p1', 'NRS Otter 130 – Blue']]),
};

function ctx(overrides: Partial<ImportContext> = {}): ImportContext {
  let n = 0;
  return {
    refNames,
    existing: new Map(),
    qrCodes: new Map(),
    createMissingRefs: false,
    generateQrCode: () => `CG-GEN00${n++}`,
    ...overrides,
  };
}

describe('parsers', () => {
  it('parses dates in common formats', () => {
    expect(parseDate('2024-03-05')).toBe('2024-03-05');
    expect(parseDate('3/5/2024')).toBe('2024-03-05');
    expect(parseDate('3/5/24')).toBe('2024-03-05');
    expect(parseDate('2024/3/5')).toBe('2024-03-05');
    expect(parseDate('31/31/2024')).toBe('invalid');
    expect(parseDate('')).toBeNull();
  });
  it('parses links', () => {
    expect(parseLinks('Manual | https://a.com/m.pdf; https://b.com')).toEqual([
      { label: 'Manual', url: 'https://a.com/m.pdf' },
      { label: '', url: 'https://b.com' },
    ]);
    expect(parseLinks('not a link')).toBe('invalid');
  });
});

describe('planImport — gear', () => {
  const def = ENTITIES.gear;

  it('creates gear, resolving references by name (case-insensitive) and generating codes', () => {
    const plan = planImport(
      def,
      [{ Name: 'Raft 7', Product: 'nrs otter 130 – blue', 'Program Area': 'river school', location: "Riley's", status: 'Has issues', tags: 'big; loaner', purchase_value: '$5,800' }],
      ctx(),
    );
    const row = plan.rows[0];
    expect(row.errors).toEqual([]);
    expect(row.action).toBe('create');
    expect(row.data).toMatchObject({
      name: 'Raft 7',
      productId: 'p1',
      programAreaId: 'pa1',
      locationId: 'loc1',
      status: 'has_issues',
      tags: ['big', 'loaner'],
      purchaseValue: 5800,
      qrCode: 'CG-GEN000',
    });
  });

  it('reports unknown references, bad values and duplicate codes', () => {
    const plan = planImport(
      def,
      [
        { name: 'A', location: 'Nowhere', purchase_date: 'soon', qr_code: 'tag-1' },
        { name: 'B', qr_code: 'TAG-1' },
        { name: '', status: 'broken' },
      ],
      ctx({ qrCodes: new Map() }),
    );
    expect(plan.rows[0].errors).toEqual([
      'location: no location named "Nowhere"',
      'purchase_date: "soon" is not a date (use YYYY-MM-DD)',
    ]);
    expect(plan.rows[1].errors).toEqual(['qr_code TAG-1 already belongs to other gear']);
    expect(plan.rows[2].errors).toContain('name is required');
    expect(plan.rows[2].errors.some((e) => e.startsWith('status:'))).toBe(true);
  });

  it('plans missing references when asked to create them', () => {
    const plan = planImport(def, [{ name: 'A', location: 'Boat shed' }, { name: 'B', location: 'boat shed' }], ctx({ createMissingRefs: true }));
    expect(plan.newRefs).toEqual([{ kind: 'locations', name: 'Boat shed' }]);
    expect(plan.rows[0].data.locationId).toBe('new:locations:boat shed');
    expect(plan.rows[1].data.locationId).toBe('new:locations:boat shed');
  });

  it('updates by id or by QR code, changing only supplied columns', () => {
    const existing = new Map([['g1', { name: 'Raft 1', qrCode: 'CG-AAA222', status: 'active' }]]);
    const qrCodes = new Map([['CG-AAA222', 'g1']]);
    const byCode = planImport(def, [{ qr_code: 'cg-aaa222', location: "Riley's" }], ctx({ existing, qrCodes }));
    expect(byCode.rows[0]).toMatchObject({ action: 'update', id: 'g1', data: { qrCode: 'CG-AAA222', locationId: 'loc1' } });
    expect(byCode.rows[0].data).not.toHaveProperty('name');

    const byId = planImport(def, [{ id: 'g1', notes: '' }], ctx({ existing, qrCodes }));
    expect(byId.rows[0]).toMatchObject({ action: 'update', id: 'g1', data: { notes: null } });

    const blanks = planImport(def, [{ name: '', status: '', qr_code: 'CG-AAA222', notes: 'x' }], ctx({ existing, qrCodes }));
    expect(blanks.rows[0]).toMatchObject({ action: 'update', data: { notes: 'x' } });
    expect(blanks.rows[0].data).not.toHaveProperty('name');
    expect(blanks.rows[0].data).not.toHaveProperty('status');

    const badId = planImport(def, [{ id: 'nope', name: 'X' }], ctx({ existing, qrCodes }));
    expect(badId.rows[0].action).toBe('error');
  });

  it('flags two rows updating the same record', () => {
    const existing = new Map([['g1', { name: 'Raft 1', qrCode: 'CG-AAA222' }]]);
    const plan = planImport(def, [{ id: 'g1', name: 'X' }, { id: 'g1', name: 'Y' }], ctx({ existing }));
    expect(plan.rows[1].errors).toContain('another row in this file updates the same record');
  });

  it('round-trips through export', () => {
    const exportCtx = {
      names: refNames,
      products: new Map([['p1', { categoryId: 'cat1', lifetimeYears: 10 }]]),
      manufacturers: new Map([['m1', { name: 'NRS' }]]),
      categories: new Map([['cat1', { name: 'Rafts' }]]),
    };
    const doc = {
      id: 'g1',
      name: 'Raft 1',
      qrCode: 'CG-AAA222',
      productId: 'p1',
      programAreaId: 'pa1',
      locationId: 'loc1',
      status: 'quarantined',
      tags: ['a', 'b'],
      purchaseDate: '2020-01-01',
      links: [{ label: 'Manual', url: 'https://x.com' }],
    };
    const { headers, rows } = exportRows(def, [doc], exportCtx);
    expect(headers).toContain('category');
    expect(rows[0]).toMatchObject({ product: 'NRS Otter 130 – Blue', category: 'Rafts', tags: 'a; b', links: 'Manual | https://x.com', end_of_life: '2030-01-01' });

    const asStrings = Object.fromEntries(Object.entries(rows[0]).map(([k, v]) => [k, String(v)]));
    const plan = planImport(def, [asStrings], ctx({ existing: new Map([['g1', doc]]), qrCodes: new Map([['CG-AAA222', 'g1']]) }));
    expect(plan.rows[0].errors).toEqual([]);
    expect(plan.rows[0].data).toMatchObject({ productId: 'p1', status: 'quarantined', tags: ['a', 'b'], links: doc.links });
  });
});

describe('planImport — products and users', () => {
  it('matches products by maker + model + variant', () => {
    const existing = new Map([['p1', { manufacturerId: 'm1', model: 'Otter 130', variant: 'Blue' }]]);
    const plan = planImport(
      ENTITIES.products,
      [
        { manufacturer: 'NRS', model: 'Otter 130', variant: 'Blue', lifetime_years: '12' },
        { manufacturer: 'NRS', model: 'Otter 130', variant: 'Red' },
      ],
      ctx({ existing }),
    );
    expect(plan.rows.map((r) => r.action)).toEqual(['update', 'create']);
    expect(plan.rows[1].data).toMatchObject({ active: true, inspectionSchedules: [] });
  });

  it('validates user emails and roles', () => {
    const plan = planImport(ENTITIES.users, [{ email: 'Sam@Gmail.com', role: 'Repair technician', access_expires: '8/20/2026' }, { email: 'nope' }], ctx());
    expect(plan.rows[0]).toMatchObject({ action: 'create', data: { email: 'sam@gmail.com', role: 'technician', expiresOn: '2026-08-20' } });
    expect(plan.rows[1].action).toBe('error');
  });
});

import { describe, expect, it } from 'vitest';
import { addMonths, ageYears, endOfLife, isIsoDate, lifeUsedPercent, productName } from './gear';
import { codeFromScan, generateQrCode, normalizeQrCode, qrUrl } from './qr';

describe('dates', () => {
  it('adds months and clamps to month end', () => {
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29');
    expect(addMonths('2020-06-15', 120)).toBe('2030-06-15');
  });
  it('validates ISO dates', () => {
    expect(isIsoDate('2024-02-29')).toBe(true);
    expect(isIsoDate('2023-02-29')).toBe(false);
    expect(isIsoDate('2024-2-1')).toBe(false);
  });
});

describe('lifecycle', () => {
  const product = { lifetimeYears: 10 };
  it('uses manufacture date, then first use, then purchase', () => {
    expect(endOfLife({ mfgDate: '2015-01-01', firstUseDate: '2016-01-01' }, product)).toBe('2025-01-01');
    expect(endOfLife({ firstUseDate: '2016-01-01', purchaseDate: '2015-06-01' }, product)).toBe('2026-01-01');
    expect(endOfLife({ purchaseDate: '2015-06-01' }, product)).toBe('2025-06-01');
  });
  it('prefers a custom end of life', () => {
    expect(endOfLife({ customEol: '2027-03-01', mfgDate: '2015-01-01' }, product)).toBe('2027-03-01');
  });
  it('is unknown without a lifetime or start date', () => {
    expect(endOfLife({ mfgDate: '2015-01-01' }, {})).toBeNull();
    expect(endOfLife({}, product)).toBeNull();
  });
  it('computes life used and age', () => {
    expect(lifeUsedPercent({ mfgDate: '2020-01-01' }, product, '2025-01-01')).toBe(50);
    expect(ageYears({ purchaseDate: '2020-01-01' }, '2025-01-01')).toBe(5);
  });
});

describe('productName', () => {
  const makers = new Map([['m1', { name: 'NRS' }]]);
  it('joins maker, model and variant', () => {
    expect(productName({ manufacturerId: 'm1', model: 'Otter 130', variant: 'Blue' }, makers)).toBe('NRS Otter 130 – Blue');
    expect(productName({ manufacturerId: null, model: 'Paddle' }, makers)).toBe('Paddle');
  });
});

describe('QR codes', () => {
  it('generates unambiguous codes', () => {
    for (let i = 0; i < 200; i++) expect(generateQrCode()).toMatch(/^CG-[2-9A-HJKMNP-Z]{6}$/);
  });
  it('normalizes and rejects unsafe codes', () => {
    expect(normalizeQrCode(' cg-abc234 ')).toBe('CG-ABC234');
    expect(normalizeQrCode('a/b')).toBeNull();
    expect(normalizeQrCode('')).toBeNull();
    expect(normalizeQrCode('__x__')).toBeNull();
  });
  it('reads codes from our URLs, vendor URLs and bare text', () => {
    expect(codeFromScan('https://gear.calleva.org/q/CG-ABC234')).toBe('CG-ABC234');
    expect(codeFromScan(qrUrl('https://x.org/', 'cg-zz9'))).toBe('CG-ZZ9');
    expect(codeFromScan('https://tags.example.com/t/00123')).toBe('00123');
    expect(codeFromScan('  TAG-0042 ')).toBe('TAG-0042');
  });
});

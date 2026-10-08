import type { Gear, IsoDate, Manufacturer, Product } from './types';

/** "NRS Otter 130 – blue" */
export function productName(
  product: Pick<Product, 'manufacturerId' | 'model' | 'variant'> | undefined | null,
  manufacturers: ReadonlyMap<string, Pick<Manufacturer, 'name'>>,
): string {
  if (!product) return '';
  const maker = product.manufacturerId ? manufacturers.get(product.manufacturerId)?.name : undefined;
  const base = [maker, product.model].filter(Boolean).join(' ');
  return product.variant ? `${base} – ${product.variant}` : base;
}

export function todayIso(now: Date = new Date()): IsoDate {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function isIsoDate(value: unknown): value is IsoDate {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Adds whole months (may be fractional years × 12) to an ISO date, clamping to month end. */
export function addMonths(iso: IsoDate, months: number): IsoDate {
  const [y, m, d] = iso.split('-').map(Number);
  const whole = Math.round(months);
  const target = new Date(Date.UTC(y, m - 1 + whole, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

export function addDays(iso: IsoDate, days: number): IsoDate {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + Math.round(days))).toISOString().slice(0, 10);
}

export function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / 864e5);
}

/** The date that service life is counted from: manufacture, else first use, else purchase. */
export function lifeStartDate(gear: Pick<Gear, 'mfgDate' | 'firstUseDate' | 'purchaseDate'>): IsoDate | null {
  return gear.mfgDate || gear.firstUseDate || gear.purchaseDate || null;
}

export function endOfLife(
  gear: Pick<Gear, 'customEol' | 'mfgDate' | 'firstUseDate' | 'purchaseDate'>,
  product: Pick<Product, 'lifetimeYears'> | undefined | null,
): IsoDate | null {
  if (gear.customEol) return gear.customEol;
  const start = lifeStartDate(gear);
  if (!start || !product?.lifetimeYears) return null;
  return addMonths(start, product.lifetimeYears * 12);
}

/** 0–100+ percent of service life used, or null if unknown. */
export function lifeUsedPercent(
  gear: Pick<Gear, 'customEol' | 'mfgDate' | 'firstUseDate' | 'purchaseDate'>,
  product: Pick<Product, 'lifetimeYears'> | undefined | null,
  today: IsoDate = todayIso(),
): number | null {
  const start = lifeStartDate(gear);
  const end = endOfLife(gear, product);
  if (!start || !end) return null;
  const total = daysBetween(start, end);
  if (total <= 0) return 100;
  return Math.max(0, Math.round((daysBetween(start, today) / total) * 100));
}

/** Age in years (one decimal) from purchase, else manufacture, else first use. */
export function ageYears(
  gear: Pick<Gear, 'mfgDate' | 'firstUseDate' | 'purchaseDate'>,
  today: IsoDate = todayIso(),
): number | null {
  const start = gear.purchaseDate || gear.mfgDate || gear.firstUseDate;
  if (!start) return null;
  return Math.round((daysBetween(start, today) / 365.25) * 10) / 10;
}

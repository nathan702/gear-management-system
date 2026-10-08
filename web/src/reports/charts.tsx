import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';

/*
 * Small hand-built charts for the Reports page. Every chart here is one
 * series (one color), with values labelled in text ink and a table or
 * export alongside, so color never carries meaning on its own.
 */

const SERIES = '#2a78d6';
const SERIES_HOVER = '#1c5cab';

export function StatTile({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'bad' | 'warn' }) {
  return (
    <div className="card px-4 py-3">
      <div className="text-xs font-medium text-stone-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tracking-tight ${tone === 'bad' ? 'text-red-800' : tone === 'warn' ? 'text-amber-800' : 'text-stone-900'}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-stone-500">{sub}</div>}
    </div>
  );
}

export function StatRow({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{children}</div>;
}

export interface BarDatum {
  key: string;
  label: string;
  value: number;
  /** Text shown at the end of the bar (defaults to the value). */
  display?: string;
  /** Extra line in the hover tooltip. */
  detail?: string;
  to?: string;
}

/** Horizontal bars, largest first, label on the left and value on the right. */
export function BarList({ data, max: maxRows = 12, empty = 'No data' }: { data: BarDatum[]; max?: number; empty?: string }) {
  const [hover, setHover] = useState<string | null>(null);
  const rows = [...data].sort((a, b) => b.value - a.value).slice(0, maxRows);
  const top = Math.max(...rows.map((r) => r.value), 0);
  if (!rows.length || top === 0) return <p className="text-sm text-stone-500">{empty}</p>;
  const hidden = data.length - rows.length;
  return (
    <div>
      <ul className="space-y-0.5" role="list">
        {rows.map((r) => {
          const pct = (r.value / top) * 100;
          const active = hover === r.key;
          return (
            <li
              key={r.key}
              className={`grid grid-cols-[minmax(6rem,11rem)_1fr_auto] items-center gap-3 rounded px-1 py-1 text-sm ${active ? 'bg-stone-50' : ''}`}
              onMouseEnter={() => setHover(r.key)}
              onMouseLeave={() => setHover(null)}
              title={r.detail ? `${r.label}: ${r.display ?? r.value} · ${r.detail}` : `${r.label}: ${r.display ?? r.value}`}
            >
              <span className="truncate text-stone-700">
                {r.to ? (
                  <Link className="hover:underline" to={r.to}>
                    {r.label}
                  </Link>
                ) : (
                  r.label
                )}
              </span>
              <span className="h-3 min-w-0">
                {r.value > 0 && (
                  <span
                    className="block h-full rounded-r"
                    style={{ width: `max(${pct}%, 3px)`, background: active ? SERIES_HOVER : SERIES }}
                  />
                )}
              </span>
              <span className="text-right text-stone-900 tabular-nums">{r.display ?? r.value.toLocaleString()}</span>
            </li>
          );
        })}
      </ul>
      {hidden > 0 && <p className="mt-2 text-xs text-stone-500">+ {hidden} more in the table below</p>}
    </div>
  );
}

function niceStep(max: number, ticks: number): number {
  const raw = max / ticks;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  return (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
}

export interface ColumnDatum {
  key: string;
  label: string;
  /** Axis label when `label` is too long to fit under a column. */
  short?: string;
  value: number;
  tooltip: ReactNode;
}

/** Vertical columns along a time axis, with gridlines and a hover tooltip. */
export function ColumnChart({ data, format, height = 220, ariaLabel }: { data: ColumnDatum[]; format(n: number): string; height?: number; ariaLabel: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...data.map((d) => d.value), 0);
  const step = max > 0 ? niceStep(max, 4) : 1;
  const top = max > 0 ? Math.ceil(max / step) * step : 4;
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  const many = data.length > 12;
  return (
    <div className="relative" role="img" aria-label={ariaLabel}>
      <div className="flex">
        {/* y axis labels */}
        <div className="relative mr-2 shrink-0 text-right text-[11px] text-stone-500 tabular-nums" style={{ height, width: '3.75rem' }}>
          {ticks.map((t) => (
            <span key={t} className="absolute right-0" style={{ bottom: `${(t / top) * 100}%`, transform: 'translateY(50%)' }}>
              {format(t)}
            </span>
          ))}
        </div>
        <div className="relative min-w-0 flex-1" style={{ height }}>
          {ticks.map((t) => (
            <div key={t} className={`absolute inset-x-0 ${t === 0 ? 'border-t border-stone-300' : 'border-t border-stone-200/70'}`} style={{ bottom: `${(t / top) * 100}%` }} />
          ))}
          <div className="absolute inset-0 flex items-end gap-[2px]">
            {data.map((d, i) => (
              <div
                key={d.key}
                className="relative flex h-full flex-1 items-end justify-center"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
                tabIndex={0}
                aria-label={`${d.label}: ${format(d.value)}`}
              >
                {d.value > 0 && (
                  <div
                    className="w-full max-w-12 rounded-t"
                    style={{ height: `max(${(d.value / top) * 100}%, 2px)`, background: hover === i ? SERIES_HOVER : SERIES }}
                  />
                )}
                {hover === i && (
                  <div
                    className={`pointer-events-none absolute bottom-full z-10 mb-1 w-max max-w-56 rounded-md border border-stone-200 bg-white px-2.5 py-1.5 text-xs text-stone-700 shadow-md ${
                      i > data.length / 2 ? 'right-0' : 'left-0'
                    }`}
                  >
                    <div className="font-semibold text-stone-900">{d.label}</div>
                    {d.tooltip}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
      {/* x axis labels */}
      <div className="mt-1 flex gap-[2px]" style={{ marginLeft: 'calc(3.75rem + 0.5rem)' }}>
        {data.map((d, i) => (
          <div key={d.key} className="flex-1 truncate text-center text-[11px] text-stone-500">
            {!many || i % Math.ceil(data.length / 12) === 0 ? (d.short ?? d.label) : ''}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Compact money for axis ticks: $0, $500, $2.5k, $1.2M. */
export function shortMoney(n: number): string {
  if (n >= 1e6) return `$${(n / 1e6).toFixed(n % 1e6 ? 1 : 0)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(n % 1e3 ? 1 : 0)}k`;
  return `$${n}`;
}

'use client';
import { useState, useId } from 'react';
import { fmtT, fmtPct, fmtInt, fmtB } from './format';

/* Formatting crosses the server/client boundary as a KEY, never as a function:
   a function prop cannot be serialised into a client component, and passing one
   fails only at prerender time — exactly the kind of break that reaches
   production if the build is never run against real data. */
export type FormatKey = 'money' | 'billions' | 'int' | 'pct' | 'pct0';
const FORMATTERS: Record<FormatKey, (n: number) => string> = {
  money: fmtT, billions: fmtB, int: fmtInt,
  pct: (n) => fmtPct(n, 1), pct0: (n) => fmtPct(n, 0),
};
const fmt = (k: FormatKey = 'money') => FORMATTERS[k] ?? fmtT;

/* Marks are thin, data-ends are rounded and anchored to the baseline, fills are
   separated by a 2px surface gap, grid and axes are recessive, and every plotted
   form carries a hover tooltip. Values wear text tokens, never the series hue. */

const SURFACE = '#0a1929';

export function StatTile({ label, value, sub, tone = 'default', title }: {
  label: string; value: string; sub?: string; title?: string;
  tone?: 'default' | 'good' | 'warning' | 'critical' | 'accent';
}) {
  const toneCls = {
    default: 'text-navy-50', accent: 'text-accent-400',
    good: 'text-[color:var(--status-good)]',
    warning: 'text-[color:var(--status-warning)]',
    critical: 'text-[color:var(--status-critical)]',
  }[tone];
  return (
    <div className="glass-card rounded-lg p-5" title={title}>
      <div className="text-[11px] uppercase tracking-wider text-navy-400 font-semibold">{label}</div>
      <div className={`text-2xl sm:text-3xl font-bold mt-2 tnum ${toneCls}`}>{value}</div>
      {sub && <div className="text-xs text-navy-400 mt-1.5 leading-relaxed">{sub}</div>}
    </div>
  );
}

/* ---------------------------------------------------------------- BarList -- */
export function BarList({ rows, format, colour = 'var(--series-1)', caption }: {
  rows: { key: string; label: string; value: number; meta?: string }[];
  format?: FormatKey; colour?: string; caption?: string;
}) {
  const valueFormat = fmt(format);
  const [hover, setHover] = useState<string | null>(null);
  const max = Math.max(...rows.map((r) => r.value), 1);
  if (!rows.length) return <Empty />;
  return (
    <div>
      <ul className="space-y-2.5">
        {rows.map((r) => (
          <li key={r.key}
              onMouseEnter={() => setHover(r.key)} onMouseLeave={() => setHover(null)}
              className="group cursor-default">
            <div className="flex items-baseline justify-between gap-4 mb-1">
              <span className="text-[13px] text-navy-200 truncate" title={r.label}>{r.label}</span>
              <span className="text-[13px] text-navy-100 font-semibold tnum shrink-0">{valueFormat(r.value)}</span>
            </div>
            <div className="h-2 rounded-full bg-navy-800/70 overflow-hidden">
              <div className="h-2 rounded-full transition-[width] duration-300"
                   style={{ width: `${Math.max(0.6, (r.value / max) * 100)}%`,
                            background: colour,
                            opacity: hover && hover !== r.key ? 0.45 : 1 }} />
            </div>
            {r.meta && (
              <div className={`text-[11px] mt-1 tnum transition-colors ${hover === r.key ? 'text-navy-300' : 'text-navy-500'}`}>
                {r.meta}
              </div>
            )}
          </li>
        ))}
      </ul>
      {caption && <p className="text-xs text-navy-500 mt-4">{caption}</p>}
    </div>
  );
}

/* -------------------------------------------------------------- Waterfall -- */
export interface WaterfallStep {
  key: string; label: string; value: number; kind: 'base' | 'add' | 'total' | 'flow';
  note?: string;
}
export function Waterfall({ steps }: { steps: WaterfallStep[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...steps.map((s) => Math.abs(s.value)), 1);
  const colourFor = (k: WaterfallStep['kind']) =>
    k === 'total' ? 'var(--series-1)' : k === 'add' ? 'var(--series-3)'
    : k === 'flow' ? 'var(--series-4)' : 'var(--series-1)';
  return (
    <div className="space-y-2">
      {steps.map((s, i) => (
        <div key={s.key} className="relative"
             onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
          <div className="flex items-center gap-3">
            <div className="w-44 sm:w-56 shrink-0 text-right">
              <div className={`text-[13px] leading-tight ${s.kind === 'total' ? 'text-navy-50 font-semibold' : 'text-navy-300'}`}>
                {s.label}
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <div className="h-6 rounded bg-navy-900/50 relative overflow-hidden"
                   style={{ boxShadow: s.kind === 'total' ? `inset 0 0 0 1px rgba(57,135,229,0.35)` : undefined }}>
                <div className="h-6 rounded transition-[width] duration-300"
                     style={{ width: `${Math.max(0.8, (Math.abs(s.value) / max) * 100)}%`,
                              background: colourFor(s.kind),
                              opacity: hover !== null && hover !== i ? 0.5 : 1,
                              borderRight: `2px solid ${SURFACE}` }} />
              </div>
            </div>
            <div className="w-24 sm:w-28 shrink-0 text-right text-[13px] text-navy-100 font-semibold tnum">
              {fmtT(s.value)}
            </div>
          </div>
          {(hover === i || s.kind === 'total') && s.note && (
            <p className="ml-0 sm:ml-[15rem] mr-28 text-[11px] text-navy-400 mt-1 leading-relaxed">{s.note}</p>
          )}
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------- Stacked by year --- */
export function StackedFY({ years, series, format }: {
  years: { fy: number; parts: number[]; partial?: boolean }[];
  series: { label: string; colour: string }[];
  format?: FormatKey;
}) {
  const valueFormat = fmt(format);
  const [hover, setHover] = useState<{ y: number; s: number } | null>(null);
  const totals = years.map((y) => y.parts.reduce((a, b) => a + b, 0));
  const max = Math.max(...totals, 1);
  return (
    <div>
      <div className="flex items-end gap-2 sm:gap-4 h-56">
        {years.map((y, yi) => {
          const total = totals[yi];
          return (
            <div key={y.fy} className="flex-1 flex flex-col items-center gap-1.5 min-w-0">
              <div className="text-[11px] text-navy-300 tnum">{valueFormat(total)}</div>
              <div className="w-full flex flex-col-reverse justify-start"
                   style={{ height: `${(total / max) * 100}%` }}>
                {y.parts.map((v, si) => (
                  <div key={si}
                    onMouseEnter={() => setHover({ y: yi, s: si })} onMouseLeave={() => setHover(null)}
                    title={`FY${y.fy} · ${series[si].label} · ${valueFormat(v)}`}
                    className="w-full first:rounded-t"
                    style={{ height: `${(v / total) * 100}%`,
                             background: series[si].colour,
                             borderTop: si < y.parts.length - 1 ? `2px solid ${SURFACE}` : undefined,
                             opacity: hover && !(hover.y === yi && hover.s === si) ? 0.5 : 1 }} />
                ))}
              </div>
              <div className="text-[11px] text-navy-400 tnum">
                FY{String(y.fy).slice(2)}{y.partial ? '*' : ''}
              </div>
            </div>
          );
        })}
      </div>
      <Legend series={series} />
      {hover && (
        <p className="text-xs text-navy-300 mt-2 tnum">
          FY{years[hover.y].fy} · {series[hover.s].label} ·{' '}
          <strong className="text-navy-100">{valueFormat(years[hover.y].parts[hover.s])}</strong>{' '}
          ({fmtPct(years[hover.y].parts[hover.s] / totals[hover.y] * 100)} of the year)
        </p>
      )}
      {years.some((y) => y.partial) && (
        <p className="text-[11px] text-navy-500 mt-2">* fiscal year in progress — period-to-date, not a closed year.</p>
      )}
    </div>
  );
}

export function Legend({ series }: { series: { label: string; colour: string }[] }) {
  return (
    <ul className="flex flex-wrap gap-x-5 gap-y-1.5 mt-4">
      {series.map((s) => (
        <li key={s.label} className="flex items-center gap-2 text-xs text-navy-300">
          <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: s.colour }} />
          {s.label}
        </li>
      ))}
    </ul>
  );
}

/* -------------------------------------------------------------- LineTrend -- */
export function LineTrend({ points, format = 'pct0', label, reference }: {
  points: { x: number; y: number; partial?: boolean }[];
  format?: FormatKey; label: string;
  reference?: { y: number; label: string };
}) {
  const valueFormat = fmt(format);
  const [idx, setIdx] = useState<number | null>(null);
  const uid = useId();
  if (points.length < 2) return <Empty />;
  const W = 640, H = 200, PL = 46, PR = 16, PT = 14, PB = 26;
  const ys = points.map((p) => p.y).concat(reference ? [reference.y] : []);
  const maxY = Math.max(...ys) * 1.15, minY = 0;
  const sx = (i: number) => PL + (i / (points.length - 1)) * (W - PL - PR);
  const sy = (v: number) => PT + (1 - (v - minY) / (maxY - minY || 1)) * (H - PT - PB);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${sx(i).toFixed(1)},${sy(p.y).toFixed(1)}`).join(' ');
  const area = `${d} L${sx(points.length - 1).toFixed(1)},${sy(0)} L${sx(0).toFixed(1)},${sy(0)} Z`;
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img"
           aria-label={`${label} by fiscal year`}
           onMouseLeave={() => setIdx(null)}
           onMouseMove={(e) => {
             const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
             const x = ((e.clientX - r.left) / r.width) * W;
             const i = Math.round(((x - PL) / (W - PL - PR)) * (points.length - 1));
             setIdx(Math.max(0, Math.min(points.length - 1, i)));
           }}>
        <defs>
          <linearGradient id={`g${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--series-1)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="var(--series-1)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 0.5, 1].map((t) => (
          <line key={t} x1={PL} x2={W - PR} y1={sy(maxY * t)} y2={sy(maxY * t)}
                stroke="var(--grid-line)" strokeWidth="1" />
        ))}
        {[0, 0.5, 1].map((t) => (
          <text key={t} x={PL - 8} y={sy(maxY * t) + 3} textAnchor="end"
                className="tnum" fill="#627d98" fontSize="10">{valueFormat(maxY * t)}</text>
        ))}
        {reference && (
          <>
            <line x1={PL} x2={W - PR} y1={sy(reference.y)} y2={sy(reference.y)}
                  stroke="#829ab1" strokeWidth="1" strokeDasharray="4 4" />
            <text x={W - PR} y={sy(reference.y) - 5} textAnchor="end" fill="#829ab1" fontSize="10">
              {reference.label}
            </text>
          </>
        )}
        <path d={area} fill={`url(#g${uid})`} />
        <path d={d} fill="none" stroke="var(--series-1)" strokeWidth="2"
              strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p, i) => (
          <circle key={i} cx={sx(i)} cy={sy(p.y)} r={i === idx ? 5 : 3.5}
                  fill="var(--series-1)" stroke={SURFACE} strokeWidth="2" />
        ))}
        {idx !== null && (
          <line x1={sx(idx)} x2={sx(idx)} y1={PT} y2={H - PB} stroke="#829ab1"
                strokeWidth="1" strokeDasharray="3 3" />
        )}
        {points.map((p, i) => (
          <text key={i} x={sx(i)} y={H - 8} textAnchor="middle" className="tnum"
                fill={i === idx ? '#d9e2ec' : '#627d98'} fontSize="10">
            FY{String(p.x).slice(2)}{p.partial ? '*' : ''}
          </text>
        ))}
      </svg>
      <p className="text-xs text-navy-300 mt-1 h-4 tnum">
        {idx !== null
          ? <>FY{points[idx].x} · <strong className="text-navy-100">{valueFormat(points[idx].y)}</strong>{points[idx].partial ? ' · year in progress' : ''}</>
          : <span className="text-navy-500">Hover the line for a fiscal year.</span>}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------- DriftBars --- */
export function DriftBars({ rows }: {
  rows: { label: string; value: number; sub?: string; closed?: boolean }[];
}) {
  const max = Math.max(...rows.map((r) => Math.abs(r.value)), 1);
  return (
    <div className="space-y-3">
      {rows.map((r) => {
        const pct = (Math.abs(r.value) / max) * 50;
        const up = r.value >= 0;
        return (
          <div key={r.label} className="flex items-center gap-3">
            <div className="w-20 shrink-0 text-[13px] text-navy-300 tnum">{r.label}</div>
            <div className="flex-1 relative h-6">
              <div className="absolute inset-y-0 left-1/2 w-px" style={{ background: 'var(--diverge-zero)' }} />
              <div className="absolute inset-y-1 rounded"
                   style={{ [up ? 'left' : 'right']: '50%', width: `${Math.max(0.4, pct)}%`,
                            background: up ? 'var(--diverge-up)' : 'var(--diverge-down)' } as React.CSSProperties} />
            </div>
            <div className="w-32 shrink-0 text-right text-[13px] tnum text-navy-100">
              {r.sub}
            </div>
          </div>
        );
      })}
      <ul className="flex flex-wrap gap-x-5 gap-y-1.5 pt-1">
        <li className="flex items-center gap-2 text-xs text-navy-300">
          <span className="w-2.5 h-2.5 rounded-sm" style={{ background: 'var(--diverge-up)' }} />increase
        </li>
        <li className="flex items-center gap-2 text-xs text-navy-300">
          <span className="w-2.5 h-2.5 rounded-sm" style={{ background: 'var(--diverge-down)' }} />decrease
        </li>
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ misc --- */
export function Empty() {
  return <p className="text-sm text-navy-500 italic py-6">No rows in scope for this selection.</p>;
}

export function DataTable({ head, rows, caption }: {
  head: string[]; rows: (string | number)[][]; caption?: string;
}) {
  return (
    <div>
      <div className="scroll-x rounded-lg border border-navy-800">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="bg-navy-900/70">
              {head.map((h, i) => (
                <th key={h} scope="col"
                    className={`px-4 py-2.5 text-[11px] uppercase tracking-wider font-semibold text-navy-400 ${i ? 'text-right' : 'text-left'}`}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-navy-800/70 hover:bg-navy-900/40">
                {r.map((c, j) => (
                  <td key={j} className={`px-4 py-2.5 tnum ${j ? 'text-right text-navy-100' : 'text-navy-300'}`}>{c}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {caption && <p className="text-xs text-navy-500 mt-3">{caption}</p>}
    </div>
  );
}

export { fmtT, fmtPct, fmtInt };

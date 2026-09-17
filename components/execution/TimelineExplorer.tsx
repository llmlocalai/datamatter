'use client';
import { useMemo, useState } from 'react';
import type { ApropEvent, TimelineHolder, TimelineMonth } from '@/lib/timeline';

/**
 * Contract obligation through the fiscal year, one line per year, with each
 * year's full-year appropriation act marked on its own line.
 *
 * The default is SHARE of the year rather than dollars, because the years differ in
 * size and the question is shape. Dollars are one click away and say so.
 *
 * Months past the reporting frontier are not drawn. They are not zero, they are
 * unreported: FY2026's contract extract runs to August and is substantially
 * complete only to April, and drawing the gap as zero ran the curve flat for
 * three months on the page this one sits beside.
 */
const MONTHS = ['Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep'];
const SERIES = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)',
                'var(--series-4)', 'var(--series-5)', '#f2f6fb'];

type Mode = 'cumulative' | 'monthly';
type Basis = 'share' | 'dollars';
type Window = 'full' | 'samePoint';

export default function TimelineExplorer({ months, holders, events }: {
  months: TimelineMonth[]; holders: TimelineHolder[]; events: ApropEvent[];
}) {
  const [mode, setMode] = useState<Mode>('cumulative');
  const [basis, setBasis] = useState<Basis>('share');
  const [holder, setHolder] = useState('DOW');
  // Default to the same-point view whenever a year in progress is on the chart.
  // Shown as a share of its OWN observed months, a part-year reaches 100% at its
  // reporting frontier by construction -- which reads as a year that finished in
  // April. Cutting every year at the shortest observed one is the comparison an
  // execution review actually wants, and it is the one this page's sibling makes.
  const [win, setWin] = useState<Window>('samePoint');

  const holderKeys = useMemo(() => {
    const seen = new Map<string, number>();
    for (const h of holders) seen.set(h.dimKey, (seen.get(h.dimKey) ?? 0) + h.fyObligation);
    return Array.from(seen.entries()).sort((a, b) => b[1] - a[1]).map(([k]) => k);
  }, [holders]);

  const rows = useMemo(
    () => months.filter((m) => m.dimKey === holder && m.isObserved),
    [months, holder]);

  const years = useMemo(
    () => Array.from(new Set(rows.map((r) => r.fiscalYear))).sort(), [rows]);

  // The shortest observed year on the chart. Every year is cut here in the
  // same-point view, so the curves compare like with like.
  const frontier = useMemo(() => Math.min(12, ...years.map((fy) =>
    rows.filter((r) => r.fiscalYear === fy).reduce((n, r) => Math.max(n, r.fyMonth), 0))),
    [years, rows]);
  const cut = win === 'samePoint' ? frontier : 12;

  const series = useMemo(() => years.map((fy) => {
    const ms = rows.filter((r) => r.fiscalYear === fy && r.fyMonth <= cut)
      .sort((a, b) => a.fyMonth - b.fyMonth);
    const tot = ms.reduce((n, r) => n + r.obligation, 0) || 1;
    let cum = 0;
    return {
      fy,
      points: ms.map((r) => {
        cum += r.obligation;
        const v = mode === 'cumulative'
          ? (basis === 'share' ? 100 * cum / tot : cum)
          : (basis === 'share' ? 100 * r.obligation / tot : r.obligation);
        return { m: r.fyMonth, v };
      }),
      // Read off the calendar, not off the holder row: the holder row carries
      // the same month, and one source for it means the marker cannot disagree
      // with the strip above.
      enactedMonth: enactedMonthOf(fy, events),
    };
  }), [years, rows, mode, basis, events, cut]);

  const max = Math.max(1, ...series.flatMap((s) => s.points.map((p) => p.v)));
  const W = 960; const H = 340; const L = 54; const R = 12; const T = 14; const B = 34;
  const x = (m: number) => L + ((m - 1) / 11) * (W - L - R);
  const y = (v: number) => T + (1 - v / max) * (H - T - B);
  const fmt = (v: number) => (basis === 'share' ? `${v.toFixed(0)}%` : `$${(v / 1e9).toFixed(0)}B`);

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-5 text-[12px]">
        <Group value={mode} set={setMode as (v: string) => void}
               opts={[['cumulative', 'Cumulative'], ['monthly', 'By month']]} />
        <Group value={basis} set={setBasis as (v: string) => void}
               opts={[['share', 'Share'], ['dollars', 'Dollars']]} />
        {frontier < 12 && (
          <Group value={win} set={setWin as (v: string) => void}
                 opts={[['samePoint', `Same point (to ${MONTHS[frontier - 1]})`],
                        ['full', 'Full year']]} />
        )}
        <select value={holder} onChange={(e) => setHolder(e.target.value)}
                className="bg-navy-900 border border-navy-700 rounded px-2.5 py-1.5 text-navy-200
                           text-[12px] focus:outline-none focus:border-accent-500"
                aria-label="Fund holder">
          <option value="DOW">Department (all fund holders)</option>
          {holderKeys.filter((k) => k !== 'DOW').map((k) => (
            <option key={k} value={k}>{k}</option>
          ))}
        </select>
      </div>

      <figure className="overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[620px]" role="img"
             aria-label={`Contract obligation by fiscal month, ${holder}`}>
          {[0, 0.25, 0.5, 0.75, 1].map((f) => (
            <g key={f}>
              <line x1={L} y1={y(max * f)} x2={W - R} y2={y(max * f)}
                    stroke="#16304f" strokeWidth={1} />
              <text x={L - 8} y={y(max * f) + 4} fontSize={12} fill="#e8c88a" textAnchor="end">
                {fmt(max * f)}
              </text>
            </g>
          ))}
          {MONTHS.map((m, i) => (
            <text key={m} x={x(i + 1)} y={H - 12} fontSize={12} fill="#c4d4e6" textAnchor="middle">
              {m}
            </text>
          ))}
          {series.map((s, i) => {
            const c = SERIES[i % SERIES.length];
            const d = s.points.map((p, j) => `${j ? 'L' : 'M'}${x(p.m)},${y(p.v)}`).join(' ');
            const mark = s.enactedMonth
              ? s.points.find((p) => p.m === s.enactedMonth) : null;
            return (
              <g key={s.fy}>
                <path d={d} fill="none" stroke={c} strokeWidth={2}
                      strokeLinejoin="round" strokeLinecap="round" />
                {mark && (
                  <>
                    <circle cx={x(mark.m)} cy={y(mark.v)} r={5} fill={c}
                            stroke="#0a1929" strokeWidth={2} />
                    <circle cx={x(mark.m)} cy={y(mark.v)} r={9} fill="none"
                            stroke={c} strokeWidth={1} />
                  </>
                )}
              </g>
            );
          })}
        </svg>
        <figcaption className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px]">
          {series.map((s, i) => (
            <span key={s.fy} className="inline-flex items-center gap-1.5 text-navy-300">
              <span className="inline-block w-3 h-0.5" style={{ background: SERIES[i % SERIES.length] }} />
              FY{s.fy}
            </span>
          ))}
          <span className="text-navy-500">
            The ringed point on each line is the month that year&rsquo;s full-year appropriation act
            was signed. FY2025 has none: it never received one.
            {frontier < 12 && (win === 'samePoint'
              ? ` Every year is cut at ${MONTHS[frontier - 1]}, the last month the live year is
                  observed for, so the shares are of the same window in each year.`
              : ` Full year: the live year is shown as a share of its own observed months, so it
                  reaches 100% at its reporting frontier by construction and its LEVEL is not
                  comparable with the complete years. Compare shape, or switch to dollars.`)}
          </span>
        </figcaption>
      </figure>
    </div>
  );
}

function enactedMonthOf(fy: number, events: ApropEvent[]): number | null {
  const e = events.find((v) => v.fiscalYear === fy && v.eventKind === 'enactment');
  if (!e) return null;
  const m = Number(e.startDate.slice(5, 7));
  return m >= 10 ? m - 9 : m + 3;
}

function Group({ value, set, opts }: {
  value: string; set: (v: string) => void; opts: [string, string][];
}) {
  return (
    <div className="inline-flex rounded border border-navy-700 overflow-hidden">
      {opts.map(([v, l]) => (
        <button key={v} type="button" onClick={() => set(v)}
                className={`px-2.5 py-1.5 text-[12px] transition-colors ${
                  value === v ? 'bg-accent-500 text-navy-950 font-semibold'
                              : 'bg-navy-900 text-navy-300 hover:text-navy-100'}`}>
          {l}
        </button>
      ))}
    </div>
  );
}

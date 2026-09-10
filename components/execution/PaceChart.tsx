import { fmtT } from '@/components/format';

/**
 * Cumulative contract obligations by day of the fiscal year, one line per year.
 *
 * Drawn rather than plotted with a library, for the same reason the rest of this
 * site is: an SVG the server renders has no hydration cost and cannot fail
 * differently in production. The only interaction it needs is reading a value at
 * a date, and the marker below does that without JavaScript.
 *
 * The live year's line STOPS where its data stops. Continuing it to the right
 * edge, or drawing it against a full-year axis without saying where it ends, is
 * the single misreading this chart exists to prevent.
 */
export interface PacePoint { fiscalYear: number; dayOfFy: number; cumObligation: number }

const MONTH_TICKS: { day: number; label: string }[] = [
  { day: 1, label: 'Oct' }, { day: 32, label: 'Nov' }, { day: 62, label: 'Dec' },
  { day: 93, label: 'Jan' }, { day: 124, label: 'Feb' }, { day: 152, label: 'Mar' },
  { day: 183, label: 'Apr' }, { day: 213, label: 'May' }, { day: 244, label: 'Jun' },
  { day: 274, label: 'Jul' }, { day: 305, label: 'Aug' }, { day: 336, label: 'Sep' },
];

export function PaceChart({ points, liveYear, todayDayOfFy, dataEndsDay }: {
  points: PacePoint[];
  liveYear: number;
  /** Where the calendar is today, which is not where the data ends. */
  todayDayOfFy: number;
  dataEndsDay: number;
}) {
  if (!points.length) return null;
  const years = Array.from(new Set(points.map((p) => p.fiscalYear))).sort();
  const maxY = Math.max(...points.map((p) => p.cumObligation)) * 1.04;
  const W = 900, H = 320, L = 62, R = 16, T = 12, B = 34;
  const x = (d: number) => L + (Math.min(d, 366) / 366) * (W - L - R);
  const y = (v: number) => T + (1 - v / maxY) * (H - T - B);

  const line = (fy: number) => {
    const ps = points.filter((p) => p.fiscalYear === fy).sort((a, b) => a.dayOfFy - b.dayOfFy);
    return ps.map((p, i) => `${i ? 'L' : 'M'}${x(p.dayOfFy).toFixed(1)},${y(p.cumObligation).toFixed(1)}`).join(' ');
  };
  const endOf = (fy: number) => {
    const ps = points.filter((p) => p.fiscalYear === fy);
    return ps.reduce((a, b) => (b.dayOfFy > a.dayOfFy ? b : a), ps[0]);
  };
  const shade = (fy: number, i: number) =>
    fy === liveYear ? 'var(--series-1)' : `rgba(148,163,184,${0.25 + i * 0.13})`;

  const gridVals = [0.25, 0.5, 0.75, 1].map((f) => maxY * f);

  return (
    <div>
      <div className="scroll-x">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[640px]" role="img"
             aria-label={`Cumulative contract obligations by day of fiscal year, FY${years[0]} to FY${years[years.length - 1]}`}>
          {gridVals.map((v) => (
            <g key={v}>
              <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="currentColor"
                    className="text-navy-800" strokeWidth="1" />
              <text x={L - 8} y={y(v) + 4} textAnchor="end"
                    className="fill-navy-500 text-[10px] tnum">{fmtT(v)}</text>
            </g>
          ))}
          {MONTH_TICKS.map((m) => (
            <g key={m.day}>
              <line x1={x(m.day)} x2={x(m.day)} y1={T} y2={H - B} stroke="currentColor"
                    className="text-navy-900" strokeWidth="1" />
              <text x={x(m.day)} y={H - B + 14} textAnchor="middle"
                    className="fill-navy-500 text-[10px]">{m.label}</text>
            </g>
          ))}
          {/* Today, and where the data actually stops. The gap between them is
              the reporting lag and it is the reason the live line ends early. */}
          <line x1={x(todayDayOfFy)} x2={x(todayDayOfFy)} y1={T} y2={H - B}
                stroke="var(--series-4, #f59e0b)" strokeWidth="1.5" strokeDasharray="4 3" />
          <text x={x(todayDayOfFy) - 6} y={T + 12} textAnchor="end"
                className="fill-amber-400/90 text-[10px]">today</text>
          <line x1={x(dataEndsDay)} x2={x(dataEndsDay)} y1={T} y2={H - B}
                stroke="currentColor" className="text-navy-600" strokeWidth="1" strokeDasharray="2 4" />
          <text x={x(dataEndsDay) - 6} y={T + 26} textAnchor="end"
                className="fill-navy-500 text-[10px]">data ends</text>

          {years.map((fy, i) => (
            <path key={fy} d={line(fy)} fill="none" stroke={shade(fy, i)}
                  strokeWidth={fy === liveYear ? 2.6 : 1.5} strokeLinejoin="round" />
          ))}
          {years.map((fy) => {
            const e = endOf(fy);
            if (!e) return null;
            return (
              <g key={`e${fy}`}>
                <circle cx={x(e.dayOfFy)} cy={y(e.cumObligation)} r={fy === liveYear ? 4 : 2.5}
                        fill={fy === liveYear ? 'var(--series-1)' : 'rgba(148,163,184,0.8)'} />
                <text x={x(e.dayOfFy) + 7} y={y(e.cumObligation) + 3}
                      className={`text-[10px] tnum ${fy === liveYear ? 'fill-accent-400' : 'fill-navy-500'}`}>
                  FY{String(fy).slice(2)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

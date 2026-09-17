import type { ApropEvent } from '@/lib/timeline';

/**
 * The appropriation calendar, one fiscal year per row, October on the left.
 *
 * Three states and they are not interchangeable. A LAPSE is no appropriation of
 * any kind; a CONTINUING RESOLUTION is an appropriation at the prior year's rate
 * with new starts and production-rate increases generally barred; a full-year
 * ACT is the appropriation the budget was built on. FY2026 held all three inside
 * eighteen weeks, and a chart that merged the first two would say nothing about
 * the difference the page exists to show.
 *
 * Widths are days, taken from the calendar's own dates. Nothing here is stored
 * as a day count: the arithmetic runs on the dates, so it cannot drift away from
 * them.
 */
const DAYS = 365;
const MONTHS = ['Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep'];
const LEN = [31, 30, 31, 31, 28, 31, 30, 31, 30, 31, 31, 30];

const FILL = {
  lapse: 'var(--status-critical)',
  cr: 'var(--status-warning)',
  enacted: 'var(--status-good)',
} as const;

type Span = { kind: keyof typeof FILL; from: number; to: number };

/** The year's days resolved into non-overlapping spans, lapse winning. */
function spansFor(fy: number, events: ApropEvent[]): Span[] {
  const y = events.filter((e) => e.fiscalYear === fy);
  const act = y.find((e) => e.eventKind === 'enactment');
  const lapses = y.filter((e) => e.eventKind === 'shutdown' && e.endDay !== null);
  const state = new Array<keyof typeof FILL>(DAYS + 1).fill('cr');
  if (act) for (let d = act.startDay; d <= DAYS; d += 1) state[d] = 'enacted';
  for (const l of lapses) {
    for (let d = l.startDay; d <= Math.min(DAYS, l.endDay as number); d += 1) state[d] = 'lapse';
  }
  const out: Span[] = [];
  for (let d = 1; d <= DAYS; d += 1) {
    const k = state[d];
    const last = out[out.length - 1];
    if (last && last.kind === k && last.to === d - 1) last.to = d;
    else out.push({ kind: k, from: d, to: d });
  }
  return out;
}

export default function CalendarStrip({ events, years }:
  { events: ApropEvent[]; years: number[] }) {
  const W = 1000; const ROW = 38; const LABEL = 62; const TOP = 22;
  const x = (day: number) => LABEL + ((day - 1) / DAYS) * (W - LABEL - 8);
  let acc = 1;
  const ticks = MONTHS.map((m, i) => { const d = acc; acc += LEN[i]; return { m, d }; });

  return (
    <figure className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${TOP + years.length * ROW + 14}`}
           className="w-full min-w-[640px]" role="img"
           aria-label="Appropriation status by day of fiscal year, FY2021 to FY2026">
        {ticks.map((t) => (
          <g key={t.m}>
            <line x1={x(t.d)} y1={TOP - 6} x2={x(t.d)} y2={TOP + years.length * ROW - 8}
                  stroke="#1e3a5f" strokeWidth={1} />
            <text x={x(t.d) + 3} y={TOP - 10} fontSize={12} fill="#e8c88a">{t.m}</text>
          </g>
        ))}
        {years.map((fy, i) => {
          const y0 = TOP + i * ROW;
          const act = events.find((e) => e.fiscalYear === fy && e.eventKind === 'enactment');
          return (
            <g key={fy}>
              <text x={0} y={y0 + 15} fontSize={12} fill="#c4d4e6" fontWeight={600}>FY{fy}</text>
              {spansFor(fy, events).map((s) => (
                <rect key={`${s.kind}-${s.from}`} x={x(s.from)} y={y0}
                      width={Math.max(1, x(s.to + 1) - x(s.from))} height={18}
                      fill={FILL[s.kind]} rx={2} />
              ))}
              {act && (
                <g>
                  <line x1={x(act.startDay)} y1={y0 - 3} x2={x(act.startDay)} y2={y0 + 21}
                        stroke="#ffffff" strokeWidth={1.5} />
                  <text x={x(act.startDay) + 4} y={y0 + 31} fontSize={12} fill="#f2f6fb">
                    {act.publicLaw}
                  </text>
                </g>
              )}
            </g>
          );
        })}
      </svg>
      <figcaption className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-[12px] text-navy-400">
        {([['lapse', 'Lapse in appropriations'], ['cr', 'Continuing resolution'],
           ['enacted', 'Full-year appropriation act']] as const).map(([k, l]) => (
          <span key={k} className="inline-flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded-sm" style={{ background: FILL[k] }} />
            {l}
          </span>
        ))}
        <span className="text-navy-500">
          The white rule is the day the act was signed. FY2025 carries no rule: it never
          received one.
        </span>
      </figcaption>
    </figure>
  );
}

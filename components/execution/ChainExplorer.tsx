'use client';
import { useMemo, useState } from 'react';
import type { ChainAuthority, ChainFirst, ChainLag, ChainOc, ChainUnit } from '@/lib/chain';

/**
 * One component's colour of money, one year, end to end.
 *
 * Three figures stacked on the SAME day axis, because the whole point is that
 * they line up: when authority arrived, when each type of spending actually
 * moved, and what sits between the two. Day 1 is 1 October.
 *
 * The middle figure is a timing bar per object class -- d10 to d90 with the
 * median marked -- rather than a cumulative curve per class. With eight classes
 * on one axis the curves become a thicket, and the question here is ordering:
 * which kind of spending moved first and which waited.
 */
const MONTHS = ['Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep'];
const LEN = [31, 30, 31, 31, 28, 31, 30, 31, 30, 31, 31, 30];
const STATE_FILL = { lapse: 'var(--status-critical)', cr: 'var(--status-warning)',
                     enacted: 'var(--status-good)' } as const;

export default function ChainExplorer({ units, authority, first, lag, oc }: {
  units: ChainUnit[]; authority: ChainAuthority[]; first: ChainFirst[];
  lag: ChainLag[]; oc: ChainOc[];
}) {
  const years = useMemo(
    () => Array.from(new Set(units.map((u) => u.fiscalYear))).sort((a, b) => b - a), [units]);
  const [fy, setFy] = useState(years[0]);
  const inYear = useMemo(() => units.filter((u) => u.fiscalYear === fy), [units, fy]);
  const agencies = useMemo(
    () => Array.from(new Set(inYear.map((u) => u.agencyCode))).sort(), [inYear]);
  const [agency, setAgency] = useState(agencies.includes('021') ? '021' : agencies[0]);
  const approps = useMemo(() => inYear.filter((u) => u.agencyCode === agency)
    .sort((a, b) => b.obligations - a.obligations).map((u) => u.appropriation), [inYear, agency]);
  const [approp, setApprop] = useState(
    approps.includes('Operation and maintenance') ? 'Operation and maintenance' : approps[0]);

  // A change of year or component can leave a colour of money that unit does not
  // have. Fall back to its largest rather than rendering an empty figure.
  const activeApprop = approps.includes(approp) ? approp : approps[0];
  const activeAgency = agencies.includes(agency) ? agency : agencies[0];

  const unit = inYear.find((u) => u.agencyCode === activeAgency && u.appropriation === activeApprop);
  const sel = <T extends { fiscalYear: number; agencyCode: string; appropriation: string }>(rows: T[]) =>
    rows.filter((r) => r.fiscalYear === fy && r.agencyCode === activeAgency
      && r.appropriation === activeApprop);
  const auth = sel(authority).sort((a, b) => a.seq - b.seq);
  const cells = sel(first).filter((f) => f.d10Day && f.d90Day)
    .sort((a, b) => (a.d50Day ?? 999) - (b.d50Day ?? 999));
  const steps = sel(lag);
  const ocRows = sel(oc).sort((a, b) => b.obligations - a.obligations);
  const head = steps[0];

  const W = 960; const L = 132; const R = 16;
  const x = (d: number) => L + ((Math.max(1, Math.min(365, d)) - 1) / 364) * (W - L - R);
  let acc = 1;
  const ticks = MONTHS.map((m, i) => { const d = acc; acc += LEN[i]; return { m, d }; });
  const maxAuth = Math.max(1, ...auth.map((a) => a.authorityAvailable));

  return (
    <div className="min-w-0 max-w-full">
      <div className="flex flex-wrap gap-2 mb-6 text-[12px]">
        <Pick label="Fiscal year" value={String(fy)} set={(v) => setFy(Number(v))}
              opts={years.map((y) => [String(y), `FY${y}`])} />
        <Pick label="Component" value={activeAgency} set={setAgency}
              opts={agencies.map((a) => [a, AGENCY[a] ?? a])} />
        <Pick label="Colour of money" value={activeApprop} set={setApprop}
              opts={approps.map((a) => [a, a])} />
      </div>

      {unit && (
        <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3 mb-8">
          <Fig label="Enacted authority" value={money(unit.baAppropriated)} tone="accent" />
          <Fig label="Total resources" value={money(unit.resources)} />
          <Fig label="Obligated" value={money(unit.obligations)}
               sub={unit.resources ? `${(100 * unit.obligations / unit.resources).toFixed(1)}% of resources` : undefined} />
          <Fig label="Outlaid" value={money(unit.outlays)}
               sub={unit.obligations ? `${(100 * unit.outlays / unit.obligations).toFixed(1)}% of obligations` : undefined} />
          <Fig label="Unobligated" value={money(unit.unobligated)} tone="warning" />
        </div>
      )}

      {/* ---------------------------------------------- authority staircase -- */}
      <h3 className="text-sm font-semibold text-navy-100 mb-1">
        1 · When the money was there, and how much
      </h3>
      <p className="text-[12px] text-navy-400 mb-4 max-w-3xl leading-relaxed">
        Both ends are File A figures. Under a continuing resolution the account carries
        authority at the prior year&rsquo;s annualised rate, which is the rule that shapes the
        middle; at enactment it carries its own enacted amount for the first time. Under a lapse
        it carries nothing.
      </p>
      <figure className="w-full max-w-full overflow-x-auto">
        <svg viewBox={`0 0 ${W} 190`} className="w-full min-w-[640px]" role="img"
             aria-label="Budget authority available by day of fiscal year">
          {ticks.map((t) => (
            <g key={t.m}>
              <line x1={x(t.d)} y1={16} x2={x(t.d)} y2={150} stroke="#16304f" strokeWidth={1} />
              <text x={x(t.d) + 3} y={12} fontSize={12} fill="#e8c88a">{t.m}</text>
            </g>
          ))}
          {auth.map((a, i) => {
            const nx = i + 1 < auth.length ? auth[i + 1].dayOfFy : 365;
            const h = (a.authorityAvailable / maxAuth) * 118;
            return (
              <g key={a.seq}>
                <rect x={x(a.dayOfFy)} y={150 - h} width={Math.max(1, x(nx) - x(a.dayOfFy))}
                      height={Math.max(1, h)} fill={STATE_FILL[a.state]} opacity={0.85} />
                <line x1={x(a.dayOfFy)} y1={150 - h} x2={x(a.dayOfFy)} y2={150}
                      stroke="#0a1929" strokeWidth={1} />
              </g>
            );
          })}
          <line x1={L} y1={150} x2={W - R} y2={150} stroke="#2a4a6f" strokeWidth={1} />
          <text x={0} y={30} fontSize={12} fill="#c4d4e6" fontWeight={600}>Authority</text>
          <text x={0} y={46} fontSize={12} fill="#e8c88a">{money(maxAuth)} max</text>
          {auth.filter((a) => a.state === 'enacted').map((a) => (
            <g key={`e${a.seq}`}>
              <line x1={x(a.dayOfFy)} y1={10} x2={x(a.dayOfFy)} y2={158}
                    stroke="#ffffff" strokeWidth={1.5} strokeDasharray="3 3" />
              <text x={x(a.dayOfFy) + 4} y={170} fontSize={12} fill="#f2f6fb">
                {a.publicLaw} · day {a.dayOfFy}
              </text>
            </g>
          ))}
        </svg>
      </figure>
      <ol className="mt-4 space-y-1.5 text-[12px] text-navy-300">
        {auth.map((a) => (
          <li key={a.seq} className="flex flex-wrap gap-x-3 gap-y-0.5">
            <span className="tnum text-navy-500 shrink-0 w-24 sm:w-28">
              {a.eventDate} · d{a.dayOfFy}
            </span>
            <span className="shrink-0 w-14 sm:w-20 font-semibold"
                  style={{ color: STATE_FILL[a.state] }}>{STATE_LABEL[a.state]}</span>
            <span className="tnum shrink-0 w-20 sm:w-24 text-navy-100">{money(a.authorityAvailable)}</span>
            <span className="text-navy-400 basis-full sm:basis-auto sm:flex-1 min-w-0">
              <span className="text-navy-500">[{a.basis}]</span> {a.note}
            </span>
          </li>
        ))}
      </ol>

      {/* --------------------------------------------- execution timing bars -- */}
      <h3 className="text-sm font-semibold text-navy-100 mt-10 mb-1">
        2 · When each type of spending actually moved
      </h3>
      <p className="text-[12px] text-navy-400 mb-4 max-w-3xl leading-relaxed">
        Each bar runs from the day a tenth of that object class&rsquo;s observed obligation had
        been made to the day nine tenths had, with the median marked. Measured on contract
        actions that name this account, so it is an <strong className="text-navy-200">upper
        bound</strong>: an earlier obligation that named no account is invisible here. The first
        action is shown too, and it is deliberately not the measure — something obligates on
        1 October in almost every year.
      </p>
      {cells.length === 0 ? (
        <p className="text-sm text-navy-400">
          No object class in this unit has enough dated actions against a named account to place
          a ramp. That is a coverage limit, not a statement that nothing was obligated.
        </p>
      ) : (
        <figure className="w-full max-w-full overflow-x-auto">
          <svg viewBox={`0 0 ${W} ${34 + cells.length * 28}`} className="w-full min-w-[640px]"
               role="img" aria-label="Execution timing by object class">
            {ticks.map((t) => (
              <g key={t.m}>
                <line x1={x(t.d)} y1={14} x2={x(t.d)} y2={20 + cells.length * 28}
                      stroke="#16304f" strokeWidth={1} />
                <text x={x(t.d) + 3} y={10} fontSize={12} fill="#e8c88a">{t.m}</text>
              </g>
            ))}
            {head?.enactedDayOfFy ? (
              <line x1={x(head.enactedDayOfFy)} y1={14} x2={x(head.enactedDayOfFy)}
                    y2={20 + cells.length * 28} stroke="#ffffff" strokeWidth={1.5}
                    strokeDasharray="3 3" />
            ) : null}
            {head?.authorityDayOfFy ? (
              <line x1={x(head.authorityDayOfFy)} y1={14} x2={x(head.authorityDayOfFy)}
                    y2={20 + cells.length * 28} stroke="var(--status-warning)" strokeWidth={1.5} />
            ) : null}
            {cells.map((c, i) => {
              const y = 24 + i * 28;
              return (
                <g key={c.ocGroup}>
                  <text x={0} y={y + 10} fontSize={12} fill="#c4d4e6">{c.ocLabel}</text>
                  <line x1={x(c.d10Day as number)} y1={y + 6} x2={x(c.d90Day as number)} y2={y + 6}
                        stroke="var(--series-1)" strokeWidth={6} strokeLinecap="round"
                        opacity={0.5} />
                  {c.dayOfFy ? (
                    <circle cx={x(c.dayOfFy)} cy={y + 6} r={3} fill="none"
                            stroke="#e8c88a" strokeWidth={1.5} />
                  ) : null}
                  <circle cx={x(c.d50Day as number)} cy={y + 6} r={5} fill="var(--series-1)"
                          stroke="#0a1929" strokeWidth={1.5} />
                  <text x={W - R} y={y + 10} fontSize={12} fill="#829ab1" textAnchor="end">
                    {fmtM(c.positiveAmount)} · {c.actions.toLocaleString()} actions
                  </text>
                </g>
              );
            })}
          </svg>
          <figcaption className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-[12px] text-navy-500">
            <span><span className="text-accent-400">○</span> first action observed</span>
            <span><span className="text-[color:var(--series-1)]">●</span> median day</span>
            <span>bar: 10% to 90% executed</span>
            <span style={{ color: 'var(--status-warning)' }}>│ authority available</span>
            <span className="text-navy-200">┆ full-year act</span>
          </figcaption>
        </figure>
      )}

      {/* -------------------------------------------------------- the chain -- */}
      <h3 className="text-sm font-semibold text-navy-100 mt-10 mb-1">
        3 · The chain, and the part of it nobody publishes
      </h3>
      {head ? (
        <>
          <p className="text-[12px] text-navy-400 mb-4 max-w-3xl leading-relaxed">
            Authority was available on <strong className="text-navy-200">day {head.authorityDayOfFy}</strong>;
            a tenth of the observed year had been obligated by{' '}
            <strong className="text-navy-200">day {head.d10Day}</strong>
            {head.applicable
              ? <> — a measured gap of <strong className="text-navy-200">{head.residualDays} days</strong>.
                  Only the two ends of that gap are observed. The split below divides it by the
                  profile named beneath, and every interior row is an assumption, not a measurement.</>
              : <> — execution was <strong className="text-navy-200">already running {Math.abs(head.gapToAuthority ?? 0)} days
                  before</strong> that authority arrived, on the continuing resolution or on
                  carried-in balances. There is no wait to divide, so no days are assigned to the
                  interior steps.</>}
          </p>
          <ol className="space-y-2">
            {steps.map((s) => (
              <li key={s.stepKey}
                  className={`flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded px-3 py-2 min-w-0 ${
                    s.basis === 'measured' ? 'bg-navy-900/70' : 'bg-navy-900/30'}`}>
                <span className={`text-[12px] font-semibold shrink-0 w-14 ${
                  s.basis === 'measured' ? 'text-[color:var(--status-good)]' : 'text-navy-500'}`}>
                  {s.basis === 'measured' ? 'measured' : 'assumed'}
                </span>
                <span className="text-sm text-navy-100 shrink-0 w-full sm:w-64">{s.stepLabel}</span>
                <span className="tnum text-sm shrink-0 w-16 text-right text-navy-50">
                  {s.basis === 'measured' ? '—'
                    : (s.applicable ? `${Number(s.days).toFixed(0)} d` : 'n/a')}
                </span>
                <span className="text-[12px] text-navy-400 basis-full sm:basis-auto sm:flex-1 min-w-0">
                  {s.stepDetail} <span className="text-navy-500">{s.authority}</span>
                </span>
              </li>
            ))}
          </ol>
          {head.profileNote && (
            <p className="mt-3 text-[12px] text-navy-500 max-w-3xl leading-relaxed">
              Profile: <span className="text-navy-300">{head.profileLabel}</span>. {head.profileNote}
            </p>
          )}
        </>
      ) : (
        <p className="text-sm text-navy-400">
          This unit has no dated sample large enough to anchor a chain.
        </p>
      )}

      {/* ------------------------------------------- the complete dimensions -- */}
      <h3 className="text-sm font-semibold text-navy-100 mt-10 mb-1">
        4 · Every dollar, by type of execution
      </h3>
      <p className="text-[12px] text-navy-400 mb-4 max-w-3xl leading-relaxed">
        File B, direct obligations, this unit&rsquo;s own-year money. Complete — and carrying no
        timing at all, which is why it sits beside the censored ramp above rather than inside it.
      </p>
      {ocRows.length === 0 ? (
        <p className="text-sm text-navy-400">
          File B publishes object-class detail for the three most recent years; earlier years are
          carried as rollups.
        </p>
      ) : (
        <div className="scroll-x rounded-lg border border-navy-800">
          <table className="min-w-full text-sm">
            <thead><tr className="bg-navy-900/70">
              {['Type of execution', 'Obligated', 'Outlaid', 'Undelivered', 'Outlay rate'].map((h, i) => (
                <th key={h} scope="col"
                    className={`px-4 py-2.5 text-[12px] uppercase tracking-wider font-semibold text-navy-400 ${i ? 'text-right' : 'text-left'}`}>
                  {h}
                </th>))}
            </tr></thead>
            <tbody>
              {ocRows.map((r) => (
                <tr key={r.ocGroup} className="border-t border-navy-800/70">
                  <td className="px-4 py-2.5 text-navy-300">{r.ocLabel}</td>
                  <td className="px-4 py-2.5 tnum text-right text-navy-100">{money(r.obligations)}</td>
                  <td className="px-4 py-2.5 tnum text-right text-navy-100">{money(r.outlays)}</td>
                  <td className="px-4 py-2.5 tnum text-right text-navy-400">{money(r.undelivered)}</td>
                  <td className="px-4 py-2.5 tnum text-right text-navy-400">
                    {r.obligations ? `${(100 * r.outlays / r.obligations).toFixed(0)}%` : '—'}
                  </td>
                </tr>))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const AGENCY: Record<string, string> = {
  '097': 'Defense-wide', '021': 'Army', '017': 'Navy', '057': 'Air Force',
};
const STATE_LABEL = { lapse: 'lapse', cr: 'CR', enacted: 'enacted' } as const;

const money = (n: number) => (Math.abs(n) >= 1e9 ? `$${(n / 1e9).toFixed(2)}B`
  : Math.abs(n) >= 1e6 ? `$${(n / 1e6).toFixed(0)}M` : `$${(n / 1e3).toFixed(0)}K`);
const fmtM = (n: number) => (Math.abs(n) >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : `$${(n / 1e6).toFixed(0)}M`);

function Fig({ label, value, sub, tone = 'default' }: {
  label: string; value: string; sub?: string; tone?: 'default' | 'accent' | 'warning';
}) {
  const c = tone === 'accent' ? 'text-accent-400'
    : tone === 'warning' ? 'text-[color:var(--status-warning)]' : 'text-navy-50';
  return (
    <div className="glass-card rounded-lg p-4">
      <div className="text-[12px] uppercase tracking-wider text-navy-400 font-semibold">{label}</div>
      <div className={`text-xl font-bold mt-1.5 tnum ${c}`}>{value}</div>
      {sub && <div className="text-[12px] text-navy-500 mt-1">{sub}</div>}
    </div>
  );
}

function Pick({ label, value, set, opts }: {
  label: string; value: string; set: (v: string) => void; opts: [string, string][];
}) {
  return (
    <label className="inline-flex items-center gap-2">
      <span className="text-navy-500">{label}</span>
      <select value={value} onChange={(e) => set(e.target.value)}
              className="bg-navy-900 border border-navy-700 rounded px-2.5 py-1.5 text-navy-200
                         text-[12px] focus:outline-none focus:border-accent-500">
        {opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}

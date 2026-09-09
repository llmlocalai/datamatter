import type { Metadata } from 'next';
import Link from 'next/link';
import Shell, { PageHeader, Section } from '@/components/Shell';
import { VintageChip, Caveat } from '@/components/Provenance';
import { StatTile, DataTable, BarList, LineTrend } from '@/components/charts';
import { fmtT, fmtB, fmtPct, fmtInt } from '@/components/format';

/** Seam volumes span millions to trillions, so they auto-scale rather than pinning to billions. */
const money = (n: number) => fmtT(n);
import {
  getAllProvenance, getSeams, getFilecPeriods, getFilecSpread, getScopeComparison,
  getMemoWeight, getVintageDrift, getProgramCoverage, getControls, getKbInventory,
  isLoaded,
} from '@/lib/analytics';
import { NotLoaded } from '../execution/page';

export const metadata: Metadata = {
  title: 'Linkage · datamatter',
  description:
    'Every figure on this site is the result of joining files that were built by different reporting chains, for different purposes, with no key in common. This page measures each of those joins, names what it loses, and shows the places where the data looks complete and is not.',
};
export const revalidate = 900;

const K = (n: number | null | undefined) => Number(n ?? 0) * 1000;

const UNIT_LABEL: Record<string, string> = {
  lines: 'budget lines', accounts: 'accounts', systems: 'weapon systems',
  dollars: 'obligated dollars', actions: 'contract actions',
};

function Badge({ children, tone = 'muted' }: {
  children: React.ReactNode; tone?: 'gold' | 'muted' | 'warn';
}) {
  const cls = tone === 'gold' ? 'bg-accent-500/15 text-accent-300 border-accent-500/30'
    : tone === 'warn' ? 'alert-warning border-transparent'
    : 'bg-navy-800 text-navy-300 border-navy-700';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium border ${cls}`}>
      {children}
    </span>
  );
}

export default async function LinkagePage() {
  if (!(await isLoaded())) return <Shell><NotLoaded /></Shell>;

  const [prov, seams, periods, spread, scope, memo, drift, coverage, controls, kb] =
    await Promise.all([
      getAllProvenance(), getSeams(), getFilecPeriods(), getFilecSpread(),
      getScopeComparison(), getMemoWeight(), getVintageDrift(), getProgramCoverage(),
      getControls(), getKbInventory(),
    ]);

  const byKey = Object.fromEntries(prov.map((p) => [p.datasetKey, p]));
  const used = Array.from(new Set(seams.flatMap((s) => [s.fromDataset, s.toDataset])))
    .map((k) => byKey[k]).filter(Boolean);

  const seam = (k: string) => seams.find((s) => s.key === k);
  const exact = seams.filter((s) => s.isExact);
  const derived = seams.filter((s) => s.isDerived);

  // ---- File C: the same year, read four ways --------------------------------
  const filecYears = Array.from(new Set(periods.map((p) => p.fiscalYear))).sort();
  const substantive = periods.filter((p) => p.isSubstantive);
  const thinPeriods = periods.length - substantive.length;
  const periodNos = Array.from(new Set(substantive.map((p) => p.periodNo)))
    .filter((n): n is number => n != null).sort((a, b) => a - b);
  const widest = [...spread].filter((s) => s.snapshots > 1)
    .sort((a, b) => (Number(b.hi) / Number(b.lo)) - (Number(a.hi) / Number(a.lo)))[0];

  // ---- the scope trap, at its largest -------------------------------------
  const worstScope = [...scope].sort((a, b) =>
    Number(b.overstatementPct) - Number(a.overstatementPct))[0];
  const openDrift = drift.find((d) => !d.yearClosed);
  const closedDrift = drift.filter((d) => d.yearClosed);
  const closedWorst = closedDrift.length
    ? Math.max(...closedDrift.map((d) =>
        Math.abs(Number(d.obligationDelta)) / Number(d.obligationTo) * 100))
    : 0;
  const newestCoverage = [...coverage].filter((c) => !c.isPartialYear)
    .sort((a, b) => b.fiscalYear - a.fiscalYear)[0];
  const newestMemo = memo[memo.length - 1];
  const ctl = (code: string) => controls.find((c) => c.code === code);

  return (
    <Shell>
      <PageHeader
        eyebrow="Method · the seams between files"
        title={<>Every figure here is a <span className="text-accent-400">join</span></>}
        lede="No file in this corpus answers an interesting question on its own. A budget line lives in one book, the account it is appropriated to in another, the contracts written against it in a third, and the record tying those contracts back to the account in a fourth — built by different reporting chains, for different purposes, and sharing no key. The joins between them are where meaning is lost, and a number that has not been traced through its seam cannot be told apart from an artefact of it. This page measures every join the site depends on."
      />

      <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2">
        {used.map((p) => (
          <VintageChip key={p.datasetKey} source={p.label} vintage={p.vintage} />
        ))}
      </div>
      <p className="text-xs text-navy-500 mt-3 leading-relaxed max-w-3xl">
        Every seam below spans two of these datasets and is therefore as old as the older of the
        two. Where a figure combines them, both vintages are named rather than one.
      </p>

      {/* ================================================== the seam map === */}
      <Section title="The seams, measured"
        note="What share of the left-hand side reaches the right-hand side. The unit differs by seam deliberately: a budget line either resolves to a Treasury account or it does not, so that seam is counted in lines, while the contract-to-account seam loses money rather than rows and is counted in dollars. Forcing them onto one scale would make the narrowest seam look like the widest.">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <StatTile label="Joins the site depends on" value={String(seams.length)}
            sub={`${exact.length} exact by construction, ${derived.length} derived here on evidence`}
            tone="accent" />
          <StatTile label="Budget line → Treasury account"
            value={seam('bli_account')?.pct != null ? fmtPct(seam('bli_account')!.pct!, 0) : '—'}
            sub="the one seam in the chain that loses nothing" />
          <StatTile label="Contract dollars traceable to an account"
            value={seam('action_account')?.pct != null ? fmtPct(seam('action_account')!.pct!) : '—'}
            tone="warning"
            sub="of obligations on the acquisition programs held, newest closed year" />
          <StatTile label="Contract dollars naming a program"
            value={seam('action_program')?.pct != null ? fmtPct(seam('action_program')!.pct!) : '—'}
            sub={newestCoverage
              ? `FY${newestCoverage.fiscalYear} — and only ${fmtPct(Number(newestCoverage.attributedActions) / Number(newestCoverage.totalActions) * 100, 1)} of actions`
              : undefined} />
        </div>

        <BarList
          format="pct"
          rows={seams.map((s) => ({
            key: s.key,
            label: `${s.fromLabel} → ${s.toLabel}`,
            value: s.pct ?? 0,
            meta: `${s.unit === 'dollars'
              ? `${money(s.numerator)} of ${money(s.denominator)}`
              : `${fmtInt(s.numerator)} of ${fmtInt(s.denominator)}`} ${UNIT_LABEL[s.unit] ?? s.unit}`
              + ` · joined on ${s.joinKey}`,
          }))}
          caption="Read as survival, not as quality. A seam at 2% is not a failure of the Department; it usually means the two files were never built to be joined and the site refuses to invent the missing key." />

        <div className="mt-10">
          <DataTable
            align={[1, 2, 3, 5]}
            caption="Exact means the two sides carry a shared identifier, so where the join fails it is because the key is absent rather than because the match was wrong. Derived means this site inferred the link from names, in which case every individual link records the evidence it rests on and can be rejected without disturbing the rest — and neither derived crosswalk is a Department-published mapping."
            head={['Seam', 'Joined on', 'Survives', 'Kind', 'What is lost']}
            rows={seams.map((s) => [
              <span key={s.key}>
                <span className="text-navy-100">{s.fromLabel}</span>
                <span className="block text-[12px] text-navy-500">→ {s.toLabel}</span>
              </span>,
              <span key={`${s.key}-j`} className="font-mono text-[11px] text-navy-400">
                {s.joinKey}
              </span>,
              <span key={`${s.key}-p`} className="text-navy-100">
                {s.pct != null ? fmtPct(s.pct) : '—'}
                <span className="block text-[11px] text-navy-500 font-normal">
                  {s.unit === 'dollars'
                    ? `${money(s.numerator)} of ${money(s.denominator)}`
                    : `${fmtInt(s.numerator)} / ${fmtInt(s.denominator)}`}
                </span>
              </span>,
              <span key={`${s.key}-k`} className="flex flex-wrap gap-1">
                {s.isExact ? <Badge tone="gold">exact</Badge> : <Badge>inferred</Badge>}
                {s.isDerived && <Badge tone="warn">derived here</Badge>}
              </span>,
              <span key={`${s.key}-n`} className="text-[12px] text-navy-400 leading-relaxed">
                {s.note}
              </span>,
            ])} />
        </div>
      </Section>

      {/* ================================================== File C in depth === */}
      <Section id="filec"
        title="File C: the seam where the answer depends on which copy you read"
        note="File C is the record that ties a contract award back to the Treasury account that funded it — the join that would close the gap between what the contract files say and what the accounting says. It is also the seam most often quoted as a single number, and that number turns out to be the product of a choice nobody had written down.">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatTile label="Snapshots held per fiscal year"
            value={String(periodNos.length)}
            sub={`at periods ${periodNos.join(', ')} — not a monthly series`} tone="accent" />
          <StatTile label="Periods carrying almost nothing"
            value={String(thinPeriods)}
            sub="fewer than a thirtieth of the volume of a real snapshot" />
          <StatTile label="Widest spread within one year"
            value={widest ? `${(Number(widest.hi) / Number(widest.lo)).toFixed(1)}×` : '—'}
            tone="warning"
            sub={widest
              ? `FY${widest.fiscalYear}: ${fmtPct(Number(widest.lo))} at period ${widest.loPeriod}, ${fmtPct(Number(widest.hi))} at period ${widest.hiPeriod}`
              : undefined} />
          <StatTile label="Years where the spread exceeds 2×"
            value={String(spread.filter((s) => s.snapshots > 1
              && Number(s.hi) / Number(s.lo) > 2).length)}
            sub={`of ${spread.filter((s) => s.snapshots > 1).length} years with more than one snapshot`} />
        </div>

        <div className="mt-10">
          <h3 className="text-sm font-semibold text-navy-200 mb-4">
            The same fiscal year, read from each snapshot the warehouse holds
          </h3>
          <DataTable
            align={[]}
            caption="Each cell is the linkage percentage that snapshot would produce: File C obligations for that period over the full-year contract obligations for that fiscal year. The marked cell is the one this site publishes — the snapshot with the most rows, on the reasoning that it is the most complete copy held. It is a defensible rule and it is still a rule."
            head={['Fiscal year', ...periodNos.map((n) => `Period ${n}`), 'Published', 'Spread']}
            rows={filecYears.map((fy) => {
              const row = spread.find((s) => s.fiscalYear === fy);
              const ratio = row && row.snapshots > 1 ? Number(row.hi) / Number(row.lo) : null;
              return [
                `FY${fy}`,
                ...periodNos.map((n) => {
                  const p = periods.find((x) => x.fiscalYear === fy && x.periodNo === n);
                  if (!p) return <span key={`${fy}-${n}`} className="text-navy-700">—</span>;
                  if (!p.isSubstantive) {
                    return (
                      <span key={`${fy}-${n}`} className="text-navy-600" title={`${fmtInt(Number(p.filecRows))} rows`}>
                        thin copy
                        <span className="block text-[11px]">{fmtInt(Number(p.filecRows))} rows</span>
                      </span>
                    );
                  }
                  return (
                    <span key={`${fy}-${n}`}
                      className={p.isChosen ? 'text-accent-300 font-semibold' : 'text-navy-100'}>
                      {p.linkagePct != null ? fmtPct(Number(p.linkagePct)) : '—'}
                      <span className="block text-[11px] text-navy-500 font-normal">
                        {fmtB(Number(p.obligation))}
                      </span>
                    </span>
                  );
                }),
                <span key={`${fy}-c`} className="text-accent-300">
                  {row?.chosenPeriod ? `period ${row.chosenPeriod}` : '—'}
                </span>,
                ratio == null
                  ? <span key={`${fy}-s`} className="text-navy-500">single snapshot</span>
                  : <span key={`${fy}-s`} className={ratio > 2 ? 'text-amber-300' : 'text-navy-100'}>
                      {ratio.toFixed(1)}×
                    </span>,
              ];
            })} />
        </div>

        <div className="mt-8 grid grid-cols-1 lg:grid-cols-2 gap-10">
          <div className="text-sm text-navy-300 leading-relaxed space-y-4">
            <p>
              <strong className="text-navy-100">This is the finding.</strong> Reading FY2022 at
              period 3 puts award-to-account linkage at {(() => {
                const s = spread.find((x) => x.fiscalYear === 2022);
                return s ? fmtPct(Number(s.lo)) : '—';
              })()}; reading the same year at period 12 puts it at {(() => {
                const s = spread.find((x) => x.fiscalYear === 2022);
                return s ? fmtPct(Number(s.hi)) : '—';
              })()}. Same warehouse, same fiscal year, same query — an eight-fold difference that
              comes entirely from which submission the copy was taken from. Neither figure is wrong.
            </p>
            <p>
              <strong className="text-navy-100">What follows from it.</strong> A year-over-year
              comparison of linkage is only meaningful if every year is read at the same period, and
              the period actually held differs by year. Comparing one year&rsquo;s period 6 with
              another&rsquo;s period 12 measures the copies, not the Department. That is why this
              site no longer draws a trend line through those figures — see{' '}
              <Link href="/reconciliation" className="text-accent-400 hover:underline">
                reconciliation
              </Link>, where the series is now shown per period rather than as a slope.
            </p>
            <p>
              <strong className="text-navy-100">What it is not.</strong> None of this says the
              Department failed to report. File C and the contract award files are two reporting
              chains, not one chain measured twice, and a dollar absent from File C is not a dollar
              that was not obligated. The linkage percentage measures how much of the contract file
              can be tied to an account in this cut — nothing more.
            </p>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-navy-200 mb-4">
              Volume held, by submission period
            </h3>
            <BarList format="int"
              rows={filecYears.flatMap((fy) =>
                periodNos.map((n) => {
                  const p = periods.find((x) => x.fiscalYear === fy && x.periodNo === n);
                  return p ? {
                    key: `${fy}-${n}`, label: `FY${fy} period ${n}`,
                    value: Number(p.filecRows),
                    meta: p.isSubstantive
                      ? `${fmtB(Number(p.obligation))} over ${fmtInt(Number(p.filecAwards))} awards`
                      : 'a thin copy — not a submission this small',
                  } : null;
                }).filter((x): x is NonNullable<typeof x> => x !== null))}
              caption="Row counts, not dollars. The four substantive snapshots a year sit at periods 3, 6, 9 and 12; every other period held carries fewer than thirty rows. Where a year shows only one substantive snapshot, the warehouse holds a thin copy of the other three — which is a fact about this collection, not about what the Department submitted." />
          </div>
        </div>

        <Caveat>
          Two controls hold this open. {ctl('FILEC-01')
            ? <><Link href="/controls" className="underline">FILEC-01</Link> is a shape rather
              than a check: it makes it structurally impossible to render the published figure
              without the snapshots it was chosen over. </>
            : null}
          {ctl('FILEC-02')
            ? <><Link href="/controls" className="underline">FILEC-02</Link> measures the size of
              that choice each year and reports a spread wider than a factor of two as a finding.
              It must never be satisfied by narrowing the series until the spread closes.</>
            : null}
        </Caveat>
      </Section>

      {/* ============================================ the traceability decline === */}
      <Section title="The seam that is genuinely narrowing"
        note="Not every seam is a measurement artefact. The share of contract dollars that can be tied to the account that funded them has fallen by more than half across the years held, on the acquisition programs this site carries — and unlike the File C figure, this one is read the same way every year.">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
          <div>
            <LineTrend label="Obligations traceable to an account" format="pct0"
              points={coverage.map((c) => ({
                x: c.fiscalYear,
                y: Number(c.attributedPct),
                partial: c.isPartialYear,
              }))} />
            <p className="text-xs text-navy-500 mt-3">
              Share of contract obligations carrying an acquisition program code, by fiscal year.
              The final year is period-to-date.
            </p>
          </div>
          <div className="text-sm text-navy-300 leading-relaxed space-y-4">
            <p>
              <strong className="text-navy-100">The account field is a list, not a key.</strong>{' '}
              A contract action names every federal account funding the award in one
              semicolon-separated field, with no apportionment between them. An obligation is
              counted as traceable only when the action names accounts at all; it is never split
              across them, because the file states no split and inventing one would be fabrication.
            </p>
            <p>
              <strong className="text-navy-100">The program field is a sentinel.</strong> FPDS
              records &ldquo;no acquisition program&rdquo; as the explicit code{' '}
              <span className="font-mono text-[12px]">000</span>, description{' '}
              <span className="font-mono text-[12px]">NONE</span> — so a null test finds nothing
              and reports full coverage. {newestCoverage && (
                <>In FY{newestCoverage.fiscalYear},{' '}
                  {fmtPct(Number(newestCoverage.attributedPct))} of obligated dollars and{' '}
                  {fmtPct(Number(newestCoverage.attributedActions) / Number(newestCoverage.totalActions) * 100, 1)}{' '}
                  of actions carry a program at all.</>
              )}
            </p>
          </div>
        </div>
      </Section>

      {/* ======================================================= the traps === */}
      <Section title="Where the data looks complete and is not"
        note="Each of these has a measured cost, and each of them passed an internal consistency check before it was caught. That is the common shape: an extract can be perfectly consistent with itself and still be wrong, because consistency is a property of the extract and correctness is a property of the source.">
        <DataTable
          align={[0, 1, 2, 3]}
          caption="Every row here is a mistake this site made or came close to making. They are kept on the page because the next person to build on these files will meet all of them."
          head={['The trap', 'Why it passes unnoticed', 'Measured cost', 'What stops it now']}
          rows={[
            [
              <span key="t1" className="text-navy-100">A sentinel value that is not a null</span>,
              'FPDS writes “no acquisition program” as the code 000 with description NONE. A null test on the field finds nothing missing and reports complete coverage.',
              newestCoverage
                ? <span key="c1">{fmtPct(100 - Number(newestCoverage.attributedPct))} of obligations
                    <span className="block text-[11px] text-navy-500">
                      and {fmtPct(100 - Number(newestCoverage.attributedActions) / Number(newestCoverage.totalActions) * 100, 1)} of actions carry no program
                    </span>
                  </span>
                : '—',
              <span key="s1">Coverage is published as its own measure —{' '}
                <Link href="/controls" className="text-accent-400 hover:underline">PROG-06</Link>{' '}
                — rather than inferred from an absence.</span>,
            ],
            [
              <span key="t2" className="text-navy-100">Five agency codes in one file</span>,
              'File A carries five agency identifier codes, and one of them (011, the Executive Office of the President) is not the Department. Summing the file and calling it DoD looks like the obvious read.',
              worstScope
                ? <span key="c2">{money(Number(worstScope.all) - Number(worstScope.dow))}
                    <span className="block text-[11px] text-navy-500">
                      above the Department figure in FY{worstScope.fiscalYear} — {fmtPct(Number(worstScope.overstatementPct))} more
                      than the Department obligated
                    </span>
                  </span>
                : '—',
              <span key="s2">Every Department figure uses{' '}
                <span className="font-mono text-[11px]">scope = DOW</span>, and{' '}
                <Link href="/controls" className="text-accent-400 hover:underline">SCOPE-01</Link>{' '}
                blocks the load if one does not.</span>,
            ],
            [
              <span key="t3" className="text-navy-100">Rows that restate money counted elsewhere</span>,
              'The P-1R exhibit, R-1 lines outside total obligation authority, memo cost types and advance-procurement subtotals all restate money already carried on another line in the same book. Nothing in the file marks them as a duplicate.',
              newestMemo
                ? <span key="c3">{fmtT(K(Number(newestMemo.memoK)))}
                    <span className="block text-[11px] text-navy-500">
                      restated across {fmtInt(newestMemo.memoLines)} lines in the PB{newestMemo.pbYear} book
                    </span>
                  </span>
                : '—',
              <span key="s3">Memo rows are kept and flagged rather than dropped, every query excludes
                them, and{' '}
                <Link href="/controls" className="text-accent-400 hover:underline">EXH-03</Link>{' '}
                asserts no unflagged row carries a memo cost type.</span>,
            ],
            [
              <span key="t4" className="text-navy-100">An extract consistent with itself and wrong</span>,
              'The P-1 publishes an Advance Procurement row for a line and then restates the same money on the rows beneath it. Counting both is internally consistent — every subtotal foots — and overstates the request.',
              <span key="c4">$14.4B
                <span className="block text-[11px] text-navy-500">
                  in the PB2026 procurement request alone
                </span>
              </span>,
              <span key="s4">
                <Link href="/controls" className="text-accent-400 hover:underline">EXH-08</Link>{' '}
                checks the extract against the total the Department publishes in its own weapons
                book. It is the only control here that tests whether the extract is right rather
                than self-consistent.</span>,
            ],
            [
              <span key="t5" className="text-navy-100">A cumulative snapshot read as a period</span>,
              'File C states a fiscal year as of a submission period. Four snapshots of a year are held and each gives a different answer, so the figure quoted depends on which copy was opened.',
              widest
                ? <span key="c5">{(Number(widest.hi) / Number(widest.lo)).toFixed(1)}× spread
                    <span className="block text-[11px] text-navy-500">
                      within FY{widest.fiscalYear} alone
                    </span>
                  </span>
                : '—',
              <span key="s5">
                <Link href="/controls" className="text-accent-400 hover:underline">FILEC-01</Link>{' '}
                and{' '}
                <Link href="/controls" className="text-accent-400 hover:underline">FILEC-02</Link>{' '}
                publish the whole series and the size of the choice.</span>,
            ],
            [
              <span key="t6" className="text-navy-100">A year that is not over</span>,
              'The current fiscal year reports period-to-date and looks like a complete year in every chart it appears in. The source says so itself, in a field that is easy not to read.',
              openDrift
                ? <span key="c6">{fmtT(Math.abs(Number(openDrift.obligationDelta)))}
                    <span className="block text-[11px] text-navy-500">
                      FY{openDrift.fiscalYear} moved this much between two vintages a month apart
                    </span>
                  </span>
                : '—',
              <span key="s6">Partial years are marked wherever they are shown, from{' '}
                <span className="font-mono text-[11px]">submission_period</span>, and{' '}
                <Link href="/controls" className="text-accent-400 hover:underline">PART-01</Link>{' '}
                asserts the flag is set.</span>,
            ],
          ]} />
      </Section>

      {/* ================================================= restatement === */}
      <Section title="The same number, told twice"
        note="Two different mechanisms restate a figure that has already been published, and neither is an error. Confusing either one for a change in the underlying money is the most common way to read these files wrongly.">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
          <div>
            <h3 className="text-sm font-semibold text-navy-200 mb-4">
              A closed year barely moves; an open year moves in billions
            </h3>
            <DataTable
              caption="The same fiscal year as two vintages of the contract files describe it, one month apart. A closed year drifts by corrections; the open year is still being reported."
              head={['Fiscal year', 'Earlier vintage', 'Later vintage', 'Movement', 'Closed']}
              rows={drift.map((d) => [
                `FY${d.fiscalYear}`,
                fmtT(Number(d.obligationFrom)),
                fmtT(Number(d.obligationTo)),
                <span key={d.fiscalYear}
                  className={Math.abs(Number(d.obligationDelta)) / Number(d.obligationTo) > 0.01
                    ? 'text-amber-300' : 'text-navy-100'}>
                  {Number(d.obligationDelta) >= 0 ? '+' : '−'}
                  {fmtT(Math.abs(Number(d.obligationDelta)))}
                  <span className="block text-[11px] text-navy-500 font-normal">
                    {fmtPct(Math.abs(Number(d.obligationDelta)) / Number(d.obligationTo) * 100, 3)}
                  </span>
                </span>,
                d.yearClosed ? 'yes' : <span key={`${d.fiscalYear}-o`} className="text-amber-300">no</span>,
              ])} />
            <Caveat>
              Closed years move by at most {fmtPct(closedWorst, 3)} between these two vintages, which
              is what a corrections process looks like. The open year is a different kind of number
              altogether and should never be compared with a closed one.
            </Caveat>
          </div>
          <div className="text-sm text-navy-300 leading-relaxed space-y-4">
            <p>
              <strong className="text-navy-100">The budget books restate on purpose.</strong> Each
              President&rsquo;s Budget carries three fiscal years — the prior year as actuals, the
              current year as enacted, the budget year as requested — so one fiscal year appears in
              three successive books with three different numbers. That spread is the restatement
              history and it exists in no other source here. Collapsing it to one figure per year
              looks like tidying up and destroys the only record of a request becoming an
              appropriation.{' '}
              <Link href="/program#restatement" className="text-accent-400 hover:underline">
                The three-year structure
              </Link>{' '}
              is on the program roster.
            </p>
            <p>
              <strong className="text-navy-100">The execution files restate by correction.</strong>{' '}
              A vintage is a copy taken on a date. Comparing two vintages of a closed year measures
              the corrections process; comparing two vintages of the open year measures how much of
              the year had been reported when each copy was taken. The two look identical in a
              table and mean nothing alike.
            </p>
            <p>
              <strong className="text-navy-100">Obligations are not outlays.</strong> And outlays
              are not a subset of the current year&rsquo;s obligations — they include payment
              against obligations incurred in prior years, so a ratio of the two within one fiscal
              year is not a completion rate.
            </p>
          </div>
        </div>
      </Section>

      {/* ==================================================== the text layer === */}
      <Section title="What the document corpus can and cannot answer"
        note="The numbers are not the only evidence here. Regulation, statute, congressional direction and justification material are held as documents, and they answer a different kind of question — but they invite a specific mistake, which is to treat a count of files as a measurement of anything.">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
          <div>
            <BarList format="int"
              rows={kb.map((k) => ({
                key: `${k.collection}-${k.label}`, label: k.label,
                value: Number(k.docCount),
                meta: k.authorityTier === 1 ? 'primary authority' : 'reference material',
              }))}
              caption="Documents held by collection. This is an inventory of a corpus, and it is the only thing it is." />
          </div>
          <div className="text-sm text-navy-300 leading-relaxed space-y-4">
            <p>
              <strong className="text-navy-100">Counting files is not measuring quality.</strong> A
              GAO report is not a finding. A justification folder with five exhibits in it is not a
              better-justified programme than one with two. Nothing on this site infers quality,
              effort or compliance from a document count, and any figure that looks like it does is
              a defect.
            </p>
            <p>
              <strong className="text-navy-100">A filename is not a date.</strong> Hearing files in
              this corpus are named for the date they were acquired, not the date the hearing was
              held, so no hearing date is printed from a filename and no hearing is ever described
              as upcoming. The hearing date is on the first page of the document, which is a
              different and more expensive thing to read.
            </p>
            <p>
              <strong className="text-navy-100">Absence is absence in this cut.</strong> An empty
              result means the filter matched nothing in the vintage named above. It never means the
              Department did not publish the thing, and no copy on this site says otherwise.
            </p>
            <p>
              The corpus is searchable by authority rank on{' '}
              <Link href="/regulation" className="text-accent-400 hover:underline">regulation</Link>,
              and the terms it uses are defined, with citations, on{' '}
              <Link href="/definitions" className="text-accent-400 hover:underline">definitions</Link>.
            </p>
          </div>
        </div>
      </Section>

      {/* ==================================================== how to read === */}
      <Section title="How to use this page">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-10 gap-y-4 text-sm text-navy-300 leading-relaxed">
          <p>
            <strong className="text-navy-100">A narrow seam is not a scandal.</strong> Most of these
            joins are narrow because the two files were built by different chains for different
            purposes and share no key. The width of a seam tells you how much of a question these
            sources can answer — not how well the Department is run.
          </p>
          <p>
            <strong className="text-navy-100">Two of these joins are ours.</strong> The budget line
            to acquisition program crosswalk and the weapons system to budget line crosswalk are
            derived on this site from names, because neither source carries the other&rsquo;s key.
            Every individual link records its evidence so it can be rejected on its own, an
            ambiguous match produces no link at all, and neither may be presented as a
            Department-published mapping.
          </p>
          <p>
            <strong className="text-navy-100">Every seam has two vintages.</strong> A join between a
            budget book extracted in August and contract files extracted in a different month is as
            old as the older of the two. The chips at the top of this page are the dates that apply.
          </p>
          <p>
            <strong className="text-navy-100">The controls are the enforcement.</strong> Everything
            asserted here is checked inside the load transaction rather than in a test suite, so a
            break either blocks the load or is published as a finding beside the data it concerns.
          </p>
        </div>
        <p className="text-xs text-navy-500 mt-8">
          <Link href="/controls" className="text-accent-400 hover:underline">All {controls.length} controls</Link>
          {' '}· <Link href="/sources" className="text-accent-400 hover:underline">the data register and its vintages</Link>
          {' '}· <Link href="/traceability" className="text-accent-400 hover:underline">one programme followed through every seam on this page</Link>
          {' '}· <Link href="/reconciliation" className="text-accent-400 hover:underline">the File C reconciliation in full</Link>
        </p>
      </Section>
    </Shell>
  );
}

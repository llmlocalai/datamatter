import type { Metadata } from 'next';
import Link from 'next/link';
import Shell, { PageHeader, Section } from '@/components/Shell';
import { ProvenanceBar, Caveat, VintageChip } from '@/components/Provenance';
import { StatTile, DataTable, LineTrend, Legend, StackedFY } from '@/components/charts';
import { fmtT, fmtB, fmtPct, fmtInt } from '@/components/format';
import {
  getProvenance, getProgramYears, getProgramCoverage, getProgramFilec,
  getProgramAccounts, getProgramAwards, getReconciliation,
  getAuditPosture, getAuditMwCategories, getF35BudgetLines, getWarBudgetVintage,
} from '@/lib/analytics';
import { NotLoaded } from '../execution/page';

export const metadata: Metadata = {
  title: 'The traceability break · datamatter',
  description:
    'F-35 followed from the FY2027 budget request through obligation into the account records and out to the audit findings that judge them — and the one link in that chain that fails.',
};
export const revalidate = 900;

const F35 = '198';
const K = 1000; // exhibit tables are $ thousands

export default async function TraceabilityPage() {
  const [prov, years, coverage, filec, recon, posture, mw, budget, budgetVintage] =
    await Promise.all([
      getProvenance('program_execution'), getProgramYears(F35), getProgramCoverage(),
      getProgramFilec(F35), getReconciliation(), getAuditPosture(),
      getAuditMwCategories(2025), getF35BudgetLines(), getWarBudgetVintage(),
    ]);
  if (!years.length) return <Shell><NotLoaded /></Shell>;

  const closed = years.filter((y) => !y.isPartialYear);
  const latest = closed[closed.length - 1] ?? years[years.length - 1];
  const first = years[0];
  const [accounts, awards] = await Promise.all([
    getProgramAccounts(F35, latest.fiscalYear, 8),
    getProgramAwards(F35, latest.fiscalYear, 5),
  ]);

  // ---- budget layer, live from the exhibit tables ($K -> $) ----------------
  const proc = budget.filter((b) => b.docCode === 'p1');
  const rdte = budget.filter((b) => b.docCode === 'r1');
  const sum = (rows: typeof budget, f: (b: typeof budget[number]) => number) =>
    rows.reduce((s, b) => s + Number(f(b)), 0) * K;
  const fy25 = sum(budget, (b) => b.fy25);
  const fy26 = sum(budget, (b) => b.fy26disc) + sum(budget, (b) => b.fy26mand);
  const fy27disc = sum(budget, (b) => b.fy27disc);
  const fy27mand = sum(budget, (b) => b.fy27mand);
  const fy27 = fy27disc + fy27mand;
  const fy26disc = sum(budget, (b) => b.fy26disc);
  const qty = (f: (b: typeof budget[number]) => number) =>
    proc.reduce((s, b) => s + Number(f(b)), 0);

  // ---- the four links ------------------------------------------------------
  const fcLatest = filec.find((f) => f.fiscalYear === latest.fiscalYear);
  const covLatest = coverage.find((c) => c.fiscalYear === latest.fiscalYear);
  const reconLatest = recon.find((r) => r.fiscalYear === latest.fiscalYear);
  const jsfMw = mw.find((m) =>
    String(m.category ?? '').toUpperCase().includes('JOINT STRIKE FIGHTER'));
  const val = (k: string) => posture.find((p) => p.metricKey === k);
  const opinion = val('opinion');
  const streak = val('disclaimer_streak_years');
  const mwCount = val('mw_auditor_identified');
  const outOfScope = Array.from(new Set(
    accounts.flatMap((a) => a.outOfScopeAccounts ?? []))).sort();
  const topAward = awards[0];

  const LINKS = [
    { n: '01', label: 'Budget', holds: budget.length > 0,
      detail: budget.length ? `${budget.length} lines · ${fmtT(fy25)} FY${latest.fiscalYear}` : 'exhibits not loaded' },
    { n: '02', label: 'Execution', holds: true,
      detail: `${fmtT(latest.obligation)} · ${fmtInt(latest.actionCount)} actions` },
    { n: '03', label: 'Accounts', holds: false,
      detail: `${fmtPct(latest.traceablePct)} names an account` },
    { n: '04', label: 'Audit', holds: true,
      detail: jsfMw ? `Material weakness #${jsfMw.rank}` : 'DODIG-2026-032' },
  ];

  return (
    <Shell>
      <PageHeader
        eyebrow="Oversight · pilot analysis"
        title={<>The traceability break</>}
        lede="Can one major program be followed from the budget request, through obligation, into the account records, and out to the audit findings that judge those records — using only the sources this site publishes? Three of the four links hold. The one that fails is the one that matters, and the audit layer names it independently."
      />

      <div className="mt-6 space-y-5">
        <ProvenanceBar p={prov}
          extra="Every figure on this page is queried live from the loaded data, not transcribed from the analysis memo. The budget layer is the one exception to the dm_load provenance system — see the note in section 01." />
      </div>

      {/* ------------------------------------------------------- the chain */}
      <Section title="The chain, as the data actually supports it">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {LINKS.map((l) => (
            <div key={l.n}
              className={`rounded-lg p-5 ${l.holds
                ? 'border border-navy-700 bg-navy-900/50'
                : 'alert-critical'}`}>
              <div className="flex items-baseline justify-between">
                <span className="font-mono text-[12px] tracking-wider text-accent-400">{l.n}</span>
                <span className={`font-mono text-[12px] ${l.holds
                  ? 'text-navy-500' : 'text-[color:var(--status-critical)] font-semibold'}`}>
                  {l.holds ? 'holds' : 'BREAKS'}
                </span>
              </div>
              <div className="text-lg font-bold text-navy-50 mt-2">{l.label}</div>
              <div className="text-[12px] text-navy-400 mt-1.5 tnum">{l.detail}</div>
            </div>
          ))}
        </div>
        <Caveat>
          The program dimension exists only in the award files. The account dimension exists only in
          File A and File B. <strong className="text-navy-100">File C is the sole bridge between
          them</strong> — and for the F-35 appropriations it is, in this warehouse cut, empty.
        </Caveat>
      </Section>

      {/* --------------------------------------------------------- 01 budget */}
      <Section title="01 · Budget — what was asked for"
        note="The F-35 lines in the FY2027 President's Budget exhibits, read live from the loaded exhibit tables. Procurement totals are Add rows only — weapon system cost, less prior-year advance procurement, plus current-year AP — so the Non-Add advance-procurement detail is not double counted.">
        {budget.length === 0 ? (
          <p className="text-sm text-navy-400">
            The FY2027 exhibit tables are not loaded, so the budget layer is withheld rather than
            shown from memory. Run <code className="font-mono text-[12px] text-accent-400">npm run refresh</code>.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <StatTile label={`FY${latest.fiscalYear} enacted`} value={fmtT(fy25)}
                sub={`${fmtInt(qty((b) => b.qty25))} aircraft · ${proc.length} procurement lines, ${rdte.length} RDT&E`} />
              <StatTile label="FY2026 total" value={fmtT(fy26)}
                sub={`${fmtInt(qty((b) => b.qty26))} aircraft · ${fmtT(fy26 - fy26disc)} of it reconciliation funding`} />
              <StatTile label="FY2027 request" value={fmtT(fy27)} tone="accent"
                sub={`${fmtInt(qty((b) => b.qty27))} aircraft`} />
              <StatTile label="FY2027 mandatory share"
                value={fy27 ? fmtPct(fy27mand / fy27 * 100) : '—'}
                tone="warning"
                sub={`Discretionary base ${fy26disc ? fmtPct((fy27disc / fy26disc - 1) * 100) : '—'} against FY2026`} />
            </div>
            <div className="mt-8">
              <DataTable
                caption="Amounts converted from the exhibits' $ thousands. Joint Strike Missile (3020F JSM000) is a different program and is deliberately excluded."
                head={['Account', 'Line', 'Title', `FY${latest.fiscalYear}`, 'FY2027 disc.', 'FY2027 mand.']}
                rows={budget.map((b) => [
                  b.account, b.bli || '—', b.title,
                  fmtT(Number(b.fy25) * K), fmtT(Number(b.fy27disc) * K), fmtT(Number(b.fy27mand) * K),
                ])} />
            </div>
            <div className="mt-5">
              <VintageChip source="FY2027 budget exhibits (p1 · r1)"
                vintage={budgetVintage.ingestedAt ?? 'unknown'} />
            </div>
            <Caveat>
              These figures come from <code className="font-mono text-[12px]">war_budget_line</code>, which
              predates the <code className="font-mono text-[12px]">dm_load</code> provenance system and carries its own
              ingest stamp instead of a load row. That is stated here rather than left to look like the
              rest of the site&rsquo;s measures. Separately, a scan of the FY2027 O-1 returns no F-35 line at
              all: operation and maintenance — where sustainment is funded — carries no program dimension
              at exhibit level, though F-35 contracts draw on O&amp;M accounts (see section 03).
            </Caveat>
          </>
        )}
      </Section>

      {/* ------------------------------------------------------ 02 execution */}
      <Section title="02 · Execution — what was obligated"
        note="Contract obligations tagged to the F-35 acquisition program code. Action counts are flat within a narrow band while dollars move by multiples: obligation volume on this program is not an activity measure, it is a definitization calendar.">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatTile label={`FY${latest.fiscalYear} obligations`} value={fmtT(latest.obligation)}
            tone="accent"
            sub={`${fmtInt(latest.actionCount)} actions across ${fmtInt(latest.awardCount)} contracts`} />
          <StatTile label="Carried by five actions" value={fmtPct(latest.top5Pct)}
            sub={fmtT(latest.top5Obligation)} />
          <StatTile label="Landed in August–September" value={fmtPct(latest.lateQuarterPct)}
            sub={fmtT(latest.lateQuarterObligation)} />
          <StatTile label="Largest single contract"
            value={topAward ? fmtPct(topAward.shareOfFyPct) : '—'}
            tone="warning"
            sub={topAward ? `${topAward.awardIdPiid} · ${fmtT(topAward.obligation)} over ${fmtInt(topAward.actionCount)} actions` : undefined} />
        </div>
        <div className="mt-8">
          <DataTable
            head={['Fiscal year', 'Obligated', 'Actions', 'Contracts', 'Top-5 share', 'Aug–Sep share']}
            rows={years.map((y) => [
              `FY${y.fiscalYear}${y.isPartialYear ? ' *' : ''}`,
              fmtT(y.obligation), fmtInt(y.actionCount), fmtInt(y.awardCount),
              fmtPct(y.top5Pct), fmtPct(y.lateQuarterPct),
            ])} />
        </div>
        {topAward?.description && (
          <p className="text-[12px] text-navy-400 mt-4 leading-relaxed">
            <span className="text-navy-500">Largest action on {topAward.awardIdPiid}</span>
            {topAward.largestActionDate ? ` (${topAward.largestActionDate})` : ''} —{' '}
            <span className="font-mono text-[12px] text-navy-300">{topAward.description}</span>
          </p>
        )}
      </Section>

      {/* ------------------------------------------------ 03 the break */}
      <Section title="03 · The account bridge, and where it breaks"
        note="To connect an obligation to an appropriation you need to know which Treasury account it drew on. Two fields could answer that. Neither does.">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
          <div>
            <h3 className="text-sm font-semibold text-navy-200 mb-4">
              Share of F-35 obligations naming a Treasury account
            </h3>
            <LineTrend label="Account-traceable share" format="pct0"
              points={years.map((y) => ({ x: y.fiscalYear, y: y.traceablePct, partial: y.isPartialYear }))} />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-navy-200 mb-4">Traced and untraced obligations</h3>
            <StackedFY format="billions"
              years={years.map((y) => ({ fy: y.fiscalYear, partial: y.isPartialYear,
                parts: [y.traceableObligation, y.untraceableObligation] }))}
              series={[
                { label: 'Names an account', colour: 'var(--series-1)' },
                { label: 'Names no account', colour: 'var(--series-3)' },
              ]} />
            <Legend series={[
              { label: 'Names an account', colour: 'var(--series-1)' },
              { label: 'Names no account', colour: 'var(--series-3)' },
            ]} />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-10">
          <StatTile label={`FY${first.fiscalYear} traceable share`} value={fmtPct(first.traceablePct)}
            tone="good" />
          <StatTile label={`FY${latest.fiscalYear} traceable share`} value={fmtPct(latest.traceablePct)}
            tone="critical" sub={`${fmtT(latest.untraceableObligation)} names no account at all`} />
          <StatTile label={`FY${latest.fiscalYear} File C rows for these contracts`}
            value={fcLatest ? fmtInt(fcLatest.filecRows) : '—'} tone="critical"
            sub={fcLatest?.submissionPeriod
              ? `Latest submission ${fcLatest.submissionPeriod} — a period ending P12 is a closed year`
              : undefined} />
        </div>

        <h3 className="text-sm font-semibold text-navy-200 mt-10 mb-4">
          The accounts named on FY{latest.fiscalYear} actions
        </h3>
        {accounts.length ? (
          <DataTable
            caption="Read a row as: this much was obligated on actions that named this combination of accounts. It is not this much from each account — the file states no split, and nothing here apportions one."
            head={['Accounts named', 'Accounts', 'Obligated', 'Actions']}
            rows={accounts.map((a) => [
              a.accountSet.split(';').join(' + ') + (a.hasOutOfScope ? '  ⚑' : ''),
              a.accountCount, fmtT(a.obligation), fmtInt(a.actionCount),
            ])} />
        ) : (
          <p className="text-sm text-navy-400">
            No action in FY{latest.fiscalYear} for this program named a funding account, so this
            warehouse cut contains no account combinations to show.
          </p>
        )}
        {outOfScope.length > 0 && (
          <div className="mt-6 alert-warning rounded-lg px-4 py-3">
            <p className="text-sm text-navy-100 leading-relaxed">
              <strong className="text-[color:var(--status-warning)]">⚑ Accounts outside Department scope
              appear on these actions:</strong>{' '}
              <span className="font-mono text-[12px] text-navy-200">{outOfScope.join(', ')}</span>.
              Disclosed rather than dropped, per{' '}
              <Link href="/controls" className="text-accent-400 hover:underline">PROG-04</Link>.{' '}
              <Link href="/controls" className="text-accent-400 hover:underline">SCOPE-01</Link> keeps
              agency 011 out of Department <em>budgetary</em> totals, which is right for budget. On the
              execution side those dollars sit on the same contract actions as Department appropriations
              and the file does not separate them.
            </p>
          </div>
        )}

        <h3 className="text-sm font-semibold text-navy-200 mt-10 mb-4">
          The same collapse, department-wide
        </h3>
        <DataTable
          caption="File C is the account-linked contract obligation file — the only artifact tying a contract to a Treasury account with a dollar amount attached. This is the measurement /reconciliation already publishes; it is repeated here because it is the mechanism behind the F-35 figures above."
          head={['Fiscal year', 'Award-file obligations', 'File C obligations', 'Linkage']}
          rows={recon.map((r) => [
            `FY${r.fiscalYear}${r.isPartialYear ? ' *' : ''}`,
            fmtT(r.awardObligation), fmtT(r.filecObligation), fmtPct(r.linkagePct),
          ])} />
        <Caveat>
          A fiscal year showing no File C rows matched nothing in this warehouse cut. That is a statement
          about the extract, not evidence that no such report was made. Nor is File C&rsquo;s shortfall an
          error estimate for the award files: they are two reporting chains, and the ratio measures
          linkage completeness. See{' '}
          <Link href="/reconciliation" className="text-accent-400 hover:underline">reconciliation</Link>.
        </Caveat>
      </Section>

      {/* ---------------------------------------------------------- 04 audit */}
      <Section title="04 · Audit — the layer that names the same failure"
        note="The independent auditor's report on the FY2025 financial statements, from the curated audit register.">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatTile label="Opinion" value={String(opinion?.valueText ?? '—')} tone="critical" />
          <StatTile label="Consecutive disclaimers"
            value={streak ? fmtInt(Number(streak.metricValue)) : '—'} sub="FY2018–FY2025" />
          <StatTile label="Auditor-identified material weaknesses"
            value={mwCount ? fmtInt(Number(mwCount.metricValue)) : '—'} />
          <StatTile label="Of which, this program"
            value={jsfMw ? `#${jsfMw.rank}` : '—'} tone="warning"
            sub={jsfMw ? jsfMw.category : undefined} />
        </div>
        {jsfMw && (
          <p className="mt-6 text-navy-100 leading-relaxed">
            <strong className="text-navy-50">The program traced on this page is a named material
            weakness in its own right</strong> — not merely a program affected by the Department&rsquo;s audit
            condition. Four other weaknesses on the same list bear directly on the break in section 03:
            the universe of transactions, government property in the possession of contractors,
            intragovernmental transactions, and budgetary resources.
          </p>
        )}
        <div className="mt-8">
          <DataTable
            caption="The auditor's own material-weakness categories, in report order. A separate framework from the FMFIA self-assessed counts on the audit page; the two are not conflated."
            head={['#', 'Category']}
            rows={mw.map((m) => [m.rank, m.category])} />
        </div>
        <Caveat>
          Read the full audit posture on{' '}
          <Link href="/audit" className="text-accent-400 hover:underline">audit</Link>, and the
          program-level execution figures on{' '}
          <Link href={`/program?code=${F35}`} className="text-accent-400 hover:underline">program</Link>.
        </Caveat>
      </Section>

      {/* --------------------------------------------------- what it doesn't */}
      <Section title="What this pilot does not support"
        note="Stated as prominently as the findings, because each of these is a comparison the data invites and cannot bear.">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-10 gap-y-5 text-sm text-navy-300 leading-relaxed">
          <p>
            <strong className="text-navy-50">The two big numbers cannot be reconciled.</strong>{' '}
            {fmtT(latest.obligation)} obligated against {budget.length ? fmtT(fy25) : 'the appropriation'}:
            obligations draw on prior-year balances this cut cannot age, an unknown share is FMS and
            partner money, and {fmtPct(100 - latest.traceablePct)} of the dollars name no account.
            Publishing a budget-versus-execution variance here would assert a comparison the data cannot bear.
          </p>
          <p>
            <strong className="text-navy-50">This is a quarter of the contract file.</strong>{' '}
            {covLatest ? `Only ${fmtPct(covLatest.attributedPct)} of FY${covLatest.fiscalYear} contract obligations carry any acquisition program code at all` : 'Most contract obligations carry no acquisition program code'} —
            FPDS records &ldquo;no program&rdquo; as an explicit code, not a null. Nothing here describes the rest.
          </p>
          <p>
            <strong className="text-navy-50">An account named is not an account charged.</strong>{' '}
            Where several accounts appear on one action the file states no split between them, and
            nothing on this page apportions one.
          </p>
          <p>
            <strong className="text-navy-50">Absence is absence in this cut.</strong> An empty result
            means the filter matched nothing in the vintage named above — never that the Department
            did not report it.
          </p>
        </div>
        <p className="text-[12px] text-navy-500 mt-8">
          Method: <Link href="/controls" className="text-accent-400 hover:underline">PROG-01 through PROG-06</Link>
          {' '}· <Link href="/sources" className="text-accent-400 hover:underline">sources</Link>
          {' '}· the full memo and a script that re-derives every figure live in{' '}
          <code className="font-mono text-[12px]">analysis/</code> in the repository.
        </p>
      </Section>
    </Shell>
  );
}

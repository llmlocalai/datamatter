import type { Metadata } from 'next';
import Link from 'next/link';
import Shell, { PageHeader, Section } from '@/components/Shell';
import { ProvenanceBar, Caveat } from '@/components/Provenance';
import { StatTile, BarList, DataTable, StackedFY, LineTrend } from '@/components/charts';
import { FyPicker } from '@/components/FyPicker';
import { fmtB, fmtT, fmtPct, fmtInt } from '@/components/format';
import {
  getProvenance, getPrograms, getProgramYears, getProgramCoverage,
  getProgramDim, getProgramAwards, getProgramAccounts, getProgramFilec,
} from '@/lib/analytics';
import { NotLoaded } from '../execution/page';

export const metadata: Metadata = {
  title: 'Program execution · datamatter',
  description:
    'Contract obligations by acquisition program, with the share of each total whose funding Treasury account is actually named — the only cut on this site keyed to a budget line rather than to an account.',
};
export const revalidate = 900;

/** Programs the picker offers, as links, so the page stays a server component. */
function ProgramPicker({ programs, active }: {
  programs: { programCode: string; programName: string }[]; active: string;
}) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {programs.map((p) => (
        <Link key={p.programCode} href={`/program?code=${p.programCode}`} scroll={false}
          aria-current={p.programCode === active ? 'page' : undefined}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            p.programCode === active ? 'bg-accent-500 text-navy-950'
                                     : 'bg-navy-800 text-navy-300 hover:bg-navy-700'}`}>
          {p.programName}
        </Link>
      ))}
    </div>
  );
}

export default async function ProgramPage({ searchParams }:
  { searchParams: { code?: string; fy?: string } }) {
  const [prov, programs, coverage] = await Promise.all([
    getProvenance('program_execution'), getPrograms(), getProgramCoverage(),
  ]);
  if (!programs.length) return <Shell><NotLoaded /></Shell>;

  const program = programs.find((p) => p.programCode === searchParams.code) ?? programs[0];
  const [years, filec] = await Promise.all([
    getProgramYears(program.programCode), getProgramFilec(program.programCode),
  ]);
  if (!years.length) return <Shell><NotLoaded /></Shell>;

  const closed = years.filter((y) => !y.isPartialYear);
  const requested = Number(searchParams.fy);
  const row = years.find((y) => y.fiscalYear === requested)
    ?? closed[closed.length - 1] ?? years[years.length - 1];

  const [recipients, competed, pricing, psc, offices, awards, accounts] = await Promise.all([
    getProgramDim(program.programCode, row.fiscalYear, 'recipient', 8),
    getProgramDim(program.programCode, row.fiscalYear, 'extent_competed', 6),
    getProgramDim(program.programCode, row.fiscalYear, 'pricing', 6),
    getProgramDim(program.programCode, row.fiscalYear, 'psc', 8),
    getProgramDim(program.programCode, row.fiscalYear, 'awarding_office', 6),
    getProgramAwards(program.programCode, row.fiscalYear, 8),
    getProgramAccounts(program.programCode, row.fiscalYear, 8),
  ]);

  const cov = coverage.find((c) => c.fiscalYear === row.fiscalYear);
  const fc = filec.find((f) => f.fiscalYear === row.fiscalYear);
  const first = years[0];
  const outOfScope = Array.from(new Set(
    accounts.flatMap((a) => a.outOfScopeAccounts ?? [])
  )).sort();

  const base = `/program?code=${program.programCode}`;
  const base2 = `/program?code=${program.programCode}&`;

  return (
    <Shell>
      <PageHeader
        eyebrow="Execution · by acquisition program"
        title={<>Program execution — <span className="text-accent-400">{program.programName}</span></>}
        lede="Contract obligations cut by the FPDS acquisition program code: the only field in this warehouse keyed to a budget line rather than to an account. Every obligation total here is published beside the share of it whose funding Treasury account is actually named, because the total on its own reads as reconciled when it is not."
      />

      <div className="mt-6 space-y-5">
        <ProvenanceBar p={prov}
          extra="A program obligation total is not comparable to that program's appropriation: it draws on prior-year balances this cut cannot age, and Foreign Military Sales trust dollars can sit on the same contract actions as Department appropriations." />
        <ProgramPicker programs={programs} active={program.programCode} />
        <FyPicker years={years.map((y) => y.fiscalYear)} active={row.fiscalYear} base={base}
          partial={years.filter((y) => y.isPartialYear).map((y) => y.fiscalYear)} />
      </div>

      {row.isPartialYear && (
        <div className="mt-6 border border-amber-500/40 bg-amber-500/5 rounded-lg px-4 py-3">
          <p className="text-sm text-amber-200">
            <strong>FY{row.fiscalYear} is in progress.</strong> {fmtInt(row.actionCount)} actions
            recorded so far — every FY{row.fiscalYear} figure below is period-to-date, not a full year.
          </p>
        </div>
      )}

      {/* ------------------------------------------------ the pair, up front */}
      <Section title={`FY${row.fiscalYear} obligations, and how much of it can be traced to an account`}>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatTile label="Obligated on this program" value={fmtT(row.obligation)}
            sub={`${fmtInt(row.actionCount)} actions across ${fmtInt(row.awardCount)} contracts`}
            tone="accent" />
          <StatTile label="Names a funding Treasury account"
            value={fmtPct(row.traceablePct)}
            sub={`${fmtT(row.traceableObligation)} of ${fmtT(row.obligation)}`}
            tone={row.traceablePct < 50 ? 'critical' : row.traceablePct < 80 ? 'warning' : 'good'}
            title="treasury_accounts_funding_this_award, populated" />
          <StatTile label="Names no account at all"
            value={fmtT(row.untraceableObligation)}
            sub={`Cannot be tied to an appropriation from this file`}
            tone={row.traceablePct < 50 ? 'critical' : 'default'} />
          <StatTile label="Carried by the five largest actions" value={fmtPct(row.top5Pct)}
            sub={`${fmtT(row.top5Obligation)} · ${fmtPct(row.lateQuarterPct)} of the year landed in August–September`}
            title="A definitization calendar, not an activity measure." />
        </div>
        <Caveat>
          The two figures on the left travel together by design. An obligation total published without
          the account-traceable share beside it looks reconciled and is not — control{' '}
          <Link href="/controls" className="text-accent-400 hover:underline">PROG-03</Link> asserts the
          pair, and the data layer returns them on the same row so a page cannot render one without the
          other. Where the traceable share is low, the money was still obligated; what is missing is any
          statement of which appropriation it came from.
        </Caveat>
      </Section>

      {/* ------------------------------------------------------ the trend */}
      <Section title="Traceability over time"
        note="The share of this program's obligations naming a funding Treasury account, by fiscal year. Where this falls, the obligations do not become less real — they become unattributable to an appropriation.">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
          <div>
            <h3 className="text-sm font-semibold text-navy-200 mb-4">Account-traceable share</h3>
            <LineTrend label="Share naming a Treasury account" format="pct0"
              points={years.map((y) => ({ x: y.fiscalYear, y: y.traceablePct, partial: y.isPartialYear }))} />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-navy-200 mb-4">Obligations, traced and untraced</h3>
            <StackedFY format="billions"
              years={years.map((y) => ({ fy: y.fiscalYear, partial: y.isPartialYear,
                parts: [y.traceableObligation, y.untraceableObligation] }))}
              series={[
                { label: 'Names an account', colour: 'var(--series-1)' },
                { label: 'Names no account', colour: 'var(--series-3)' },
              ]} />
          </div>
        </div>
        <div className="mt-8">
          <DataTable
            caption="Action counts are the activity measure; obligations are the definitization calendar. Where the two diverge, read the counts."
            head={['Fiscal year', 'Obligated', 'Names an account', 'Share', 'Actions', 'Contracts', 'Top 5 share']}
            rows={years.map((y) => [
              `FY${y.fiscalYear}${y.isPartialYear ? ' *' : ''}`,
              fmtT(y.obligation), fmtT(y.traceableObligation), fmtPct(y.traceablePct),
              fmtInt(y.actionCount), fmtInt(y.awardCount), fmtPct(y.top5Pct),
            ])} />
        </div>
      </Section>

      {/* --------------------------------------------------- concentration */}
      <Section title={`Where FY${row.fiscalYear} went`}
        note="Aggregated by contract rather than by modification: the concentration on this kind of program lives at the contract level, where a single definitization can carry most of a year.">
        <DataTable
          head={['Contract', 'Recipient', 'Obligated', 'Share of FY', 'Actions', 'Account named']}
          rows={awards.map((a) => [
            a.awardIdPiid, a.recipientName, fmtT(a.obligation),
            fmtPct(a.shareOfFyPct), fmtInt(a.actionCount),
            a.hasAccountLink ? 'yes' : 'no',
          ])} />
        {awards[0] && awards[0].description && (
          <p className="text-xs text-navy-400 mt-4 leading-relaxed">
            <span className="text-navy-500">Largest action on {awards[0].awardIdPiid}</span>
            {awards[0].largestActionDate ? ` (${awards[0].largestActionDate})` : ''} —{' '}
            <span className="font-mono text-[12px] text-navy-300">{awards[0].description}</span>
          </p>
        )}
      </Section>

      <Section title="Who, how, and through whom">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
          <div>
            <h3 className="text-sm font-semibold text-navy-200 mb-4">Recipient (corporate parent)</h3>
            <BarList rows={recipients.map((r) => ({
              key: r.key, label: r.label, value: r.obligation,
              meta: `${fmtPct(r.obligation / row.obligation * 100)} · ${fmtInt(r.actionCount)} actions`,
            }))} />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-navy-200 mb-4">Awarding office</h3>
            <BarList colour="var(--series-4)" rows={offices.map((o) => ({
              key: o.key, label: o.label, value: o.obligation,
              meta: `${fmtInt(o.actionCount)} actions`,
            }))} />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-navy-200 mb-4">Extent competed</h3>
            <BarList colour="var(--series-2)" rows={competed.map((c) => ({
              key: c.key, label: c.label, value: c.obligation,
              meta: fmtPct(c.obligation / row.obligation * 100),
            }))} />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-navy-200 mb-4">Contract pricing</h3>
            <BarList colour="var(--series-3)" rows={pricing.map((p) => ({
              key: p.key, label: p.label, value: p.obligation,
              meta: fmtPct(p.obligation / row.obligation * 100),
            }))} />
          </div>
        </div>
        <Caveat>
          Extent competed and pricing arrive from FPDS as single-letter codes; the code book lives in
          the ETL, not in page-level string matching, so the label shown is the decoded value with its
          code retained. A sole-source program of record awarding incentive contracts through a lead
          service is the expected shape, not a finding.
        </Caveat>
      </Section>

      {/* --------------------------------------------------- the accounts */}
      <Section title={`The accounts named on FY${row.fiscalYear} actions`}
        note="The exact set of Treasury accounts named on each action. The obligation is not split across the accounts in a set and is never summed by account — a joint-service contract states which appropriations funded it and no split between them.">
        {accounts.length ? (
          <DataTable
            caption="Read a row as: this much was obligated on actions that named this combination of accounts. It is not this much from each account."
            head={['Accounts named', 'Accounts', 'Obligated', 'Actions']}
            rows={accounts.map((a) => [
              a.accountSet.split(';').join(' + ') + (a.hasOutOfScope ? '  ⚑' : ''),
              a.accountCount, fmtT(a.obligation), fmtInt(a.actionCount),
            ])} />
        ) : (
          <p className="text-sm text-navy-400">
            No action in FY{row.fiscalYear} for this program named a funding account, so this
            warehouse cut contains no account combinations to show.
          </p>
        )}
        {outOfScope.length > 0 && (
          <div className="mt-6 border border-amber-500/40 bg-amber-500/5 rounded-lg px-4 py-3">
            <p className="text-sm text-amber-200 leading-relaxed">
              <strong>⚑ Accounts outside Department scope appear on these actions:</strong>{' '}
              <span className="font-mono text-xs">{outOfScope.join(', ')}</span>. These are disclosed
              rather than dropped (control{' '}
              <Link href="/controls" className="text-accent-300 underline">PROG-04</Link>).{' '}
              <Link href="/controls" className="text-accent-300 underline">SCOPE-01</Link> keeps agency
              011 out of Department <em>budgetary</em> totals, which is right for budget. On the
              execution side those dollars sit on the same contract actions as Department
              appropriations and the file does not separate them — which is one reason the obligation
              total above is not comparable to an appropriation.
            </p>
          </div>
        )}
      </Section>

      {/* ------------------------------------------------------ File C tie */}
      <Section title="The File C tie-out"
        note="File C is the account-linked contract obligation file — the only artifact that ties a contract to a Treasury account with a dollar amount attached. This is what it holds for this program's own contracts.">
        <DataTable
          head={['Fiscal year', 'Award-file obligations', 'File C obligations', 'File C rows', 'Linkage', 'Latest submission']}
          rows={filec.map((f) => [
            `FY${f.fiscalYear}${f.isPartialYear ? ' *' : ''}`,
            fmtT(f.awardObligation), fmtT(f.filecObligation), fmtInt(f.filecRows),
            fmtPct(f.linkagePct, 2), f.submissionPeriod ?? '—',
          ])} />
        <Caveat>
          A fiscal year showing no File C rows matched nothing in this warehouse cut for this program&rsquo;s
          contracts. That is a statement about the extract, not evidence that no such report was made.
          A submission period ending <span className="font-mono">P12</span> means the fiscal year was
          reported closed, so a low linkage there is not explained by the year still being open. This
          is the same measurement the{' '}
          <Link href="/reconciliation" className="text-accent-400 hover:underline">reconciliation</Link>{' '}
          page makes department-wide, narrowed to one program.
        </Caveat>
      </Section>

      {/* ------------------------------------------------------- coverage */}
      <Section title="What this page does not cover"
        note="FPDS records “no acquisition program” as the explicit code 000 with description NONE, not as a null — so a null test finds almost nothing and makes program tagging look complete. It is not.">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatTile label={`FY${row.fiscalYear} contract obligations carrying any program code`}
            value={cov ? fmtPct(cov.attributedPct) : '—'}
            sub={cov ? `${fmtT(cov.attributedObligation)} of ${fmtT(cov.totalObligation)} across ${fmtInt(cov.programCount)} programs` : undefined}
            tone="warning" />
          <StatTile label="Actions carrying any program code"
            value={cov ? fmtPct(cov.attributedActions / cov.totalActions * 100, 2) : '—'}
            sub={cov ? `${fmtInt(cov.attributedActions)} of ${fmtInt(cov.totalActions)}` : undefined} />
          <StatTile label="This program's share of the attributed total"
            value={cov && cov.attributedObligation ? fmtPct(row.obligation / cov.attributedObligation * 100) : '—'}
            sub={`${program.programName} · FY${row.fiscalYear}`} />
        </div>
        <div className="mt-8">
          <DataTable
            caption="Published as a control result under PROG-06. The program dimension is precise where it is present and absent for most of the file; both halves of that are true and only one of them is visible from a program page."
            head={['Fiscal year', 'Contract obligations', 'Carrying a program code', 'Share', 'Programs seen']}
            rows={coverage.map((c) => [
              `FY${c.fiscalYear}${c.isPartialYear ? ' *' : ''}`,
              fmtT(c.totalObligation), fmtT(c.attributedObligation),
              fmtPct(c.attributedPct), fmtInt(c.programCount),
            ])} />
        </div>
      </Section>

      <Section title="How to read a figure on this page">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-10 gap-y-4 text-sm text-navy-300 leading-relaxed">
          <p>
            <strong className="text-navy-100">An obligation is not an appropriation.</strong>{' '}
            {program.programName} obligated {fmtT(row.obligation)} in FY{row.fiscalYear}, drawing on
            balances appropriated across several prior years. Comparing that to a single year&rsquo;s
            budget line would be comparing two different things.
          </p>
          <p>
            <strong className="text-navy-100">Volume is not activity.</strong> Action counts here run
            between {fmtInt(Math.min(...years.map((y) => y.actionCount)))} and{' '}
            {fmtInt(Math.max(...years.map((y) => y.actionCount)))} while obligations move by multiples.
            A large year is usually a definitization, not a surge.
          </p>
          <p>
            <strong className="text-navy-100">An account named is not an account charged.</strong>{' '}
            Where several accounts appear on one action, the file states no split between them. Nothing
            on this page apportions one.
          </p>
          <p>
            <strong className="text-navy-100">Absence is absence in this cut.</strong> An empty result
            means the filter matched nothing in the warehouse vintage named above — never that the
            Department did not report it.
          </p>
        </div>
        <p className="text-xs text-navy-500 mt-8">
          Traceability first observed at {fmtPct(first.traceablePct)} in FY{first.fiscalYear}.
          Method and controls: <Link href="/controls" className="text-accent-400 hover:underline">PROG-01 through PROG-06</Link>{' '}
          · <Link href="/sources" className="text-accent-400 hover:underline">sources</Link>
          {' '}· <Link href={`${base2}fy=${first.fiscalYear}`} className="text-accent-400 hover:underline">
            compare FY{first.fiscalYear}
          </Link>
        </p>
      </Section>
    </Shell>
  );
}

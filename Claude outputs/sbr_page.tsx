import type { Metadata } from 'next';
import Link from 'next/link';
import Shell, { PageHeader, Section } from '@/components/Shell';
import { ProvenanceBar, Caveat } from '@/components/Provenance';
import { StatTile, DataTable } from '@/components/charts';
import { fmtT, fmtInt, fmtPct } from '@/components/format';
import { getProvenance } from '@/lib/analytics';
import {
  getSbrCharter, getSbrTests, getSbrRuns, getSbrConfidence, getSbrCases,
  getSbrQueueSummary, getSbrYears, getSbrTestTrend,
} from '@/lib/sbr';
import { NotLoaded } from '../execution/page';

export const metadata: Metadata = {
  title: 'SBR assurance · datamatter',
  description:
    'The Budgetary Resources material weakness worked end to end: a tested population, '
    + 'deterministic tests with their criteria, a risk-scored case queue, and the run history '
    + 'that shows whether a remediation held.',
};
export const revalidate = 900;

const TIER_TONE = ['critical', 'warning', 'default'] as const;

export default async function SbrPage({ searchParams }: {
  searchParams?: { fy?: string };
}) {
  const years = await getSbrYears();
  if (!years.length) return <Shell><NotLoaded /></Shell>;

  // An exception RATE measured on a part-year submission measures the
  // submission, not the Department -- the same reason /reconciliation keeps its
  // linkage tiles on the last closed year. So this page defaults to the last
  // closed year and names it, rather than to the year being executed.
  const closed = years.filter((y) => !y.isPartialYear);
  const asked = Number(searchParams?.fy);
  const fy = years.some((y) => y.fiscalYear === asked) ? asked
    : (closed[closed.length - 1] ?? years[years.length - 1]).fiscalYear;
  const yearRow = years.find((y) => y.fiscalYear === fy)!;

  const [charter, tests, runs, conf, cases, queue, trend, prov] = await Promise.all([
    getSbrCharter(), getSbrTests(), getSbrRuns(fy), getSbrConfidence(fy),
    getSbrCases(fy, 40), getSbrQueueSummary(fy), getSbrTestTrend(), getProvenance('file_a_sbr'),
  ]);

  const byKind = (k: string) => runs.filter((r) => r.kind === k);
  const exceptionRuns = byKind('exception');
  const assuranceRuns = byKind('assurance');
  const notTestable = tests.filter((t) => t.kind === 'not_testable');

  const totalExceptions = exceptionRuns.reduce((s, r) => s + r.exceptions, 0);
  const totalExposure = exceptionRuns.reduce((s, r) => s + Number(r.exposure), 0);
  const openCases = queue.reduce((s, q) => s + q.open, 0);
  const tier1 = queue.find((q) => q.tier === 1);
  const assurancePasses = assuranceRuns.every((r) => r.exceptions === 0);

  const trendYears = Array.from(new Set(trend.map((t) => t.fiscalYear))).sort((a, b) => a - b);

  return (
    <Shell>
      <PageHeader
        eyebrow="Oversight · remediation programme"
        title="Budgetary Resources, worked end to end"
        lede="One material weakness, one population, one queue. /nfr scores this weakness as the only one of the twenty-six that the sources here can actually test. This is what that score is worth: every Department Treasury account tested against its criteria on every refresh, the exceptions ranked so a finite team can work them in order, and a run history that answers whether a remediation held rather than whether a plan completed."
      />

      <div className="mt-6">
        <ProvenanceBar p={prov}
          extra={`Tests run inside the load transaction over every account in File A, joined to File B where a row exists. Showing FY${fy}${yearRow.isPartialYear ? ', which is period-to-date' : ''}.`} />
      </div>

      <Section title="Position" id="position">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatTile label={`Exceptions, FY${fy}`} value={fmtInt(totalExceptions)}
            tone={totalExceptions ? 'critical' : 'good'}
            sub={`${exceptionRuns.length} tests over ${fmtInt(exceptionRuns[0]?.population ?? 0)} accounts`} />
          <StatTile label="Exposure identified" value={fmtT(totalExposure)}
            tone="warning" sub="Summed across tests; a dollar can be named by more than one" />
          <StatTile label="Cases open" value={fmtInt(openCases)} tone="warning"
            sub={tier1 ? `${tier1.cases} in tier 1` : 'No tier 1 cases this year'} />
          <StatTile label="Assurance tests" value={assurancePasses ? 'All pass' : 'Failing'}
            tone={assurancePasses ? 'good' : 'critical'}
            sub={`${assuranceRuns.length} assertions over the whole population`} />
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          {years.map((y) => (
            <Link key={y.fiscalYear} href={`/sbr?fy=${y.fiscalYear}`}
              className={`rounded border px-2.5 py-1 text-xs font-semibold ${
                y.fiscalYear === fy
                  ? 'border-accent-500/40 bg-accent-500/12 text-accent-400'
                  : 'border-navy-700 text-navy-400 hover:text-navy-100'}`}>
              FY{y.fiscalYear}{y.isPartialYear ? ' · to date' : ''}
            </Link>
          ))}
        </div>
        {yearRow.isPartialYear && (
          <Caveat>
            FY{fy} is submission period {yearRow.submissionPeriod}, which is period-to-date. Every
            count and every exposure on this page for that year is a position part way through it
            and will move. An exception rate read off a part-year submission measures the
            submission.
          </Caveat>
        )}
      </Section>

      <Section title="The risk, before the technology"
        note="Written before a line of the test engine, because a detector built without it finds whatever happens to be in the data rather than what the auditor reported."
        id="charter">
        <DataTable
          head={['Element', 'Definition', 'Basis']} align={[1, 2]}
          rows={charter.map((c) => [
            <span key="e" className="font-semibold text-navy-100">{c.element}</span>,
            c.value,
            <span key="b" className="text-[11px] text-navy-500">{c.basis === 'reported' ? 'reported' : 'read'}</span>,
          ])}
          caption="Reported means the cited document states it; read means this site drew it from the material weakness narrative. The root cause is the element everything else turns on."
        />
      </Section>

      <Section title="Can the population be tested at all"
        note="Measured before any test runs. A test over a population that cannot be shown complete proves nothing about the population, only about the sample that happened to be loaded."
        id="confidence">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {conf.map((m) => (
            <div key={m.metricKey} className="glass-card rounded-lg p-5">
              <div className="flex items-baseline justify-between gap-3">
                <div className="text-[12px] uppercase tracking-wider text-navy-400 font-semibold">
                  {m.metricLabel}
                </div>
                {m.isBlocking && (
                  <span className="text-[10px] uppercase tracking-wider text-accent-400 font-bold">
                    blocking
                  </span>
                )}
              </div>
              <div className={`text-2xl font-bold mt-2 tnum ${
                m.valuePct === null ? 'text-navy-400'
                  : Number(m.valuePct) >= 99.9 ? 'text-[color:var(--status-good)]'
                  : Number(m.valuePct) >= 90 ? 'text-[color:var(--status-warning)]'
                  : 'text-[color:var(--status-critical)]'}`}>
                {m.valuePct === null ? '—' : `${Number(m.valuePct).toFixed(2)}%`}
              </div>
              <p className="text-xs text-navy-400 mt-2 leading-relaxed">{m.detail}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section title={`The tests, and what they found in FY${fy}`}
        note="Deterministic and explainable, each tied to the authority that makes its finding a question rather than an opinion. Nothing here concludes that a misstatement exists."
        id="tests">
        <DataTable
          head={['Test', 'Assertion', 'Severity', 'Population', 'Exceptions', 'Rate', 'Exposure']}
          align={[1, 2]}
          rows={exceptionRuns.map((r) => [
            <span key="t"><span className="font-mono text-[12px] text-accent-400">{r.testCode}</span>
              <span className="block text-navy-100">{r.name}</span></span>,
            r.assertion,
            r.severity,
            fmtInt(r.population),
            <span key="e" className={r.exceptions ? 'text-[color:var(--status-warning)] font-semibold' : 'text-navy-500'}>
              {fmtInt(r.exceptions)}</span>,
            r.population ? fmtPct((r.exceptions / r.population) * 100, 2) : '—',
            Number(r.exposure) ? fmtT(Number(r.exposure)) : '—',
          ])}
          caption="Exposure means a different thing for each test and the test says which; it is never a misstatement estimate."
        />

        <h3 className="text-sm font-semibold text-navy-100 mt-8 mb-3">
          Assertions that hold across the whole population
        </h3>
        <DataTable
          head={['Test', 'What it asserts', 'Population', 'Exceptions']}
          align={[1]}
          rows={assuranceRuns.map((r) => [
            <span key="t"><span className="font-mono text-[12px] text-accent-400">{r.testCode}</span>
              <span className="block text-navy-100">{r.name}</span></span>,
            tests.find((t) => t.code === r.testCode)?.criterion ?? '',
            fmtInt(r.population),
            <span key="e" className={r.exceptions
              ? 'text-[color:var(--status-critical)] font-semibold'
              : 'text-[color:var(--status-good)] font-semibold'}>{fmtInt(r.exceptions)}</span>,
          ])}
          caption="These are evidence, not decoration. That the status section equals the resources section for every account in every year is the reason a figure drawn from this extract can be relied on at all; if one of them starts failing, that is a finding about the extract and it appears in the same run history as everything else."
        />
      </Section>

      <Section title="What these sources cannot test, and why"
        note="Two of these were written, run against the real population, and withdrawn. Publishing the reason is worth more than publishing a queue of exceptions that mean nothing."
        id="limits">
        <div className="space-y-5">
          {notTestable.map((t) => (
            <div key={t.code} className="border-l-2 border-navy-700 pl-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[12px] text-navy-500">{t.code}</span>
                <span className="text-sm font-semibold text-navy-100">{t.name}</span>
                <span className="text-[11px] text-navy-500">{t.assertion}</span>
              </div>
              <p className="text-xs text-navy-400 mt-1.5 leading-relaxed max-w-3xl">{t.limitation}</p>
            </div>
          ))}
        </div>
        <Caveat>
          The third is the one that matters. No published file here carries an obligating document
          reference on a Statement of Budgetary Resources line, so the test that would answer the
          material weakness rather than describe it cannot be run from this data at all. That is
          not a gap in this page. It is the data requirement any real remediation system for this
          weakness has to be built against, and naming it precisely is worth more than
          approximating it with something reachable.
        </Caveat>
      </Section>

      <Section title={`The queue — FY${fy}`}
        note="Ranked so a finite team can work it in order. Every score carries its components on the case page; a number nobody can argue with persuades nobody to act."
        id="queue">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
          {[1, 2, 3].map((t) => {
            const q = queue.find((x) => x.tier === t);
            return (
              <StatTile key={t} label={`Tier ${t}`} value={fmtInt(q?.cases ?? 0)}
                tone={TIER_TONE[t - 1]}
                sub={q ? `${fmtT(Number(q.exposure))} exposure, ${q.open} open` : 'No cases'} />
            );
          })}
        </div>
        <DataTable
          head={['Case', 'Account', 'Tier', 'Score', 'Exposure', 'Tests', 'Recurs', 'State']}
          align={[1, 5, 7]}
          rows={cases.map((c) => [
            <Link key="k" href={`/sbr/${encodeURIComponent(c.caseKey)}`}
              className="font-mono text-[12px] text-accent-400 hover:text-accent-300">
              {c.treasuryAccount}</Link>,
            <span key="n" className="text-navy-300">{c.accountName ?? '—'}</span>,
            c.tier,
            <span key="s" className="font-semibold text-navy-100">{Number(c.riskScore).toFixed(0)}</span>,
            fmtT(Number(c.exposure)),
            <span key="t" className="font-mono text-[11px] text-navy-400">{c.testCodes}</span>,
            `${c.recurrenceYears}y`,
            <span key="st" className="text-navy-400">{c.state ?? 'open'}</span>,
          ])}
          caption={`Top ${cases.length} by risk score. Recurs is the number of fiscal years in this load where the same account fails the same test.`}
        />
      </Section>

      <Section title="Does a remediation hold"
        note="Exception count per test across every fiscal year in the load. This is the control-performance history, and it is the only thing that distinguishes a corrective action that worked from one that was reported complete."
        id="validation">
        <DataTable
          head={['Test', ...trendYears.map((y) => `FY${String(y).slice(2)}`)]}
          rows={Array.from(new Set(trend.map((t) => t.testCode))).map((code) => [
            <span key="c" className="font-mono text-[12px] text-accent-400">{code}</span>,
            ...trendYears.map((y) => {
              const r = trend.find((t) => t.testCode === code && t.fiscalYear === y);
              if (!r) return '—';
              return (
                <span key={y} title={r.isPartialYear ? 'Period to date' : undefined}
                  className={r.exceptions === 0 ? 'text-[color:var(--status-good)]' : ''}>
                  {fmtInt(r.exceptions)}{r.isPartialYear ? '*' : ''}
                </span>
              );
            }),
          ])}
          caption="An asterisk marks a period-to-date submission, which is not comparable with a closed year. SBR-X04, the File A against File B disagreement, runs 6, 7, 10, 23, 45 across the closed years: that is a condition getting worse, and it is visible here because the same test runs on every refresh rather than once."
        />
        <Caveat>
          The cancelled-account exception, SBR-X01, stands at exactly three accounts and the same
          exposure in every one of the six years loaded. The same three Air Force missile
          procurement accounts, whose availability ended between FY1992 and FY1994, have carried
          the same balances throughout. A condition that survives six years of reporting is not an
          error anyone is working on; it is a control that does not operate, which is precisely
          the distinction the oversight weakness on the roster describes.
        </Caveat>
      </Section>

      <Section title="Where this sits"
        note="This programme is one material weakness of twenty-six. The other twenty-five are scored on the findings page, and eighteen of them cannot be reached from any published file at all.">
        <div className="flex flex-wrap gap-3 text-sm">
          <Link href="/nfr/budgetary" className="text-accent-400 hover:text-accent-300">
            The ten-element object for this weakness &rarr;
          </Link>
          <Link href="/nfr" className="text-navy-400 hover:text-accent-400">
            All twenty-six weaknesses and the NFR record &rarr;
          </Link>
          <Link href="/controls" className="text-navy-400 hover:text-accent-400">
            The load controls these tests run beside &rarr;
          </Link>
        </div>
      </Section>
    </Shell>
  );
}

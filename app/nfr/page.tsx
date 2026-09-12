import type { Metadata } from 'next';
import Link from 'next/link';
import Shell, { PageHeader, Section } from '@/components/Shell';
import { ProvenanceBar, Caveat } from '@/components/Provenance';
import { StatTile, DataTable, BarList } from '@/components/charts';
import { fmtInt } from '@/components/format';
import { CoverageChip, PersistenceGrid } from '@/components/nfr';
import {
  getNfrYears, getNfrEntities, getNfrRoster, getNfrObjects, getProvenance,
} from '@/lib/analytics';
import { NotLoaded } from '../execution/page';

export const metadata: Metadata = {
  title: 'NFRs and material weaknesses · datamatter',
  description:
    'Notices of Findings and Recommendations issued, reissued and closed across eight years of Department financial statement audits, the material weakness roster behind them, and a ten-element audit-risk object built at material weakness grain.',
};
export const revalidate = 900;

export default async function NfrPage() {
  const [years, roster, objects, prov] = await Promise.all([
    getNfrYears(), getNfrRoster(), getNfrObjects(), getProvenance('curated_nfr'),
  ]);
  if (!years.length) return <Shell><NotLoaded /></Shell>;

  const current = years[years.length - 1];
  const rosterYears = Array.from(new Set(roster.map((r) => r.fiscalYear))).sort((a, b) => a - b);
  const entityYear = [...years].reverse().find((y) => y.entityRowsPublished);
  const entities = entityYear ? await getNfrEntities(entityYear.fiscalYear) : [];

  // The grid is built from the roster rows, not from the object list, so a
  // weakness that has left the current roster still appears with the years it
  // was on it. Sorted by how long it has been there, longest first.
  const objKeys = new Set(objects.map((o) => o.mwKey));
  const byKey = new Map<string, { label: string; obstacle: string; present: number[] }>();
  for (const r of roster) {
    const e = byKey.get(r.mwKey) ?? { label: r.printedLabel, obstacle: r.obstacle, present: [] };
    e.present.push(r.fiscalYear);
    if (objKeys.has(r.mwKey) && r.fiscalYear === Math.max(...rosterYears)) e.label = r.printedLabel;
    byKey.set(r.mwKey, e);
  }
  const gridRows = Array.from(byKey.entries())
    .map(([mwKey, e]) => ({ mwKey, ...e, current: objKeys.has(mwKey) }))
    .sort((a, b) => Number(b.current) - Number(a.current)
      || b.present.length - a.present.length
      || a.label.localeCompare(b.label));

  const cov = (k: string) => objects.filter((o) => o.coverage === k);
  const reachable = objects.filter((o) => o.coverage !== 'absent');
  const withheldYears = years.filter((y) => !y.entityRowsPublished).map((y) => y.fiscalYear);
  const noRoster = years.filter((y) => !y.rosterPublished).map((y) => y.fiscalYear);
  const firstYear = years[0];
  const longest = objects.reduce((a, b) => (b.rosterYearsPresent > a.rosterYearsPresent ? b : a), objects[0]);
  const everyYear = objects.filter((o) => o.rosterYearsPresent === o.rosterYearsAvailable).length;

  return (
    <Shell>
      <PageHeader
        eyebrow="Oversight · audit findings"
        title="Notices of findings, and the risk object behind them"
        lede="Eight years of Department financial statement audits, read as a record rather than as a headline: how many notices were issued, how many were the same notices issued again, which material weaknesses never left the roster, and — for each one still on it — the account, the assertion, the control that failed and why."
      />

      <div className="mt-6">
        <ProvenanceBar p={prov}
          extra="Transcribed from named DoD OIG and GAO reports. Each year's per-entity rows are published only where they foot to the total that same report states." />
      </div>

      <Section title="What the public record actually contains"
        note="This matters before any figure below is read, because the unit everyone talks about is not the unit anyone outside the audit can obtain.">
        <Caveat>
          A Notice of Findings and Recommendations is what an auditor issues when testing finds a control
          deficiency. It names the condition, the criterion, the cause, the effect and a recommendation, and it
          is addressed to the entity that has to fix it. <strong className="text-navy-200">The notices
          themselves are not published.</strong> What the DoD OIG publishes each year is the count of notices
          issued, reissued and closed, a table of those counts by reporting entity, and a roster of the
          Agency-Wide material weaknesses. Nothing on this page is an extracted notice. The material weakness
          is the finest grain the public record supports, and the ten-element object below is built at that
          grain and says so element by element.
        </Caveat>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
          <StatTile label={`NFRs issued, FY${current.fiscalYear}`}
            value={current.nfrsIssued == null ? '—' : fmtInt(current.nfrsIssued)}
            tone="critical" sub={current.nfrsClosed == null ? undefined
              : `${fmtInt(current.nfrsClosed)} prior-year notices closed`} />
          <StatTile label={`Material weaknesses, FY${current.fiscalYear}`}
            value={current.mwAgencyWide == null ? '—' : String(current.mwAgencyWide)}
            tone="critical" sub="Agency-Wide, independent auditor" />
          <StatTile label="Consecutive years disclaimed"
            value={String(years.length)} tone="critical"
            sub={`FY${firstYear.fiscalYear} through FY${current.fiscalYear}`} />
          <StatTile label="On every published roster"
            value={String(everyYear)} tone="warning"
            sub={`Of ${objects.length} current weaknesses, across ${rosterYears.length} rosters from FY${rosterYears[0]}`} />
        </div>
      </Section>

      <Section title="Eight years of notices"
        note="Issued is the whole population an auditor worked on in that year, and most of it is prior-year notices reissued because the condition had not been corrected. New is the part that was found that year. Reading issued alone reads the backlog as fresh findings."
        id="years">
        <DataTable
          head={['FY', 'Issued', 'New', 'Reissued', 'Closed', 'MWs, all entities', 'Non-compliance', 'MWs, Agency-Wide', 'Opinion']}
          align={[8]}
          rows={years.map((y) => [
            <span key="fy" className="font-semibold text-navy-100">FY{y.fiscalYear}</span>,
            y.nfrsIssued == null ? '—' : fmtInt(y.nfrsIssued),
            y.nfrsNew == null ? '—' : fmtInt(y.nfrsNew),
            y.nfrsReissued == null ? '—' : fmtInt(y.nfrsReissued),
            y.nfrsClosed == null ? '—' : fmtInt(y.nfrsClosed),
            y.mwTotal == null ? '—' : fmtInt(y.mwTotal),
            y.noncomplianceTotal == null ? '—' : fmtInt(y.noncomplianceTotal),
            y.mwAgencyWide == null ? '—' : String(y.mwAgencyWide),
            y.opinion,
          ])}
          caption="An em dash is a figure the year's report does not publish, not a zero."
        />
        <Caveat>
          The issued count falls from {fmtInt(3559)} in FY2020 to {fmtInt(current.nfrsIssued ?? 0)} in
          FY{current.fiscalYear}, and that is not by itself evidence of improvement. A notice leaves the
          population when it is closed, when it is merged into another, when the entity it was issued to stops
          being separately audited, or when the audit approach changes what is tested. Two of those happened
          inside this window: the FY2024 entity table has no U.S. Special Operations Command row, and the
          Department moved in 2026 from control remediation toward substantive testing of balances. Whether a
          control was fixed is a different question from whether its notice is still open, and the public
          record answers only the second.
        </Caveat>
        <div className="mt-6 space-y-2">
          {years.filter((y) => y.note).map((y) => (
            <p key={y.fiscalYear} className="text-xs text-navy-500 leading-relaxed">
              <span className="text-navy-400 font-medium">FY{y.fiscalYear}. </span>{y.note}
            </p>
          ))}
        </div>
        <div className="mt-5 space-y-1">
          {years.map((y) => (
            <p key={y.fiscalYear} className="text-[11px] text-navy-600 leading-relaxed">
              FY{y.fiscalYear} · {y.sourceUrl
                ? <a href={y.sourceUrl} className="hover:text-accent-400 underline decoration-navy-700 underline-offset-2"
                     target="_blank" rel="noopener noreferrer">{y.citation}</a>
                : y.citation}
            </p>
          ))}
        </div>
      </Section>

      {entityYear && (
        <Section title={`Where the notices sit — FY${entityYear.fiscalYear}`}
          note="The per-entity table each report prints. It is published here only for the years whose rows sum exactly to the total the same report states, which is the one check the source itself supplies against a transcription.">
          <BarList
            format="int" colour="var(--series-2)"
            rows={entities.map((e) => ({ key: e.entity, label: e.entity, value: e.nfrCount }))}
            caption={`Rows sum to ${fmtInt(entityYear.nfrsIssued ?? 0)}, the total stated in the same report. Control NFR-01 re-checks that in the load transaction and blocks a load where it breaks.`}
          />
          <Caveat>
            FY{withheldYears.join(', FY')} {withheldYears.length === 1 ? 'is' : 'are'} not published at entity
            grain. The FY2018 table sums to 2,243 against a published 2,410 — the difference is a merged
            General Fund and Working Capital Fund presentation and a Defense Information Systems Agency row the
            report marks &ldquo;Delayed&rdquo; — and FY2025&rsquo;s auditor report prints no entity table at all.
            A table that does not foot is a transcription, so it is withheld rather than shown with a caveat.
          </Caveat>
        </Section>
      )}

      <Section title="What stayed on the roster"
        note="Each column is a year in which a roster was published; each mark is that weakness appearing on it. Pairing a weakness across years is this site's judgement, not the Department's: the systems weakness was printed as Financial Management Systems and Information Technology, then Legacy Systems, then Financial Management Systems Modernization, and a roster keyed on the printed title would read those renames as closures."
        id="roster">
        <PersistenceGrid years={rosterYears} rows={gridRows} />
        <Caveat>
          FY{noRoster.join(', FY')} {noRoster.length === 1 ? 'has' : 'have'} no column.
          DODIG-2024-114 states 28 Agency-Wide material weaknesses for FY2023 and refers the roster to an
          appendix that is not in the released text; drawing that year with every weakness absent would turn a
          gap in the record into a year of closures. {longest?.label} has been on every one of the
          {' '}{rosterYears.length} rosters published. Rows in grey have left the FY{current.fiscalYear}
          {' '}roster, which is not the same as having been fixed — the FY2022 report folded
          {' '}<em>Financial Statement Compilation</em> and <em>Suspense Accounts</em> into weaknesses that remain.
        </Caveat>
      </Section>

      <Section title="The ten-element audit-risk object"
        note="A finding read as a document tells you what went wrong once. The same finding read as a structured object tells you what to build: which relationship in the data was supposed to hold, which data would evidence it, and whether anyone can measure it. Ten elements per weakness, each recording whether the cited document states it or this site read it out of the narrative."
        id="object">
        <ol className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2 mb-7 text-sm text-navy-300 max-w-4xl">
          {[
            ['Financial statement / account', 'which balance is affected'],
            ['Assertion', 'existence, completeness, cutoff, valuation, rights'],
            ['Audit risk', 'what could cause a material misstatement'],
            ['Control', 'what was supposed to prevent or detect it'],
            ['Control failure', 'what actually went wrong'],
            ['Root cause', 'why the control failed — not the symptom'],
            ['Population / exposure', 'how much was in scope'],
            ['Historical audit evidence', 'what the auditors tested and found'],
            ['Remediation', 'what management did, and whether it held'],
            ['Outcome', 'open, recurring, downgraded or closed'],
          ].map(([name, gloss], i) => (
            <li key={name} className="flex gap-3 py-1 border-b border-navy-800/40">
              <span className="tnum text-navy-600 font-semibold w-5 shrink-0">{i + 1}</span>
              <span><span className="text-navy-100 font-medium">{name}</span>
                <span className="text-navy-500"> — {gloss}</span></span>
            </li>
          ))}
        </ol>
        <Caveat>
          Element 6 is the one that decides whether any of this is useful. &ldquo;The interface failed&rdquo;
          is a symptom; &ldquo;no key identifies a record on both sides of the interface, so the reconciliation
          that exists compares two numbers derived from the same side&rdquo; is a cause, and only the second
          tells anyone what to build. Element 10 is never written by the extract: it is computed from the
          rosters above, because an outcome asserted beside the evidence it summarises is a restatement with a
          verdict printed on it. Control NFR-05 re-derives it on every load.
        </Caveat>
        <div className="mt-6">
          <DataTable
            head={['Material weakness', 'Obstacle', 'On the roster', 'First', 'This site’s sources', '']}
            align={[1, 4]}
            rows={objects.map((o) => [
              <Link key="l" href={`/nfr/${o.mwKey}`} className="text-navy-100 hover:text-accent-400 font-medium">
                {o.label}
              </Link>,
              o.obstacle,
              `${o.rosterYearsPresent} of ${o.rosterYearsAvailable}`,
              `FY${o.firstRosterYear}`,
              <CoverageChip key="c" coverage={o.coverage} />,
            ])}
            caption="Obstacle is the Department's own grouping of these weaknesses, from the FY2024 report."
          />
        </div>
      </Section>

      <Section title="What the sources on this site could actually test"
        note="Scored one weakness at a time against File A, File B, File C, the contract files and the budget exhibits. This is the step that turns a reading list into a build queue, and most of the queue is empty for a reason worth stating plainly."
        id="coverage">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatTile label="Testable with what is here" value={String(cov('testable').length)}
            tone="good" sub="A control on this site already tests an assertion of this kind" />
          <StatTile label="Partially reachable" value={String(cov('partial').length)}
            tone="warning" sub="Part of the relationship, with a named loss" />
          <StatTile label="Out of reach" value={String(cov('absent').length)}
            sub="No published file carries either side of the relationship" />
        </div>
        <div className="mt-7 space-y-5">
          {reachable.map((o) => (
            <div key={o.mwKey} className="border-l-2 border-navy-700 pl-4">
              <div className="flex flex-wrap items-center gap-2">
                <Link href={`/nfr/${o.mwKey}`} className="text-sm font-semibold text-navy-100 hover:text-accent-400">
                  {o.label}
                </Link>
                <CoverageChip coverage={o.coverage} />
              </div>
              <p className="text-xs text-navy-400 mt-1.5 leading-relaxed max-w-3xl">
                <span className="text-navy-500">Expected relationship. </span>{o.expectedRelationship}
              </p>
              <p className="text-xs text-navy-400 mt-1 leading-relaxed max-w-3xl">{o.coverageNote}</p>
            </div>
          ))}
        </div>
        <Caveat>
          {cov('absent').length} of {objects.length} are out of reach here, and that is the finding rather than
          a shortcoming of this site. The weaknesses that dominate the roster concern proprietary balances,
          journal entries, trading partners, user access and interface reconciliations — none of which appear
          in any published execution file, because the published files exist to report budgetary execution to
          the public and were never built to evidence a control. A remediation system has to be built where the
          transactions are. What this page can do is name, for each weakness, the relationship that has to hold
          and the data that would evidence it, which is the specification that work would start from.
        </Caveat>
      </Section>
    </Shell>
  );
}

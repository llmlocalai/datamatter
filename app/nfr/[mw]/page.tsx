import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import Shell, { PageHeader, Section } from '@/components/Shell';
import { ProvenanceBar, Caveat } from '@/components/Provenance';
import { StatTile, DataTable } from '@/components/charts';
import { BasisChip, ChainStep, CoverageChip } from '@/components/nfr';
import {
  getNfrObjects, getNfrElements, getNfrRoster, getProvenance,
} from '@/lib/analytics';

export const revalidate = 900;
// Unknown keys 404 rather than rendering at request time. The 26 that exist are
// prerendered by the build, so a broken query here fails the build instead of a
// visitor's request -- which is the whole point of prerendering against the
// live database on this site.
export const dynamicParams = false;

export async function generateStaticParams() {
  const objects = await getNfrObjects();
  return objects.map((o) => ({ mw: o.mwKey }));
}

export async function generateMetadata(
  { params }: { params: { mw: string } }): Promise<Metadata> {
  const o = (await getNfrObjects()).find((x) => x.mwKey === params.mw);
  if (!o) return { title: 'Material weakness · datamatter' };
  return {
    title: `${o.label} · audit-risk object · datamatter`,
    description: `The ten-element audit-risk object for the ${o.label} material weakness: account, assertion, risk, control, failure, root cause, exposure, evidence, remediation and outcome.`,
  };
}

export default async function NfrObjectPage({ params }: { params: { mw: string } }) {
  const [objects, elements, roster, prov] = await Promise.all([
    getNfrObjects(), getNfrElements(params.mw), getNfrRoster(), getProvenance('curated_nfr'),
  ]);
  const o = objects.find((x) => x.mwKey === params.mw);
  if (!o) notFound();

  const i = objects.findIndex((x) => x.mwKey === o.mwKey);
  const prev = objects[i - 1];
  const next = objects[i + 1];
  const mine = roster.filter((r) => r.mwKey === o.mwKey);
  const rosterYears = Array.from(new Set(roster.map((r) => r.fiscalYear))).sort((a, b) => a - b);
  const titles = Array.from(new Set(mine.map((r) => r.printedLabel)));
  const el = (n: number) => elements.find((e) => e.elementNo === n);
  const rootCause = el(6);
  const exposure = el(7);

  return (
    <Shell>
      <PageHeader
        eyebrow={`Audit-risk object · ${o.obstacle}`}
        title={o.label}
        lede={`Ten elements built at material weakness grain from the published audit record. Every element below says whether the cited document states it or this site read it out of the narrative — and none of them is an extracted Notice of Findings and Recommendations, because those are not public documents.`}
      />

      <div className="mt-6">
        <ProvenanceBar p={prov}
          extra={`On the published roster in ${o.rosterYearsPresent} of ${o.rosterYearsAvailable} years, first FY${o.firstRosterYear}, last FY${o.lastRosterYear}.`} />
      </div>

      <Section title="Position">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatTile label="Outcome"
            value={o.outcomeState === 'open' ? 'Open' : 'Off the roster'}
            tone={o.outcomeState === 'open' ? 'critical' : 'warning'}
            sub={`Computed from the ${o.rosterYearsAvailable} published rosters, not asserted`} />
          <StatTile label="Years on the roster"
            value={`${o.rosterYearsPresent} of ${o.rosterYearsAvailable}`}
            tone="warning" sub={`First published FY${o.firstRosterYear}`} />
          <StatTile label="Titles it has been printed under"
            value={String(titles.length)}
            sub={titles.length > 1 ? 'Paired across years by this site, not by the Department' : 'Unchanged across the record'} />
        </div>
        <div className="glass-card rounded-lg p-5 mt-4">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="text-[12px] uppercase tracking-wider text-navy-400 font-semibold">
              What the sources on this site could test
            </span>
            <CoverageChip coverage={o.coverage} />
          </div>
          <p className="text-sm text-navy-300 mt-2.5 leading-relaxed max-w-4xl">{o.coverageNote}</p>
        </div>
      </Section>

      <Section title="The ten elements"
        note="Read in order, these answer a different question from the report they come from: not what happened, but what a system built to prevent it would have to measure.">
        <div className="space-y-4">
          {elements.map((e) => (
            <article key={e.elementNo}
              className="glass-card rounded-lg p-5 border-l-2 border-navy-700">
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="tnum text-navy-600 font-bold text-sm">{e.elementNo}</span>
                <h3 className="text-sm font-semibold text-navy-100">{e.elementName}</h3>
                <BasisChip basis={e.basis} />
              </div>
              <p className="mt-2 text-sm text-navy-300 leading-relaxed max-w-3xl">{e.elementText}</p>
              <p className="mt-2.5 text-[11px] text-navy-600 leading-relaxed">{e.citation}</p>
            </article>
          ))}
        </div>
      </Section>

      <Section title="Where it appeared, and what it was called"
        note="One row per published roster. A year absent from this table is a year in which this weakness was not on the roster, or — for FY2023 — a year for which no roster was published at all.">
        <DataTable
          head={['FY', 'Printed as', 'Rank in the report', 'Citation']}
          align={[1, 3]}
          rows={mine.map((r) => [
            <span key="y" className="font-semibold text-navy-100">FY{r.fiscalYear}</span>,
            r.printedLabel, String(r.rank), r.citation,
          ])}
          caption={rosterYears.length
            ? `Rosters published for FY${rosterYears.join(', FY')}.` : undefined}
        />
      </Section>

      <Section title="From this root cause to a system that can be audited"
        note="The first three steps come from the record above. The rest is a design, and is marked as one: nothing on this site evidences that any of it was built or that it works.">
        <ol className="mt-2">
          <ChainStep n={1} title="Root cause" kind="finding">
            {rootCause?.elementText}
          </ChainStep>
          <ChainStep n={2} title="The business relationship that should hold" kind="finding">
            {o.expectedRelationship}
          </ChainStep>
          <ChainStep n={3} title="Data the relationship requires" kind="finding">
            {o.dataRequired}
            <span className="block mt-1.5 text-navy-500">{o.coverageNote}</span>
          </ChainStep>
          <ChainStep n={4} title="Rule" kind="design">
            State the relationship as a testable condition over that data and run it over the whole
            population, not a sample. Every break is an exception with a transaction behind it. A rule that
            can only be evaluated on one side of the relationship is not a test of it, which is why step 3
            has to come first and has to be honest about what is missing.
          </ChainStep>
          <ChainStep n={5} title="Machine learning" kind="design">
            Patterns the rule does not express: a break that appears only at a particular period end, a
            counterparty whose exceptions cluster, a value distribution that moves before a reconciliation
            fails. Trained on the exception history the rule produces, so the model has a labelled population
            rather than an unsupervised guess at what &ldquo;unusual&rdquo; means for this account.
          </ChainStep>
          <ChainStep n={6} title="Language model" kind="design">
            Explain a specific exception against the source records it was raised from, quoting them. Grounded
            in the retrieved evidence, never in the model&rsquo;s own account of how the process works — an
            explanation that cannot name the record it rests on is not audit evidence.
          </ChainStep>
          <ChainStep n={7} title="Automation" kind="design">
            Route the exception to the accountable office, collect the supporting document, open the
            correction, and record what was done and by whom. The automation is the part that makes the
            control operate on a schedule rather than at year end under an auditor&rsquo;s deadline.
          </ChainStep>
          <ChainStep n={8} title="Monitoring" kind="design">
            Measure whether the control performs: exception rate, time to clear, ageing of what is unresolved,
            and recurrence after closure. Recurrence after closure is the one that matters here, because the
            oversight weakness on this roster is precisely that a corrective action can be reported complete
            while the control it was meant to install never operates.
          </ChainStep>
          <ChainStep n={9} title="Audit evidence" kind="design">
            Retain the tested population, the exceptions, the investigation, the remediation and the
            control-performance history, each immutable and timestamped. The deliverable is not a dashboard.
            It is a package an auditor can test that demonstrates the control operated across the period.
          </ChainStep>
        </ol>
        <Caveat>
          The order is the argument. Building an anomaly detector for this account without steps 1 to 3 gives a
          model trained on whichever side of the relationship happens to be in a data lake, and it will find
          anomalies there — reliably, and without any of them being the failure the auditor reported.
          {' '}Materiality decides whether the work is worth doing, and the public record sizes this one
          {exposure?.basis === 'reported'
            ? ` only this far: ${exposure.elementText}`
            : ' no further than the roster it sits on: the reports name no population or dollar exposure at material weakness grain, so the decision to build has to be made on the balance, not on the finding.'}
        </Caveat>
      </Section>

      <Section title="">
        <div className="flex flex-wrap items-center justify-between gap-4 text-sm">
          {prev
            ? <Link href={`/nfr/${prev.mwKey}`} className="text-navy-400 hover:text-accent-400">← {prev.label}</Link>
            : <span />}
          <Link href="/nfr" className="text-accent-400 hover:text-accent-300">All {objects.length} weaknesses</Link>
          {next
            ? <Link href={`/nfr/${next.mwKey}`} className="text-navy-400 hover:text-accent-400">{next.label} →</Link>
            : <span />}
        </div>
      </Section>
    </Shell>
  );
}

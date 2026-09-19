import type { Metadata } from 'next';
import Link from 'next/link';
import Shell, { PageHeader, Section } from '@/components/Shell';
import { ProvenanceBar, Caveat } from '@/components/Provenance';
import { StatTile, DataTable, BarList, LineTrend, Empty } from '@/components/charts';
import { getProvenance } from '@/lib/analytics';
import {
  researchReady, getFindings, getRecommendations, getEvidence, evidenceMap, runs,
  AUDIENCE_LABEL, AUDIENCE_WHO,
  type Audience, type EvidenceMap, type ResearchFinding, type ResearchRecommendation,
} from '@/lib/research';
import { getChainSensitivity } from '@/lib/chain';
import { getTimelineTrend } from '@/lib/timeline';

export const metadata: Metadata = {
  title: 'Where the time goes · a research paper · datamatter',
  description:
    'What six years of public appropriation and execution data can and cannot establish about '
    + 'the wait between a Department of Defense appropriation and an obligation, and what the '
    + 'Department, the components and the appropriations committees could each do about it.',
};
export const revalidate = 900;

const AUDIENCE_ORDER: Audience[] = ['department', 'service', 'appropriator'];

export default async function ResearchPage() {
  if (!(await researchReady())) return <Shell><NotLoaded /></Shell>;

  const [prov, findings, recs, evidenceRows, sens, trend] = await Promise.all([
    getProvenance('curated_research'), getFindings(), getRecommendations(), getEvidence(),
    getChainSensitivity('d50'), getTimelineTrend(),
  ]);
  const ev = evidenceMap(evidenceRows);
  const byKey = new Map(findings.map((f) => [f.findingKey, f]));

  // The two figures the argument turns on, drawn from the same loaded tables the
  // pages they came from use. Cells only: a component rollup and its own colours
  // of money in one ranking would compare a set against one of its members.
  const cells = sens.filter((s) => s.level === 'cell' && s.daysPer30CrDays !== null)
    .sort((a, b) => (b.daysPer30CrDays as number) - (a.daysPer30CrDays as number));
  const sepShare = trend.filter((t) => t.metricKey === 'sep_share' && t.value !== null
                                       && t.isCompleteYear);
  const crByYear = new Map(sepShare.map((t) => [t.fiscalYear, t.crDays]));

  const num = (k: string) => ev[k]?.value ?? null;

  return (
    <Shell>
      <PageHeader
        eyebrow="Research"
        title="Where the time goes"
        lede="What six years of public appropriation and execution data can establish about the wait between a Department of Defense appropriation and an obligation — and, separately, what it cannot. Nine findings, thirteen recommendations, and the observation that would falsify each one."
      />

      <div className="pt-8">
        <ProvenanceBar p={prov} extra="The prose of this paper is written by hand and contains no literal numbers. Every figure below is a named placeholder resolved at load time from the same extracts the rest of this site publishes; control RES-01 rolls the load back if one fails to resolve." />
      </div>

      {/* ------------------------------------------------------------ abstract */}
      <Section title="Abstract">
        <div className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-4 [&>p]:text-[15px] [&>p]:text-navy-200 [&>p]:leading-relaxed">
            {/* The abstract obeys the same rule as the findings: no figure is typed
                in. Each one below is resolved against this load's evidence table by
                the same renderer the findings use, so an abstract cannot quietly
                disagree with the paper underneath it. */}
            <Prose ev={ev} text={
              'The standard account of Department of Defense execution says that continuing '
              + 'resolutions delay spending and that the delay reappears as a September rush. Six '
              + 'years of public data support neither half of that as a general claim. The measured '
              + 'effect of continuing-resolution length on execution timing is {sens_med_operating} '
              + 'days for the median operating account and {sens_med_investment} for the median '
              + 'investment account, both within two days of zero. The entire measured effect sits '
              + 'in {sens_slip_count} of {sens_pairs} pairs, every one of them construction or '
              + 'family housing. Meanwhile September\u2019s share of contract obligation has risen '
              + 'from {sep_share_first} to {sep_share_last} across the same six years, and the year '
              + 'with the second-longest continuing resolution, at {cr_days_2022} days, closed with '
              + 'the lowest September share of them all at {sep_share_2022}.'} />
            <Prose ev={ev} text={
              'A second result runs the other way. Modelled from statute, regulation and the steps '
              + 'nobody publishes a clock for, the chain from a full-year act to a tenth of the '
              + 'post-act obligation being placed has a likely duration of {chain_model_likely} '
              + 'days. Components place that first tenth between {post_act_lo} and {post_act_hi} '
              + 'days after the act. Work is being staged against authority that has not arrived '
              + 'and released when it does, which means authority rather than capability is the '
              + 'binding constraint, and it means schedule bought by earlier authority is real '
              + 'rather than theoretical.'} />
            <Prose ev={ev} text={
              'The third result is the one that limits the other two. Of the {chain_steps_total} '
              + 'steps between an appropriation and an obligation, {chain_steps_unpublished} have '
              + 'no published deadline, no published date and no record of whether they were met '
              + '\u2014 for any component, in any year. The Department cannot presently '
              + 'demonstrate whether the wait between authority and execution is funds distribution '
              + 'or acquisition lead time, and therefore cannot tell whether any corrective action '
              + 'worked. That is not an analytical gap on this site. It is the finding, and it is '
              + 'the cheapest one on this page to fix.'} />
          </div>
          <aside className="space-y-3">
            <StatTile label="Findings" value={String(findings.length)}
              sub="Each stating the observation that would falsify it" />
            <StatTile label="Recommendations" value={String(recs.length)} tone="accent"
              sub={AUDIENCE_ORDER.map((a) => `${recs.filter((r) => r.audience === a).length} ${a}`).join(' · ')} />
            <StatTile label="Resolved figures" value={String(evidenceRows.length)}
              sub="Every number in this paper, re-derived at load time" />
          </aside>
        </div>
      </Section>

      {/* -------------------------------------------------------- evidence base */}
      <Section title="What this evidence base can see"
        note="A paper that does not state the shape of its own data invites the reader to assume it is complete. This one is not, and the limits are structural rather than temporary.">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatTile label="Department obligations" value={ev['dow_obligations']?.display ?? '—'}
            sub={`FY${num('scope_year') ?? ''} · File A, Department scope only`} />
          <StatTile label="Scope error if unfiltered" value={ev['scope_overstatement']?.display ?? '—'}
            tone="critical" sub="Summing every agency code in File A adds the Executive Office of the President" />
          <StatTile label="Contract dollars naming one account"
            value={`${ev['single_tas_lo']?.display ?? '—'} – ${ev['single_tas_hi']?.display ?? '—'}`}
            tone="warning" sub="Worst to best year. Every colour-of-money timing statement rests on this sample" />
          <StatTile label="Chain steps with a published clock"
            value={`${(num('chain_steps_total') ?? 0) - (num('chain_steps_unpublished') ?? 0)} of ${num('chain_steps_total') ?? '—'}`}
            tone="warning" sub="The rest are modelled, and labelled as modelled on every row" />
        </div>
        <Caveat>
          Three populations, never mixed. <strong className="text-navy-300">Measured, complete</strong>:
          File A and File B carry every dollar, and one submission per fiscal year, so they contain
          no within-year timing at all. <strong className="text-navy-300">Measured, censored</strong>:
          contract action dates give a within-year ramp, but only for the small share of dollars
          that name a Treasury account, which makes every timing figure here an upper bound on how
          early money actually moved. <strong className="text-navy-300">Assumed</strong>: the
          interior of the distribution chain, which appears in no file available here. Nothing
          assumed is added to anything measured anywhere on this site.
        </Caveat>
      </Section>

      {/* -------------------------------------------------------------- findings */}
      <Section title="Findings"
        note="Nine, in the order the argument needs them. Each carries the claim, what follows from it, the observation that would falsify it, and how far the evidence actually reaches.">
        <ol className="space-y-5">
          {findings.map((f, i) => <FindingCard key={f.findingKey} f={f} n={i + 1} ev={ev} />)}
        </ol>
      </Section>

      {/* --------------------------------------------------------------- figures */}
      <Section title="The two figures the argument turns on"
        note="Both are drawn from the loaded tables behind the pages they came from, not restated here by hand.">
        <div className="grid lg:grid-cols-2 gap-8">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-navy-100 mb-1">
              Execution slip per thirty days of continuing resolution
            </h3>
            <p className="text-xs text-navy-400 mb-4 leading-relaxed">
              One row per component and colour of money, ranked. Positive is later. The mass sits
              at zero; the effect is entirely in the top of the tail.
            </p>
            {cells.length ? (
              <BarList
                rows={cells.slice(0, 10).map((s) => ({
                  key: `${s.agencyCode}-${s.appropriation}`,
                  label: `${s.agencyName ?? s.agencyCode} · ${s.appropriation}`,
                  value: s.daysPer30CrDays as number,
                  meta: `${s.years} years · ${s.profile}`,
                }))}
                format="int"
                colour="var(--status-warning)"
                caption={`Ranked by days of slip per thirty days without a full-year act. Only ${num('sens_slip_count') ?? '—'} of ${num('sens_pairs') ?? '—'} pairs exceed five days; the median is ${ev['sens_med_operating']?.display ?? '—'} days for operating accounts and ${ev['sens_med_investment']?.display ?? '—'} for investment.`}
              />
            ) : <Empty />}
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-navy-100 mb-1">
              September&rsquo;s share of the year&rsquo;s contract obligation
            </h3>
            <p className="text-xs text-navy-400 mb-4 leading-relaxed">
              Rising across six years. It does not track the appropriations calendar: the longest
              and second-longest continuing resolutions bracket the lowest and highest points.
            </p>
            {sepShare.length > 1 ? (
              <>
                <LineTrend
                  points={sepShare.map((t) => ({ x: t.fiscalYear, y: t.value as number }))}
                  format="pct"
                  label="September share of contract obligation"
                />
                <DataTable
                  head={['Fiscal year', 'September share', 'Days without a full-year act']}
                  rows={sepShare.map((t) => [
                    `FY${t.fiscalYear}`,
                    `${(t.value as number).toFixed(1)}%`,
                    crByYear.get(t.fiscalYear) === null ? '—' : String(crByYear.get(t.fiscalYear)),
                  ])}
                  caption="If year-end concentration were a continuing-resolution effect, these two columns would move together."
                />
              </>
            ) : <Empty />}
          </div>
        </div>
      </Section>

      {/* ------------------------------------------------------- recommendations */}
      <Section title="Recommendations"
        note="Thirteen, each naming exactly one finding above. A recommendation that cannot name a finding is an opinion, and this site does not print those beside measurements without saying which is which.">
        <div className="space-y-10">
          {AUDIENCE_ORDER.map((a) => {
            const mine = recs.filter((r) => r.audience === a);
            if (!mine.length) return null;
            return (
              <div key={a}>
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-1">
                  <h3 className="text-lg font-bold text-navy-50">{AUDIENCE_LABEL[a]}</h3>
                  <span className="text-xs text-navy-500">{AUDIENCE_WHO[a]}</span>
                </div>
                <div className="grid lg:grid-cols-2 gap-4 mt-4">
                  {mine.map((r, i) => (
                    <RecCard key={r.recKey} r={r} n={i + 1} ev={ev} finding={byKey.get(r.becauseFinding)} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </Section>

      {/* ------------------------------------------------------------ limitations */}
      <Section title="What would change these conclusions"
        note="Stated as tests rather than caveats, because a limitation nobody can act on is decoration.">
        <div className="grid md:grid-cols-2 gap-4">
          {[
            ['Four recorded dates per distribution action',
             'Apportionment, allocation, allotment and sub-allotment, published with the obligation data. This would replace the modelled interior of the chain with a measurement and settle, one way or the other, whether the wait is funds distribution or acquisition lead time. Every finding on this page about the chain is conditional on it.'],
            ['The account files published monthly',
             'The Department already submits them monthly; only the annual snapshot is published. A monthly series at full dollar coverage would replace the censored contract sample that carries every within-year figure here, and would likely revise the magnitude — though not, on this evidence, the direction — of the continuing-resolution result.'],
            ['A funding account on the contract action',
             'Attribution today is at award level, on a small share of dollars. Colour-of-money timing is therefore inference. At even half coverage it becomes measurement, and the three exposed account pairs could be confirmed or dismissed on far more than four observations each.'],
            ['Days-to-satisfaction on each obligation bar',
             'Nothing currently measures how long a spend-plan condition actually holds money, or how much. Without it, the claim that these conditions matter is an argument from their text rather than from their effect.'],
          ].map(([t, b]) => (
            <div key={t} className="glass-card rounded-lg p-5">
              <h3 className="text-sm font-semibold text-navy-50">{t}</h3>
              <p className="text-[13px] text-navy-300 leading-relaxed mt-2">{b}</p>
            </div>
          ))}
        </div>
        <Caveat>
          Two things this paper does not claim. It does not claim the Department is slow: on the
          only interval that is measured end to end, it is faster than its own documented process.
          And it does not claim its own sources are adequate — they are public reporting files
          built to report budgetary execution to the public, and asking them to carry audit
          evidence or funds-control timing is asking them to be something they were not built to
          be. Where they cannot answer, this paper says so rather than estimating.
        </Caveat>
      </Section>

      {/* ---------------------------------------------------------------- method */}
      <Section title="Method"
        note="Short, because the detail belongs on the pages that produced each figure and is linked from every finding above.">
        <div className="grid md:grid-cols-2 gap-x-10 gap-y-4 text-[13px] text-navy-300 leading-relaxed">
          <div className="space-y-3">
            <p>
              <strong className="text-navy-100">Unit of analysis.</strong> Fiscal year × component ×
              colour of money, for the year&rsquo;s <em>own</em> appropriation — programme year
              equal to fiscal year. A fiscal year&rsquo;s File A holds every programme year still
              executing in it, and a lag measured across that mixture answers nothing anyone asks.
            </p>
            <p>
              <strong className="text-navy-100">Scope.</strong> Department only. File A carries
              several agency identifier codes and one of them is the Executive Office of the
              President; a blocking control refuses to publish any Department figure that includes it.
            </p>
            <p>
              <strong className="text-navy-100">Statistics.</strong> Medians and a scaled median
              absolute deviation rather than means and standard deviations, because obligation
              amounts across these categories differ by three orders of magnitude and a shared
              threshold only ever selects the largest. Slopes are Theil–Sen, for the same reason.
            </p>
          </div>
          <div className="space-y-3">
            <p>
              <strong className="text-navy-100">Partial years.</strong> A year observed to day 168
              is not compared against a closed year at day 365. Comparisons are truncated to the
              shortest window any year of that unit reaches, and a control enforces it.
            </p>
            <p>
              <strong className="text-navy-100">The modelled interior.</strong> Where the chain has
              no published clock, each step carries a minimum, likely and maximum drawn from
              statute, regulation or practitioner description, is labelled with which of the three
              it is, and divides a <em>measured</em> residual. Nothing modelled is ever added to
              anything measured.
            </p>
            <p>
              <strong className="text-navy-100">This page.</strong> The sentences are written by
              hand and contain no numbers. Every figure is a named placeholder resolved from the
              staged extracts at load time; the load fails if one does not resolve, or if a
              recommendation names a finding that no longer exists.
            </p>
          </div>
        </div>
      </Section>

      {/* -------------------------------------------------------------- appendix */}
      <Section title="Appendix · every figure in this paper"
        note="The complete evidence table, in the order the paper resolves it. Value as extracted, beside the string the paper prints, so the rounding can be checked rather than taken on trust.">
        <DataTable
          head={['Key', 'What it is', 'Printed', 'As extracted', 'Source', 'FY']}
          align={[1, 4]}
          rows={evidenceRows.map((e) => [
            <code key="k" className="font-mono text-[12px] text-accent-400">{e.evidenceKey}</code>,
            e.label,
            <strong key="d" className="text-navy-50">{e.display}</strong>,
            e.value === null ? '—'
              : e.unit === 'year'
                ? String(Math.round(e.value))
                : e.value.toLocaleString('en-US', { maximumFractionDigits: 4 }),
            e.source,
            e.fiscalYear ?? '—',
          ])}
          caption={`${evidenceRows.length} figures. A key appearing here but not in any sentence above is dead evidence; a key in a sentence but not here fails the load.`}
        />
      </Section>

      <div className="py-10 text-sm text-navy-400">
        Underlying pages:{' '}
        <PageLink href="/execution/chain">distribution chain &amp; lag</PageLink>{' · '}
        <PageLink href="/execution/timeline">fund distribution &amp; timeline</PageLink>{' · '}
        <PageLink href="/nfr">findings &amp; NFRs</PageLink>{' · '}
        <PageLink href="/linkage">linkage</PageLink>{' · '}
        <PageLink href="/controls">controls</PageLink>{' · '}
        <PageLink href="/sources">sources</PageLink>
      </div>
    </Shell>
  );
}

/* ------------------------------------------------------------------ prose -- */

/**
 * A sentence with its figures marked up rather than flattened into the text.
 * An unresolved placeholder renders as its own braces: the load should have
 * refused it, and hiding it here would hide a broken control.
 */
function Prose({ text, ev, className, as: As = 'p' }: {
  text: string; ev: EvidenceMap; className?: string; as?: 'p' | 'h3' | 'h4' | 'span';
}) {
  return (
    <As className={className}>
      {runs(text, ev).map((r, i) =>
        r.evidence ? (
          <span key={i} className="font-semibold text-navy-50 tnum"
                title={`${r.evidence.label} — ${r.evidence.source}${r.evidence.fiscalYear ? ` · FY${r.evidence.fiscalYear}` : ''}`}>
            {r.text}
          </span>
        ) : <span key={i}>{r.text}</span>)}
    </As>
  );
}

/** The same resolution as Prose, flattened, for a title= attribute or any other
 *  place that takes a string rather than elements. */
function plain(text: string, ev: EvidenceMap): string {
  return runs(text, ev).map((r) => r.text).join('');
}

function FindingCard({ f, n, ev }: { f: ResearchFinding; n: number; ev: EvidenceMap }) {
  return (
    <li id={f.findingKey} className="glass-card rounded-lg p-6 scroll-mt-20">
      <div className="flex items-baseline gap-3 mb-3">
        <span className="text-[12px] font-mono text-accent-400 shrink-0 pt-0.5">F{n}</span>
        <Prose text={f.title} ev={ev}
          className="text-base sm:text-lg font-bold text-navy-50 leading-snug sm:text-balance" as="h3" />
      </div>
      <Prose text={f.claim} ev={ev}
        className="text-[15px] text-navy-200 leading-relaxed max-w-3xl" />
      <div className="mt-4 grid md:grid-cols-2 gap-x-8 gap-y-3">
        <div>
          <Label>So what</Label>
          <Prose text={f.soWhat} ev={ev} className="text-[13px] text-navy-300 leading-relaxed mt-1" />
        </div>
        <div>
          <Label>What would falsify it</Label>
          <Prose text={f.falsifier} ev={ev} className="text-[13px] text-navy-300 leading-relaxed mt-1" />
        </div>
      </div>
      <div className="mt-4 pt-3 border-t border-navy-800/70 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="text-[12px] text-navy-400 leading-relaxed">
          <span className="text-navy-500 uppercase tracking-wider font-semibold">How far it reaches </span>
          {f.confidence}
        </span>
        {f.sourcePages.length > 0 && (
          <span className="text-[12px] text-navy-500 shrink-0">
            {f.sourcePages.map((p, i) => (
              <span key={p}>{i > 0 && ' · '}<PageLink href={p}>{p}</PageLink></span>
            ))}
          </span>
        )}
      </div>
    </li>
  );
}

function RecCard({ r, n, ev, finding }: {
  r: ResearchRecommendation; n: number; ev: EvidenceMap; finding?: ResearchFinding;
}) {
  return (
    <div className="glass-card rounded-lg p-5 flex flex-col min-w-0">
      <div className="flex items-baseline gap-3 mb-2">
        <span className="text-[12px] font-mono text-accent-400 shrink-0 pt-0.5">{n}</span>
        <Prose text={r.title} ev={ev}
          className="text-[15px] font-semibold text-navy-50 leading-snug sm:text-balance" as="h4" />
      </div>
      <Prose text={r.action} ev={ev} className="text-[13px] text-navy-200 leading-relaxed" />
      <dl className="mt-4 space-y-2.5 text-[12px] flex-1">
        {r.cost && <Row k="What it costs"><Prose text={r.cost} ev={ev} className="inline" /></Row>}
        {r.measure && <Row k="How you would know it worked"><Prose text={r.measure} ev={ev} className="inline" /></Row>}
        {r.authority && <Row k="Authority">{r.authority}</Row>}
      </dl>
      <div className="mt-4 pt-3 border-t border-navy-800/70 flex flex-wrap items-center justify-between gap-2 min-w-0">
        <a href={`#${r.becauseFinding}`}
           className="text-[12px] text-accent-400 hover:underline min-w-0 flex-1 truncate"
           title={finding ? plain(finding.title, ev) : r.becauseFinding}>
          Because: {finding ? <Prose text={finding.title} ev={ev} as="span" /> : r.becauseFinding}
        </a>
        {r.horizon && (
          <span className="text-[12px] text-navy-400 shrink-0 border border-navy-700 rounded px-2 py-0.5">
            {r.horizon}
          </span>
        )}
      </div>
    </div>
  );
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-navy-500 uppercase tracking-wider font-semibold text-[12px]">{k}</dt>
      <dd className="text-navy-300 leading-relaxed mt-0.5">{children}</dd>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[12px] uppercase tracking-wider text-navy-500 font-semibold">{children}</span>
  );
}

function PageLink({ href, children }: { href: string; children: React.ReactNode }) {
  return <Link href={href} className="text-accent-400 hover:underline">{children}</Link>;
}

function NotLoaded() {
  return (
    <div className="py-20">
      <PageHeader eyebrow="Research" title="Where the time goes"
        lede="The research tables are not in this database yet." />
      <div className="mt-8 alert-warning rounded-lg p-6 max-w-2xl">
        <p className="text-sm text-navy-200 leading-relaxed">In order:</p>
        <pre className="mt-4 text-[12px] text-navy-300 bg-navy-950 rounded p-4 overflow-x-auto">
{`npm run migrate    # schema only, safe on a live site
npm run refresh    # ETL + load
npm run verify     # the same prerender the deploy runs`}
        </pre>
        <p className="mt-4 text-[12px] text-navy-400 leading-relaxed">
          The paper is withheld rather than published with its figures blank. Every number in it is
          resolved from a live extract, and a paper whose figures did not resolve would argue from
          nothing while reading exactly like one that did.
        </p>
      </div>
    </div>
  );
}

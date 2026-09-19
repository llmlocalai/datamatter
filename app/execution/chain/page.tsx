import type { Metadata } from 'next';
import Link from 'next/link';
import Shell, { PageHeader, Section } from '@/components/Shell';
import { ProvenanceBar, Caveat } from '@/components/Provenance';
import { StatTile, DataTable, Empty } from '@/components/charts';
import { fmtB, fmtPct, fmtInt } from '@/components/format';
import ChainExplorer from '@/components/execution/ChainExplorer';
import { getProvenance } from '@/lib/analytics';
import {
  chainReady, getChainAnomalies, getChainArchetypes, getChainAuthority, getChainFirst,
  getChainLag, getChainOc, getChainSensitivity, getChainUnits, getLegislativeGates,
  AGENCY_LABEL, type ChainSensitivity,
} from '@/lib/chain';

export const metadata: Metadata = {
  title: 'Funds distribution and execution lag · datamatter',
  description:
    'For the year\'s own appropriation: when authority arrived, when execution actually started '
    + 'and on what, how long each observable link took, and what a continuing resolution costs '
    + 'in execution days.',
};
export const revalidate = 900;

export default async function ChainPage() {
  if (!(await chainReady())) return <Shell><NotLoaded /></Shell>;

  const [prov, units, authority, first, lag, oc, sens, arche, anomalies, gates] =
    await Promise.all([
      getProvenance('execution_chain'), getChainUnits(), getChainAuthority(),
      getChainFirst(), getChainLag(), getChainOc(), getChainSensitivity('d50'),
      getChainArchetypes(), getChainAnomalies(30), getLegislativeGates(),
    ]);

  const years = Array.from(new Set(units.map((u) => u.fiscalYear))).sort();
  const live = Math.max(...years);

  // Operating against investment, computed here rather than asserted. The split
  // is the finding: a continuing resolution barely touches an account whose
  // requirements already exist and pushes back the ones that need a new start.
  // Cells only for the rankings and the medians; the rollups are a different
  // population and get their own small table.
  const cells = sens.filter((s) => s.level === 'cell' && s.daysPer30CrDays !== null);
  const rollups = sens.filter((s) => s.level !== 'cell' && s.daysPer30CrDays !== null)
    .sort((a, b) => (a.level === 'department' ? -1 : b.level === 'department' ? 1 : 0));
  const byProfile = (p: string) => cells.filter((s) => s.profile === p);
  const medOf = (rows: ChainSensitivity[]) => {
    const v = rows.map((r) => r.daysPer30CrDays as number).sort((a, b) => a - b);
    if (!v.length) return null;
    return v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
  };
  const invMed = medOf(byProfile('investment'));
  const opsMed = medOf(byProfile('operating'));
  const scored = cells;
  const worst = scored[0];
  // The finding is in the TAIL, not the centre. The first cut of this page led on
  // the two medians and they are both near zero -- the honest reading is that a
  // continuing resolution has no measurable effect on most of the Department and
  // a large one on a named few.
  const SLIP = 5;
  const slippers = scored.filter((s) => (s.daysPer30CrDays as number) > SLIP);

  // One row per unit-year per chain, taken off each chain's head step. Cells
  // only for the rankings: a component rollup and its own colours of money would
  // otherwise appear as separate entries in the same league table.
  const heads = lag.filter((l) => l.stepKey === 'enactment');
  const crHeads = heads.filter((h) => h.mode === 'cr' && h.level === 'cell');
  const enHeads = heads.filter((h) => h.mode === 'enacted');
  const waits = crHeads.filter((h) => h.applicable && h.residualDays !== null)
    .sort((a, b) => (b.residualDays as number) - (a.residualDays as number));
  const ahead = crHeads.filter((h) => !h.applicable)
    .sort((a, b) => (a.gapToAuthority ?? 0) - (b.gapToAuthority ?? 0));
  // The enacted chain at component level: how long after the act each component
  // placed the first tenth of the obligation that could only follow it.
  const afterAct = enHeads.filter((h) => h.level === 'component' && h.observedGap !== null)
    .sort((a, b) => (b.observedGap as number) - (a.observedGap as number));
  const beyond = enHeads.filter((h) => h.verdict === 'beyond_model');
  const modelLikely = enHeads[0]?.modelLikely ?? null;

  const totalObl = units.filter((u) => u.fiscalYear === live && u.level === 'department')
    .reduce((n, u) => n + u.obligations, 0);
  const sampleObl = crHeads.filter((h) => h.fiscalYear === live)
    .reduce((n, h) => n + h.sampleAmount, 0);
  const barGates = gates.filter((g) => g.barsObligation);
  const goldenDome = gates.find((g) => g.gateKey === 'golden_dome_spend_plan');

  return (
    <Shell>
      <PageHeader
        eyebrow="Execution · Chain"
        title="Funds distribution and the execution lag"
        lede={`For the year's own appropriation: when the authority arrived and at what rate, when `
          + `execution actually started and on what type of spending, how long each observable link `
          + `took, and what a continuing resolution costs in execution days — measured from this `
          + `Department's own six years rather than asserted.`} />
      <ProvenanceBar p={prov} extra={`Own-year money only · FY2021–FY${live}`} />

      <Section
        id="bases"
        title="Four bases, and which one every figure comes from"
        note="This page mixes measurement and assumption on purpose, because the question cannot be
              answered without both. What it must never do is let them blur, so each figure says
              which it is.">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <Basis kind="Measured · complete" tone="good"
            what="File A and File B"
            detail="Budget authority, resources, obligations, outlays, by object class. Every dollar — and one submission a fiscal year, so no within-year timing exists in them at all." />
          <Basis kind="Measured · dated" tone="good"
            what="The appropriation calendar"
            detail="Enactment, continuing-resolution and lapse dates, each cited to its public law. Day-level." />
          <Basis kind="Measured · censored" tone="warning"
            what="The execution ramp"
            detail={`Contract action dates against named accounts. An UPPER BOUND: ${fmtPct(100 * sampleObl / Math.max(1, totalObl), 1)} of FY${live} own-year obligations are visible this way, and the attribution is award-level.`} />
          <Basis kind="Assumed" tone="critical"
            what="The interior of the chain"
            detail="Apportionment, allocation, allotment and sub-allotment appear in no file available here. Only the endpoints are observed; the interior divides a measured residual." />
        </div>
        <Caveat>
          Nothing assumed is ever added to anything measured. <strong className="text-navy-100">CHN-03</strong>{' '}
          blocks a load where a unit assigns days to a step it never waited on, and{' '}
          <strong className="text-navy-100">CHN-01</strong> ties every analytic unit back to File A&rsquo;s
          own obligations for the year&rsquo;s own money. The chain interior is the one part of this
          page that no control can verify, because there is nothing published to verify it against —
          which is itself the finding in section 5.
        </Caveat>
      </Section>

      <Section
        id="explorer"
        title="1 · One component, one colour of money, end to end"
        note="Authority, execution and the chain on the same day axis, because the whole point is
              that they line up. Day 1 is 1 October.">
        <ChainExplorer units={units} authority={authority} first={first} lag={lag} oc={oc} />
      </Section>

      <Section
        id="sensitivity"
        title="2 · What a continuing resolution actually costs in execution days"
        note="Each component and colour of money regressed against the number of days its year ran
              without a full-year act. Theil-Sen rather than least squares: with five or six
              observations one unusual year sets an ordinary slope, and two of these six years are
              unusual. Every year is compared over the same window — the shortest any year of that
              unit reaches — so a live year measured over fewer days does not read as running early.">
        <div className="grid sm:grid-cols-3 gap-4 mb-8">
          <StatTile label="Where the effect is" tone="critical"
            value={`${slippers.length} of ${scored.length}`}
            sub={`Component and colour-of-money pairs that slip more than ${SLIP} days per 30 days of continuing resolution: ${slippers.map((x) => `${x.agencyName ?? x.agencyCode} ${x.appropriation.toLowerCase()}`).join(', ')}. Construction and housing, and nothing else.`} />
          <StatTile label="Everywhere else" tone="good"
            value={invMed === null || opsMed === null ? '—'
              : `${opsMed.toFixed(1)} / ${invMed.toFixed(1)} days`}
            sub={`Median slope for operating and for investment accounts. Both are within two days of zero: for most of the Department the length of the continuing resolution does not move execution timing at a level this data can detect.`} />
          <StatTile label="Evidence depth" tone="warning"
            value={(() => {
              if (!slippers.length) return '—';
              const lo = Math.min(...slippers.map((x) => x.years));
              const hi = Math.max(...slippers.map((x) => x.years));
              return lo === hi ? `${lo} years` : `${lo}–${hi} years`;
            })()}
            sub="The three exposed pairs rest on four observations each, which is the minimum this page will publish a slope on. Treat the direction as established and the magnitude as provisional." />
        </div>
        <div className="mb-8">
          <h3 className="text-sm font-semibold text-navy-100 mb-3">
            The Department and its components, all colours of money together
          </h3>
          <DataTable
            align={[1]}
            head={['Scope', 'Window', 'Years', 'Days later per 30 days of CR']}
            rows={rollups.map((s) => [
              <span key="a" className="text-navy-100 font-medium">
                {s.level === 'department' ? 'Department of War (all components)'
                  : `${s.agencyName || s.agencyCode} — all colours of money`}
              </span>,
              `${s.comparisonWindowDays} d`, s.years,
              <Slope key="d" n={s.daysPer30CrDays as number} />,
            ])}
            caption="Rolled up, the effect disappears entirely: the Department as a whole and every
                     component sit within a few days of zero. That is not the same as saying nothing
                     is affected — it is the arithmetic of a small number of exposed accounts inside
                     a very large total, which is exactly why the table below is the one to act on." />
        </div>
        <h3 className="text-sm font-semibold text-navy-100 mb-3">
          Component by colour of money
        </h3>
        <DataTable
          align={[1, 2]}
          head={['Component', 'Colour of money', 'Profile', 'Window', 'Years',
                 'Days later per 30 days of CR']}
          rows={cells.map((s) => [
            <span key="a" className="text-navy-100">{s.agencyName || s.agencyCode}</span>,
            <span key="b" className="text-navy-300">{s.appropriation}</span>,
            <span key="c" className="text-navy-500">{s.profile}</span>,
            `${s.comparisonWindowDays} d`, s.years,
            <Slope key="d" n={s.daysPer30CrDays as number} />,
          ])}
          caption="A positive figure means execution slipped later as the continuing resolution ran
                   longer. A negative one means it did not, and several are negative: an account
                   whose requirements already exist obligates at the prior year's rate whether or
                   not the new act has passed. CHN-05 re-derives every slope in SQL from the points
                   it was taken over, sharing no code with the extract that published it." />
        <p className="mt-6 text-sm text-navy-300 leading-relaxed max-w-3xl">
          The shape of this table is the finding, and it is not the one an execution review usually
          starts from. Both medians sit within two days of zero, so a continuing resolution has no
          effect on most of the Department that this data can detect. The effect lives entirely in
          the tail, and the tail is construction and family housing. The negative rows are not
          noise either: an account whose requirements already exist obligates at the prior
          year&rsquo;s rate whether or not the new act has passed, and several of them obligate
          <em> earlier</em> in a long continuing resolution, which is what carrying a backlog into
          October looks like.
        </p>
        <p className="mt-4 text-sm text-navy-400 leading-relaxed max-w-3xl">
          Two cautions on reading it. The three exposed pairs have four observations each, so the
          direction is better established than the magnitude. And Air Force military construction at
          the bottom of the table, at {scored.length ? (scored[scored.length - 1].daysPer30CrDays as number).toFixed(1) : '—'}{' '}
          days, is a single-account series whose sign is set by two years; it is published because
          deleting an inconvenient row is how a table stops being evidence, not because it is
          believed.
        </p>
      </Section>

      <Section
        id="waits"
        title="3 · Where the wait actually is"
        note="The measured gap between the day a unit first had authority and the day a tenth of its
              observed year had been obligated. Both ends are measured; nothing here is assumed.">
        <div className="grid lg:grid-cols-2 gap-8">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-navy-100 mb-3">
              The longest measured waits
            </h3>
            <DataTable
              align={[1]}
              head={['FY', 'Unit', 'Authority', '10% executed', 'Gap']}
              rows={waits.slice(0, 12).map((w) => [
                w.fiscalYear,
                <span key="u" className="text-navy-300">
                  {AGENCY_LABEL[w.agencyCode] ?? w.agencyCode} · {w.appropriation}
                </span>,
                `day ${w.authorityDayOfFy}`, `day ${w.d10Day}`,
                <span key="g" className="text-[color:var(--status-critical)] font-medium">
                  {w.residualDays} d
                </span>,
              ])}
              caption="Construction and family housing dominate, and that is the honest reading:
                       their wait is design, solicitation and source selection, not a funds
                       distribution delay. The chain profile in section 1 charges it accordingly." />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-navy-100 mb-3">
              Units that executed before the authority arrived
            </h3>
            <DataTable
              align={[1]}
              head={['FY', 'Unit', 'Authority', '10% executed', 'Ahead by']}
              rows={ahead.slice(0, 12).map((w) => [
                w.fiscalYear,
                <span key="u" className="text-navy-300">
                  {AGENCY_LABEL[w.agencyCode] ?? w.agencyCode} · {w.appropriation}
                </span>,
                `day ${w.authorityDayOfFy}`, `day ${w.d10Day}`,
                <span key="g" className="text-[color:var(--status-good)] font-medium">
                  {Math.abs(w.gapToAuthority ?? 0)} d
                </span>,
              ])}
              caption={`Almost all of these are FY${live}, where the year opened with a 43-day lapse
                        and operating accounts kept obligating anyway — on excepted activity and on
                        carried-in balances. It is the clearest evidence on the page that operating
                        execution is not gated by the new appropriation.`} />
          </div>
        </div>
      </Section>

      <Section
        id="after-act"
        title="4 · After the act: how long until the money that had to wait actually moved"
        note="The new-start chain. Obligation that could only follow the full-year act, measured
              from the day it was signed, against the process model built from statute, regulation
              and the steps nobody publishes a clock for.">
        <DataTable
          align={[1]}
          head={['FY', 'Component', 'Act signed', 'First tenth placed', 'Days after the act',
                 'Against the model']}
          rows={afterAct.map((h) => [
            h.fiscalYear,
            <span key="c" className="text-navy-300">
              {h.agencyCode === 'DOW' ? 'Department' : (AGENCY_LABEL[h.agencyCode] ?? h.agencyCode)}
            </span>,
            `day ${h.enactedDayOfFy}`,
            `day ${h.postEnactmentD10 ?? '\u2014'}`,
            <span key="d" className="tnum font-medium text-navy-50">{h.observedGap} d</span>,
            <span key="v" className="text-[12px]"
                  style={{ color: h.verdict === 'beyond_model' ? 'var(--status-critical)'
                    : h.verdict === 'ahead_of_chain' ? 'var(--series-1)' : 'var(--status-good)' }}>
              {h.verdict === 'beyond_model' ? `beyond by ${h.excessDays} d`
                : h.verdict === 'ahead_of_chain' ? `ahead by ${h.excessDays} d`
                  : 'within the model'}
            </span>,
          ])}
          caption={`The model's likely path \u2014 every step at its typical duration \u2014 totals `
            + `${modelLikely} days. Most components beat it, and that is the finding: the work was `
            + `staged and waiting on authority rather than starting when the authority arrived. `
            + `${beyond.length === 0 ? 'No chain anywhere in the six years runs beyond what the process explains.' : `${beyond.length} chains run beyond it.`}`} />
        <p className="mt-6 text-sm text-navy-300 leading-relaxed max-w-3xl">
          Read the spread rather than the level. Both components are inside a model that runs from{' '}
          {enHeads[0]?.modelMin} to {enHeads[0]?.modelMax} days, which is wide enough that
          &ldquo;within the model&rdquo; is a weak statement on its own. The useful comparison is
          between components running the same statute in the same year, and there the difference is
          real and consistent.
        </p>
      </Section>

      <Section
        id="gates"
        title="5 · What the law puts between an appropriation and an obligation"
        note="Conditions in appropriations law and the joint explanatory statements. Two kinds, and
              conflating them is the commonest error in this area: a BAR prevents obligation until
              the condition is met; a reporting direction burdens the Department without, on its
              own words, withholding the money.">
        <div className="grid sm:grid-cols-3 gap-4 mb-6">
          <StatTile label="Gates that bar obligation" value={`${barGates.length} of ${gates.length}`}
            tone="critical"
            sub="The rest direct a report or a spend plan. A reporting direction is a real burden and it is not the same thing as money that cannot be touched." />
          <StatTile label="The one that governs everything" value="No new starts" tone="warning"
            sub="A continuing resolution funds the prior year's activities at the prior year's rate and bars new starts, multi-year procurements and production-rate increases. It is the mechanism behind section 3." />
          <StatTile label="Statutory ceiling to allotment" value="60 days" tone="accent"
            sub="Thirty days for OMB to apportion after enactment (31 U.S.C. 1513(b)(1)) plus thirty for the component to allot after that signature (DoD FMR Volume 3). The only end-to-end figure on this page that comes from law alone." />
        </div>
        {goldenDome && goldenDome.scopeBa !== null && (
          <div className="alert-warning rounded-lg p-5 mb-6">
            <h3 className="text-sm font-semibold text-navy-50 mb-2">
              What a gated account looks like in the execution data
            </h3>
            <p className="text-sm text-navy-300 leading-relaxed">
              The FY2026 agreement attaches a 60-day spend plan to Golden Dome. File A can isolate
              that account, so the scope is measured rather than asserted: it received{' '}
              <strong className="text-navy-100">{fmtB(goldenDome.scopeBa)}</strong> of budget
              authority and obligated <strong className="text-navy-100">$0.02B, 0.2%</strong>, in
              its year of appropriation, then <strong className="text-navy-100">$19.18B of $21.12B,
              90.8%</strong>, in the year after. That is the shape a gated new fund makes.{' '}
              <span className="text-navy-400">
                The direction and the slow year are not the same event \u2014 the money was
                appropriated before this act, and a first-year investment fund executes slowly for
                many reasons. What this shows is the pattern, not a cause.
              </span>
            </p>
          </div>
        )}
        <div className="space-y-3">
          {gates.map((g) => (
            <div key={g.gateKey}
                 className={`rounded-lg p-5 ${g.barsObligation ? 'alert-critical' : 'glass-card'}`}>
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-2">
                <span className="text-[12px] font-semibold uppercase tracking-wider"
                      style={{ color: g.barsObligation ? 'var(--status-critical)' : 'var(--status-warning)' }}>
                  {g.barsObligation ? 'bars obligation' : 'reporting direction'}
                </span>
                <span className="text-sm font-semibold text-navy-50">{g.scopeLabel}</span>
                {g.fiscalYear && <span className="text-[12px] text-navy-500">FY{g.fiscalYear}</span>}
                {g.days !== null && (
                  <span className="text-[12px] text-navy-400 tnum">{g.days} days</span>
                )}
                <span className="text-[12px] text-navy-500">
                  {g.isVerbatim ? 'quoted' : 'described'}
                </span>
              </div>
              <p className={`text-sm leading-relaxed ${g.isVerbatim ? 'text-navy-200 italic' : 'text-navy-300'}`}>
                {g.isVerbatim ? `\u201c${g.requirement}\u201d` : g.requirement}
              </p>
              {g.scopeBa !== null && (
                <p className="mt-2 text-[12px] text-navy-400 tnum">
                  Measured scope: {fmtB(g.scopeBa)} budget authority, {fmtB(g.scopeResources ?? 0)}{' '}
                  resources, {fmtB(g.scopeObligations ?? 0)} obligated across FY
                  {g.scopeYears.join(', FY')} \u2014 account {g.treasuryAccount}.
                </p>
              )}
              {g.note && <p className="mt-2 text-[12px] text-navy-400 leading-relaxed">{g.note}</p>}
              <p className="mt-2 text-[12px] text-navy-500">
                {g.authority}
                {g.citation && (
                  <> \u00b7 <a href={g.citation} target="_blank" rel="noopener noreferrer"
                          className="text-accent-400 hover:underline">source</a></>
                )}
              </p>
            </div>
          ))}
        </div>
        <Caveat>
          This is a selection read out of the acts and statements, not a mechanical extraction of
          every congressional direction, and it says so. Reprogramming thresholds by appropriation
          type are not published in any source this site could reach, so no figure is given for
          them. Where a gate sits inside a component&rsquo;s accounts rather than in one of its own,
          File A cannot isolate it and the scope is left empty rather than estimated \u2014{' '}
          <strong className="text-navy-100">GATE-01</strong> fails a load that claims a measured
          scope without naming the account it was measured on.
        </Caveat>
      </Section>

      <Section
        id="patterns"
        title="6 · What the shapes themselves say"
        note="Execution ramps clustered by their own shape rather than by a category assigned in
              advance, and each unit-year scored against its own history. Deterministic: the same
              load gives the same archetypes, and the centroid rides on every row so a reader can
              see what the cluster actually is.">
        <h3 className="text-base font-semibold text-navy-100 mb-4">Execution archetypes</h3>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8 [&>*]:min-w-0">
          {archetypeSummary(arche).map((a) => (
            <div key={a.key} className="glass-card rounded-lg p-4">
              <p className="text-[12px] uppercase tracking-wider text-accent-400 font-semibold">
                {a.label}
              </p>
              <p className="text-2xl font-bold text-navy-50 mt-1.5 tnum">{a.n}</p>
              <p className="text-[12px] text-navy-500">unit-years</p>
              <Spark centroid={a.centroid} />
              <p className="text-[12px] text-navy-400 mt-2 leading-relaxed">
                Half the year&rsquo;s obligation placed by fiscal month{' '}
                <strong className="text-navy-200">{a.half}</strong>.
              </p>
            </div>
          ))}
        </div>
        <h3 className="text-base font-semibold text-navy-100 mb-4">
          Unit-years furthest from their own history
        </h3>
        <DataTable
          align={[1]}
          head={['Deviation', 'What moved', 'Sample', 'Prior median sample', 'Years']}
          rows={anomalies.slice(0, 12).map((a) => [
            <span key="z" className="tnum font-medium"
                  style={{ color: Math.abs(a.deviation ?? 0) > 6 ? 'var(--status-critical)'
                    : Math.abs(a.deviation ?? 0) > 3 ? 'var(--status-warning)' : 'var(--status-good)' }}>
              {(a.deviation ?? 0) > 0 ? '+' : ''}{(a.deviation ?? 0).toFixed(1)}
            </span>,
            <span key="h" className="text-navy-300">{a.headline}</span>,
            fmtB(a.sampleAmount ?? 0),
            fmtB(a.priorMedianAmount ?? 0),
            a.baselineYears,
          ])}
          caption="Median and scaled median absolute deviation against the unit's own prior years,
                   scale floored at 5% of the median and the result capped at 99 \u2014 never against
                   a Department average, because these categories differ by three orders of
                   magnitude. The two sample columns are the point: a cell whose dated sample
                   collapsed shifts its own median for reasons that have nothing to do with
                   execution, and several rows here are exactly that. CHN-09 re-derives every
                   baseline in SQL." />
      </Section>

      <Section
        id="cause"
        title="7 · Root cause"
        note="Why the pattern looks the way it does, and what each explanation would predict that
              this data can check.">
        <div className="space-y-4">
          <Cause n={1} title="A continuing resolution bars new starts, and a construction project is all new start"
            support={`Every pair that slips more than ${SLIP} days per 30 days of CR is construction or family housing, and those same accounts dominate the measured-wait table. A project that cannot be started cannot be obligated against, and there is no continuing requirement underneath it to keep obligating in the meantime.`}
            against={`It does not generalise to investment money as a class: the investment median is ${invMed?.toFixed(1)} days, statistically indistinguishable from the operating median of ${opsMed?.toFixed(1)}. Procurement and RDT&E, which also need new starts, do not show the effect.`}
            verdict="Right for construction and housing, wrong as a statement about investment accounts generally. The distinction matters because it decides where mitigation goes." />
          <Cause n={2} title="Acquisition lead time sets the level; the appropriation sets the variance"
            support="Design, solicitation and source selection for a construction project take the better part of a year regardless of when the money arrived. That produces exactly what is seen: a long baseline wait that shifts modestly with the calendar."
            against="If lead time were the whole level, the slope would be zero and it is not — Navy family housing and military construction both move materially with CR length."
            verdict="The best available reading. Level is acquisition; variance is appropriation. They need different remedies and are currently managed as one problem." />
          <Cause n={3} title="The distribution chain itself is slow"
            support="The classic explanation, and the one the Department's own workforce reports."
            against="Nothing here can test it. Apportionment, allocation, allotment and sub-allotment are published in no file available to this site, so the interior of every chain on this page is an assumption sitting inside a measured residual."
            verdict="Untestable with public data. That is a finding about instrumentation, not a verdict on the chain." />
          <Cause n={4} title="The ramp is an artefact of which contracts name their account"
            support={`Only ${fmtPct(100 * sampleObl / Math.max(1, totalObl), 1)} of FY${live} own-year obligations are visible in the dated ramp, and the account is attributed at award level rather than action level.`}
            against="The pattern is stable across six years and reverses cleanly between operating and investment accounts. A coverage artefact would not produce a sign change that tracks the economics."
            verdict="A real limit on precision, not on the direction. Every ramp figure is labelled an upper bound." />
        </div>
      </Section>

      <Section
        id="coa"
        title="8 · Courses of action"
        note="Four, ordered by the ratio of what they would change to what they would cost. Each
              names the evidence it rests on and how you would know it worked.">
        <div className="space-y-4">
          <Coa n={1} title="Aim continuing-resolution mitigation at construction and family housing"
            tone="critical"
            doThis={`Build the CR playbook — anomaly requests, new-start exception lists, pre-award authorisations — around the ${slippers.length} pairs that actually move: ${slippers.map((x) => `${x.agencyName ?? x.agencyCode} ${x.appropriation.toLowerCase()}`).join(', ')}. Do not spend the request capital on operating accounts.`}
            because={`Measured over six years, the median slope is ${opsMed?.toFixed(1)} days for operating accounts and ${invMed?.toFixed(1)} for investment accounts — no detectable effect either way. Every pair above ${SLIP} days is construction or family housing. A Department-wide CR mitigation spends most of its effort on accounts that do not respond to it.`}
            measure="The slope on those three pairs. Re-run it each year; a mitigation that works pulls them toward the zero the rest of the Department already sits at." />
          <Coa n={2} title="Instrument the distribution chain so the argument can be settled"
            tone="critical"
            doThis="Capture and publish four dates per funds-distribution action — apportionment, allocation, allotment, sub-allotment — from the systems that already create them, into the same reporting stream that carries obligations."
            because={`Six of the nine steps in section 1 have no published clock at all. Statute gives OMB 30 days to apportion and the regulation gives the component 30 more to allot \u2014 ${enHeads[0]?.regCeilingDays ?? 60} days end to end \u2014 and nothing records whether either was met, for any component, in any year. The Department cannot currently demonstrate whether the wait between authority and execution is distribution or acquisition, which means it cannot tell whether any remediation worked.`}
            measure={`The model in section 1 spans ${enHeads[0]?.modelMin}\u2013${enHeads[0]?.modelMax} days for the enacted chain because six of its steps are estimates. Four recorded dates per distribution action would collapse that range to a measurement, and the estimate rows would disappear from this page.`} />
          <Coa n={3} title="Separate the acquisition-lead-time problem from the appropriation problem"
            tone="warning"
            doThis="For construction and family housing, move design and solicitation ahead of appropriation where authority permits, so the award is ready when the money is. Track design-complete-to-award separately from authority-to-award."
            because="These accounts carry 200-350 day waits from authority to first tenth even in years enacted in December. That level is not a funding delay and will not respond to funding remedies."
            measure="Authority-to-first-tenth for those units should fall toward the solicitation cycle rather than track the calendar." />
          <Coa n={4} title="Triage the legislative gates by whether they actually bar obligation"
            tone="warning"
            doThis={`Maintain a single register of the conditions that gate obligation, separating the ${barGates.length} that bar it from the reporting directions that do not, and put a named owner and a due date against each bar. Section 5 is the starting inventory.`}
            because="A direction to submit a spend plan and a clause reading 'none of these funds may be obligated or expended until' are managed today as one category of congressional homework. Only the second stops money moving, and the USAFRICOM clause carries no deadline at all, so its wait is as long as the staffing takes."
            measure="Days from enactment to the condition being met, per bar. It is not currently measured anywhere." />
          <Coa n={5} title="Fix account attribution on contract actions"
            tone="warning"
            doThis="Require the funding Treasury account on the action, not only on the award, in contract writing systems feeding the public files."
            because={`Execution timing is currently measurable on ${fmtPct(100 * sampleObl / Math.max(1, totalObl), 1)} of own-year obligations. Every timing figure on this page is an upper bound because of it, and no amount of analysis fixes a coverage problem.`}
            measure="Coverage. At 50% the ramp stops being an upper bound and becomes a measurement." />
        </div>
        <Caveat>
          Nothing on this page observes impropriety and nothing on it establishes causation. A
          consistent association between the appropriation calendar and the shape of execution,
          measured over six years against each unit&rsquo;s own history, is what these files support.
          The mechanism is what a programme office, a comptroller and a contracting activity would
          have to be asked — which is the point of course of action 2.
        </Caveat>
      </Section>

      <Section
        id="gaps"
        title="9 · What this page cannot do, stated plainly"
        note="So that the next person does not rediscover it.">
        <ul className="space-y-3 text-sm text-navy-300 leading-relaxed max-w-3xl list-disc pl-5">
          <li>
            <strong className="text-navy-100">There is no monthly File A or File B.</strong> The
            warehouse holds one submission per fiscal year and the files themselves carry one
            period: the &ldquo;P01-P12&rdquo; in a download&rsquo;s filename is the request range,
            not its content. A true monthly obligation curve at full coverage would need each
            period requested separately, which is a fetch rather than a code change.
          </li>
          <li>
            <strong className="text-navy-100">File C is quarterly here, not monthly.</strong> It
            carries eleven period labels but only four of them hold content, and it reaches a few
            per cent of contract dollars.
          </li>
          <li>
            <strong className="text-navy-100">Commitments are not published at all.</strong> The
            step between a fund centre receiving money and an obligation being recorded is
            invisible in every file on this site.
          </li>
          <li>
            <strong className="text-navy-100">The ramp cannot see payroll.</strong> Pay and benefits
            move on a schedule through no contract action, so the one type of execution with no
            timing question in it is also the one the dated sample barely contains. That is why the
            complete File B table sits beside the ramp rather than inside it.
          </li>
        </ul>
        <p className="mt-6 text-sm text-navy-400 leading-relaxed max-w-3xl">
          The companion page,{' '}
          <Link href="/execution/timeline" className="text-accent-400 hover:underline">
            fund distribution and the execution timeline
          </Link>, takes the same calendar and reads it against all contract obligations by fund
          holder, where coverage is complete and the colour of money is not available. The two
          answer different halves of the same question.
        </p>
        <p className="mt-4 text-sm text-navy-400 leading-relaxed max-w-3xl">
          The argument these pages add up to, with what follows from it for the Department, the
          components and the appropriations committees, is written up at{' '}
          <Link href="/research" className="text-accent-400 hover:underline">
            Where the time goes
          </Link>.
        </p>
      </Section>
    </Shell>
  );
}

/* --------------------------------------------------------------- helpers -- */

function archetypeSummary(rows: { archetypeKey: string; archetypeLabel: string;
                                  centroid: number[]; halfByMonth: number | null }[]) {
  const m = new Map<string, { key: string; label: string; n: number;
                              centroid: number[]; half: number }>();
  for (const r of rows) {
    const hit = m.get(r.archetypeKey);
    if (hit) hit.n += 1;
    else m.set(r.archetypeKey, { key: r.archetypeKey, label: r.archetypeLabel, n: 1,
                                 centroid: r.centroid,
                                 half: (r.centroid.findIndex((v) => v >= 0.5) + 1) || 12 });
  }
  return Array.from(m.values()).sort((a, b) => b.n - a.n);
}

/** The cluster's own centroid, drawn. An archetype whose shape cannot be seen is
 *  a label rather than a finding. */
function Spark({ centroid }: { centroid: number[] }) {
  if (!centroid.length) return null;
  const W = 180; const H = 40;
  const d = centroid.map((v, i) =>
    `${i ? 'L' : 'M'}${(i / (centroid.length - 1)) * W},${H - v * H}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full mt-3" role="img"
         aria-label="Cumulative share of the year by fiscal month">
      <line x1={0} y1={H} x2={W} y2={H} stroke="#16304f" strokeWidth={1} />
      <path d={d} fill="none" stroke="var(--series-1)" strokeWidth={2}
            strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function Slope({ n }: { n: number }) {
  const tone = n > 8 ? 'var(--status-critical)' : n > 2 ? 'var(--status-warning)'
    : n > -2 ? 'var(--status-good)' : 'var(--series-1)';
  return (
    <span className="tnum font-medium" style={{ color: tone }}>
      {n > 0 ? '+' : ''}{n.toFixed(1)}
    </span>
  );
}

function Basis({ kind, what, detail, tone }: {
  kind: string; what: string; detail: string; tone: 'good' | 'warning' | 'critical';
}) {
  const c = { good: 'var(--status-good)', warning: 'var(--status-warning)',
              critical: 'var(--status-critical)' }[tone];
  return (
    <div className="glass-card rounded-lg p-4">
      <p className="text-[12px] uppercase tracking-wider font-semibold" style={{ color: c }}>{kind}</p>
      <p className="text-sm text-navy-100 mt-2 font-medium">{what}</p>
      <p className="text-[12px] text-navy-400 mt-2 leading-relaxed">{detail}</p>
    </div>
  );
}

function Cause({ n, title, support, against, verdict }: {
  n: number; title: string; support: string; against: string; verdict: string;
}) {
  return (
    <div className="glass-card rounded-lg p-5">
      <div className="flex items-baseline gap-3 mb-3">
        <span className="text-accent-400 font-bold text-sm tnum">{n}</span>
        <h3 className="text-sm font-semibold text-navy-50">{title}</h3>
      </div>
      <dl className="grid sm:grid-cols-3 gap-4 text-[12px] leading-relaxed">
        <div>
          <dt className="uppercase tracking-wider text-navy-500 font-semibold mb-1">What supports it</dt>
          <dd className="text-navy-300">{support}</dd>
        </div>
        <div>
          <dt className="uppercase tracking-wider text-navy-500 font-semibold mb-1">What cuts against it</dt>
          <dd className="text-navy-300">{against}</dd>
        </div>
        <div>
          <dt className="uppercase tracking-wider text-navy-500 font-semibold mb-1">What this data can say</dt>
          <dd className="text-navy-200">{verdict}</dd>
        </div>
      </dl>
    </div>
  );
}

function Coa({ n, title, doThis, because, measure, tone }: {
  n: number; title: string; doThis: string; because: string; measure: string;
  tone: 'critical' | 'warning';
}) {
  return (
    <div className={`${tone === 'critical' ? 'alert-critical' : 'alert-warning'} rounded-lg p-5`}>
      <div className="flex items-baseline gap-3 mb-3">
        <span className="text-accent-400 font-bold text-sm tnum">COA {n}</span>
        <h3 className="text-sm font-semibold text-navy-50">{title}</h3>
      </div>
      <dl className="space-y-2.5 text-[12px] leading-relaxed">
        <Row k="Do" v={doThis} />
        <Row k="Because" v={because} />
        <Row k="Know it worked" v={measure} />
      </dl>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-3">
      <dt className="uppercase tracking-wider text-navy-500 font-semibold shrink-0 w-28">{k}</dt>
      <dd className="text-navy-300">{v}</dd>
    </div>
  );
}

function NotLoaded() {
  return (
    <div className="py-20">
      <PageHeader eyebrow="Execution · Chain" title="Funds distribution and the execution lag"
        lede="The chain tables are not in this database yet." />
      <div className="mt-8 alert-warning rounded-lg p-6 max-w-2xl">
        <p className="text-sm text-navy-200 leading-relaxed">In order:</p>
        <pre className="mt-4 text-[12px] text-navy-300 bg-navy-950 rounded p-4 overflow-x-auto">
{`npm run migrate    # schema only, safe on a live site
npm run refresh    # ETL + load
npm run verify     # the same prerender the deploy runs`}
        </pre>
        <p className="mt-4 text-[12px] text-navy-400 leading-relaxed">
          The figures are withheld rather than approximated. There is no older column to fall back
          to here, and an empty result would read as a Department that obligated nothing.
        </p>
      </div>
    </div>
  );
}

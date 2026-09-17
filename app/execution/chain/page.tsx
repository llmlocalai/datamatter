import type { Metadata } from 'next';
import Link from 'next/link';
import Shell, { PageHeader, Section } from '@/components/Shell';
import { ProvenanceBar, Caveat } from '@/components/Provenance';
import { StatTile, DataTable, Empty } from '@/components/charts';
import { fmtB, fmtPct, fmtInt } from '@/components/format';
import ChainExplorer from '@/components/execution/ChainExplorer';
import { getProvenance } from '@/lib/analytics';
import {
  chainReady, getChainAuthority, getChainFirst, getChainLag, getChainOc,
  getChainSensitivity, getChainUnits, AGENCY_LABEL,
  type ChainLag, type ChainSensitivity,
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

  const [prov, units, authority, first, lag, oc, sens] = await Promise.all([
    getProvenance('execution_chain'), getChainUnits(), getChainAuthority(),
    getChainFirst(), getChainLag(), getChainOc(), getChainSensitivity('d50'),
  ]);

  const years = Array.from(new Set(units.map((u) => u.fiscalYear))).sort();
  const live = Math.max(...years);

  // Operating against investment, computed here rather than asserted. The split
  // is the finding: a continuing resolution barely touches an account whose
  // requirements already exist and pushes back the ones that need a new start.
  const byProfile = (p: string) => sens.filter((s) => s.profile === p && s.daysPer30CrDays !== null);
  const medOf = (rows: ChainSensitivity[]) => {
    const v = rows.map((r) => r.daysPer30CrDays as number).sort((a, b) => a - b);
    if (!v.length) return null;
    return v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
  };
  const invMed = medOf(byProfile('investment'));
  const opsMed = medOf(byProfile('operating'));
  const scored = sens.filter((s) => s.daysPer30CrDays !== null);
  const worst = scored[0];
  // The finding is in the TAIL, not the centre. The first cut of this page led on
  // the two medians and they are both near zero -- the honest reading is that a
  // continuing resolution has no measurable effect on most of the Department and
  // a large one on a named few.
  const SLIP = 5;
  const slippers = scored.filter((s) => (s.daysPer30CrDays as number) > SLIP);

  // The measured wait, one row per unit-year, taken off the chain's head step.
  const heads = lag.filter((l) => l.stepKey === 'enactment');
  const waits = heads.filter((h) => h.applicable && h.residualDays !== null)
    .sort((a, b) => (b.residualDays as number) - (a.residualDays as number));
  const ahead = heads.filter((h) => !h.applicable)
    .sort((a, b) => (a.gapToAuthority ?? 0) - (b.gapToAuthority ?? 0));

  const totalObl = units.filter((u) => u.fiscalYear === live)
    .reduce((n, u) => n + u.obligations, 0);
  const sampleObl = heads.filter((h) => h.fiscalYear === live)
    .reduce((n, h) => n + h.sampleAmount, 0);

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
        <DataTable
          align={[1, 2]}
          head={['Component', 'Colour of money', 'Profile', 'Window', 'Years',
                 'Days later per 30 days of CR']}
          rows={sens.filter((s) => s.daysPer30CrDays !== null).map((s) => [
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
        id="cause"
        title="4 · Root cause"
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
        title="5 · Courses of action"
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
            because="The interior of every chain on this page is an assumption. The Department cannot currently demonstrate whether the wait between authority and execution is distribution or acquisition, which means it cannot tell whether any remediation worked. This is the single highest-value data change on the page."
            measure={`Today the assumed interior of an average applicable unit covers ${waits.length ? Math.round(waits.reduce((n, w) => n + (w.residualDays ?? 0), 0) / waits.length) : 0} days of measured residual. Instrumented, that becomes measurement and the assumption disappears.`} />
          <Coa n={3} title="Separate the acquisition-lead-time problem from the appropriation problem"
            tone="warning"
            doThis="For construction and family housing, move design and solicitation ahead of appropriation where authority permits, so the award is ready when the money is. Track design-complete-to-award separately from authority-to-award."
            because="These accounts carry 200-350 day waits from authority to first tenth even in years enacted in December. That level is not a funding delay and will not respond to funding remedies."
            measure="Authority-to-first-tenth for those units should fall toward the solicitation cycle rather than track the calendar." />
          <Coa n={4} title="Fix account attribution on contract actions"
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
        title="6 · What this page cannot do, stated plainly"
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
      </Section>
    </Shell>
  );
}

/* --------------------------------------------------------------- helpers -- */

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

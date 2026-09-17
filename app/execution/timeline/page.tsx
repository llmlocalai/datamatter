import type { Metadata } from 'next';
import Link from 'next/link';
import Shell, { PageHeader, Section } from '@/components/Shell';
import { ProvenanceBar, Caveat } from '@/components/Provenance';
import { StatTile, DataTable, BarList, Empty } from '@/components/charts';
import { fmtB, fmtPct, fmtInt } from '@/components/format';
import CalendarStrip from '@/components/execution/CalendarStrip';
import TimelineExplorer from '@/components/execution/TimelineExplorer';
import { getProvenance, getSbrSeries } from '@/lib/analytics';
import {
  getApropCalendar, getTimelineAnnual, getTimelineCoverage, getTimelineHolders,
  getTimelineModel, getTimelineMonths, getTimelineTrend, timelineReady, byYear,
  sortAppropriations, type TimelineAnnual, type TimelineHolder,
} from '@/lib/timeline';

export const metadata: Metadata = {
  title: 'Fund distribution and execution timeline · datamatter',
  description:
    'When the money moved, for which fund holder, on which colour of money, read against the '
    + 'continuing resolutions, lapses and appropriation acts of FY2021 to FY2026.',
};
export const revalidate = 900;

const MONTHS = ['Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep'];

export default async function TimelinePage() {
  if (!(await timelineReady())) return <Shell><NotLoaded /></Shell>;

  const [prov, events, months, holderMonths, holders, coverage, trend] = await Promise.all([
    getProvenance('execution_timeline'), getApropCalendar(),
    getTimelineMonths('total'), getTimelineMonths('fund_holder'),
    getTimelineHolders(), getTimelineCoverage(), getTimelineTrend(),
  ]);
  // The denominator of the current-year share, read from the Statement of
  // Budgetary Resources rather than written down here: a figure typed into page
  // code is a figure that goes stale at the next load and cannot be controlled.
  const sbr = await getSbrSeries();
  const allObligations = (fy: number) =>
    sbr.find((r) => r.fiscalYear === fy)?.obligationsIncurred ?? null;
  const years = Array.from(new Set(months.map((m) => m.fiscalYear))).sort();
  const lastClosed = Math.max(...trend.filter((t) => t.isCompleteYear).map((t) => t.fiscalYear));
  const live = Math.max(...years);
  const [annual, model] = await Promise.all([
    getTimelineAnnual(undefined, true), getTimelineModel(lastClosed),
  ]);
  const T = byYear(trend);
  const v = (fy: number, k: string) => T[fy]?.[k]?.value ?? null;

  // The pace index, which is what the page is about. Every year that received a
  // full-year act ran below its own average month before it and above it after.
  const paced = years.filter((fy) => v(fy, 'pre_enactment_pace_index') !== null);
  const preLow = Math.min(...paced.map((fy) => v(fy, 'pre_enactment_pace_index') as number));
  const preHigh = Math.max(...paced.map((fy) => v(fy, 'pre_enactment_pace_index') as number));
  const postHigh = Math.max(...paced.map((fy) => v(fy, 'post_enactment_pace_index') as number));

  // Fund-holder medians, computed here rather than stored: a median over five
  // years of a holder's own index is a reading of the table below it, and a
  // stored copy is one more figure that can go stale against it.
  const holderIndex = medianIndex(holders);
  const worst = holderIndex[0];
  const best = holderIndex[holderIndex.length - 1];
  const otherBill = Array.from(new Map(holders.filter((h) => !h.inDefenseBill)
    .map((h) => [h.dimKey, h])).values());
  const otherBillTotal = holders.filter((h) => !h.inDefenseBill)
    .reduce((n, h) => n + h.fyObligation, 0);

  const cov = (fy: number, k: string) => coverage.find((c) => c.fiscalYear === fy && c.measureKey === k);
  const sampleNow = cov(lastClosed, 'current_year');
  const sampleRange = coverage.filter((c) => c.measureKey === 'single_tas');
  const sampleLo = Math.min(...sampleRange.map((c) => c.pct));
  const sampleHi = Math.max(...sampleRange.map((c) => c.pct));

  const cyShare = (fy: number) => {
    const rows = annual.filter((a) => a.fiscalYear === fy);
    return rows.reduce((n, r) => n + r.obligations, 0);
  };

  return (
    <Shell>
      <PageHeader
        eyebrow="Execution · Timeline"
        title="Fund distribution and the execution timeline"
        lede={`When the money moved, for which fund holder, on which colour of money — read against `
          + `the continuing resolutions, lapses and appropriation acts the Department actually `
          + `operated under from FY2021 to FY${live}.`} />
      <ProvenanceBar p={prov} extra={`Calendar cited to public law · FY2021–FY${live}`} />

      {/* ------------------------------------------------- what this can see -- */}
      <Section
        id="what-this-sees"
        title="What this page can see, and what it cannot"
        note="Three populations, kept apart on purpose. Merging any two of them would produce a
              figure that belongs to no file, and the merge is tempting enough that it is worth
              saying plainly which layer every number below comes from.">
        <div className="grid sm:grid-cols-3 gap-4 mb-6">
          <Layer
            kind="Observed · dated"
            what="Every contract action, by date and by funding sub-agency"
            can="The only source here that names WHS, MDA and SOCOM. Daily resolution, six years."
            cannot={`About a third of Department obligations. Carries no colour of money on `
              + `${(100 - sampleHi).toFixed(0)}–${(100 - sampleLo).toFixed(0)}% of its dollars.`} />
          <Layer
            kind="Observed · annual"
            what="File A at account grain, by programme year and appropriation"
            can="The whole population. Every account, every colour of money, the year's own money separable from carried-in balances."
            cannot="One submission a fiscal year. There is no within-year series in it at all, and none can be built." />
          <Layer
            kind="Modelled"
            what="The annual totals spread across the months using the dated layer's shape"
            can="A monthly picture for money the contract file cannot see — payroll, transfers, working-capital orders."
            cannot="Not a measurement. Never summed into an observed total, and withheld entirely for a year in progress." />
        </div>
        <Caveat>
          The join that would collapse the first two into one does not exist at usable coverage. A
          contract action names exactly one Treasury account on{' '}
          <strong className="text-navy-100">{fmtPct(sampleLo)} to {fmtPct(sampleHi)}</strong> of its
          dollars depending on the year, and the obligation on an action is never split across the
          accounts named on it. So the dated cut by colour of money and programme year is a{' '}
          <em>sample</em> whose size moves with the year: it carries shape, never level, and it is
          never a denominator. Where this page shows it, its coverage is printed on the same row.
        </Caveat>
      </Section>

      {/* ---------------------------------------------------- the calendar -- */}
      <Section
        id="calendar"
        title="1 · The appropriation calendar"
        note="Every timing statement below is read against these dates. A lapse, a continuing
              resolution and a full-year act are three different states and the chart does not
              merge them: under a continuing resolution the Department has money at last year's
              rate and generally no new starts; under a lapse it has none at all.">
        <CalendarStrip events={events} years={years} />
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-8 mb-8">
          <StatTile label="FY2025" value="365 days"
            sub="A full-year continuing resolution. FY2025 never received a Department of Defense Appropriations Act — the only year of the six in that position."
            tone="critical" />
          <StatTile label="FY2024" value="174 days"
            sub="The longest wait for a full-year act among the years that got one. Signed 23 March 2024."
            tone="warning" />
          <StatTile label={`FY${live}`} value="45 days"
            sub="Two lapses in appropriations, 43 days from 1 October and four more at the end of January. No appropriation of any kind was in force."
            tone="critical" />
          <StatTile label="Six-year mean" value={`${Math.round(years.reduce((n, fy) => n + (T[fy]?.q1_share?.crDays ?? 0), 0) / years.length)} days`}
            sub="Average days into the fiscal year before the Department held its own full-year appropriation." />
        </div>
        <DataTable
          align={[1, 2, 3, 5]}
          head={['FY', 'Event', 'Public law', 'From', 'To', 'Days', 'Basis']}
          rows={events.map((e) => [
            e.fiscalYear,
            <span key="k" className={e.eventKind === 'shutdown' ? 'text-[color:var(--status-critical)]' : undefined}>
              {EVENT_LABEL[e.eventKind]}
            </span>,
            e.citation
              ? <a key="c" href={e.citation} target="_blank" rel="noopener noreferrer"
                   className="text-accent-400 hover:underline">{e.publicLaw ?? 'source'}</a>
              : (e.publicLaw ?? '—'),
            e.startDate, e.endDate ?? '—', e.days ?? '—',
            <span key="b" className="text-navy-500">{e.basis}</span>,
          ])}
          caption="Day counts are derived in SQL from these dates and never stored, so the arithmetic
                   on this page cannot drift away from the dates it is drawn from. CAL-01 blocks a
                   load where a year has no full-year anchor, a span ends before it starts, an
                   enactment falls outside its own fiscal year, or a lapse sits after the act." />
      </Section>

      {/* --------------------------------------------------- the curves ----- */}
      <Section
        id="curves"
        title="2 · When contract money moves"
        note={`Contract obligation through the fiscal year, one line per year, with each year's `
          + `full-year act marked on its own line. This is the dated layer: about a third of `
          + `Department obligations, and the only within-year series any source here supports.`}>
        <TimelineExplorer months={[...months, ...holderMonths]} holders={holders} events={events} />
        <Caveat>
          Months past the reporting frontier are not drawn. They are not zero, they are unreported —
          the FY{live} contract extract runs to August and is substantially complete only to April.
          Drawing the gap as zero is what ran the cumulative curve flat for three months on the page
          this one sits beside, and every pace on this page is measured to the frontier.
        </Caveat>
      </Section>

      {/* ------------------------------------------------- the pace index --- */}
      <Section
        id="pace"
        title="3 · The finding: money runs slow under a continuing resolution and fast after the act"
        note="The average observed month before the full-year appropriation act, divided by the
              year's own average observed month. One means the pre-act months ran at the year's own
              pace. A raw share of the year is not comparable between years — they differ both in
              how long the continuing resolution ran and, for the live year, in how many months are
              observed at all — so the index divides each window by its own length.">
        <div className="grid sm:grid-cols-3 gap-4 mb-8">
          <StatTile label="Before the act" value={`${preLow.toFixed(2)} – ${preHigh.toFixed(2)}`}
            sub={`Every one of the ${paced.length} years that received a full-year act ran BELOW its own average month beforehand — between ${Math.round((1 - preHigh) * 100)}% and ${Math.round((1 - preLow) * 100)}% below.`}
            tone="warning" />
          <StatTile label="After the act" value={`up to ${postHigh.toFixed(2)}`}
            sub={`And above it afterwards, in every one of those years. The catch-up is largest in FY${live}, the year with the 45-day lapse.`}
            tone="good" />
          <StatTile label="Most exposed fund holder" value={worst.key}
            sub={`Median index ${worst.median.toFixed(2)} across five years — it has never once reached its own average monthly pace before an appropriation act. ${best.key} is the least exposed at ${best.median.toFixed(2)}.`}
            tone="critical" />
        </div>
        <DataTable
          align={[7]}
          head={['FY', 'Days without a full-year act', 'Lapse days', 'Pace before',
                 'Pace after', 'Q1 share', 'September share', 'Status']}
          rows={years.map((fy) => {
            const pre = v(fy, 'pre_enactment_pace_index');
            const post = v(fy, 'post_enactment_pace_index');
            const row = T[fy]?.q1_share;
            return [
              fy, row?.crDays ?? '—', row?.lapseDays || '—',
              pre === null ? '—' : <Idx key="a" n={pre} />,
              post === null ? '—' : <Idx key="b" n={post} />,
              fmtPct(v(fy, 'q1_share') ?? 0),
              v(fy, 'sep_share') === null ? '—' : fmtPct(v(fy, 'sep_share') as number),
              <span key="s" className="text-navy-500">
                {fy === 2025 ? 'full-year CR, no act to index against'
                  : (row?.isCompleteYear ? 'complete year' : `observed to month ${row?.monthsObserved}`)}
              </span>,
            ];
          })}
          caption="TL-03 re-derives this index in SQL from the monthly rows and the calendar, sharing
                   no code with the extract that published it. FY2025 is not missing a figure: with
                   no full-year act there is no before and after to index." />
        <p className="mt-6 text-sm text-navy-300 leading-relaxed max-w-3xl">
          Note what the September column does <em>not</em> do. It rises from {fmtPct(v(2021, 'sep_share') ?? 0)}{' '}
          to {fmtPct(v(lastClosed, 'sep_share') ?? 0)} across the six years, but it does not track the
          length of the continuing resolution: FY2022 ran 165 days without an act and closed with the
          <em> lowest</em> September share of the six. Year-end concentration and continuing-resolution
          delay are two different phenomena, and reading the first as evidence of the second is the
          easiest mistake available on this data.
        </p>
      </Section>

      {/* ----------------------------------------------- by fund holder ----- */}
      <Section
        id="holders"
        title="4 · By fund holder"
        note="The funding sub-agency on the contract action — the organisation whose money it is,
              not the office that awarded it. This is the only dimension on this site that names WHS,
              MDA and SOCOM: the account chain does not decompose agency 097, and File A's owning
              agency reads 'Department of Defense' on every Department account.">
        <DataTable
          align={[]}
          head={['Fund holder', 'Six-year contract obligation', ...paced.map((fy) => `FY${fy}`), 'Median']}
          rows={holderIndex.map((h) => [
            <span key="k" className="text-navy-100 font-medium">{h.key}</span>,
            fmtB(h.total),
            ...paced.map((fy) => {
              const n = h.byYear[fy];
              return n === undefined ? '—' : <Idx key={fy} n={n} />;
            }),
            <Idx key="m" n={h.median} />,
          ])}
          caption={`Pace before the full-year appropriation act, against each holder's own average `
            + `month in the same year. Carried here when the holder is funded by the Defense `
            + `appropriations act, holds at least ${fmtB(INDEX_FLOOR)} of contract obligation across `
            + `the six years, and appears in at least ${INDEX_YEARS} of the ${paced.length} indexed `
            + `years. TL-02 checks every holder total against the sum of its own monthly rows.`} />
        <p className="mt-4 text-[12px] text-navy-500 leading-relaxed max-w-3xl">
          Withheld rather than computed for {otherBill.map((h) => h.dimKey).join(', ')} —{' '}
          {fmtB(otherBillTotal)} of contract obligation across the six years. Their money arrives on
          a different appropriations bill with a different calendar: the Corps of Engineers civil
          programme is in Energy and Water, Veterans Affairs in Military Construction and Veterans
          Affairs, and the exchange services are not appropriated at all. Indexing them against the
          Defense enactment date would produce a number with nothing behind it.
        </p>
        <div className="grid sm:grid-cols-2 gap-6 mt-8 [&>*]:min-w-0">
          <Finding title={`${worst.key} is the clearest case in the data`} tone="critical">
            Its index is {worst.byYear[2021]?.toFixed(2)}, {worst.byYear[2022]?.toFixed(2)},{' '}
            {worst.byYear[2023]?.toFixed(2)}, {worst.byYear[2024]?.toFixed(2)} and{' '}
            {worst.byYear[live]?.toFixed(2)} — five years, never once at its own average pace before
            an act. A holder that small ({fmtB(worst.total)} across six years) is dominated by
            service contracts and facilities support, which are exactly the obligations a contracting
            officer can hold while the rate is uncertain. The page does not observe that this is why;
            it observes that the shape is consistent and the exposure is concentrated.
          </Finding>
          <Finding title={`${best.key} runs the other way`} tone="good">
            Median {best.median.toFixed(2)}: it obligates <em>faster</em> than its own average month
            while the Department is on a continuing resolution. Demand-driven spending does not wait
            for an appropriation act, and a health or sustainment account that cannot defer its
            obligations will show exactly this. It is the useful counter-example: the pattern in this
            table is not an artefact of the measure, because the measure does not produce it everywhere.
          </Finding>
        </div>
      </Section>

      {/* ------------------------------------------- the year's own money --- */}
      <Section
        id="current-year"
        title="5 · Fund distribution: the year's own money"
        note="A fiscal year's File A holds every programme year still executing in it, so a rate
              built on the whole file answers nothing a programme office asks. Everything in this
              section is programme year = fiscal year: FY2021 figures are FY2021 appropriations
              only, not FY2020 procurement still being obligated alongside them.">
        <DataTable
          align={[]}
          head={['FY', "The year's own resources", "Obligated", 'Rate', 'Unobligated at close',
                 'Accounts']}
          rows={years.map((fy) => {
            const rows = annual.filter((a) => a.fiscalYear === fy);
            const res = rows.reduce((n, r) => n + r.resources, 0);
            const obl = rows.reduce((n, r) => n + r.obligations, 0);
            const un = rows.reduce((n, r) => n + r.unobligated, 0);
            return [fy, fmtB(res), fmtB(obl), fmtPct(res ? 100 * obl / res : 0), fmtB(un),
                    fmtInt(rows.reduce((n, r) => n + r.accounts, 0))];
          })}
          caption="File A, Department scope, programme year equal to the fiscal year. The rate is
                   File A over File A so it foots to the Statement of Budgetary Resources; never a
                   cumulative share of a first year's resources, which recoveries push past 100%." />

        <h3 className="text-base font-semibold text-navy-100 mt-10 mb-4">
          By colour of money, FY{lastClosed}
        </h3>
        <BarList
          rows={sortAppropriations(rollup(annual.filter((a) => a.fiscalYear === lastClosed), 'appropriation'))
            .filter((r) => r.obligations > 0)
            .map((r) => ({ key: r.appropriation, label: r.appropriation, value: r.obligations,
                           meta: `${fmtPct(r.resources ? 100 * r.obligations / r.resources : 0)} of ${fmtB(r.resources)} available` }))}
          format="billions"
          caption={`The appropriation category is read off each account's own published name rather
                    than a hand-built code list, so a new account arrives classified instead of
                    silently becoming "Other". Across all six years $${(unmappedOf(annual) / 1e9).toFixed(1)}B —
                    ${fmtPct(100 * unmappedOf(annual) / annual.reduce((n, a) => n + a.obligations, 0), 2)} of
                    obligations — falls outside the categories and is published as Other rather than forced into one.`} />

        <h3 className="text-base font-semibold text-navy-100 mt-10 mb-4">
          The year&rsquo;s own money as a share of what was obligated
        </h3>
        <DataTable
          align={[3]}
          head={['FY', "The year's own money obligated", 'Share of all obligations that year', 'Reading']}
          rows={years.map((fy) => {
            const own = cyShare(fy);
            const all = allObligations(fy);
            return [fy, fmtB(own), all ? fmtPct(100 * own / all) : '—',
              <span key="r" className="text-navy-500">
                {all ? `${fmtB(all - own)} was prior-year or no-year money` : '—'}
              </span>];
          })}
          caption="The share falls across the six years. A year in which more of what is obligated is
                   carried-in balance is a year in which the current appropriation is doing less of
                   the work, which is the shape a long continuing resolution would leave behind — and
                   also the shape a growing multi-year procurement portfolio would leave behind. This
                   page cannot separate those two, and does not claim to." />
      </Section>

      {/* --------------------------------------- dated x colour of money ---- */}
      <Section
        id="sample"
        title="6 · Colour of money on a dated curve — the sample, and why it stays a sample"
        note="This is the one place the dated layer and the colour of money meet, and it is worth
              being blunt about how thin it is.">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {years.map((fy) => {
            const c = cov(fy, 'current_year');
            return (
              <StatTile key={fy} label={`FY${fy}`} value={fmtPct(c?.pct ?? 0)}
                sub={`${fmtB(c?.numerator ?? 0)} of ${fmtB(c?.denominator ?? 0)} dated contract dollars can be cut by both colour of money and programme year.`}
                tone={(c?.pct ?? 0) < 3 ? 'critical' : 'warning'} />
            );
          })}
        </div>
        <Caveat>
          The sample runs from {fmtPct(Math.min(...coverage.filter((c) => c.measureKey === 'current_year').map((c) => c.pct)))} to{' '}
          {fmtPct(Math.max(...coverage.filter((c) => c.measureKey === 'current_year').map((c) => c.pct)))} of
          dated contract dollars, and measured across two warehouse vintages a month apart the
          coverage for a given fiscal year does not move — so this is a property of the source year,
          not a lag that will fill in. A sample that changes size by a factor of five across the
          years cannot carry a level comparison between them. It is drawn here for shape within a
          year, and COV-01 fails a load that publishes any of it without its coverage.
        </Caveat>
        <div className="mt-6">
          <DataTable
            align={[1]}
            head={['FY', 'Measure', 'Of', 'Share']}
            rows={coverage.filter((c) => c.fiscalYear === lastClosed).map((c) => [
              c.fiscalYear, <span key="l" className="text-navy-300">{c.measureLabel}</span>,
              fmtB(c.denominator), fmtPct(c.pct),
            ])}
            caption={`FY${lastClosed}. Each layer's reach, measured rather than asserted, so the copy on this page cannot drift away from it.`} />
        </div>
      </Section>

      {/* -------------------------------------------------- the model ------- */}
      <Section
        id="model"
        title="7 · The modelled monthly distribution"
        note={`Nothing in this section is a measurement. The contract file cannot see two thirds of
               Department obligations — payroll, intragovernmental orders, transfers — and those
               dollars have a monthly shape too. This is an estimate of it, with the method printed
               beside it.`}>
        {model.length === 0 ? <Empty /> : (
          <>
            <div className="glass-card rounded-lg p-5 mb-6">
              <p className="text-[12px] uppercase tracking-wider text-navy-400 font-semibold mb-2">
                The method, in full
              </p>
              <p className="text-sm text-navy-300 leading-relaxed">
                For each appropriation and component, File A&rsquo;s measured current-year obligation
                is split in two. The share in personnel object classes is spread evenly across the
                twelve months, because compensation is paid on a schedule and has no year-end timing
                question in it. The remainder takes the contract shape observed for that
                component&rsquo;s own service in the same year, or the Department shape where the
                money is Defense-wide and therefore spread across every agency. MOD-01 checks that
                each group&rsquo;s twelve months sum to the annual total <em>and</em> that the annual
                total is the File A obligation it claims to distribute; MOD-02 blocks any model of a
                year in progress, because File B&rsquo;s figure is then period-to-date at one
                submission while the contract shape stops at the reporting frontier, and spreading
                the first across the second gives a month that belongs to neither.
              </p>
            </div>
            <DataTable
              align={[1]}
              head={['Appropriation', 'Component', 'Annual (measured)', 'Personnel share',
                     'Shape borrowed from', ...MONTHS.map((m) => m)]}
              rows={modelTable(model).slice(0, 14).map((r) => [
                <span key="a" className="text-navy-100">{r.appropriation}</span>,
                <span key="c" className="text-navy-300">{r.agencyName || r.agencyCode}</span>,
                fmtB(r.annual), fmtPct(r.personnelSharePct, 0),
                <span key="s" className="text-navy-500">{r.shapeSource}</span>,
                ...r.months.map((n, i) => (
                  <span key={i} className="text-navy-400">{(n / 1e9).toFixed(1)}</span>
                )),
              ])}
              caption={`FY${lastClosed}, $B per month, the fourteen largest groups. Every figure in the
                        month columns is MODELLED. The "Annual (measured)" column is File A's own
                        figure and is the only measurement in this table.`} />
            <p className="mt-6 text-sm text-navy-300 leading-relaxed max-w-3xl">
              Where this is most likely wrong, named rather than buried: operation and maintenance is
              contract-like and the borrowed shape probably fits it well; procurement is lumpier than
              any Department-wide shape, so a large single award will be smeared across months it did
              not fall in; and military construction follows a seasonal and award-milestone pattern
              the contract file&rsquo;s aggregate shape does not contain at all. The model is useful
              for the question &ldquo;roughly when in the year does this colour of money move&rdquo;
              and useless for any question about a specific month.
            </p>
          </>
        )}
      </Section>

      {/* ------------------------------------------------------- the RCA ---- */}
      <Section
        id="root-cause"
        title="8 · Root cause analysis"
        note="Five candidate explanations for the pattern in section 3, each with what supports it
              here, what would falsify it, and whether this data can tell.">
        <div className="space-y-4">
          <Cause
            n={1}
            title="A continuing resolution bars new starts and rate increases"
            support={`The most direct explanation, and it fits the shape: the index is below one in `
              + `every year with an act, and the catch-up afterwards is above one in every one of `
              + `them. The largest catch-up (${postHigh.toFixed(2)}) is in FY${live}, the year with `
              + `a 45-day lapse on top of the continuing resolution.`}
            against="It does not explain why the index does not scale with the length of the
                     continuing resolution. FY2022 ran 165 days and indexed 0.84; FY2023 ran 89 days
                     and indexed 0.65. If the bar on new starts were the whole story, the longer year
                     should be the slower one, and it is the faster one."
            verdict="Supported in direction, not in magnitude. Something else sets the depth." />
          <Cause
            n={2}
            title="The composition of the year's spending differs, not its timing"
            support="A year heavy in multi-year procurement obligates later regardless of the
                     appropriation calendar, because a major award has its own schedule. FY2023 and
                     FY2025 both show procurement rising as a share of current-year obligations."
            against="The index is measured against each year's OWN average month and each fund
                     holder's own history, so a year that is simply back-loaded everywhere would push
                     the pre-act and post-act indices together, not apart."
            verdict="Contributes. The measure is designed to net most of it out, and some survives." />
          <Cause
            n={3}
            title="Contracting capacity is the binding constraint, not the appropriation"
            support={`The fund holders with the lowest indices — ${holderIndex.slice(0, 3).map((h) => h.key).join(', ')} — `
              + `are small organisations with concentrated contracting shops. ${best.key}, which runs `
              + `above pace, is demand-driven and cannot defer.`}
            against="Air Force and DLA are large, index stably around 0.84 every year, and show
                     almost no year-to-year variation despite the calendar varying by 280 days across
                     the six years. That is the signature of a process constraint, not a funding one."
            verdict="Probably the dominant factor for the stable holders. Nothing here separates a
                     workforce constraint from a workload one." />
          <Cause
            n={4}
            title="The measure is an artefact of the contract file"
            support="The dated layer is a third of obligations and skews to what is bought by
                     contract. If contract spending is simply later in the year than payroll and
                     transfers, an index built on it would read low early and high late for reasons
                     that have nothing to do with appropriations."
            against={`The index is normalised on the year's own average contract month, so a `
              + `uniformly late contract profile cancels. And it does not produce the effect `
              + `everywhere: ${best.key} indexes above one in most years on the same file.`}
            verdict="Largely ruled out by the normalisation and by the counter-example." />
          <Cause
            n={5}
            title="Year-end concentration is driving the post-act figure"
            support="September's share of the year rises from 14.8% to 18.8% across the six years,
                     and September always sits after the act."
            against="The post-act window is seven to eleven months long, so one month cannot set it.
                     And the September series does not track the calendar: the year with the lowest
                     September share, FY2022, had the second-longest continuing resolution."
            verdict="Separate phenomenon. Concentration at a year end is the shape of an annual
                     appropriation and is not, on its own, a finding about continuing resolutions." />
        </div>
        <Caveat>
          Nothing on this page observes impropriety, and nothing on it establishes causation. A
          consistent association between the appropriation calendar and the shape of contract
          obligation is what these files can support. The mechanism is what a programme office, a
          comptroller and a contracting activity would have to be asked.
        </Caveat>
      </Section>

      {/* -------------------------------------------------- improvement ----- */}
      <Section
        id="improvement"
        title="9 · What would have to change"
        note="Two lists. The first is what a Department could do about the pattern; the second is
              what would have to exist in the published record before any of it could be measured
              properly.">
        <div className="grid lg:grid-cols-2 gap-6">
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-navy-100 mb-3">On the execution side</h3>
            <ol className="space-y-3 text-sm text-navy-300 leading-relaxed list-decimal pl-5">
              <li>
                <strong className="text-navy-100">Measure the pre-act pace per fund holder, every
                year.</strong> The Department-level index hides a range from{' '}
                {worst.median.toFixed(2)} to {best.median.toFixed(2)}. The organisations at the
                bottom are small enough that a handful of award decisions moves them, which makes
                them tractable in a way the Department total is not.
              </li>
              <li>
                <strong className="text-navy-100">Separate the process constraint from the funding
                constraint.</strong> A holder whose index is flat across six years of wildly varying
                calendars is not being limited by the continuing resolution. That is a different
                remediation from a holder whose index moves with the calendar, and the two are
                currently managed as one problem.
              </li>
              <li>
                <strong className="text-navy-100">Pre-position the award pipeline against the
                act.</strong> The catch-up index reaching {postHigh.toFixed(2)} says the work was
                ready and the authority was not. Whatever share of that is solicitation work that
                could have run during the continuing resolution is recoverable schedule.
              </li>
              <li>
                <strong className="text-navy-100">Stop reading September concentration as the CR
                signal.</strong> The two series do not track each other in this data, and conflating
                them sends year-end scrutiny at a problem that starts in October.
              </li>
            </ol>
          </div>
          <div>
            <h3 className="text-base font-semibold text-navy-100 mb-3">On the data side</h3>
            <ol className="space-y-3 text-sm text-navy-300 leading-relaxed list-decimal pl-5">
              <li>
                <strong className="text-navy-100">A Treasury account on every contract
                action.</strong> This is the single biggest gap. At {fmtPct(sampleNow?.pct ?? 0)}{' '}
                coverage in FY{lastClosed}, the question &ldquo;when did O&amp;M move, for
                MDA&rdquo; has no measured answer — only a modelled one. Nothing else on this list
                would buy as much.
              </li>
              <li>
                <strong className="text-navy-100">File B at more than one submission a year.</strong>{' '}
                The warehouse holds one period per fiscal year. The monthly files exist; fetching
                P01 through P12 would replace this page&rsquo;s entire modelled layer with a
                measurement and would do it for all obligations, not a third of them.
              </li>
              <li>
                <strong className="text-navy-100">An obligating-document reference on
                the account files.</strong> The same gap{' '}
                <Link href="/sbr" className="text-accent-400 hover:underline">SBR-N03</Link> names:
                without it, a dated action and an account balance cannot be tied to each other at
                all, and every bridge between them is inference.
              </li>
              <li>
                <strong className="text-navy-100">A published fund-holder dimension on the account
                chain.</strong> Agency 097 does not decompose. WHS, MDA and SOCOM are visible here
                only because FPDS names them, which means they are visible only for the third of
                their money that runs through contracts.
              </li>
            </ol>
          </div>
        </div>
        <p className="mt-8 text-sm text-navy-400 leading-relaxed max-w-3xl">
          The companion page,{' '}
          <Link href="/execution/chain" className="text-accent-400 hover:underline">
            funds distribution and the execution lag
          </Link>, takes the same calendar down to one component and one colour of money at a time:
          when the authority arrived, when each type of spending moved against it, and what a
          continuing resolution costs in execution days. It trades this page&rsquo;s coverage for
          that page&rsquo;s depth.
        </p>
      </Section>
    </Shell>
  );
}

/* --------------------------------------------------------------- helpers -- */

const EVENT_LABEL: Record<string, string> = {
  shutdown: 'Lapse in appropriations', cr: 'Without a full-year act',
  cr_extension: 'Continuing resolution', enactment: 'Full-year act enacted',
  full_year_cr: 'Full-year continuing resolution',
};

function rollup(rows: TimelineAnnual[], key: 'appropriation') {
  const m = new Map<string, TimelineAnnual>();
  for (const r of rows) {
    const k = r[key];
    const hit = m.get(k);
    if (hit) {
      hit.resources += r.resources; hit.obligations += r.obligations;
      hit.unobligated += r.unobligated; hit.outlays += r.outlays; hit.accounts += r.accounts;
    } else m.set(k, { ...r });
  }
  return Array.from(m.values()).sort((a, b) => b.obligations - a.obligations);
}

function unmappedOf(rows: TimelineAnnual[]) {
  return rows.filter((r) => r.appropriation === 'Other').reduce((n, r) => n + r.obligations, 0);
}

/**
 * The index population.
 *
 * Two exclusions, both about whether the number means anything rather than about
 * tidiness. A holder funded by a different appropriations bill has a different
 * calendar, so indexing it against the DEFENSE enactment date measures nothing.
 * And a median over five years of a holder with a few hundred million dollars of
 * contract obligation is set by a handful of awards: the first cut of this page
 * headlined a $0.6B activity as the Department's most continuing-resolution-
 * exposed organisation, which is a statement about sample size and not about the
 * Department.
 */
const INDEX_FLOOR = 4e9;   // six-year contract obligation
const INDEX_YEARS = 4;     // of the five years that received a full-year act

function medianIndex(holders: TimelineHolder[]) {
  const m = new Map<string, { key: string; total: number; byYear: Record<number, number> }>();
  for (const h of holders) {
    if (!h.inDefenseBill) continue;
    const hit = m.get(h.dimKey) ?? { key: h.dimKey, total: 0, byYear: {} };
    hit.total += h.fyObligation;
    if (h.preEnactmentPaceIndex !== null) hit.byYear[h.fiscalYear] = h.preEnactmentPaceIndex;
    m.set(h.dimKey, hit);
  }
  return Array.from(m.values())
    .filter((h) => h.total >= INDEX_FLOOR && Object.keys(h.byYear).length >= INDEX_YEARS)
    .map((h) => {
      const xs = Object.values(h.byYear).sort((a, b) => a - b);
      const med = xs.length % 2 ? xs[(xs.length - 1) / 2]
        : (xs[xs.length / 2 - 1] + xs[xs.length / 2]) / 2;
      return { ...h, median: med };
    })
    .sort((a, b) => a.median - b.median);
}

function modelTable(rows: Awaited<ReturnType<typeof getTimelineModel>>) {
  const m = new Map<string, {
    appropriation: string; agencyCode: string; agencyName: string | null;
    annual: number; personnelSharePct: number; shapeSource: string; months: number[];
  }>();
  for (const r of rows) {
    const k = `${r.appropriation}|${r.agencyCode}`;
    const hit = m.get(k) ?? {
      appropriation: r.appropriation, agencyCode: r.agencyCode, agencyName: r.agencyName,
      annual: r.annualObligation, personnelSharePct: r.personnelSharePct,
      shapeSource: r.shapeSource, months: new Array(12).fill(0),
    };
    hit.months[r.fyMonth - 1] = r.modelledObligation;
    m.set(k, hit);
  }
  return Array.from(m.values()).sort((a, b) => b.annual - a.annual);
}

function Idx({ n }: { n: number }) {
  const tone = n < 0.7 ? 'var(--status-critical)'
    : n < 0.95 ? 'var(--status-warning)'
      : n <= 1.05 ? 'var(--status-good)' : 'var(--series-1)';
  return <span className="tnum font-medium" style={{ color: tone }}>{n.toFixed(2)}</span>;
}

function Layer({ kind, what, can, cannot }: {
  kind: string; what: string; can: string; cannot: string;
}) {
  return (
    <div className="glass-card rounded-lg p-5">
      <p className="text-[12px] uppercase tracking-wider text-accent-400 font-semibold">{kind}</p>
      <p className="text-sm text-navy-100 mt-2 font-medium leading-snug">{what}</p>
      <p className="text-[12px] text-navy-400 mt-3 leading-relaxed">{can}</p>
      <p className="text-[12px] text-navy-500 mt-2 leading-relaxed">{cannot}</p>
    </div>
  );
}

function Finding({ title, tone, children }: {
  title: string; tone: 'critical' | 'good'; children: React.ReactNode;
}) {
  return (
    <div className={tone === 'critical' ? 'alert-critical rounded-lg p-5' : 'glass-card rounded-lg p-5'}>
      <h3 className="text-sm font-semibold text-navy-50 mb-2">{title}</h3>
      <p className="text-sm text-navy-300 leading-relaxed">{children}</p>
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

function NotLoaded() {
  return (
    <div className="py-20">
      <PageHeader eyebrow="Execution · Timeline" title="Fund distribution and the execution timeline"
        lede="The timeline tables are not in this database yet." />
      <div className="mt-8 alert-warning rounded-lg p-6 max-w-2xl">
        <p className="text-sm text-navy-200 leading-relaxed">
          This section needs the appropriation calendar and the timeline tables. In order:
        </p>
        <pre className="mt-4 text-[12px] text-navy-300 bg-navy-950 rounded p-4 overflow-x-auto">
{`npm run migrate    # schema only, safe on a live site
npm run refresh    # ETL + load
npm run verify     # the same prerender the deploy runs`}
        </pre>
        <p className="mt-4 text-[12px] text-navy-400 leading-relaxed">
          The figures are withheld rather than approximated. There is nothing here to fall back to:
          the nearest available substitute would be a Department-wide curve with no fund holder and
          no colour of money on it, which is the thing this page exists to replace.
        </p>
      </div>
    </div>
  );
}

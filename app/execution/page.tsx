import type { Metadata } from 'next';
import Shell, { PageHeader, Section } from '@/components/Shell';
import { ProvenanceBar, Caveat } from '@/components/Provenance';
import { StatTile, Waterfall, StackedFY, BarList, DataTable, Empty } from '@/components/charts';
import { fmtT, fmtB, fmtPct, fmtInt } from '@/components/format';
import { PaceChart } from '@/components/execution/PaceChart';
import SignalBoard from '@/components/execution/SignalBoard';
import ActionTable from '@/components/execution/ActionTable';
import ExecExplorer from '@/components/execution/ExecExplorer';
import {
  getProvenance, getSbrSeries, getObligationStages, getSbrDim, getScopeComparison, getAwardYears,
} from '@/lib/analytics';
import {
  getExecFy, getExecObjectClasses, getExecFundLife, getFpdsYears, getFpdsPace,
  getFpdsTailDays, getEoy, getSignals, getSignalCounts, getExecutors, getFpdsActions,
} from '@/lib/execution';

export const metadata: Metadata = {
  title: 'Budget to execution · datamatter',
  description:
    'The fiscal year in progress: budgetary resources through obligation and outlay, File B detail '
    + 'by object class and expenditure stage, and contract timing against each category\'s own '
    + 'year-end history.',
};
export const revalidate = 900;

// The kinds, in the order the board offers them. Named here so the page can ask
// for the most severe of each rather than the most severe overall.
const SIGNAL_KINDS = ['eoy_deviation', 'spike', 'pace', 'new_activity',
                      'eoy_projection', 'eoy_concentration'];

/** The fiscal year a date falls in. October starts the next one. */
function fiscalYearOf(d: Date) {
  return d.getUTCMonth() >= 9 ? d.getUTCFullYear() + 1 : d.getUTCFullYear();
}
function dayOfFiscalYear(d: Date, fy: number) {
  const start = Date.UTC(fy - 1, 9, 1);
  return Math.floor((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - start) / 86400000) + 1;
}

export default async function ExecutionPage() {
  const now = new Date();
  const currentFy = fiscalYearOf(now);
  const yearEnd = Date.UTC(currentFy, 8, 30);
  const daysLeft = Math.max(0, Math.round((yearEnd - Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())) / 86400000));

  const [prov, provB, provT, sbr, stages, scope, awards, execFy, fpdsYears] = await Promise.all([
    getProvenance('file_a_sbr'), getProvenance('file_b_detail'), getProvenance('contract_timing'),
    getSbrSeries(), getObligationStages(), getScopeComparison(), getAwardYears(),
    getExecFy(), getFpdsYears(),
  ]);
  if (!sbr.length) return <Shell><NotLoaded /></Shell>;

  // The page is centred on the fiscal year the calendar is in, not on the last
  // closed one. That year is period-to-date in every source here, and the whole
  // difficulty of the page is saying so on every figure rather than once.
  const focus = sbr.find((r) => r.fiscalYear === currentFy)
    ?? sbr[sbr.length - 1];
  const closed = sbr.filter((r) => !r.isPartialYear);
  const lastClosed = closed[closed.length - 1];
  const isFocusPartial = focus.isPartialYear;

  const [objects, components, fundLife, pace, tail, eoySub, executors, actions] =
    await Promise.all([
      getExecObjectClasses(focus.fiscalYear),
      getSbrDim(focus.fiscalYear, 'agency', 6),
      getExecFundLife(focus.fiscalYear),
      getFpdsPace(3),
      getFpdsTailDays(21),
      getEoy('sub_agency', lastClosed?.fiscalYear, 12),
      getExecutors(),
      getFpdsActions(undefined, undefined, 400),
    ]);
  // The board's filter chips have to count what EXISTS, not what was shipped to
  // the browser. Taking the most severe 400 signals overall and counting those
  // by kind told the reader there were 254 of one kind when the load holds far
  // more, and silently dropped whole kinds whose signals never rank that high.
  // So: the true totals come from a count, and the rows shipped are the most
  // severe of each kind rather than the most severe overall.
  const [signalCounts, byKind] = await Promise.all([
    getSignalCounts(),
    Promise.all(SIGNAL_KINDS.map((k) => getSignals({ kinds: [k], limit: 45 }))),
  ]);
  const signals = byKind.flat().sort((a, b) => a.severityRank - b.severityRank);
  const totalsByKind = signalCounts.reduce<Record<string, number>>((m, r) => {
    m[r.signalKind] = (m[r.signalKind] ?? 0) + r.n; return m;
  }, {});
  const totalsByDimension = signalCounts.reduce<Record<string, number>>((m, r) => {
    m[r.dimension] = (m[r.dimension] ?? 0) + r.n; return m;
  }, {});
  const signalTotal = signalCounts.reduce((n, r) => n + r.n, 0);

  const stage = stages.find((s) => s.fiscalYear === focus.fiscalYear);
  const execRow = execFy.find((e) => e.fiscalYear === focus.fiscalYear);
  const fpdsFocus = fpdsYears.find((y) => y.fiscalYear === focus.fiscalYear);
  const fpdsClosed = fpdsYears.filter((y) => y.isCompleteYear);
  const scopeRow = scope.find((s) => s.fiscalYear === focus.fiscalYear);
  const award = awards.find((a) => a.fiscalYear === focus.fiscalYear);

  // Same-date comparison, which is the only honest one for a year in progress.
  const sameDay = fpdsFocus?.lastDayOfFy ?? 0;
  const paceAt = (fy: number) => {
    const ps = pace.filter((p) => p.fiscalYear === fy && p.dayOfFy <= sameDay);
    return ps.length ? ps[ps.length - 1].cumObligation : 0;
  };
  const priorAtSameDay = fpdsClosed.map((y) => paceAt(y.fiscalYear)).filter((v) => v > 0).sort((a, b) => a - b);
  const medianPrior = priorAtSameDay.length
    ? (priorAtSameDay.length % 2
        ? priorAtSameDay[(priorAtSameDay.length - 1) / 2]
        : (priorAtSameDay[priorAtSameDay.length / 2 - 1] + priorAtSameDay[priorAtSameDay.length / 2]) / 2)
    : 0;
  const focusYtd = fpdsFocus?.obligation ?? 0;

  const projSep = executors.reduce((s, e) => s + (e.projectedSep ?? 0), 0);
  const projLow = executors.reduce((s, e) => s + (e.projectedSepLow ?? 0), 0);
  const projHigh = executors.reduce((s, e) => s + (e.projectedSepHigh ?? 0), 0);

  // Periods of availability have a long tail -- a handful of accounts with a
  // thirteen-year window carrying a few hundred million between them. Below a
  // thousandth of the year they are folded into one row: shown as separate bars
  // they are invisible, and shown with a rate they are misleading, because a
  // ratio whose denominator rounds to nothing produces figures like 12,330,403,700%.
  const fundLifeTotal = fundLife.reduce((s2, f) => s2 + Number(f.obligations), 0);
  const RATE_FLOOR = 1e6;
  const fundLifeMain = fundLife.filter((f) => Number(f.obligations) >= fundLifeTotal * 0.001);
  const fundLifeTail = fundLife.filter((f) => Number(f.obligations) < fundLifeTotal * 0.001);
  const rate = (num: number, den: number) =>
    den >= RATE_FLOOR ? `outlaid ${fmtPct(num / den * 100)}` : 'too small to rate';
  const fundLifeRows = [
    ...fundLifeMain.map((f) => ({
      key: f.fundLife, label: f.fundLife, value: Number(f.obligations),
      meta: `${fmtInt(f.accounts)} account${f.accounts === 1 ? '' : 's'} · `
        + rate(Number(f.grossOutlays), Number(f.obligations)),
    })),
    ...(fundLifeTail.length ? [{
      key: 'other', label: `Other periods of availability (${fundLifeTail.length})`,
      value: fundLifeTail.reduce((s2, f) => s2 + Number(f.obligations), 0),
      meta: `${fmtInt(fundLifeTail.reduce((s2, f) => s2 + f.accounts, 0))} accounts · `
        + `each under a thousandth of the year`,
    }] : []),
  ];

  const annual = fundLife.find((f) => f.fundLife === 'annual');
  const annualPct = execRow?.obligations ? Number(annual?.obligations ?? 0) / execRow.obligations * 100 : 0;

  const tie = sbr.map((a) => {
    const b = stages.find((s) => s.fiscalYear === a.fiscalYear);
    const d = (b?.obligationsIncurred ?? 0) - a.obligationsIncurred;
    return { fiscalYear: a.fiscalYear, pct: a.obligationsIncurred ? Math.abs(d) / a.obligationsIncurred * 100 : 0 };
  });
  const tieOff = tie.filter((t) => t.pct > 0.5);
  const repaired = stages.filter((s) => Number(s.replicatedRows ?? 0) > 0);

  const steps = [
    { key: 'ba', label: 'Appropriated budget authority', value: focus.baAppropriated, kind: 'base' as const,
      note: 'New authority enacted for the year.' },
    { key: 'bf', label: 'Unobligated balance brought forward', value: focus.unobligatedBf, kind: 'add' as const,
      note: 'Prior-year authority still available — multi-year and no-year accounts carry forward.' },
    { key: 'other', label: 'Other budgetary resources', value: focus.otherBudgetaryResources, kind: 'add' as const,
      note: 'Borrowing and contract authority plus spending authority from offsetting collections.' },
    { key: 'tbr', label: 'Total budgetary resources', value: focus.totalBudgetaryResources, kind: 'total' as const,
      note: `Across ${fmtInt(focus.tasCount)} Treasury accounts.` },
    { key: 'obl', label: 'Obligations incurred', value: focus.obligationsIncurred, kind: 'flow' as const,
      note: `${fmtPct(focus.obligationsIncurred / focus.totalBudgetaryResources * 100)} of available resources`
        + `${isFocusPartial ? `, as at ${focus.submissionPeriod ?? 'the current submission'}` : ''}.` },
    { key: 'out', label: 'Gross outlays', value: focus.grossOutlays, kind: 'flow' as const,
      note: 'Cash out the door. Outlays include payments against prior-year obligations, which is why they are not a subset of the line above.' },
    { key: 'unob', label: 'Unobligated balance', value: focus.unobligatedBalance, kind: 'total' as const,
      note: isFocusPartial
        ? 'Not yet obligated as at this submission. In a year still running this is a position, not a result.'
        : 'Carried into the following year where the period of availability permits.' },
  ];

  const periodNote = isFocusPartial && execRow?.submissionPeriod
    ? `FY${focus.fiscalYear} is period-to-date at ${execRow.submissionPeriod}.` : '';

  return (
    <Shell>
      <PageHeader
        eyebrow={`Execution · FY${currentFy}, ${daysLeft} day${daysLeft === 1 ? '' : 's'} to 30 September`}
        title={<>The year that is running, not the last one that closed</>}
        lede={`Everything below is centred on FY${currentFy}. Every source here reaches it at a `
          + `different distance: the account files are a period-to-date submission, the contract files `
          + `run to a date a few weeks behind today, and neither is a closed year. Where a figure is `
          + `compared with a prior year it is compared at the same point in that year, and where that `
          + `is not possible the page says so instead of drawing the line anyway.`}
      />

      <div className="mt-6"><ProvenanceBar p={prov} /></div>

      {/* ---------------------------------------------------------------- */}
      <Section title={`FY${currentFy} at ${daysLeft} days out`}
        note="Four figures a review would start from on this date, each labelled with how far its source actually reaches.">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatTile label="Obligations incurred" value={fmtT(focus.obligationsIncurred)}
            sub={`${fmtPct(focus.obligationsIncurred / focus.totalBudgetaryResources * 100)} of `
              + `${fmtT(focus.totalBudgetaryResources)} available`
              + `${focus.submissionPeriod ? ` · File A at ${focus.submissionPeriod}` : ''}`}
            tone="accent" />
          <StatTile label="On authority that expires 30 September"
            value={fmtT(Number(annual?.obligations ?? 0))}
            sub={`${fmtPct(annualPct)} of obligations are on annual appropriations`}
            tone="warning" />
          <StatTile label="Contract obligations, year to date" value={fmtB(focusYtd)}
            sub={medianPrior
              ? `${fmtPct(focusYtd / medianPrior * 100)} of the median of FY`
                + `${fpdsClosed[0]?.fiscalYear}–FY${fpdsClosed[fpdsClosed.length - 1]?.fiscalYear} at the same day`
              : 'No same-day comparison available'} />
          <StatTile label="September projects to" value={projSep ? fmtB(projSep) : '—'}
            sub={projSep ? `Range ${fmtB(projLow)}–${fmtB(projHigh)} across the sub-agencies` : 'Not computable'} />
        </div>
        <Caveat>
          The September figure is a <strong className="text-navy-200">projection</strong>: each
          sub-agency&rsquo;s observed whole months scaled by how September has related to that same
          window in its own prior years, and the range is the observed minimum and maximum of that
          ratio, not a confidence interval. It is what the year end looks like if each organisation
          behaves as it has, and it will be wrong for any that does not.
        </Caveat>
      </Section>

      {/* ---------------------------------------------------------------- */}
      <Section title="Where the year stands against its own history"
        note={`Cumulative contract obligations by day of the fiscal year. The FY${currentFy} line `
          + `stops where the contract file stops — a few weeks behind today — and the gap between the `
          + `two markers is the reporting lag rather than a fall in spending.`}>
        {pace.length ? (
          <>
            <PaceChart points={pace} liveYear={currentFy}
              todayDayOfFy={dayOfFiscalYear(now, currentFy)}
              dataEndsDay={fpdsFocus?.lastDayOfFy ?? dayOfFiscalYear(now, currentFy)} />
            <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-8">
              <div>
                <h3 className="text-sm font-semibold text-navy-200 mb-3">
                  The last three weeks of a closed year
                </h3>
                {tail.length ? (
                  <DataTable
                    head={['Fiscal year', 'Final 5 days', 'Share of the year', 'Largest single day']}
                    rows={fpdsClosed.map((y) => {
                      const rows = tail.filter((t) => t.fiscalYear === y.fiscalYear);
                      const last5 = rows.filter((t) => t.daysToEnd <= 4)
                        .reduce((s, t) => s + t.obligation, 0);
                      const biggest = rows.reduce((a, b) => (b.obligation > (a?.obligation ?? 0) ? b : a), rows[0]);
                      return [`FY${y.fiscalYear}`, fmtB(last5),
                              fmtPct(y.obligation ? last5 / y.obligation * 100 : 0),
                              biggest ? `${fmtB(biggest.obligation)} on day ${biggest.dayOfFy}` : '—'];
                    })}
                    caption="Concentration at the end of a year is the shape of an annual appropriation, not a finding in itself. It is published so the deviations further down can be read against it."
                  />
                ) : <Empty />}
              </div>
              <div>
                <h3 className="text-sm font-semibold text-navy-200 mb-3">
                  Where September lands, by sub-agency
                  {lastClosed ? ` · FY${lastClosed.fiscalYear}` : ''}
                </h3>
                {eoySub.length ? (
                  <BarList
                    rows={eoySub.slice(0, 10).map((e) => ({
                      key: e.dimKey, label: e.dimLabel, value: e.sepObligation,
                      meta: `${fmtPct(e.sepSharePct)} of its year · ${fmtPct(e.last5SharePct)} in the final five days`,
                    }))}
                    colour="var(--series-2)"
                  />
                ) : <Empty />}
              </div>
            </div>
          </>
        ) : <Empty />}
        <div className="mt-4"><ProvenanceBar p={provT} /></div>
      </Section>

      {/* ---------------------------------------------------------------- */}
      <Section title="Signals worth asking about"
        note="Each one compares a category with its own prior years, never with a Department-wide average — these categories differ by three orders of magnitude in size and a shared threshold would only ever select the largest of them. A signal is a question, not a finding.">
        {signals.length
          ? <SignalBoard signals={signals} totalsByKind={totalsByKind}
              totalsByDimension={totalsByDimension} shown={signals.length} total={signalTotal} />
          : <Empty />}
        <Caveat>
          None of these observes impropriety, and several of the largest are certainly ordinary: a
          multiyear definitisation, an exercised option or a supplemental lands as one very large
          action with nothing unusual in it beyond its size. The deviation is a robust z — the
          distance from the median of the category&rsquo;s own years, scaled by their median absolute
          deviation, floored so that a category with a nearly flat history cannot produce an
          arbitrarily large number, and capped at 99. A capped value means <em>far outside its own
          history</em> rather than a measurement. Control{' '}
          <strong className="text-navy-200">TIME-02</strong> refuses a signal computed against fewer
          than three of a category&rsquo;s own years.
        </Caveat>
      </Section>

      {/* ---------------------------------------------------------------- */}
      <Section title="Who is executing, and how much of it is left to September"
        note={`Each sub-agency against its own norm for the same whole months, with the September and `
          + `final-five-day dependence its own prior years show. Ordered by size, because a pace `
          + `percentage on a small organisation is not comparable with one on the Navy.`}>
        {executors.length ? (
          <DataTable
            head={['Sub-agency', 'Year to date', 'Own norm, same months', 'Pace',
                   'September share, median', 'Final five days, median', 'September projects to']}
            rows={executors.map((e) => [
              e.dimLabel,
              fmtB(e.ytdObligation),
              fmtB(e.ytdNorm),
              e.pacePct === null ? '—' : `${fmtPct(e.pacePct, 0)}`,
              e.sepShareMedianPct === null ? '—' : fmtPct(e.sepShareMedianPct),
              e.last5ShareMedianPct === null ? '—' : fmtPct(e.last5ShareMedianPct),
              e.projectedSep === null ? '—'
                : `${fmtB(e.projectedSep)}  (${fmtB(e.projectedSepLow ?? 0)}–${fmtB(e.projectedSepHigh ?? 0)})`,
            ])}
            caption={`Pace is the year to date over the median of the same ${executors[0]?.monthsObserved ?? 0} `
              + `whole fiscal months in that organisation's own complete years. Under 100% is not `
              + `behind in any contractual sense: an organisation whose September has always carried a `
              + `fifth of its year is exactly where it has always been at this point.`}
          />
        ) : <Empty />}
      </Section>

      {/* ---------------------------------------------------------------- */}
      <Section title="What a year end actually buys"
        note="The individual actions, with the description the contracting officer wrote on them.">
        {actions.length
          ? <ActionTable actions={actions}
              years={Array.from(new Set(actions.map((a) => a.fiscalYear))).sort((a, b) => b - a)} />
          : <Empty />}
      </Section>

      {/* ---------------------------------------------------------------- */}
      <Section title={`Scope, before any of it counts`}
        note="File A carries five agency identifier codes. Four are the Department; 011 is the Executive Office of the President. Every figure on this page uses the Department scope only.">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatTile label={`Department obligations, FY${focus.fiscalYear}`} value={fmtT(focus.obligationsIncurred)}
            sub="Agency codes 097, 021, 017, 057" tone="accent" />
          <StatTile label="All codes present in File A" value={fmtT(scopeRow?.all ?? 0)}
            sub="Includes agency 011, which is not the Department" />
          <StatTile label="Difference" value={fmtT((scopeRow?.all ?? 0) - focus.obligationsIncurred)}
            sub={`Reporting the unfiltered total as the Department overstates it by ${fmtPct(scopeRow?.overstatementPct ?? 0)}`}
            tone="warning" />
        </div>
        <Caveat>
          Control <strong className="text-navy-200">SCOPE-01</strong> asserts that no Department-scope
          figure includes agency code 011, and runs on every load.
        </Caveat>
      </Section>

      {/* ---------------------------------------------------------------- */}
      <Section title={`The chain, FY${focus.fiscalYear}`}
        note={isFocusPartial
          ? `Read top to bottom. Every line is period-to-date${focus.submissionPeriod ? ` at ${focus.submissionPeriod}` : ''} — the resources are the year's, the flows are only as far as the submission reaches.`
          : 'Read top to bottom. The first three rows assemble the resources; the total is the footing; the next two are the flows against it.'}>
        <Waterfall steps={steps} />
        {isFocusPartial && lastClosed && (
          <DataTable
            head={['', `FY${focus.fiscalYear} (${focus.submissionPeriod ?? 'in progress'})`,
                   `FY${lastClosed.fiscalYear} (closed)`, 'Difference']}
            rows={[
              ['Total budgetary resources', fmtT(focus.totalBudgetaryResources),
               fmtT(lastClosed.totalBudgetaryResources),
               fmtT(focus.totalBudgetaryResources - lastClosed.totalBudgetaryResources)],
              ['Obligations incurred', fmtT(focus.obligationsIncurred),
               fmtT(lastClosed.obligationsIncurred),
               fmtT(focus.obligationsIncurred - lastClosed.obligationsIncurred)],
              ['Obligation rate',
               fmtPct(focus.obligationsIncurred / focus.totalBudgetaryResources * 100),
               fmtPct(lastClosed.obligationsIncurred / lastClosed.totalBudgetaryResources * 100), '—'],
              ['Gross outlays', fmtT(focus.grossOutlays), fmtT(lastClosed.grossOutlays),
               fmtT(focus.grossOutlays - lastClosed.grossOutlays)],
            ]}
            caption={`These two columns are not like for like and the difference column is arithmetic `
              + `rather than a finding: FY${focus.fiscalYear} is a part-year submission and `
              + `FY${lastClosed.fiscalYear} is twelve months. The account files hold one submission per `
              + `fiscal year, so there is no FY${lastClosed.fiscalYear} figure at the same period to `
              + `compare against. The same-day comparison further up, on contract actions, is the one `
              + `that is like for like.`}
          />
        )}
        <Caveat>
          Controls <strong className="text-navy-200">SBR-01</strong> and{' '}
          <strong className="text-navy-200">SBR-02</strong> assert that obligations plus unobligated
          balance equal total budgetary resources, and that the resource components sum to that same
          total. Both foot to within 0.001% for every year shown.
        </Caveat>
      </Section>

      {/* ---------------------------------------------------------------- */}
      <Section title="Execution detail" id="detail"
        note={`File B at the grain it is reported at: ${fmtInt(execRow?.detailRows ?? 0)} rows for `
          + `FY${focus.fiscalYear} across ${fmtInt(execRow?.accounts ?? 0)} Treasury accounts and `
          + `${fmtInt(execRow?.objectClasses ?? 0)} object classes. Expand a row to open the level `
          + `beneath it.`}>
        <ExecExplorer fiscalYear={focus.fiscalYear}
          years={execFy.filter((e) => e.hasDetail).map((e) => e.fiscalYear).sort((a, b) => b - a)}
          periodNote={periodNote} />
        {execRow && !execRow.hasActivityNames && (
          <Caveat>
            The FY{execRow.fiscalYear} submission carries <strong className="text-navy-200">no program
            activity name on any row</strong> — the column is null throughout and the activity is
            identified by its reporting key instead. The key is shown; no name is borrowed from
            another year&rsquo;s row that happens to share it.
            {execRow.collapsedRows > 0 && (
              <> Where an account holds several keys the file repeats the account&rsquo;s object-class
              figure against each one rather than splitting it, so{' '}
              <strong className="text-navy-200">{fmtInt(execRow.collapsedRows)}</strong> repeated rows
              are counted once; summed as published they run about a third above File A. The break is
              set out on <a href="/linkage#fileb" className="text-accent-400 hover:underline">linkage</a>.</>
            )}
          </Caveat>
        )}
        <div className="mt-4"><ProvenanceBar p={provB} /></div>
      </Section>

      {/* ---------------------------------------------------------------- */}
      <Section title="How long the money lasts"
        note="Obligations by period of availability, read off the beginning and ending periods on each account. This is the split the date at the top of this page is about.">
        {fundLifeRows.length ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
            <BarList
              rows={fundLifeRows}
              caption={`Annual authority is the only row on this list that cannot be obligated after `
                + `30 September. An outlay rate above 100% is not an error: outlays include payments `
                + `against obligations incurred in prior years. Where a period of availability carries `
                + `too little to divide by, no rate is shown rather than a very large one.`}
            />
            <div>
              <h3 className="text-sm font-semibold text-navy-200 mb-4">
                What the money bought, FY{focus.fiscalYear}
              </h3>
              <BarList
                rows={objects.slice(0, 10).map((o) => ({
                  key: o.code, label: `${o.code} · ${o.name}`, value: o.obligations,
                  meta: `${o.majorClass} · outlaid ${fmtPct(
                    o.obligations ? o.grossOutlays / o.obligations * 100 : 0)}`,
                }))}
                colour="var(--series-3)"
                caption={`Top 10 of ${objects.length} object classes carried in the extract.`}
              />
            </div>
          </div>
        ) : <Empty />}
      </Section>

      {/* ---------------------------------------------------------------- */}
      <Section title="Where obligated dollars sit"
        note="An obligation is a binding reservation, not a payment. File B splits it by USSGL account into undelivered orders, delivered orders, and what has already been outlaid.">
        {stages.length ? (
          <>
            <StackedFY
              years={stages.map((s) => ({
                fy: s.fiscalYear,
                parts: [s.undeliveredOrdersUnpaid, s.deliveredOrdersUnpaid,
                        Math.max(0, s.obligationsIncurred - s.undeliveredOrdersUnpaid - s.deliveredOrdersUnpaid)],
                partial: sbr.find((r) => r.fiscalYear === s.fiscalYear)?.isPartialYear,
              }))}
              series={[
                { label: 'Undelivered orders, unpaid (USSGL 480100 series)', colour: 'var(--series-1)' },
                { label: 'Delivered orders, unpaid (USSGL 490100 series)', colour: 'var(--series-2)' },
                { label: 'Remainder of obligations incurred', colour: 'var(--series-3)' },
              ]}
            />
            <Caveat>
              A rising undelivered-orders balance means more of the year&rsquo;s obligations are still
              ahead of delivery. It is a pipeline measure, not a performance measure: multi-year
              procurement and construction accounts carry large undelivered balances by design.
            </Caveat>
          </>
        ) : <Empty />}
      </Section>

      {/* ---------------------------------------------------------------- */}
      <Section title="A cross-system reconciliation that does not tie"
        note={`File A and File B are separate submissions of the same execution, at different grain `
          + `and read here at the same submission period. They should agree closely. In ${tieOff.length} `
          + `of ${tie.length} years they do not, and that variance is published rather than hidden.`}>
        <DataTable
          head={['Fiscal year', 'File A obligations', 'File B obligations', 'Variance', 'Variance %']}
          rows={sbr.map((a) => {
            const b = stages.find((s) => s.fiscalYear === a.fiscalYear);
            const d = (b?.obligationsIncurred ?? 0) - a.obligationsIncurred;
            const pct = a.obligationsIncurred ? Math.abs(d) / a.obligationsIncurred * 100 : 0;
            return [`FY${a.fiscalYear}${a.isPartialYear ? ' (in progress)' : ''}`,
                    fmtT(a.obligationsIncurred), fmtT(b?.obligationsIncurred ?? 0),
                    `${d >= 0 ? '+' : '−'}${fmtT(Math.abs(d))}`, `${pct.toFixed(2)}%`];
          })}
          caption="Control TIE-01 tests this at a 0.5% tolerance and reports rather than blocks: a genuine divergence between two source submissions is a finding to publish, not a reason to withhold the data."
        />
        {repaired.length ? (
          <Caveat>
            The File B column is not a plain sum for{' '}
            {repaired.map((r) => `FY${r.fiscalYear}`).join(', ')} — see the note on the explorer above.
          </Caveat>
        ) : null}
      </Section>

      {/* ---------------------------------------------------------------- */}
      <Section title="Execution rates across the window"
        note="Obligation and outlay rates against total budgetary resources. The in-progress year is marked and must not be read beside closed years as if it were one.">
        <DataTable
          head={['Fiscal year', 'Period', 'Budgetary resources', 'Obligated', 'Oblig. rate', 'Outlaid', 'Outlay rate', 'Unobligated']}
          rows={sbr.map((r) => [
            `FY${r.fiscalYear}${r.isPartialYear ? ' *' : ''}`,
            r.submissionPeriod ?? '—',
            fmtT(r.totalBudgetaryResources), fmtT(r.obligationsIncurred),
            fmtPct(r.obligationsIncurred / r.totalBudgetaryResources * 100),
            fmtT(r.grossOutlays),
            fmtPct(r.grossOutlays / r.totalBudgetaryResources * 100),
            fmtT(r.unobligatedBalance),
          ])}
          caption="* fiscal year in progress. The submission period column is the source's own marker — P12 is a closed year; anything earlier is period-to-date."
        />
        {components.length ? (
          <div className="mt-8">
            <h3 className="text-sm font-semibold text-navy-200 mb-4">
              Obligations by component, FY{focus.fiscalYear}
            </h3>
            <BarList
              rows={components.map((c) => ({
                key: c.key, label: c.label, value: c.obligationsIncurred,
                meta: `${fmtPct(c.obligationsIncurred / focus.obligationsIncurred * 100)} of Department obligations`,
              }))}
              colour="var(--series-3)"
            />
            {award && (
              <div className="mt-6 glass-card rounded-lg p-4">
                <p className="text-xs text-navy-300 leading-relaxed">
                  Contract awards in the same year total{' '}
                  <strong className="text-navy-100 tnum">{fmtB(award.obligation)}</strong> across{' '}
                  <strong className="text-navy-100 tnum">{fmtInt(award.actionCount)}</strong> actions —{' '}
                  {fmtPct(award.obligation / focus.obligationsIncurred * 100)} of total Department
                  obligations. Contract action data and account obligations are different reporting
                  chains; see <a href="/reconciliation" className="text-accent-400 hover:underline">Reconciliation</a>.
                </p>
              </div>
            )}
          </div>
        ) : null}
      </Section>
    </Shell>
  );
}

export function NotLoaded() {
  return (
    <div className="py-24 max-w-xl">
      <h1 className="text-2xl font-bold text-navy-50">No current load</h1>
      <p className="text-navy-300 mt-3 leading-relaxed">
        The analytics tables have not been loaded yet. Run{' '}
        <code className="font-mono text-accent-400 text-sm">npm run refresh</code> on a machine with access
        to the warehouse. Figures are withheld rather than shown without provenance.
      </p>
    </div>
  );
}

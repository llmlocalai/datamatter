import type { Metadata } from 'next';
import Shell, { PageHeader, Section } from '@/components/Shell';
import { ProvenanceBar, Caveat } from '@/components/Provenance';
import { StatTile, Waterfall, StackedFY, BarList, DataTable, Empty } from '@/components/charts';
import { fmtT, fmtB, fmtPct, fmtInt } from '@/components/format';
import { PaceChart } from '@/components/execution/PaceChart';
import SignalBoard from '@/components/execution/SignalBoard';
import ActionTable from '@/components/execution/ActionTable';
import ExecExplorer from '@/components/execution/ExecExplorer';
import ProgramYearExplorer from '@/components/execution/ProgramYearExplorer';
import { getProgramYearOverview, programYearReady } from '@/lib/program-year';
import {
  getProvenance, getSbrSeries, getObligationStages, getSbrDim, getScopeComparison, getAwardYears,
} from '@/lib/analytics';
import { fiscalYearOf, dayOfFiscalYear, daysToFiscalYearEnd, pickFiscalYear } from '@/lib/fiscal';
import {
  getExecFy, getExecObjectClasses, getExecFundLife, getFpdsYears, getFpdsPace,
  getFpdsTailDays, getEoy, getSignals, getSignalCounts, getExecutors, getFpdsActions,
  getContractCoverage, getMajorClasses, getCurrency,
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


export default async function ExecutionPage() {
  const now = new Date();
  const currentFy = fiscalYearOf(now);
  const daysLeft = daysToFiscalYearEnd(now, currentFy);

  const [prov, provB, provT, sbr, stages, scope, awards, execFy, fpdsYears] = await Promise.all([
    getProvenance('file_a_sbr'), getProvenance('file_b_detail'), getProvenance('contract_timing'),
    getSbrSeries(), getObligationStages(), getScopeComparison(), getAwardYears(),
    getExecFy(), getFpdsYears(),
  ]);
  if (!sbr.length) return <Shell><NotLoaded /></Shell>;

  // The page is centred on the fiscal year the calendar is in, not on the last
  // closed one. That year is period-to-date in every source here, and the whole
  // difficulty of the page is saying so on every figure rather than once.
  const focus = pickFiscalYear(sbr, undefined, now) ?? sbr[sbr.length - 1];
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
  const [coverage, majorClasses, currency, pyReady] = await Promise.all([
    getContractCoverage(), getMajorClasses(lastClosed?.fiscalYear ?? focus.fiscalYear),
    getCurrency(), programYearReady(),
  ]);
  // Withheld, not approximated, when the database predates the program-year
  // columns -- see lib/schema and lib/program-year.
  const programYear = pyReady ? await getProgramYearOverview() : null;
  // What the timing view below covers, measured rather than asserted. The last
  // CLOSED year is the one to quote: the live year's share is depressed by the
  // reporting frontier on one side of the ratio and not the other.
  const cov = coverage.find((c) => c.fiscalYear === lastClosed?.fiscalYear);
  const mcTotal = majorClasses.reduce((n, m) => n + Number(m.obligations), 0);
  const personnel = majorClasses.find((m) => m.majorClass === 'Personnel compensation and benefits');
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

  // Same-date comparison, which is the only honest one for a year in progress --
  // and it has to be measured to the REPORTING FRONTIER, not to the live year's
  // last dated action. FY2026's file runs to 4 August and is complete to
  // 30 April; comparing to 4 August put three empty months into the live year's
  // total and none into anyone else's, which showed every organisation running
  // behind when they are all running ahead.
  // Null means this database predates the frontier column. There is no fallback:
  // the only candidate is the year's last action date, which is the value the
  // frontier exists to replace, so using it would restore the bug. The timing
  // sections are withheld instead — see lib/schema.
  const timingReady = fpdsFocus?.frontierDayOfFy != null;
  const sameDay = fpdsFocus?.frontierDayOfFy ?? 0;
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
  const focusYtd = timingReady ? Number(fpdsFocus?.frontierObligation ?? 0) : 0;

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

      {/* How current this is, before anything is read off it. Timeliness is the
          point of an execution page, and the one thing the warehouse cannot say
          about itself is how old it is. */}
      <div className={`mt-4 rounded-lg border px-4 py-3 text-[13px] leading-relaxed ${
        currency.periodsBehind && currency.periodsBehind > 0
          ? 'border-amber-500/40 bg-amber-500/[0.06] text-navy-200'
          : 'border-navy-800 bg-navy-900/40 text-navy-300'}`}>
        <span className="uppercase tracking-wider text-[11px] font-semibold text-accent-400 mr-2">
          Currency
        </span>
        {currency.heldPeriod ? (
          <>
            The account files in this load hold{' '}
            <strong className="text-navy-100">{currency.heldPeriod}</strong>
            {currency.heldPeriodEnd ? ` — through ${currency.heldPeriodEnd}` : ''}
            {currency.warehouseVintage
              ? `, from a warehouse snapshot taken ${currency.warehouseVintage}` : ''}.
            {currency.newestPeriod && currency.periodsBehind !== null && currency.periodsBehind > 0 ? (
              <>
                {' '}<strong className="text-amber-300">
                  {currency.newestPeriod}
                  {currency.newestPeriodEnd ? `, covering ${currency.newestPeriodEnd}` : ''}, was
                  published{currency.newestRevealDate ? ` on ${currency.newestRevealDate}` : ''} and
                  is not in this load
                </strong>{' '}— {currency.periodsBehind} submission period
                {currency.periodsBehind === 1 ? '' : 's'} behind. Rebuild the warehouse snapshot,
                then re-run the ETL and the load. Control{' '}
                <strong className="text-navy-200">CUR-01</strong> measures this on every load.
              </>
            ) : currency.newestPeriod ? (
              <> That is the newest submission published.</>
            ) : (
              <> The submission calendar is not in this load, so how far behind it is cannot be
                 measured — the currency step needs network access.</>
            )}
            {currency.calendarVintage
              ? ` Calendar read ${currency.calendarVintage}.` : ''}
          </>
        ) : (
          <>No submission period is recorded on this load.</>
        )}
      </div>

      {/* ---------------------------------------------------------------- */}
      <Section title={`FY${currentFy} at ${daysLeft} days out`}
        note={`Four figures a review would start from on this date, each labelled with how far its `
          + `source actually reaches. The first two are the whole Department, from the account files. `
          + `The second two are contract actions only`
          + `${cov ? `, which are ${fmtPct(cov.contractPct)} of obligations` : ''} — the account files `
          + `carry no date, so anything about timing can only be read from them.`}>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatTile label="Obligations incurred, all appropriations" value={fmtT(focus.obligationsIncurred)}
            sub={`${fmtPct(focus.obligationsIncurred / focus.totalBudgetaryResources * 100)} of `
              + `${fmtT(focus.totalBudgetaryResources)} available`
              + `${focus.submissionPeriod ? ` · File A at ${focus.submissionPeriod}` : ''}`}
            tone="accent" />
          <StatTile label="On authority that expires 30 September"
            value={fmtT(Number(annual?.obligations ?? 0))}
            sub={`${fmtPct(annualPct)} of obligations are on annual appropriations`}
            tone="warning" />
          <StatTile label={timingReady
              ? `Contract obligations to ${fpdsFocus?.frontierDate}`
              : 'Contract obligations, year to date'}
            value={timingReady ? fmtB(focusYtd) : '—'}
            sub={!timingReady ? 'Awaiting a refresh — see the note below' : (medianPrior
              ? `${fmtPct(focusYtd / medianPrior * 100)} of the median of FY`
                + `${fpdsClosed[0]?.fiscalYear}–FY${fpdsClosed[fpdsClosed.length - 1]?.fiscalYear} at the same point`
                + ` · ${fpdsFocus?.fullMonthsObserved ?? 0} whole months`
              : 'No same-point comparison available')
              + (cov ? ` · a ${fmtPct(cov.contractPct, 0)} subset of obligations` : '')} />
          <StatTile label="September projects to"
            value={timingReady && projSep ? fmtB(projSep) : '—'}
            sub={!timingReady ? 'Awaiting a refresh — see the note below'
              : projSep ? `Range ${fmtB(projLow)}–${fmtB(projHigh)} across the sub-agencies`
              : 'Not computable'} />
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
      <Section title={`The Department-wide position, FY${focus.fiscalYear}`}
        note={isFocusPartial
          ? `The whole of execution, not a subset — every appropriation, every account. Read top to `
            + `bottom: the first three rows assemble the resources, the total is the footing, the next `
            + `two are the flows against it. Every line is period-to-date`
            + `${focus.submissionPeriod ? ` at ${focus.submissionPeriod}` : ''}.`
          : 'The whole of execution, not a subset. Read top to bottom. The first three rows assemble the resources; the total is the footing; the next two are the flows against it.'}>
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
          <strong className="text-navy-200">This is a position, not a curve, and it cannot be made
          into one.</strong> File A and File B each publish{' '}
          <strong className="text-navy-200">one submission per fiscal year</strong> in this warehouse —
          FY{focus.fiscalYear} at {focus.submissionPeriod ?? 'its current period'}, every closed year at
          P12 — so there is no month-by-month Department-wide series in these sources to draw. The
          timing section below is built on contract action dates because an action carries a date and
          an account submission does not; it covers{' '}
          <strong className="text-navy-200">{cov ? fmtPct(cov.contractPct) : 'about a third'}</strong>{' '}
          of obligations, and that is stated there rather than left to be inferred.
        </Caveat>
        <Caveat>
          Controls <strong className="text-navy-200">SBR-01</strong> and{' '}
          <strong className="text-navy-200">SBR-02</strong> assert that obligations plus unobligated
          balance equal total budgetary resources, and that the resource components sum to that same
          total. Both foot to within 0.001% for every year shown.
        </Caveat>
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
      <Section title="Execution by program year" id="program-year"
        note={`File B, split by the year the money was appropriated for. A fiscal year's execution is not `
          + `that year's money: FY${focus.fiscalYear}'s obligations include prior-year procurement and `
          + `research money still being obligated, expired annual money taking adjustments, and no-year `
          + `money, beside FY${focus.fiscalYear}'s own appropriations. Keep to one program year, then drill `
          + `from component to object class; each row's rate is its own obligations over its own resources.`}>
        {programYear && programYear.years.length ? (
          <ProgramYearExplorer
            years={programYear.years} cells={programYear.cells}
            defaultFy={(programYear.years.find((y) => y.fiscalYear === focus.fiscalYear)
              ?? programYear.years[programYear.years.length - 1]).fiscalYear}
            fileB={programYear.fileB} fileA={programYear.fileA} controls={programYear.controls} />
        ) : (
          <div className="alert-warning rounded-lg px-4 py-3 text-sm text-navy-100">
            The program-year figures are not in this database yet. They need the program-year columns and
            File A account table, which arrive with{' '}
            <code className="font-mono text-xs">npm run migrate</code> and then{' '}
            <code className="font-mono text-xs">npm run refresh</code>. Nothing is shown in their place,
            because the only substitute would be reading the year out of the account symbol here, unchecked.
          </div>
        )}
        <Caveat>
          <strong className="text-navy-200">A position at each submission, not a monthly curve.</strong>{' '}
          The warehouse holds one File B submission per fiscal year
          {focus.submissionPeriod ? ` (FY${focus.fiscalYear} at ${focus.submissionPeriod})` : ''}, so what moves
          across these charts is a program year&rsquo;s life — the same money in its first, second and third
          fiscal year — not the months of one year. The program year is the beginning of the period of
          availability; control <strong className="text-navy-200">POA-01</strong> re-derives it from every
          Treasury account symbol and <strong className="text-navy-200">POA-02</strong> asserts the split foots
          to the Statement of Budgetary Resources.
        </Caveat>
      </Section>

      {timingReady ? (
        <>
        {/* ---------------------------------------------------------------- */}
        <Section title="When contract money moves"
          note={`Cumulative CONTRACT obligations by day of the fiscal year — `
            + `${cov ? fmtPct(cov.contractPct) : 'about a third'} of Department obligations in FY`
            + `${cov?.fiscalYear ?? ''}, not the whole of execution. It is here because an action `
            + `carries a date and an account submission does not. The FY${currentFy} line stops at the `
            + `reporting frontier — ${fpdsFocus?.frontierDate ?? 'where the file is complete'}, `
            + `${fpdsFocus?.fullMonthsObserved ?? 0} whole months in — and the gap between the two `
            + `markers is the reporting lag, not a fall in spending.`}>
          {pace.length ? (
            <>
              <PaceChart points={pace} liveYear={currentFy}
                todayDayOfFy={dayOfFiscalYear(now, currentFy)}
                dataEndsDay={fpdsFocus?.frontierDayOfFy ?? dayOfFiscalYear(now, currentFy)} />
              {fpdsFocus && !fpdsFocus.isCompleteYear && (
                <Caveat>
                  The FY{fpdsFocus.fiscalYear} file carries actions dated as late as{' '}
                  <strong className="text-navy-200">{fpdsFocus.lastActionDate}</strong>, but it is
                  substantially complete only to{' '}
                  <strong className="text-navy-200">{fpdsFocus.frontierDate}</strong>: October through
                  April carry between 280,000 and 400,000 actions a month, and everything after the
                  frontier comes to {fmtInt(fpdsFocus.tailActions)} actions worth{' '}
                  {fmtT(fpdsFocus.tailObligation)}. Every figure on this page measures the live year to
                  the frontier and every prior year to the same point. Taking the last dated action as
                  the extent of the file instead put three near-empty months into FY
                  {fpdsFocus.fiscalYear}&rsquo;s total and none into anyone else&rsquo;s — which showed
                  every organisation running behind its own norm when all of them are running ahead.
                  Control <strong className="text-navy-200">TIME-04</strong> asserts the frontier and
                  publishes what it excludes.
                </Caveat>
              )}
              {cov && (
                <div className="mt-6">
                  <DataTable
                    head={['Fiscal year', 'Department obligations', 'Contract obligations',
                           'Share carrying a date']}
                    rows={coverage.map((c) => [
                      `FY${c.fiscalYear}${c.isPartialAccounts ? ' (in progress)' : ''}`,
                      fmtT(c.departmentObligations), fmtT(c.contractObligations),
                      fmtPct(c.contractPct),
                    ])}
                    caption={`What the curve above covers. The largest block it does not is personnel `
                      + `compensation and benefits — ${personnel ? fmtT(Number(personnel.obligations)) : ''} `
                      + `${personnel && mcTotal ? `(${fmtPct(Number(personnel.obligations) / mcTotal * 100)} of `
                          + `FY${lastClosed?.fiscalYear})` : ''}, which is paid on a schedule and has no `
                      + `year-end timing question in it. The in-progress year's share is lower on both `
                      + `counts because its two sources reach different dates.`}
                  />
                </div>
              )}
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
        </>
      ) : (
        <Section title="Contract timing is not available from this load"
          note="Everything above comes from the account files and is current. The timing sections are withheld.">
          <Caveat>
            The timing figures on this page — the day-by-day curve, the year-end shares, the signals
            and the September projection — are all measured to a{' '}
            <strong className="text-navy-200">reporting frontier</strong>, the point at which the
            contract file stops being substantially complete. This database has no frontier recorded,
            which means it was migrated before that column existed.
            <br /><br />
            The figures are withheld rather than computed from the year&rsquo;s last action date.
            That date is the value the frontier was introduced to replace: FY2026&rsquo;s file carries
            actions to 4 August but is complete only to 30 April, and measuring to the later date put
            three near-empty months into the live year and none into any other — which showed every
            organisation running behind its own norm when all of them are running ahead. A fallback
            here would restore that, quietly, on a page built to support a decision.
            <br /><br />
            Run <code className="font-mono text-accent-400 text-sm">npm run migrate</code> then{' '}
            <code className="font-mono text-accent-400 text-sm">npm run refresh</code> on a machine
            with access to the warehouse.
          </Caveat>
        </Section>
      )}
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

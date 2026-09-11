import type { Metadata } from 'next';
import Shell, { PageHeader, Section } from '@/components/Shell';
import { ProvenanceBar, Caveat } from '@/components/Provenance';
import { StatTile, BarList, DataTable, LineTrend } from '@/components/charts';
import { FyPicker } from '@/components/FyPicker';
import { fmtT, fmtPct, fmtInt } from '@/components/format';
import { getProvenance, getSbrSeries } from '@/lib/analytics';
import { pickFiscalYear } from '@/lib/fiscal';
import { getSplitByFy, getSplitByDim, splitReady, directRate } from '@/lib/funding';
import { NotLoaded } from '../execution/page';

export const metadata: Metadata = {
  title: 'Funds control · datamatter',
  description: 'Treasury-account level obligation and outlay rates, unobligated balances, and lapse exposure for the Department of War.',
};
export const revalidate = 900;

export default async function FundsControlPage({ searchParams }: { searchParams: { fy?: string } }) {
  const [prov, series] = await Promise.all([getProvenance('file_a_sbr'), getSbrSeries()]);
  if (!series.length) return <Shell><NotLoaded /></Shell>;

  const years = series.map((s) => s.fiscalYear);
  const partial = series.filter((s) => s.isPartialYear).map((s) => s.fiscalYear);
  // The page opens on the fiscal year the calendar is in, not on the last one
  // that closed — see lib/fiscal. A year in progress needs every figure marked
  // period-to-date, which the partial-year banner below does; opening on a
  // closed year instead quietly answered a question nobody asked.
  const row = pickFiscalYear(series, searchParams.fy) ?? series[series.length - 1];

  // Funds control is administered on direct authority. File A adds reimbursable
  // work in -- the Defense Working Capital Fund's customer-funded obligations
  // put it near the top of any ranking by total -- so rankings, rates and the
  // trend are direct, from File B, and the statement's own totals are kept and
  // labelled as direct plus reimbursable. See lib/funding.
  const drReady = await splitReady();
  const [splits, tas, accounts, functions] = await Promise.all([
    drReady ? getSplitByFy() : Promise.resolve([]),
    drReady ? getSplitByDim(row.fiscalYear, 'tas', 10) : Promise.resolve([]),
    drReady ? getSplitByDim(row.fiscalYear, 'federal', 10) : Promise.resolve([]),
    drReady ? getSplitByDim(row.fiscalYear, 'function', 6) : Promise.resolve([]),
  ]);
  const split = splits.find((x) => x.fiscalYear === row.fiscalYear);
  const dRate = split ? directRate(split.direct, split.resources, split.offsettingCollections) : null;

  const oblRate = row.obligationsIncurred / row.totalBudgetaryResources * 100;
  const outRate = row.grossOutlays / row.totalBudgetaryResources * 100;
  const unobPct = row.unobligatedBalance / row.totalBudgetaryResources * 100;

  return (
    <Shell>
      <PageHeader
        eyebrow="Execution · Statement of Budgetary Resources"
        title="Funds control"
        lede="Obligation and outlay position against available budgetary resources, at Treasury account grain. Unobligated balance is shown as what it is — resources not yet committed — with the account's period of availability determining whether it lapses."
      />

      <div className="mt-6 space-y-5">
        <ProvenanceBar p={prov} />
        <FyPicker years={years} active={row.fiscalYear} base="/funds-control" partial={partial} />
      </div>

      {row.isPartialYear && (
        <div className="mt-6 border border-amber-500/40 bg-amber-500/5 rounded-lg px-4 py-3">
          <p className="text-sm text-amber-200">
            <strong>FY{row.fiscalYear} is in progress.</strong> The source reports it as{' '}
            <code className="font-mono text-xs">{row.submissionPeriod}</code> — period-to-date, not a closed
            year. Its obligation rate of {fmtPct(oblRate)} is a point in a year still running and must not be
            compared with a closed year&rsquo;s final rate.
          </p>
        </div>
      )}

      <Section title={`FY${row.fiscalYear} position`}
        note={`Department scope: agency codes 097, 021, 017 and 057, across ${fmtInt(row.tasCount)} Treasury accounts. Agency 011 is excluded.`}>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatTile label="Total budgetary resources" value={fmtT(row.totalBudgetaryResources)}
            sub={`${fmtT(row.baAppropriated)} newly appropriated · ${fmtT(row.unobligatedBf)} brought forward · `
              + `${fmtT(row.spendingAuthOffsetting)} from offsetting collections (reimbursable work)`} />
          <StatTile label="Direct obligation rate" value={dRate != null ? fmtPct(dRate) : '—'}
            sub={split
              ? `${fmtT(split.direct)} direct obligations of ${fmtT(split.resources - Math.max(0, split.offsettingCollections))} `
                + `direct resources · ${fmtPct(oblRate)} with ${fmtT(split.reimbursable)} reimbursable added (File A)`
              : 'Direct/reimbursable split not loaded — run npm run migrate, then npm run refresh'}
            tone="accent" />
          <StatTile label="Outlay rate (direct + reimbursable)" value={fmtPct(outRate)}
            sub={`${fmtT(row.grossOutlays)} disbursed — includes payment against prior-year obligations`} />
          <StatTile label="Unobligated balance (direct + reimbursable)" value={fmtT(row.unobligatedBalance)}
            sub={`${fmtPct(unobPct)} of resources · File A does not split it`}
            tone={row.isPartialYear ? 'default' : unobPct > 25 ? 'warning' : 'default'} />
        </div>
        <Caveat>
          Obligations and outlays are different measures and are not a subset of one another in a single year:
          outlays here include disbursement against obligations incurred in prior years, which is why the
          outlay rate can move independently of the obligation rate. A high unobligated balance is not by
          itself an Antideficiency Act concern — it is only a lapse risk in an account whose period of
          availability is ending.
        </Caveat>
      </Section>

      <Section title="Execution across the window"
        note="Direct obligation rate by fiscal year: File B direct obligations over total budgetary resources less spending authority from offsetting collections. The in-progress year is marked and sits below closed years by construction.">
        {splits.length ? (
          <LineTrend
            label="Direct obligation rate"
            points={splits.map((x) => ({
              x: x.fiscalYear,
              y: directRate(x.direct, x.resources, x.offsettingCollections) ?? 0,
              partial: x.isPartialYear,
            }))}
            format="pct0"
          />
        ) : <p className="text-sm text-navy-400">Awaiting the direct/reimbursable split.</p>}
        <Caveat>
          The statement&rsquo;s own rate, direct and reimbursable together, runs{' '}
          {series.map((s) => `FY${s.fiscalYear} ${fmtPct(s.obligationsIncurred / s.totalBudgetaryResources * 100)}`).join(', ')}.
          Brought-forward balances cannot be split in File A, so a year carrying large balances keeps some
          reimbursable carry-in in the direct denominator.
        </Caveat>
      </Section>

      <Section title={`Largest direct obligating accounts, FY${row.fiscalYear}`}
        note="Ranked by direct obligations. Reimbursable work is shown beside each account and not added in.">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
          <div>
            <h3 className="text-sm font-semibold text-navy-200 mb-4">By federal account</h3>
            <BarList rows={accounts.map((a) => {
              const r = directRate(a.direct, a.resources, a.offsettingCollections);
              return {
                key: a.key, label: a.label, value: a.direct,
                meta: `${r != null ? `${fmtPct(r)} of its direct resources obligated` : 'too small to rate'}`
                  + ` · ${fmtT(a.reimbursable)} reimbursable not counted`,
              };
            })} />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-navy-200 mb-4">By budget function</h3>
            <BarList colour="var(--series-3)" rows={functions.map((f) => ({
              key: f.key, label: f.label || 'Not reported', value: f.direct,
              meta: `${fmtPct(split?.direct ? f.direct / split.direct * 100 : 0)} of direct obligations`
                + ` · ${fmtT(f.reimbursable)} reimbursable not counted`,
            }))} />
          </div>
        </div>
      </Section>

      <Section title="Treasury account detail"
        note="Top accounts by direct obligations, with their own direct execution rates. TAS is the level at which funds control is actually administered.">
        <DataTable
          head={['Treasury account', 'Direct obligated', 'Reimbursable', 'Direct resources', 'Direct rate',
                 'Direct outlaid', 'Unobligated (D+R)']}
          rows={tas.map((t) => {
            const r = directRate(t.direct, t.resources, t.offsettingCollections);
            return [
              `${t.label} · ${t.key}`, fmtT(t.direct), fmtT(t.reimbursable),
              fmtT(t.resources - Math.max(0, t.offsettingCollections)),
              r != null ? fmtPct(r) : '—', fmtT(t.outlaysDirect), fmtT(t.unobligatedA),
            ];
          })}
          caption="Direct amounts are File B. Direct resources are File A total budgetary resources less spending authority from offsetting collections. Unobligated balance is File A, which does not split it."
        />
      </Section>
    </Shell>
  );
}

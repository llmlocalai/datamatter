import type { Metadata } from 'next';
import Shell, { PageHeader, Section } from '@/components/Shell';
import { ProvenanceBar, Caveat } from '@/components/Provenance';
import { StatTile, BarList, DataTable, LineTrend } from '@/components/charts';
import { FyPicker } from '@/components/FyPicker';
import { fmtT, fmtPct, fmtInt } from '@/components/format';
import { getProvenance, getSbrSeries, getSbrDim } from '@/lib/analytics';
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
  const closed = series.filter((s) => !s.isPartialYear);
  const requested = Number(searchParams.fy);
  const row = series.find((s) => s.fiscalYear === requested) ?? closed[closed.length - 1] ?? series[series.length - 1];

  const [tas, accounts, functions] = await Promise.all([
    getSbrDim(row.fiscalYear, 'tas', 10),
    getSbrDim(row.fiscalYear, 'federal_account', 10),
    getSbrDim(row.fiscalYear, 'budget_function', 6),
  ]);

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
            sub={`${fmtT(row.baAppropriated)} newly appropriated · ${fmtT(row.unobligatedBf)} brought forward`} />
          <StatTile label="Obligation rate" value={fmtPct(oblRate)}
            sub={`${fmtT(row.obligationsIncurred)} obligated`} tone="accent" />
          <StatTile label="Outlay rate" value={fmtPct(outRate)}
            sub={`${fmtT(row.grossOutlays)} disbursed — includes payment against prior-year obligations`} />
          <StatTile label="Unobligated balance" value={fmtT(row.unobligatedBalance)}
            sub={`${fmtPct(unobPct)} of resources`}
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
        note="Obligation rate by fiscal year. The in-progress year is marked and sits below closed years by construction.">
        <LineTrend
          label="Obligation rate"
          points={series.map((s) => ({
            x: s.fiscalYear,
            y: s.obligationsIncurred / s.totalBudgetaryResources * 100,
            partial: s.isPartialYear,
          }))}
          format="pct0"
        />
      </Section>

      <Section title={`Largest obligating accounts, FY${row.fiscalYear}`}>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
          <div>
            <h3 className="text-sm font-semibold text-navy-200 mb-4">By federal account</h3>
            <BarList rows={accounts.map((a) => ({
              key: a.key, label: a.label, value: a.obligationsIncurred,
              meta: `${fmtPct(a.obligationsIncurred / Math.max(1, a.totalBudgetaryResources) * 100)} of that account's resources obligated`,
            }))} />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-navy-200 mb-4">By budget function</h3>
            <BarList colour="var(--series-3)" rows={functions.map((f) => ({
              key: f.key, label: f.label, value: f.obligationsIncurred,
              meta: `${fmtPct(f.obligationsIncurred / row.obligationsIncurred * 100)} of Department obligations`,
            }))} />
          </div>
        </div>
      </Section>

      <Section title="Treasury account detail"
        note="Top accounts by obligations incurred, with their own execution rates. TAS is the level at which funds control is actually administered.">
        <DataTable
          head={['Treasury account', 'Budgetary resources', 'Obligated', 'Oblig. rate', 'Outlaid', 'Unobligated']}
          rows={tas.map((t) => [
            t.label, fmtT(t.totalBudgetaryResources), fmtT(t.obligationsIncurred),
            fmtPct(t.obligationsIncurred / Math.max(1, t.totalBudgetaryResources) * 100),
            fmtT(t.grossOutlays), fmtT(t.unobligatedBalance),
          ])}
        />
      </Section>
    </Shell>
  );
}

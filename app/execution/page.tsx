import type { Metadata } from 'next';
import Shell, { PageHeader, Section } from '@/components/Shell';
import { ProvenanceBar, Caveat } from '@/components/Provenance';
import { StatTile, Waterfall, StackedFY, BarList, DataTable, Empty } from '@/components/charts';
import { fmtT, fmtB, fmtPct, fmtInt } from '@/components/format';
import {
  getProvenance, getSbrSeries, getObligationStages, getObjectClasses,
  getSbrDim, getScopeComparison, getAwardYears,
} from '@/lib/analytics';

export const metadata: Metadata = {
  title: 'Budget to execution · datamatter',
  description:
    'Budgetary resources through obligation, undelivered and delivered orders, and outlay, for the Department of War FY2021–FY2026.',
};
export const revalidate = 900;

export default async function ExecutionPage() {
  const [prov, provB, sbr, stages, scope, awards] = await Promise.all([
    getProvenance('file_a_sbr'), getProvenance('file_b_obligations'),
    getSbrSeries(), getObligationStages(), getScopeComparison(), getAwardYears(),
  ]);
  if (!sbr.length) return <Shell><NotLoaded /></Shell>;

  const closed = sbr.filter((r) => !r.isPartialYear);
  const latest = closed[closed.length - 1] ?? sbr[sbr.length - 1];
  const inProgress = sbr.find((r) => r.isPartialYear);
  const [objects, components] = await Promise.all([
    getObjectClasses(latest.fiscalYear), getSbrDim(latest.fiscalYear, 'agency', 6),
  ]);
  const stage = stages.find((s) => s.fiscalYear === latest.fiscalYear);
  const award = awards.find((a) => a.fiscalYear === latest.fiscalYear);
  const scopeRow = scope.find((s) => s.fiscalYear === latest.fiscalYear);

  const steps = [
    { key: 'ba', label: 'Appropriated budget authority', value: latest.baAppropriated, kind: 'base' as const,
      note: 'New authority enacted for the year.' },
    { key: 'bf', label: 'Unobligated balance brought forward', value: latest.unobligatedBf, kind: 'add' as const,
      note: 'Prior-year authority still available — multi-year and no-year accounts carry forward.' },
    { key: 'other', label: 'Other budgetary resources', value: latest.otherBudgetaryResources, kind: 'add' as const,
      note: 'Borrowing and contract authority plus spending authority from offsetting collections, as rolled up by the source.' },
    { key: 'tbr', label: 'Total budgetary resources', value: latest.totalBudgetaryResources, kind: 'total' as const,
      note: `The resources side of the Statement of Budgetary Resources across ${fmtInt(latest.tasCount)} Treasury accounts.` },
    { key: 'obl', label: 'Obligations incurred', value: latest.obligationsIncurred, kind: 'flow' as const,
      note: `${fmtPct(latest.obligationsIncurred / latest.totalBudgetaryResources * 100)} of available resources were obligated.` },
    { key: 'out', label: 'Gross outlays', value: latest.grossOutlays, kind: 'flow' as const,
      note: 'Cash actually disbursed. Outlays include payments against obligations incurred in prior years, which is why they are not a subset of the line above.' },
    { key: 'unob', label: 'Unobligated balance', value: latest.unobligatedBalance, kind: 'total' as const,
      note: 'Carried into the following year where the account’s period of availability permits.' },
  ];

  return (
    <Shell>
      <PageHeader
        eyebrow={`Execution · FY${latest.fiscalYear} closed · FY${inProgress?.fiscalYear ?? ''} in progress`}
        title={<>From appropriated authority to cash out the door</>}
        lede="The Statement of Budgetary Resources is the spine: resources are assembled, obligated, staged as undelivered and then delivered orders, and finally outlaid. Each hand-off below names its own source, and the variance at each step is stated rather than smoothed."
      />

      <div className="mt-6"><ProvenanceBar p={prov} /></div>

      <Section title="Scope, before anything else"
        note="File A carries five agency identifier codes. Four are the Department; 011 is the Executive Office of the President. Every figure on this page uses the Department scope only.">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatTile label={`Department obligations, FY${latest.fiscalYear}`} value={fmtT(latest.obligationsIncurred)}
            sub="Agency codes 097, 021, 017, 057" tone="accent" />
          <StatTile label="All codes present in File A" value={fmtT(scopeRow?.all ?? 0)}
            sub="Includes agency 011, which is not the Department" />
          <StatTile label="Difference" value={fmtT((scopeRow?.all ?? 0) - latest.obligationsIncurred)}
            sub={`Reporting the unfiltered total as the Department overstates it by ${fmtPct(scopeRow?.overstatementPct ?? 0)}`}
            tone="warning" />
        </div>
        <Caveat>
          Control <strong className="text-navy-200">SCOPE-01</strong> asserts that no Department-scope figure
          includes agency code 011, and runs on every load. The scope split is published because it is the
          kind of definition error that silently moves a headline number by hundreds of billions of dollars.
        </Caveat>
      </Section>

      <Section title={`The chain, FY${latest.fiscalYear}`}
        note="Read top to bottom. The first three rows assemble the resources; the total is the footing; the next two are the flows against it.">
        <Waterfall steps={steps} />
        <Caveat>
          Controls <strong className="text-navy-200">SBR-01</strong> and <strong className="text-navy-200">SBR-02</strong>{' '}
          assert that obligations plus unobligated balance equal total budgetary resources, and that the resource
          components sum to that same total. Both foot to within 0.001% for every year shown.
        </Caveat>
      </Section>

      <Section title="Where obligated dollars actually sit"
        note="An obligation is a binding reservation, not a payment. File B splits it by USSGL account into undelivered orders (goods and services ordered but not yet received) and delivered orders (received, not yet paid) — and what has already been outlaid.">
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
              A rising undelivered-orders balance means more of the year&rsquo;s obligations are still ahead of
              delivery. It is a pipeline measure, not a performance measure: multi-year procurement and
              construction accounts carry large undelivered balances by design.
            </Caveat>
          </>
        ) : <Empty />}
      </Section>

      <Section title="A cross-system reconciliation that does not tie"
        note="File A and File B are separate submissions of the same execution, at different grain and with the same submission period. They should agree closely. In two of six years they do not, and that variance is published rather than hidden.">
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
        <div className="mt-4"><ProvenanceBar p={provB} /></div>
      </Section>

      <Section title={`What the money bought, FY${latest.fiscalYear}`}
        note="OMB object class, from File B. This is the answer to “what kind of thing is this obligation” — and it is the level at which contract spending can be separated from payroll and benefits.">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
          <BarList
            rows={objects.slice(0, 10).map((o) => ({
              key: o.code, label: `${o.code} · ${o.name}`, value: o.obligations,
              meta: o.majorClass,
            }))}
            caption={`Top 10 of ${objects.length} object classes carried in the extract.`}
          />
          <div>
            <h3 className="text-sm font-semibold text-navy-200 mb-4">Obligations by component</h3>
            <BarList
              rows={components.map((c) => ({
                key: c.key, label: c.label, value: c.obligationsIncurred,
                meta: `${fmtPct(c.obligationsIncurred / latest.obligationsIncurred * 100)} of Department obligations`,
              }))}
              colour="var(--series-3)"
            />
            {award && (
              <div className="mt-8 glass-card rounded-lg p-4">
                <p className="text-xs text-navy-300 leading-relaxed">
                  Contract awards in the same year total{' '}
                  <strong className="text-navy-100 tnum">{fmtB(award.obligation)}</strong> across{' '}
                  <strong className="text-navy-100 tnum">{fmtInt(award.actionCount)}</strong> actions —{' '}
                  {fmtPct(award.obligation / latest.obligationsIncurred * 100)} of total Department obligations.
                  Contract action data and account obligations are different reporting chains; see{' '}
                  <a href="/reconciliation" className="text-accent-400 hover:underline">Reconciliation</a>.
                </p>
              </div>
            )}
          </div>
        </div>
      </Section>

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

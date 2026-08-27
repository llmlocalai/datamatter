import type { Metadata } from 'next';
import Shell, { PageHeader, Section } from '@/components/Shell';
import { ProvenanceBar, Caveat } from '@/components/Provenance';
import { StatTile, BarList, DataTable } from '@/components/charts';
import { FyPicker } from '@/components/FyPicker';
import { fmtT, fmtB, fmtPct, fmtInt, fmtCount } from '@/components/format';
import { getProvenance, getAwardYears, getAwardDim, getReconciliation } from '@/lib/analytics';
import { NotLoaded } from '../execution/page';

export const metadata: Metadata = {
  title: 'Contracting · datamatter',
  description: 'Department of War contract obligations by set-aside, extent competed, recipient, and industry, from the USASpending award files.',
};
export const revalidate = 900;

export default async function ContractingPage({ searchParams }: { searchParams: { fy?: string } }) {
  const [prov, years, rec] = await Promise.all([
    getProvenance('contract_awards'), getAwardYears(), getReconciliation(),
  ]);
  if (!years.length) return <Shell><NotLoaded /></Shell>;

  const closed = years.filter((y) => !y.isPartialYear);
  const requested = Number(searchParams.fy);
  const row = years.find((y) => y.fiscalYear === requested) ?? closed[closed.length - 1] ?? years[years.length - 1];

  const [setAside, competed, recipients, naics, psc, subAgency, pricing] = await Promise.all([
    getAwardDim(row.fiscalYear, 'set_aside', 10),
    getAwardDim(row.fiscalYear, 'extent_competed', 8),
    getAwardDim(row.fiscalYear, 'recipient', 10),
    getAwardDim(row.fiscalYear, 'naics', 8),
    getAwardDim(row.fiscalYear, 'psc', 8),
    getAwardDim(row.fiscalYear, 'sub_agency', 8),
    getAwardDim(row.fiscalYear, 'pricing', 8),
  ]);
  const link = rec.find((r) => r.fiscalYear === row.fiscalYear);

  // Match buckets by their reported key, not by inference. The previous build
  // used a mixed ||/&& expression inside .find(), which was correct only because
  // the array happened to be ordered that way. Extent competed arrives as FPDS
  // single-letter codes, so filtering on spelled-out text matches nothing.
  const bucket = (rows: { key: string; obligation: number }[], keys: string[]) =>
    rows.filter((r) => keys.includes(r.key)).reduce((s, r) => s + r.obligation, 0);

  const noSetAside = setAside.find((s) => s.key === 'NO SET ASIDE USED.');
  const setAsideNotReported = setAside.find((s) => s.key === '(not reported)');
  const smallBusiness = setAside
    .filter((s) => s.key !== 'NO SET ASIDE USED.' && s.key !== '(not reported)')
    .reduce((sum, s) => sum + s.obligation, 0);

  // Extent competed is a different FAR concept from set-aside, in its own field.
  const competedTotal = bucket(competed, ['A', 'D', 'F']);   // full & open, after exclusion, under SAP
  const notCompeted   = bucket(competed, ['C', 'G']);        // not competed, not competed under SAP
  const notAvailable  = bucket(competed, ['B']);             // not available for competition
  const setAsideCoverage = 1 - (setAsideNotReported?.obligation ?? 0) / row.obligation;

  return (
    <Shell>
      <PageHeader
        eyebrow="Execution · contract awards"
        title="Contracting"
        lede="Contract obligations as reported to FPDS, by set-aside status, extent competed, recipient and industry. Set-aside and competition are separate fields answering separate questions, and are reported separately here."
      />

      <div className="mt-6 space-y-5">
        <ProvenanceBar p={prov} extra="Snapshot, not a live feed. The warehouse retains two vintages so that movement in closed years is measurable — see Reconciliation." />
        <FyPicker years={years.map((y) => y.fiscalYear)} active={row.fiscalYear} base="/contracting"
          partial={years.filter((y) => y.isPartialYear).map((y) => y.fiscalYear)} />
      </div>

      {row.isPartialYear && (
        <div className="mt-6 border border-amber-500/40 bg-amber-500/5 rounded-lg px-4 py-3">
          <p className="text-sm text-amber-200">
            <strong>FY{row.fiscalYear} is in progress.</strong> {fmtInt(row.actionCount)} actions against roughly
            4.4 million in a full year — totals and shares below are period-to-date.
          </p>
        </div>
      )}

      <Section title={`FY${row.fiscalYear} obligations`}>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatTile label="Obligated on contracts" value={fmtB(row.obligation)}
            sub={`${fmtInt(row.actionCount)} contract actions · FPDS federal action obligation`} tone="accent" />
          <StatTile label="Competed" value={fmtPct(competedTotal / row.obligation * 100)}
            sub={`${fmtB(competedTotal)} — full and open, after exclusion of sources, or under simplified acquisition procedures`}
            tone="good" />
          <StatTile label="Not competed" value={fmtPct(notCompeted / row.obligation * 100)}
            sub={`${fmtB(notCompeted)} — plus ${fmtB(notAvailable)} recorded as not available for competition`}
            tone="warning" />
          <StatTile label="Small-business set-asides" value={fmtPct(smallBusiness / row.obligation * 100)}
            sub={`${fmtB(smallBusiness)} across all set-aside programmes`} />
        </div>
        <Caveat>
          These figures answer different questions and do not sum.{' '}
          <strong className="text-navy-200">Extent competed</strong> records whether an acquisition was
          competed; <strong className="text-navy-200">set-aside</strong> records whether it was reserved for a
          category of business. An acquisition can be competed within a set-aside pool, or full and open with
          no set-aside — so presenting one as the other, as a combined
          &ldquo;full and open / no set-aside&rdquo; tile would, is a category error.
          {setAsideNotReported && (
            <> A further caution on the set-aside share: {fmtB(setAsideNotReported.obligation)} —{' '}
            {fmtPct((setAsideNotReported.obligation) / row.obligation * 100)} of FY{row.fiscalYear}{' '}
            obligations — carries no set-aside value at this vintage, so set-aside percentages describe the{' '}
            {fmtPct(setAsideCoverage * 100)} of obligations where the field is populated and must not be read
            as department-wide participation rates.</>
          )}
        </Caveat>
      </Section>

      <Section title="Competition and set-aside, side by side"
        note="Two fields, two charts. The distinction is the point.">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
          <div>
            <h3 className="text-sm font-semibold text-navy-200 mb-4">Extent competed</h3>
            <BarList colour="var(--series-2)" rows={competed.map((c) => ({
              key: c.key, label: c.label, value: c.obligation,
              meta: `${fmtPct(c.obligation / row.obligation * 100)} · ${fmtInt(c.actionCount)} actions`,
            }))} />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-navy-200 mb-4">Type of set-aside</h3>
            <BarList colour="var(--series-3)" rows={setAside.map((s) => ({
              key: s.key, label: s.label, value: s.obligation,
              meta: `${fmtPct(s.obligation / row.obligation * 100)} · ${fmtInt(s.actionCount)} actions`,
            }))} />
          </div>
        </div>
      </Section>

      <Section title="Who receives it, and for what">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
          <div>
            <h3 className="text-sm font-semibold text-navy-200 mb-4">Top recipients</h3>
            <BarList rows={recipients.map((r) => ({
              key: r.key, label: r.label, value: r.obligation,
              meta: `${fmtPct(r.obligation / row.obligation * 100)} of contract obligations`,
            }))} />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-navy-200 mb-4">Awarding sub-agency</h3>
            <BarList colour="var(--series-4)" rows={subAgency.map((r) => ({
              key: r.key, label: r.label, value: r.obligation,
              meta: `${fmtInt(r.actionCount)} actions`,
            }))} />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-navy-200 mb-4">Industry (NAICS)</h3>
            <BarList colour="var(--series-3)" rows={naics.map((r) => ({
              key: r.key, label: `${r.key} · ${r.label}`, value: r.obligation,
            }))} />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-navy-200 mb-4">Product or service</h3>
            <BarList colour="var(--series-5)" rows={psc.map((r) => ({
              key: r.key, label: `${r.key} · ${r.label}`, value: r.obligation,
            }))} />
          </div>
        </div>
      </Section>

      <Section title="Contract pricing type"
        note="Fixed-price versus cost-reimbursement is where contract risk allocation actually shows up.">
        <DataTable
          head={['Pricing type', 'Obligated', 'Share', 'Actions']}
          rows={pricing.map((p) => [p.label, fmtB(p.obligation),
            fmtPct(p.obligation / row.obligation * 100), fmtInt(p.actionCount)])}
        />
      </Section>

      {link && (
        <Section title="How this relates to account-level obligations"
          note="The figure above is the award-file measure. It is not the same number as the account-linked obligation for the same year.">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <StatTile label="Award files" value={fmtB(link.awardObligation)} sub="FPDS federal action obligation" />
            <StatTile label="File C (account-linked)" value={fmtB(link.filecObligation)} sub="Obligations tied to a Treasury account" />
            <StatTile label="Linkage" value={fmtPct(link.linkagePct)} tone="critical"
              sub="See Reconciliation for what this does and does not mean" />
          </div>
        </Section>
      )}
    </Shell>
  );
}

import type { Metadata } from 'next';
import Shell, { PageHeader, Section } from '@/components/Shell';
import { ProvenanceBar, Caveat } from '@/components/Provenance';
import { StatTile, BarList, DataTable } from '@/components/charts';
import { FyPicker } from '@/components/FyPicker';
import { fmtB, fmtPct, fmtInt } from '@/components/format';
import { getProvenance, getAssistanceYears, getAssistanceDim, getAssistanceVintageDrift } from '@/lib/analytics';
import { NotLoaded } from '../execution/page';

export const metadata: Metadata = {
  title: 'Assistance · datamatter',
  description: 'Department of War financial-assistance obligations — cooperative agreements, grants, and direct payments — from the USASpending assistance archive.',
};
export const revalidate = 900;

export default async function AssistancePage({ searchParams }: { searchParams: { fy?: string } }) {
  const [prov, years, drift] = await Promise.all([
    getProvenance('assistance_awards'), getAssistanceYears(), getAssistanceVintageDrift(),
  ]);
  if (!years.length) return <Shell><NotLoaded /></Shell>;

  const closed = years.filter((y) => !y.isPartialYear);
  const requested = Number(searchParams.fy);
  const row = years.find((y) => y.fiscalYear === requested) ?? closed[closed.length - 1] ?? years[years.length - 1];

  const [type, subAgency, recipients, cfda, state] = await Promise.all([
    getAssistanceDim(row.fiscalYear, 'assistance_type', 10),
    getAssistanceDim(row.fiscalYear, 'sub_agency', 8),
    getAssistanceDim(row.fiscalYear, 'recipient', 10),
    getAssistanceDim(row.fiscalYear, 'cfda', 8),
    getAssistanceDim(row.fiscalYear, 'state', 10),
  ]);
  const fyDrift = drift.find((d) => d.fiscalYear === row.fiscalYear);

  const bucket = (rows: { key: string; obligation: number }[], match: (k: string) => boolean) =>
    rows.filter((r) => match(r.key)).reduce((s, r) => s + r.obligation, 0);
  const cooperative = bucket(type, (k) => k.toUpperCase().includes('COOPERATIVE AGREEMENT'));
  const grants = bucket(type, (k) => k.toUpperCase().includes('GRANT'));
  const directPay = bucket(type, (k) => k.toUpperCase().includes('DIRECT PAYMENT'));

  return (
    <Shell>
      <PageHeader
        eyebrow="Execution · financial assistance"
        title="Assistance"
        lede="Cooperative agreements, project and formula grants, and direct payments obligated by the Department — a separate USASpending reporting chain from contracts, not account-linked and not reconciled against File C."
      />

      <div className="mt-6 space-y-5">
        <ProvenanceBar p={prov}
          extra="A newer, thinner cut than contracts: two warehouse vintages retained so far, so vintage drift below is a first look rather than an established pattern." />
        <FyPicker years={years.map((y) => y.fiscalYear)} active={row.fiscalYear} base="/assistance"
          partial={years.filter((y) => y.isPartialYear).map((y) => y.fiscalYear)} />
      </div>

      {row.isPartialYear && (
        <div className="mt-6 border border-amber-500/40 bg-amber-500/5 rounded-lg px-4 py-3">
          <p className="text-sm text-amber-200">
            <strong>FY{row.fiscalYear} is in progress.</strong> {fmtInt(row.actionCount)} transactions recorded
            so far — the total below is period-to-date.
          </p>
        </div>
      )}

      <Section title={`FY${row.fiscalYear} assistance obligations`}>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatTile label="Obligated on assistance awards" value={fmtB(row.obligation)}
            sub={`${fmtInt(row.actionCount)} transactions · federal action obligation`} tone="accent" />
          <StatTile label="Cooperative agreements" value={fmtPct(cooperative / row.obligation * 100)}
            sub={fmtB(cooperative)} />
          <StatTile label="Grants" value={fmtPct(grants / row.obligation * 100)} sub={fmtB(grants)} />
          <StatTile label="Direct payments" value={fmtPct(directPay / row.obligation * 100)} sub={fmtB(directPay)} />
        </div>
        <Caveat>
          This is federal-assistance spending, not contract spending, and it is not the Department&rsquo;s
          credit-programs picture: the assistance-type codes present in this warehouse cut are cooperative
          agreements, grants and direct payments — no loan or loan-guarantee codes appear here, so this page
          must not be read as covering direct loans or loan guarantees. It also has no linkage counterpart
          the way contract obligations do against File C; treat the figures here as reported by the assistance
          archive itself, not as cross-checked against an account-level source.
        </Caveat>
      </Section>

      <Section title="By assistance type and awarding sub-agency">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
          <div>
            <h3 className="text-sm font-semibold text-navy-200 mb-4">Assistance type</h3>
            <BarList colour="var(--series-2)" rows={type.map((t) => ({
              key: t.key, label: t.label, value: t.obligation,
              meta: `${fmtPct(t.obligation / row.obligation * 100)} · ${fmtInt(t.actionCount)} transactions`,
            }))} />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-navy-200 mb-4">Awarding sub-agency</h3>
            <BarList colour="var(--series-4)" rows={subAgency.map((s) => ({
              key: s.key, label: s.label, value: s.obligation,
              meta: `${fmtInt(s.actionCount)} transactions`,
            }))} />
          </div>
        </div>
      </Section>

      <Section title="Who receives it, and under what program">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
          <div>
            <h3 className="text-sm font-semibold text-navy-200 mb-4">Top recipients</h3>
            <BarList rows={recipients.map((r) => ({
              key: r.key, label: r.label, value: r.obligation,
              meta: `${fmtPct(r.obligation / row.obligation * 100)} of assistance obligations`,
            }))} />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-navy-200 mb-4">CFDA program</h3>
            <BarList colour="var(--series-3)" rows={cfda.map((c) => ({
              key: c.key, label: `${c.key} · ${c.label}`, value: c.obligation,
            }))} />
          </div>
        </div>
      </Section>

      <Section title="Recipient state" note="Recipient's reported state, not place of performance.">
        <DataTable
          head={['State', 'Obligated', 'Share', 'Transactions']}
          rows={state.map((s) => [s.label, fmtB(s.obligation),
            fmtPct(s.obligation / row.obligation * 100), fmtInt(s.actionCount)])}
        />
      </Section>

      {fyDrift && (
        <Section title="Vintage drift"
          note="The same comparison the contracting page makes for contract obligations, applied to assistance. With only two vintages retained so far this is a first reading, not an established pattern.">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <StatTile label={`FY${fyDrift.fiscalYear} as of ${fyDrift.vintageFrom}`} value={fmtB(fyDrift.obligationFrom)} />
            <StatTile label={`FY${fyDrift.fiscalYear} as of ${fyDrift.vintageTo}`} value={fmtB(fyDrift.obligationTo)} />
            <StatTile label="Change" value={fmtB(fyDrift.obligationDelta)}
              tone={fyDrift.yearClosed ? 'warning' : undefined}
              sub={fyDrift.yearClosed ? 'This fiscal year was reported closed at the earlier vintage.' : 'In-progress year; movement is expected.'} />
          </div>
        </Section>
      )}
    </Shell>
  );
}

import type { Metadata } from 'next';
import Shell, { PageHeader, Section } from '@/components/Shell';
import { ProvenanceBar, Caveat } from '@/components/Provenance';
import { StatTile, DataTable, BarList } from '@/components/charts';
import { fmtT, fmtInt, fmtPct } from '@/components/format';
import { getAuditPosture, getProvenance, getKbInventory, getReconciliation, getAuditMwCategories } from '@/lib/analytics';
import { NotLoaded } from '../execution/page';

export const metadata: Metadata = {
  title: 'Audit posture · datamatter',
  description: 'Audit opinion, material weakness counts, and scope limitations for the Department, read from the Agency Financial Report.',
};
export const revalidate = 900;

export default async function AuditPage() {
  const [posture, prov, inventory, rec, mwCategories] = await Promise.all([
    getAuditPosture(), getProvenance('curated_audit'),
    getKbInventory('oversight'), getReconciliation(), getAuditMwCategories(2025),
  ]);
  if (!posture.length) return <Shell><NotLoaded /></Shell>;

  const by = (k: string) => posture.find((p) => p.metricKey === k);
  const opinion = by('opinion');
  const mwFin = by('mw_financial_reporting');
  const mwOps = by('mw_operational');
  const assets = by('scope_assets');
  const resources = by('scope_resources');
  const bpc = by('bpc_error');
  const mwAuditor = by('mw_auditor_identified');
  const mwAuditorPrior = by('mw_auditor_identified_fy2024');
  const sigDef = by('significant_deficiencies');
  const entitiesDisclaimed = by('entities_disclaimed');
  const disclaimerStreak = by('disclaimer_streak_years');
  const nfrIssued = by('nfr_issued');
  const nfrOpen = by('nfr_open');
  const nfrClosed = by('nfr_closed');
  const jtf = by('jtf_established');
  const remediationCost = by('remediation_cost_fy2027');
  const targetFy2027 = by('target_fy2027');
  const targetFy2028 = by('target_fy2028');
  const closedRec = rec.filter((r) => !r.isPartialYear);
  const lastRec = closedRec[closedRec.length - 1];

  const fmtValue = (p: typeof posture[number] | undefined) => {
    if (!p) return '—';
    if (p.valueKind === 'text') return p.valueText ?? '—';
    if (p.valueKind === 'dollars') return fmtT(p.metricValue ?? 0);
    if (p.valueKind === 'percent') return `${p.metricValue}%`;
    return fmtInt(p.metricValue ?? 0);
  };

  return (
    <Shell>
      <PageHeader
        eyebrow="Oversight · financial statement audit"
        title="Audit posture"
        lede="What the Department's own Agency Financial Report says about the reliability of its financial statements. These are reported findings read from the document, not counts of files in a folder."
      />

      <div className="mt-6">
        <ProvenanceBar p={prov}
          extra="Read via a curated summary of the Agency Financial Report — a secondary read of a primary document. Each figure below records which it is, and the primary document is the citation." />
      </div>

      <Section title="FY2025 position">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatTile label="Audit opinion" value={fmtValue(opinion)} tone="critical"
            sub="Insufficient evidence to form an opinion on the agency-wide statements" />
          <StatTile label="Material weaknesses — financial reporting" value={fmtValue(mwFin)} tone="critical"
            sub="Reported under the Federal Managers' Financial Integrity Act" />
          <StatTile label="Material weaknesses — operational" value={fmtValue(mwOps)} tone="warning"
            sub="Operational control weaknesses reported alongside the financial ones" />
          <StatTile label="Budgetary resources within scope limitation" value={fmtValue(resources)} tone="warning"
            sub={`${fmtValue(assets)} of total assets similarly affected`} />
        </div>
        <Caveat>
          The previous version of this page displayed &ldquo;Material Weaknesses: 0&rdquo; in large red type.
          That figure was a literal zero written by the extract for every year, and it contradicted both the
          disclaimer of opinion carried in the same file and the Department&rsquo;s own reporting. It has been
          replaced with what the Agency Financial Report actually states.
        </Caveat>
      </Section>

      <Section title="The independent auditor's FY2025 report"
        note="A separate framework from the FMFIA self-assessment above: these are the material weaknesses the DoD OIG's independent auditor identified in testing the FY2025 statements (DODIG-2026-032), not the Department's own FMFIA count. The two are not comparable and are shown separately for that reason.">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatTile label="Material weaknesses (independent auditor)" value={fmtValue(mwAuditor)} tone="critical"
            sub={mwAuditorPrior ? `Down from ${fmtValue(mwAuditorPrior)} in FY2024` : undefined} />
          <StatTile label="Significant deficiencies" value={fmtValue(sigDef)} tone="warning"
            sub="Below the material-weakness threshold, still reported" />
          <StatTile label="Reporting entities disclaimed" value={fmtValue(entitiesDisclaimed)} tone="warning"
            sub="Of the Department's standalone reporting entities" />
          <StatTile label="Consecutive years disclaimed" value={fmtValue(disclaimerStreak)} tone="critical"
            sub="FY2018 through FY2025" />
        </div>
      </Section>

      <Section title="The 26 material weaknesses named in the FY2025 audit"
        note="As categorized by the independent auditor's report, in the order given there. A category is not a dollar figure or an estimate of misstatement — it names where the auditor could not obtain sufficient evidence.">
        <DataTable
          head={['#', 'Material weakness', 'Citation']}
          rows={mwCategories.map((m) => [m.rank, m.category, m.citation])}
        />
      </Section>

      <Section title="The 2027-2028 strategy shift"
        note="In 2026 the Department moved from decentralized FIAR control-remediation toward a centralized, substantive-testing effort. GAO's report on the change (GAO-26-109115) is the citation for this section.">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatTile label="Joint Task Force Audit" value={fmtValue(jtf)} tone="accent" />
          <StatTile label="FY2027 opinion target" value={fmtValue(targetFy2027)} />
          <StatTile label="FY2028 opinion target" value={fmtValue(targetFy2028)} />
          <StatTile label="Projected FY2027 remediation cost" value={fmtValue(remediationCost)} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-4">
          <StatTile label="NFRs issued, FY2025" value={fmtValue(nfrIssued)}
            sub="Notices of Findings and Recommendations" />
          <StatTile label="NFRs open at year-end" value={fmtValue(nfrOpen)} tone="warning" />
          <StatTile label="NFRs closed in FY2025" value={fmtValue(nfrClosed)} tone="warning"
            sub={nfrOpen && nfrClosed ? `${fmtPct((Number(nfrClosed.metricValue ?? 0) / Number(nfrOpen.metricValue ?? 1)) * 100)} of the open total` : undefined} />
        </div>
        <Caveat>
          The new approach validates account balances directly with supporting documentation rather than
          working primarily through remediated internal controls, and reduces the number of standalone
          financial statements produced department-wide. GAO&rsquo;s own review of the shift raises open questions
          it has not resolved: whether fewer standalone statements narrow oversight, whether deprioritizing
          the scope-limiting material weaknesses above for multiple years delays the root-cause fixes those
          weaknesses represent, whether fraud-risk controls keep pace under compressed timelines, and whether
          the substantive-testing approach that produced a clean opinion for the Marine Corps — a component
          holding roughly one percent of Department assets — scales to the much larger Army, Navy, and Air
          Force. None of that is resolved by this page; it is recorded here because it is the citation-bearing
          context for the FY2027 and FY2028 targets above.
        </Caveat>
      </Section>

      <Section title="Every reported figure, with its citation"
        note="Nothing on this page is inferred from a filename or a file count.">
        <DataTable
          head={['Metric', 'FY', 'Value', 'Citation']}
          rows={posture.map((p) => [p.metricLabel, String(p.fiscalYear), fmtValue(p), p.citation])}
          caption="Where a row is a secondary read, the note recorded with it says so; the citation always names the primary document."
        />
        <div className="mt-6 space-y-2">
          {posture.filter((p) => p.note).map((p) => (
            <p key={p.metricKey} className="text-xs text-navy-500 leading-relaxed">
              <span className="text-navy-400 font-medium">{p.metricLabel}. </span>{p.note}
            </p>
          ))}
        </div>
      </Section>

      <Section title="What this site's own data contributes"
        note="The account-linkage gap measured on the reconciliation page is evidence in the same domain as the reported weaknesses: it concerns whether a contract obligation can be traced to a Treasury account.">
        {lastRec && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <StatTile label={`Contract obligations, FY${lastRec.fiscalYear}`} value={fmtT(lastRec.awardObligation)}
              sub="Award files (FPDS)" />
            <StatTile label="Traceable to a Treasury account" value={fmtT(lastRec.filecObligation)}
              sub={`${fmtPct(lastRec.linkagePct)} of the award-file population`} tone="warning" />
            <StatTile label="Named quantified misstatement" value={fmtValue(bpc)} tone="critical"
              sub={bpc?.metricLabel} />
          </div>
        )}
        <Caveat>
          Stated carefully: a low linkage rate is a completeness measure over two reporting chains, not an
          assertion that obligations are unsupported. It belongs on this page because traceability from a
          transaction to an account is the same evidence chain the financial statement audit tests — not
          because the two numbers are the same measure.
        </Caveat>
      </Section>

      <Section title="Oversight document inventory"
        note="Counts of documents held in the knowledge bank. A document is not a finding, and this table is labelled as an inventory for that reason.">
        <BarList
          format="int" colour="var(--series-4)"
          rows={inventory.map((i) => ({ key: i.folder, label: i.label, value: i.docCount }))}
          caption="The prior build counted PDF files in the GAO folder and rendered the total as “Total Findings”. A GAO report is not a finding; a single report carries many."
        />
      </Section>
    </Shell>
  );
}

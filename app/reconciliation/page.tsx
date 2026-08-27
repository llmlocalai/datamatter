import type { Metadata } from 'next';
import Shell, { PageHeader, Section } from '@/components/Shell';
import { ProvenanceBar, Caveat } from '@/components/Provenance';
import { StatTile, LineTrend, DataTable, DriftBars, BarList, Empty } from '@/components/charts';
import { fmtT, fmtB, fmtM, fmtPct, fmtInt, fmtCount, fmtSignedM } from '@/components/format';
import { getProvenance, getReconciliation, getVintageDrift, getAwardYears } from '@/lib/analytics';
import { NotLoaded } from '../execution/page';

export const metadata: Metadata = {
  title: 'Reconciliation · datamatter',
  description:
    'Contract award obligations reconciled to account-linked File C obligations, and the movement of closed fiscal years between warehouse vintages.',
};
export const revalidate = 900;

export default async function ReconciliationPage() {
  const [prov, provAward, rec, drift, awards] = await Promise.all([
    getProvenance('file_c_reconciliation'), getProvenance('contract_awards'),
    getReconciliation(), getVintageDrift(), getAwardYears(),
  ]);
  if (!rec.length) return <Shell><NotLoaded /></Shell>;

  const closed = rec.filter((r) => !r.isPartialYear);
  const first = closed[0], last = closed[closed.length - 1];
  const drop = first.linkagePct - last.linkagePct;

  return (
    <Shell>
      <PageHeader
        eyebrow="Reconciliation · award files to File C"
        title={<>Two reporting chains for the same contract dollar, and the gap between them</>}
        lede="Contract obligations reach the public record twice: as FPDS award actions, and as account-linked transactions that components tie to a Treasury account. They do not agree, the gap is widening, and that is the most consequential thing this dataset says."
      />

      <div className="mt-6"><ProvenanceBar p={prov} /></div>

      <Section title="The headline"
        note="These are not two measurements of one quantity. They are two submissions with different purposes, so the ratio measures reporting linkage — never error, and never missing money.">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatTile label={`Award files, FY${last.fiscalYear}`} value={fmtB(last.awardObligation)}
            sub={`${fmtInt(last.awardActions)} contract actions (FPDS federal action obligation)`} tone="accent" />
          <StatTile label={`File C, FY${last.fiscalYear}`} value={fmtB(last.filecObligation)}
            sub={`${fmtCount(last.filecRows)} rows across ${fmtCount(last.filecAwards)} awards`} />
          <StatTile label="Linkage" value={fmtPct(last.linkagePct)}
            sub="Share of award-file obligations that carry a Treasury account link" tone="critical" />
          <StatTile label={`Change since FY${first.fiscalYear}`} value={`−${drop.toFixed(1)} pts`}
            sub={`Linkage fell from ${fmtPct(first.linkagePct)} to ${fmtPct(last.linkagePct)} across closed years`}
            tone="warning" />
        </div>
      </Section>

      <Section title="Linkage completeness is falling, not holding"
        note="The share of award-file contract obligations that File C ties to an account, by fiscal year.">
        <LineTrend
          label="Account linkage rate"
          points={rec.map((r) => ({ x: r.fiscalYear, y: r.linkagePct, partial: r.isPartialYear }))}
          format="pct0"
          reference={{ y: first.linkagePct, label: `FY${first.fiscalYear} level` }}
        />
        <Caveat>
          Read this as a completeness indicator for the account-linkage submission, not as an audit finding
          about the underlying obligations. A dollar absent from File C is not a dollar that was not obligated;
          it is a dollar whose account linkage did not reach this dataset at this vintage. The direction and
          the size of the move are what matter.
        </Caveat>
      </Section>

      <Section title="The full reconciliation">
        <DataTable
          head={['Fiscal year', 'Award files', 'Actions', 'File C', 'File C rows', 'Linked awards', 'Linkage', 'Not linked here']}
          rows={rec.map((r) => [
            `FY${r.fiscalYear}${r.isPartialYear ? ' *' : ''}`,
            fmtB(r.awardObligation), fmtInt(r.awardActions),
            fmtB(r.filecObligation), fmtInt(r.filecRows), fmtInt(r.filecAwards),
            fmtPct(r.linkagePct), fmtB(r.unlinkedObligation),
          ])}
          caption="* fiscal year in progress; both chains are incomplete and the ratio is not comparable to a closed year. Control REC-01 asserts that File C never exceeds the award-file population."
        />
        <Caveat>
          Why the two differ by construction: the award files record every FPDS contract action for the
          agency, while File C records the obligations that components mapped to a Treasury Account Symbol in
          their submission. Differences in timing, in modification handling, and in which components submitted
          complete account attribution all move the ratio. What the trend cannot be explained away as is a
          change in the underlying contract volume — action counts held near 4.4 million in every closed year.
        </Caveat>
      </Section>

      <Section title="Contract volume held steady while linkage fell"
        note="If linkage were falling because there were fewer contracts to link, action counts would move with it. They do not.">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
          <BarList
            rows={awards.filter((a) => !a.isPartialYear).map((a) => ({
              key: String(a.fiscalYear), label: `FY${a.fiscalYear}`, value: a.actionCount,
              meta: `${fmtB(a.obligation)} obligated`,
            }))}
            format="int" colour="var(--series-3)"
            caption="Contract actions per closed fiscal year, award files."
          />
          <BarList
            rows={rec.filter((r) => !r.isPartialYear).map((r) => ({
              key: String(r.fiscalYear), label: `FY${r.fiscalYear}`, value: r.filecRows,
              meta: `${fmtPct(r.linkagePct)} linkage · ${fmtB(r.filecObligation)}`,
            }))}
            format="int" colour="var(--series-2)"
            caption="File C rows per closed fiscal year. The collapse is in the linkage submission, not in contracting."
          />
        </div>
      </Section>

      <Section title="Closed fiscal years still move"
        note="Two warehouse vintages of the same award files, one month apart. If a snapshot's figures were stable, every bar here would be zero.">
        {drift.length ? (
          <>
            <DriftBars rows={drift.map((d) => ({
              label: `FY${d.fiscalYear}`, value: d.obligationDelta,
              closed: d.yearClosed,
              sub: `${fmtSignedM(d.obligationDelta)} · ${d.actionDelta >= 0 ? '+' : '−'}${fmtInt(Math.abs(d.actionDelta))} actions`,
            }))} />
            <div className="mt-8">
              <DataTable
                head={['Fiscal year', 'Vintage ' + drift[0].vintageFrom, 'Vintage ' + drift[0].vintageTo, 'Change', 'Action change', 'Status']}
                rows={drift.map((d) => [
                  `FY${d.fiscalYear}`, fmtB(d.obligationFrom), fmtB(d.obligationTo),
                  fmtSignedM(d.obligationDelta),
                  `${d.actionDelta >= 0 ? '+' : '−'}${fmtInt(Math.abs(d.actionDelta))}`,
                  d.yearClosed ? 'closed year' : 'in progress',
                ])}
              />
            </div>
            <Caveat>
              FY2021 closed five years ago and still gained {fmtM(Math.abs(drift[0].obligationDelta))} between
              these two extracts. FY2023 lost dollars <em>and</em> actions, meaning records were removed, not
              just revised. This is why every figure on this site is stamped with the vintage it came from: a
              number without one cannot be reproduced, and a disagreement between two numbers is a vintage
              difference until proven otherwise.
            </Caveat>
          </>
        ) : <Empty />}
        <div className="mt-6"><ProvenanceBar p={provAward} /></div>
      </Section>

      <Section title="What would close the gap"
        note="Stated as work, not as a finding — this is the analysis a comptroller-side team would run next.">
        <ol className="space-y-4 max-w-3xl">
          {[
            ['Decompose by component.', 'File C attribution is submitted by component. Splitting linkage by awarding sub-agency identifies whether the fall is department-wide or concentrated in a small number of submitters, which changes the remediation entirely.'],
            ['Separate timing from completeness.', 'Re-run the ratio at successive vintages for the same fiscal year. If FY2024 linkage rises with each extract, the gap is submission lag; if it stays flat, it is a completeness failure.'],
            ['Test modification handling.', 'Award files count every modification as an action. If File C attributes only base awards for some submitters, the two populations differ structurally and the ratio needs a like-for-like denominator.'],
            ['Tie to the audit trail.', 'Account linkage is what lets a contract obligation be traced to a Treasury account, which is the same evidence chain that supports the universe of transactions in the financial statement audit.'],
          ].map(([h, b]) => (
            <li key={h} className="border-l-2 border-navy-700 pl-4">
              <p className="text-navy-100 font-semibold text-sm">{h}</p>
              <p className="text-navy-400 text-sm mt-1 leading-relaxed">{b}</p>
            </li>
          ))}
        </ol>
      </Section>
    </Shell>
  );
}

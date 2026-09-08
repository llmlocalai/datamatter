import type { Metadata } from 'next';
import Link from 'next/link';
import Shell, { PageHeader, Section } from '@/components/Shell';
import { ProvenanceBar, Caveat, VintageChip } from '@/components/Provenance';
import { StatTile, DataTable, LineTrend, StackedFY, BarList } from '@/components/charts';
import { fmtT, fmtPct, fmtInt } from '@/components/format';
import {
  getProvenance, getProgramYears, getProgramCoverage, getProgramFilec,
  getProgramAccounts, getProgramAwards, getProgramDim, getReconciliation,
  getAuditPosture, getAuditMwCategories, getF35BudgetLines, getWarBudgetVintage,
  getControls,
} from '@/lib/analytics';
import { NotLoaded } from '../execution/page';

export const metadata: Metadata = {
  title: 'The traceability break · datamatter',
  description:
    'F-35 followed from the FY2027 budget request through obligation into the account records and out to the audit findings that judge them — and the one link in that chain that fails.',
};
export const revalidate = 900;

const F35 = '198';
const K = 1000; // the exhibit tables are $ thousands

/* The chain is the argument, so it is drawn rather than described. Three links
   render as intact arrows; the third is drawn broken, because that is the
   finding. Labels come from the data, not from the diagram. */
function ChainDiagram({ links }: {
  links: { n: string; label: string; l1: string; l2: string; holds: boolean }[];
}) {
  const W = 940, boxW = 200, gap = (W - boxW * 4) / 3;
  return (
    <svg viewBox={`0 0 ${W} 150`} className="w-full h-auto" role="img"
      aria-label="Four-link chain: budget to execution holds, execution to accounts is broken, accounts to audit holds.">
      <defs>
        <marker id="ar" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7"
          orient="auto-start-reverse">
          <path d="M0,1 L9,5 L0,9 z" fill="var(--series-1)" />
        </marker>
        <marker id="arBad" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7"
          orient="auto-start-reverse">
          <path d="M0,1 L9,5 L0,9 z" fill="var(--status-critical)" />
        </marker>
      </defs>
      {links.map((l, i) => {
        const x = i * (boxW + gap);
        const nextBroken = !links[i + 1]?.holds;
        const cx = x + boxW + gap / 2;
        return (
          <g key={l.n}>
            <rect x={x} y={14} width={boxW} height={78} rx={4}
              fill={l.holds ? 'rgba(57,135,229,.10)' : 'rgba(255,122,122,.10)'}
              stroke={l.holds ? 'var(--series-1)' : 'var(--status-critical)'}
              strokeWidth={1} strokeDasharray={l.holds ? undefined : '5 3'} />
            <text x={x + 14} y={38} fontSize="13" fontWeight="600"
              fill={l.holds ? 'var(--series-1)' : 'var(--status-critical)'}
              className="font-mono">{l.n} · {l.label.toUpperCase()}</text>
            <text x={x + 14} y={60} fontSize="12" fill="#c4d4e6" className="font-mono">{l.l1}</text>
            <text x={x + 14} y={79} fontSize="12"
              fill={l.holds ? '#c4d4e6' : 'var(--status-critical)'} className="font-mono">{l.l2}</text>
            {i < links.length - 1 && (nextBroken ? (
              <g>
                <line x1={x + boxW + 4} y1={53} x2={cx - 12} y2={53}
                  stroke="var(--status-critical)" strokeWidth={1.5} />
                <path d={`M${cx - 12},45 L${cx - 2},53 L${cx - 12},61 M${cx + 12},45 L${cx + 2},53 L${cx + 12},61`}
                  fill="none" stroke="var(--status-critical)" strokeWidth={1.5}
                  strokeLinecap="round" strokeLinejoin="round" />
                <line x1={cx + 12} y1={53} x2={x + boxW + gap - 4} y2={53}
                  stroke="var(--status-critical)" strokeWidth={1.5} markerEnd="url(#arBad)" />
              </g>
            ) : (
              <line x1={x + boxW + 4} y1={53} x2={x + boxW + gap - 4} y2={53}
                stroke="var(--series-1)" strokeWidth={1.5} markerEnd="url(#ar)" />
            ))}
          </g>
        );
      })}
      <text x={W / 2} y={122} fontSize="12.5" textAnchor="middle" className="font-mono"
        fill="var(--status-critical)" fontWeight="600">
        {links[2]?.l2} — and File C, the file that would settle it, is empty for these appropriations
      </text>
      <text x={W / 2} y={141} fontSize="12" textAnchor="middle" className="font-mono" fill="#e8c88a">
        the program dimension lives only in the award files; the account dimension only in File A and File B
      </text>
    </svg>
  );
}

export default async function TraceabilityPage() {
  const [prov, provAwards, provAudit, years, coverage, filec, recon, posture, mw,
         budget, budgetVintage, controls] = await Promise.all([
    getProvenance('program_execution'), getProvenance('contract_awards'),
    getProvenance('curated_audit'), getProgramYears(F35), getProgramCoverage(),
    getProgramFilec(F35), getReconciliation(), getAuditPosture(),
    getAuditMwCategories(2025), getF35BudgetLines(), getWarBudgetVintage(), getControls(),
  ]);
  if (!years.length) return <Shell><NotLoaded /></Shell>;

  const closed = years.filter((y) => !y.isPartialYear);
  const latest = closed[closed.length - 1] ?? years[years.length - 1];
  const first = years[0];
  const [accounts, awards, recipients, competed, pricing] = await Promise.all([
    getProgramAccounts(F35, latest.fiscalYear, 8),
    getProgramAwards(F35, latest.fiscalYear, 6),
    getProgramDim(F35, latest.fiscalYear, 'recipient', 5),
    getProgramDim(F35, latest.fiscalYear, 'extent_competed', 5),
    getProgramDim(F35, latest.fiscalYear, 'pricing', 5),
  ]);

  // ---- budget layer ($K -> $) ---------------------------------------------
  const proc = budget.filter((b) => b.docCode === 'p1');
  const rdte = budget.filter((b) => b.docCode === 'r1');
  const S = (rows: typeof budget, f: (b: typeof budget[number]) => number) =>
    rows.reduce((s, b) => s + Number(f(b)), 0) * K;
  const fy25 = S(budget, (b) => b.fy25);
  const fy26disc = S(budget, (b) => b.fy26disc), fy26mand = S(budget, (b) => b.fy26mand);
  const fy27disc = S(budget, (b) => b.fy27disc), fy27mand = S(budget, (b) => b.fy27mand);
  const fy26 = fy26disc + fy26mand, fy27 = fy27disc + fy27mand;
  const qty = (f: (b: typeof budget[number]) => number) => proc.reduce((s, b) => s + Number(f(b)), 0);

  // ---- cross-layer ---------------------------------------------------------
  const fcLatest = filec.find((f) => f.fiscalYear === latest.fiscalYear);
  const covLatest = coverage.find((c) => c.fiscalYear === latest.fiscalYear);
  const jsfMw = mw.find((m) => String(m.category ?? '').toUpperCase().includes('JOINT STRIKE FIGHTER'));
  const V = (k: string) => posture.find((p) => p.metricKey === k);
  const num = (k: string) => { const v = V(k); return v?.metricValue != null ? Number(v.metricValue) : null; };
  const txt = (k: string) => V(k)?.valueText ?? null;
  const outOfScope = Array.from(new Set(accounts.flatMap((a) => a.outOfScopeAccounts ?? []))).sort();
  const topAward = awards[0];
  const progControls = controls.filter((c) => c.code.startsWith('PROG-'));
  const closedFilecYears = filec.filter((f) => (f.submissionPeriod ?? '').endsWith('P12'));

  const chain = [
    { n: '01', label: 'Budget', holds: budget.length > 0,
      l1: budget.length ? `${fmtT(fy25)} · FY${latest.fiscalYear}` : 'exhibits not loaded',
      l2: budget.length ? `${budget.length} lines · ${fmtInt(qty((b) => b.qty25))} aircraft` : '—' },
    { n: '02', label: 'Execution', holds: true,
      l1: `${fmtT(latest.obligation)} obligated`,
      l2: `${fmtInt(latest.actionCount)} actions · ${fmtInt(latest.awardCount)} contracts` },
    { n: '03', label: 'Accounts', holds: false,
      l1: `${fmtT(latest.untraceableObligation)} untraceable`,
      l2: `${fmtPct(latest.traceablePct)} names an account` },
    { n: '04', label: 'Audit', holds: true,
      l1: (txt('opinion') ?? 'Disclaimer of opinion').slice(0, 24),
      l2: jsfMw ? `MW #${jsfMw.rank} of ${mw.length} — named` : 'DODIG-2026-032' },
  ];

  return (
    <Shell>
      <PageHeader
        eyebrow={`Oversight · pilot analysis · program ${F35} — F-35`}
        title={<>The traceability break</>}
        lede="Can one major program be followed from the budget request, through obligation, into the account records, and out to the audit findings that judge those records — using only the sources this site publishes? Three of the four links hold. The one that fails is the one that matters, and the audit layer names it independently."
      />

      <div className="mt-6 flex flex-wrap gap-x-8 gap-y-2 text-[12px] font-mono text-navy-500">
        <span><span className="text-navy-400">Budget</span> FY2027 P-1 / R-1 · {budgetVintage.ingestedAt ?? 'not loaded'}</span>
        <span><span className="text-navy-400">Execution</span> contracts vintage {latest.vintage}</span>
        <span><span className="text-navy-400">Accounts</span> File A · File C {provAwards?.vintage ?? ''}</span>
        <span><span className="text-navy-400">Audit</span> {provAudit?.vintage ?? ''}</span>
      </div>

      <div className="mt-5">
        <ProvenanceBar p={prov}
          extra="Every figure on this page is queried live from the loaded data, not transcribed from the analysis memo. The budget layer is the one exception to the dm_load provenance system — see section 01." />
      </div>

      {/* ------------------------------------------------------------ chain */}
      <Section title="The chain, as the data actually supports it">
        <div className="glass-card rounded-lg p-6">
          <ChainDiagram links={chain} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
          <StatTile label={`FY${latest.fiscalYear} F-35 obligations`} value={fmtT(latest.obligation)}
            tone="accent" sub={`${fmtInt(latest.actionCount)} actions · ${fmtInt(latest.awardCount)} contracts`} />
          <StatTile label="Of those dollars, naming no Treasury account"
            value={fmtPct(100 - latest.traceablePct)} tone="critical"
            sub={`${fmtT(latest.untraceableObligation)} · was ${fmtPct(100 - first.traceablePct)} in FY${first.fiscalYear}`} />
          <StatTile label="Carried by one contract"
            value={topAward ? fmtPct(topAward.shareOfFyPct) : '—'}
            sub={topAward ? `${topAward.awardIdPiid} · ${fmtInt(topAward.actionCount)} actions` : undefined} />
          <StatTile label="Department-wide File C linkage"
            value={recon.find((r) => r.fiscalYear === latest.fiscalYear)
              ? fmtPct(recon.find((r) => r.fiscalYear === latest.fiscalYear)!.linkagePct) : '—'}
            tone="critical"
            sub={fcLatest?.submissionPeriod ? `year closed at ${fcLatest.submissionPeriod}` : undefined} />
        </div>
        <Caveat>
          The program dimension exists only in the award files. The account dimension exists only in File A
          and File B. <strong className="text-navy-50">File C is the sole bridge between them</strong> — and
          for the F-35 appropriations it is, in this warehouse cut, empty.
        </Caveat>
      </Section>

      {/* --------------------------------------------------------- 01 budget */}
      <Section title="01 · Budget — what was asked for"
        note="The F-35 lines in the FY2027 President's Budget exhibits, read live from the loaded exhibit tables. Procurement totals are Add rows only — weapon system cost, less prior-year advance procurement, plus current-year AP — so the Non-Add advance-procurement detail is not double counted.">
        {budget.length === 0 ? (
          <p className="text-sm text-navy-300">
            The FY2027 exhibit tables are not loaded, so the budget layer is withheld rather than shown
            from memory. Run <code className="font-mono text-[12px] text-accent-400">npm run refresh</code>.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <StatTile label={`FY${latest.fiscalYear} enacted`} value={fmtT(fy25)}
                sub={`${fmtInt(qty((b) => b.qty25))} aircraft · ${proc.length} procurement lines, ${rdte.length} RDT&E`} />
              <StatTile label="FY2026 total" value={fmtT(fy26)}
                sub={`${fmtInt(qty((b) => b.qty26))} aircraft · ${fmtT(fy26mand)} of it reconciliation funding`} />
              <StatTile label="FY2027 request" value={fmtT(fy27)} tone="accent"
                sub={`${fmtInt(qty((b) => b.qty27))} aircraft · ${fy26 ? fmtPct((fy27 / fy26 - 1) * 100) : '—'} against FY2026`} />
              <StatTile label="FY2027 mandatory share" value={fy27 ? fmtPct(fy27mand / fy27 * 100) : '—'}
                tone="warning"
                sub={`Discretionary base ${fy26disc ? fmtPct((fy27disc / fy26disc - 1) * 100) : '—'} against FY2026`} />
            </div>

            <div className="mt-10 grid grid-cols-1 lg:grid-cols-2 gap-10">
              <div>
                <h3 className="text-sm font-semibold text-navy-200 mb-4">
                  Discretionary and mandatory, by year
                </h3>
                <StackedFY format="billions"
                  years={[
                    { fy: latest.fiscalYear, parts: [fy25, 0] },
                    { fy: 2026, parts: [fy26disc, fy26mand] },
                    { fy: 2027, parts: [fy27disc, fy27mand] },
                  ]}
                  series={[
                    { label: 'Discretionary', colour: 'var(--series-1)' },
                    { label: 'Mandatory / PL 119-21', colour: 'var(--series-2)' },
                  ]} />
                <p className="text-[12px] text-navy-500 mt-4 leading-relaxed">
                  The headline reverses when the request is split. The total grows; the discretionary base
                  does not. A trend line across F-35 totals without this split describes a different
                  program in FY2027 than in FY2026.
                </p>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-navy-200 mb-4">Aircraft quantity</h3>
                <StackedFY format="int"
                  years={[
                    { fy: latest.fiscalYear, parts: [qty((b) => b.qty25)] },
                    { fy: 2026, parts: [qty((b) => b.qty26)] },
                    { fy: 2027, parts: [qty((b) => b.qty27)] },
                  ]}
                  series={[{ label: 'Aircraft', colour: 'var(--series-4)' }]} />
                <p className="text-[12px] text-navy-500 mt-4 leading-relaxed">
                  Quantity is summed on weapon-system-cost rows only. Modification and spares lines carry
                  dollars but no aircraft, so dividing the totals above by these counts would not give a
                  unit cost — that needs the P-5 / P-21 exhibits, which are not in this cut.
                </p>
              </div>
            </div>

            <div className="mt-10">
              <DataTable
                caption="Amounts converted from the exhibits' $ thousands. Joint Strike Missile (3020F JSM000) is a different program and is deliberately excluded."
                head={['Account', 'Line', 'Title', `FY${latest.fiscalYear}`, 'FY2027 disc.', 'FY2027 mand.']}
                rows={budget.map((b) => [
                  b.account, b.bli || '—', b.title,
                  fmtT(Number(b.fy25) * K), fmtT(Number(b.fy27disc) * K), fmtT(Number(b.fy27mand) * K),
                ])} />
            </div>
            <div className="mt-5">
              <VintageChip source="FY2027 budget exhibits (p1 · r1)"
                vintage={budgetVintage.ingestedAt ?? 'unknown'} />
            </div>

            <div className="mt-6 alert-warning rounded-lg px-4 py-3">
              <p className="text-[12px] font-mono uppercase tracking-wider text-[color:var(--status-warning)] font-semibold">
                What the exhibits do not contain
              </p>
              <p className="text-sm text-navy-100 mt-2 leading-relaxed">
                A scan of the FY2027 O-1 returns <strong className="text-navy-50">no F-35 line at all</strong>.
                Operation and maintenance — where sustainment is funded, and the larger share of the
                program&rsquo;s lifecycle cost — carries no program dimension at exhibit level. Yet F-35 contracts
                draw on O&amp;M accounts, as section 03 shows. Those dollars are real, they are obligated
                against F-35 contracts, and no &ldquo;-1&rdquo; exhibit attributes them to the program.
              </p>
            </div>
            <Caveat>
              These figures come from <code className="font-mono text-[12px]">war_budget_line</code>, which
              predates the <code className="font-mono text-[12px]">dm_load</code> provenance system and
              carries its own ingest stamp instead of a load row. Stated here rather than left to look like
              the rest of the site&rsquo;s measures.
            </Caveat>
          </>
        )}
      </Section>

      {/* ------------------------------------------------------ 02 execution */}
      <Section title="02 · Execution — what was obligated"
        note="Contract obligations tagged to the F-35 acquisition program code. Action counts are flat within a narrow band while dollars move by multiples: obligation volume on this program is not an activity measure, it is a definitization calendar.">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatTile label={`FY${latest.fiscalYear} obligations`} value={fmtT(latest.obligation)}
            tone="accent" sub={`${fmtInt(latest.actionCount)} actions across ${fmtInt(latest.awardCount)} contracts`} />
          <StatTile label="Carried by five actions" value={fmtPct(latest.top5Pct)}
            sub={fmtT(latest.top5Obligation)} />
          <StatTile label="Landed in August–September" value={fmtPct(latest.lateQuarterPct)}
            sub={`${fmtT(latest.lateQuarterObligation)} — year-end concentration`} />
          <StatTile label="Largest single contract"
            value={topAward ? fmtPct(topAward.shareOfFyPct) : '—'} tone="warning"
            sub={topAward ? `${topAward.awardIdPiid} · ${fmtT(topAward.obligation)}` : undefined} />
        </div>

        <div className="mt-10 grid grid-cols-1 lg:grid-cols-2 gap-10">
          <div>
            <h3 className="text-sm font-semibold text-navy-200 mb-4">
              Obligations, and the share in the five largest actions
            </h3>
            <StackedFY format="billions"
              years={years.map((y) => ({ fy: y.fiscalYear, partial: y.isPartialYear,
                parts: [Math.min(y.top5Obligation, y.obligation),
                        Math.max(0, y.obligation - y.top5Obligation)] }))}
              series={[
                { label: 'Five largest actions', colour: 'var(--series-1)' },
                { label: 'Everything else', colour: 'var(--series-3)' },
              ]} />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-navy-200 mb-4">Action count, same years</h3>
            <StackedFY format="int"
              years={years.map((y) => ({ fy: y.fiscalYear, partial: y.isPartialYear,
                parts: [y.actionCount] }))}
              series={[{ label: 'Actions', colour: 'var(--series-4)' }]} />
            <p className="text-[12px] text-navy-500 mt-4 leading-relaxed">
              Read the two together. Dollars swing by multiples while the count barely moves — the years
              differ by when a production lot was definitized, not by how much work was placed on contract.
            </p>
          </div>
        </div>

        <div className="mt-10">
          <DataTable
            head={['Fiscal year', 'Obligated', 'Actions', 'Contracts', 'Top-5 share', 'Aug–Sep share', 'Names an account']}
            rows={years.map((y) => [
              `FY${y.fiscalYear}${y.isPartialYear ? ' *' : ''}`,
              fmtT(y.obligation), fmtInt(y.actionCount), fmtInt(y.awardCount),
              fmtPct(y.top5Pct), fmtPct(y.lateQuarterPct), fmtPct(y.traceablePct),
            ])} />
        </div>

        {topAward && (
          <div className="mt-8 alert-warning rounded-lg px-4 py-3">
            <p className="text-[12px] font-mono uppercase tracking-wider text-[color:var(--status-warning)] font-semibold">
              The year in one contract
            </p>
            <p className="text-sm text-navy-100 mt-2 leading-relaxed">
              <code className="font-mono text-[12px] text-navy-50">{topAward.awardIdPiid}</code> carries{' '}
              <strong className="text-navy-50">{fmtT(topAward.obligation)} across {fmtInt(topAward.actionCount)} modifications
              — {fmtPct(topAward.shareOfFyPct)} of all FY{latest.fiscalYear} F-35 obligations</strong> to{' '}
              {topAward.recipientName}.{topAward.largestActionDate ? ` Its largest action fell on ${topAward.largestActionDate}.` : ''}
              {topAward.description ? (
                <> <span className="font-mono text-[12px] text-navy-200">{topAward.description}</span></>
              ) : null}
            </p>
          </div>
        )}

        <div className="mt-10">
          <h3 className="text-sm font-semibold text-navy-200 mb-4">
            FY{latest.fiscalYear} composition
          </h3>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div>
              <p className="text-[12px] font-mono uppercase tracking-wider text-navy-500 mb-3">Recipient</p>
              <BarList rows={recipients.map((r) => ({
                key: r.key, label: r.label, value: r.obligation,
                meta: fmtPct(r.obligation / latest.obligation * 100) }))} />
            </div>
            <div>
              <p className="text-[12px] font-mono uppercase tracking-wider text-navy-500 mb-3">Extent competed</p>
              <BarList colour="var(--series-2)" rows={competed.map((c) => ({
                key: c.key, label: c.label, value: c.obligation,
                meta: fmtPct(c.obligation / latest.obligation * 100) }))} />
            </div>
            <div>
              <p className="text-[12px] font-mono uppercase tracking-wider text-navy-500 mb-3">Contract pricing</p>
              <BarList colour="var(--series-3)" rows={pricing.map((p) => ({
                key: p.key, label: p.label, value: p.obligation,
                meta: fmtPct(p.obligation / latest.obligation * 100) }))} />
            </div>
          </div>
          <Caveat>
            Extent competed and pricing arrive from FPDS as single-letter codes; the code book lives in the
            ETL, not in page-level string matching, so the label is the decoded value with its code retained.
            A sole-source program of record awarding incentive contracts through a lead service is the
            expected shape — stated so the next section&rsquo;s failure is not mistaken for one of these.
          </Caveat>
        </div>

        {covLatest && (
          <div className="mt-10">
            <div className="alert-warning rounded-lg px-4 py-3">
              <p className="text-[12px] font-mono uppercase tracking-wider text-[color:var(--status-warning)] font-semibold">
                Correction · what this cut does not cover
              </p>
              <p className="text-sm text-navy-100 mt-2 leading-relaxed">
                An earlier draft of this analysis called FPDS program tagging dense, on the strength of a
                null test that found almost nothing. That was wrong. FPDS records &ldquo;no acquisition
                program&rdquo; as the <strong className="text-navy-50">explicit code 000, description NONE</strong> —
                not as a null. Only <strong className="text-navy-50">{fmtPct(covLatest.attributedPct)} of
                FY{covLatest.fiscalYear} contract obligations</strong>, and{' '}
                {fmtPct(covLatest.attributedActions / covLatest.totalActions * 100, 2)} of actions, carry a
                program code at all. A sentinel in a code field is not a null — the same failure mode as the
                single-letter codes above. It is now published as control{' '}
                <Link href="/controls" className="text-accent-400 hover:underline">PROG-06</Link>.
              </p>
            </div>
            <div className="mt-6">
              <DataTable
                caption="The denominator every program figure needs. The program dimension is precise where present and absent for most of the file; both halves are true and only one is visible from a program page."
                head={['Fiscal year', 'Contract obligations', 'Carrying a program code', 'Share of $', 'Share of actions', 'Programs seen']}
                rows={coverage.map((c) => [
                  `FY${c.fiscalYear}${c.isPartialYear ? ' *' : ''}`,
                  fmtT(c.totalObligation), fmtT(c.attributedObligation), fmtPct(c.attributedPct),
                  fmtPct(c.attributedActions / c.totalActions * 100, 2), fmtInt(c.programCount),
                ])} />
            </div>
          </div>
        )}
      </Section>

      {/* --------------------------------------------------------- 03 break */}
      <Section title="03 · The account bridge, and where it breaks"
        note="To connect an obligation to an appropriation you need to know which Treasury account it drew on. Two fields could answer that. Neither does.">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
          <div>
            <h3 className="text-sm font-semibold text-navy-200 mb-4">
              Share of F-35 obligations naming a Treasury account
            </h3>
            <LineTrend label="Account-traceable share" format="pct0"
              points={years.map((y) => ({ x: y.fiscalYear, y: y.traceablePct, partial: y.isPartialYear }))} />
            <p className="text-[12px] text-navy-500 mt-4 leading-relaxed">
              From {fmtPct(first.traceablePct)} in FY{first.fiscalYear} to {fmtPct(latest.traceablePct)} in
              FY{latest.fiscalYear}. Where this falls the obligations do not become less real — they become
              unattributable to an appropriation.
            </p>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-navy-200 mb-4">Traced and untraced obligations</h3>
            <StackedFY format="billions"
              years={years.map((y) => ({ fy: y.fiscalYear, partial: y.isPartialYear,
                parts: [y.traceableObligation, y.untraceableObligation] }))}
              series={[
                { label: 'Names an account', colour: 'var(--series-1)' },
                { label: 'Names no account', colour: 'var(--series-3)' },
              ]} />
          </div>
        </div>

        {closedFilecYears.length > 0 && (
          <div className="mt-10 alert-critical rounded-lg px-4 py-3">
            <p className="text-[12px] font-mono uppercase tracking-wider text-[color:var(--status-critical)] font-semibold">
              It is not submission lag
            </p>
            <p className="text-sm text-navy-100 mt-2 leading-relaxed">
              {closedFilecYears.length} of the {filec.length} fiscal years here are at a submission period
              ending <code className="font-mono text-[12px] text-navy-50">P12</code> — reported closed —
              and the linkage does not improve in them. FY{latest.fiscalYear} sits at{' '}
              <code className="font-mono text-[12px] text-navy-50">{fcLatest?.submissionPeriod}</code> with{' '}
              <strong className="text-navy-50">{fcLatest ? fmtInt(fcLatest.filecRows) : '0'} File C rows</strong>{' '}
              for this program&rsquo;s contracts. A closed year that never filled in is a completeness failure,
              not a late one. The memo in <code className="font-mono text-[12px]">analysis/</code> tests this
              further by re-running the same fiscal years at two warehouse vintages a month apart: the
              figures are identical to the dollar.
            </p>
          </div>
        )}

        <h3 className="text-sm font-semibold text-navy-200 mt-10 mb-4">
          The accounts named on FY{latest.fiscalYear} actions
        </h3>
        {accounts.length ? (
          <DataTable
            caption="Read a row as: this much was obligated on actions that named this combination of accounts. It is not this much from each account — the file states no split, and nothing here apportions one. A joint-service production contract names two services' appropriations and no division between them."
            head={['Accounts named', 'Accounts', 'Obligated', 'Actions']}
            rows={accounts.map((a) => [
              a.accountSet.split(';').join(' + ') + (a.hasOutOfScope ? '  ⚑' : ''),
              a.accountCount, fmtT(a.obligation), fmtInt(a.actionCount),
            ])} />
        ) : (
          <p className="text-sm text-navy-300">
            No action in FY{latest.fiscalYear} for this program named a funding account, so this warehouse
            cut contains no account combinations to show.
          </p>
        )}
        {outOfScope.length > 0 && (
          <div className="mt-6 alert-warning rounded-lg px-4 py-3">
            <p className="text-[12px] font-mono uppercase tracking-wider text-[color:var(--status-warning)] font-semibold">
              SCOPE-01 has an execution-side blind spot
            </p>
            <p className="text-sm text-navy-100 mt-2 leading-relaxed">
              Accounts outside Department scope appear on these actions:{' '}
              <span className="font-mono text-[12px] text-navy-50">{outOfScope.join(', ')}</span>. Disclosed
              rather than dropped, per{' '}
              <Link href="/controls" className="text-accent-400 hover:underline">PROG-04</Link>.{' '}
              <Link href="/controls" className="text-accent-400 hover:underline">SCOPE-01</Link> keeps agency
              011 out of Department <em>budgetary</em> totals, which is right for budget. On the execution
              side those dollars — Foreign Military Sales trust money — sit on the same contract actions as
              Department appropriations and the file does not separate them. That is an independent reason
              the obligation total is not comparable to an appropriation.
            </p>
          </div>
        )}

        <h3 className="text-sm font-semibold text-navy-200 mt-10 mb-4">
          File C, the file that would settle it
        </h3>
        <DataTable
          caption="File C is the account-linked contract obligation file — the only artifact tying a contract to a Treasury account with a dollar amount attached. This is what it holds for this program's own contracts."
          head={['Fiscal year', 'Award-file obligations', 'File C obligations', 'File C rows', 'Linkage', 'Latest submission']}
          rows={filec.map((f) => [
            `FY${f.fiscalYear}${f.isPartialYear ? ' *' : ''}`,
            fmtT(f.awardObligation), fmtT(f.filecObligation), fmtInt(f.filecRows),
            fmtPct(f.linkagePct, 2), f.submissionPeriod ?? '—',
          ])} />

        <h3 className="text-sm font-semibold text-navy-200 mt-10 mb-4">The same collapse, department-wide</h3>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 items-start">
          <div>
            <LineTrend label="File C linkage, department-wide" format="pct0"
              points={recon.map((r) => ({ x: r.fiscalYear, y: Number(r.linkagePct), partial: r.isPartialYear }))} />
          </div>
          <DataTable
            head={['Fiscal year', 'Award files', 'File C', 'Linkage']}
            rows={recon.map((r) => [
              `FY${r.fiscalYear}${r.isPartialYear ? ' *' : ''}`,
              fmtT(r.awardObligation), fmtT(r.filecObligation), fmtPct(r.linkagePct),
            ])} />
        </div>
        <Caveat>
          A fiscal year showing no File C rows matched nothing in this warehouse cut. That is a statement
          about the extract, not evidence that no such report was made. Nor is File C&rsquo;s shortfall an error
          estimate for the award files: they are two reporting chains, and the ratio measures linkage
          completeness. File A carries the F-35 appropriation accounts but has no program dimension at all,
          and File B has the same limitation — which is why File C is the only bridge. See{' '}
          <Link href="/reconciliation" className="text-accent-400 hover:underline">reconciliation</Link> and{' '}
          <Link href="/funds-control" className="text-accent-400 hover:underline">funds control</Link>.
        </Caveat>
      </Section>

      {/* ---------------------------------------------------------- 04 audit */}
      <Section title="04 · Audit — the layer that names the same failure"
        note="The independent auditor's report on the FY2025 financial statements, from the curated audit register.">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatTile label="Opinion" value={String(txt('opinion') ?? '—')} tone="critical" />
          <StatTile label="Consecutive disclaimers"
            value={num('disclaimer_streak_years') != null ? fmtInt(num('disclaimer_streak_years')!) : '—'}
            sub="FY2018–FY2025" />
          <StatTile label="Auditor-identified material weaknesses"
            value={num('mw_auditor_identified') != null ? fmtInt(num('mw_auditor_identified')!) : '—'}
            sub={num('mw_auditor_identified_fy2024') != null
              ? `down from ${fmtInt(num('mw_auditor_identified_fy2024')!)} in FY2024` : undefined} />
          <StatTile label="Of which, this program"
            value={jsfMw ? `#${jsfMw.rank}` : '—'} tone="warning"
            sub={jsfMw ? jsfMw.category : undefined} />
        </div>

        {jsfMw && (
          <div className="mt-8 alert-critical rounded-lg px-4 py-3">
            <p className="text-[12px] font-mono uppercase tracking-wider text-[color:var(--status-critical)] font-semibold">
              Material weakness #{jsfMw.rank} of {mw.length}
            </p>
            <p className="text-sm text-navy-100 mt-2 leading-relaxed">
              <strong className="text-navy-50">&ldquo;{jsfMw.category}&rdquo;.</strong> The program traced on this
              page is not merely affected by the Department&rsquo;s audit condition — it is a named material
              weakness in its own right. Four other weaknesses on the same list bear directly on the break in
              section 03: the universe of transactions, government property in the possession of contractors,
              intragovernmental transactions, and budgetary resources.
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-8">
          <StatTile label="Share of total assets under scope limitation"
            value={num('scope_assets') != null ? fmtPct(num('scope_assets')!, 0) : '—'} />
          <StatTile label="Share of budgetary resources"
            value={num('scope_resources') != null ? fmtPct(num('scope_resources')!, 0) : '—'} />
          <StatTile label="NFRs open at year-end"
            value={num('nfr_open') != null ? fmtInt(num('nfr_open')!) : '—'}
            sub={num('nfr_issued') != null && num('nfr_closed') != null
              ? `${fmtInt(num('nfr_issued')!)} issued · ${fmtInt(num('nfr_closed')!)} closed` : undefined} />
          <StatTile label="Projected FY2027 remediation cost"
            value={num('remediation_cost_fy2027') != null ? fmtT(num('remediation_cost_fy2027')!) : '—'}
            sub={txt('jtf_established') ? `Joint Task Force Audit ${txt('jtf_established')}` : undefined} />
        </div>

        <div className="mt-10">
          <DataTable
            caption="The auditor's own material-weakness categories, in report order. A separate framework from the FMFIA self-assessed counts on the audit page; the two are shown side by side there rather than conflated."
            head={['#', 'Category']}
            rows={mw.map((m) => [m.rank, m.category])} />
        </div>
        <Caveat>
          Full audit posture on <Link href="/audit" className="text-accent-400 hover:underline">audit</Link>;
          program-level execution figures, and the other eleven programs carried at this depth, on{' '}
          <Link href={`/program?code=${F35}`} className="text-accent-400 hover:underline">program</Link>.
          Two F-35 hearings sit in the congressional corpus — see{' '}
          <Link href="/congressional" className="text-accent-400 hover:underline">congressional</Link>. Their
          dates are not printed here: the filenames carry the acquisition date, not the hearing date, and the
          real dates are not in the loaded data.
        </Caveat>
      </Section>

      {/* ------------------------------------------------- 05 does not support */}
      <Section title="05 · What this pilot does not support"
        note="Stated as prominently as the findings, because each is a comparison the data invites and cannot bear.">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-10 gap-y-6 text-sm text-navy-300 leading-relaxed">
          <p>
            <strong className="text-navy-50">The two big numbers cannot be reconciled.</strong>{' '}
            {fmtT(latest.obligation)} obligated against{' '}
            {budget.length ? `${fmtT(fy25)} appropriated` : 'the appropriation'}: obligations draw on
            prior-year balances this cut cannot age, an unknown share is FMS and partner money, and{' '}
            {fmtPct(100 - latest.traceablePct)} of the dollars name no account. Publishing a
            budget-versus-execution variance here would assert a comparison the data cannot bear.
          </p>
          <p>
            <strong className="text-navy-50">This is a fraction of the contract file.</strong>{' '}
            {covLatest ? `Only ${fmtPct(covLatest.attributedPct)} of FY${covLatest.fiscalYear} contract obligations carry any acquisition program code` : 'Most contract obligations carry no acquisition program code'}.
            Nothing here describes the rest of it.
          </p>
          <p>
            <strong className="text-navy-50">An account named is not an account charged.</strong> Where
            several accounts appear on one action the file states no split between them, and nothing on this
            page apportions one — the shape of the account table is what stops a reader from trying.
          </p>
          <p>
            <strong className="text-navy-50">File C is not an error estimate.</strong> The award files and
            File C are two reporting chains. A dollar absent from File C is not a dollar that was not
            obligated; the ratio measures linkage completeness and nothing else.
          </p>
          <p>
            <strong className="text-navy-50">No unit cost is claimed.</strong> Quantity is summed on
            weapon-system-cost rows only, and an aircraft&rsquo;s cost is split across advance-procurement years.
            A defensible unit cost needs the P-5 / P-21 exhibits, which are not in this cut.
          </p>
          <p>
            <strong className="text-navy-50">Absence is absence in this cut.</strong> An empty result means
            the filter matched nothing in the vintage named at the top of this page — never that the
            Department did not report it.
          </p>
        </div>
      </Section>

      {/* ------------------------------------------------------- 06 controls */}
      {progControls.length > 0 && (
        <Section title="06 · The controls that keep this page honest"
          note="These are not proposals. They run inside the load transaction, and a critical failure rolls the whole load back so the previous vintage stays published.">
          <DataTable
            head={['Control', 'Severity', 'Assertion', 'Result']}
            rows={progControls.map((c) => [
              c.code, c.severity, c.assertion,
              c.total ? `${c.pass}/${c.total} pass${c.fail ? ` · ${c.fail} FAIL` : ''}` : 'not run',
            ])} />
          <Caveat>
            <strong className="text-navy-50">PROG-03 is the one that matters here.</strong> A program
            obligation total published without the account-traceable share beside it reads as reconciled when
            it is not — so the data layer returns the pair on one row and the control asserts they foot.
            Every control on this list was also confirmed to <em>fail</em> against deliberately corrupted
            rows; a control that only ever passes is not a control. Full suite on{' '}
            <Link href="/controls" className="text-accent-400 hover:underline">controls</Link>.
          </Caveat>
          <p className="text-[12px] text-navy-500 mt-8">
            Method and sources: <Link href="/sources" className="text-accent-400 hover:underline">sources</Link>
            {' '}· <Link href="/definitions" className="text-accent-400 hover:underline">definitions</Link>
            {' '}· the full memo and a script that re-derives every figure from the warehouse live in{' '}
            <code className="font-mono text-[12px]">analysis/</code> in the repository.
          </p>
        </Section>
      )}
    </Shell>
  );
}

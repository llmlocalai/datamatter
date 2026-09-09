import type { Metadata } from 'next';
import Link from 'next/link';
import Shell, { PageHeader, Section } from '@/components/Shell';
import { VintageChip, Caveat } from '@/components/Provenance';
import { StatTile, DataTable, BarList, LineTrend } from '@/components/charts';
import { fmtT, fmtB, fmtPct, fmtInt } from '@/components/format';

/** Seam volumes span millions to trillions, so they auto-scale rather than pinning to billions. */
const money = (n: number) => fmtT(n);
import {
  getAllProvenance, getSeams, getFilecPeriods, getFilecSpread, getScopeComparison,
  getMemoWeight, getVintageDrift, getProgramCoverage, getControls, getKbInventory,
  getSourceFields, getSourceSummary, getJoinSamples, getSfisCoverage, getSfisBySource,
  getLineage, getSourceRows, getTrace, getSharedElements, getFilebGrain, getFileAB,
  isLoaded,
} from '@/lib/analytics';
import { NotLoaded } from '../execution/page';

export const metadata: Metadata = {
  title: 'Linkage · datamatter',
  description:
    'Every figure on this site is the result of joining files that were built by different reporting chains, for different purposes, with no key in common. This page measures each of those joins, names what it loses, and shows the places where the data looks complete and is not.',
};
export const revalidate = 900;

const K = (n: number | null | undefined) => Number(n ?? 0) * 1000;


/* The six sources as a chain, and the elements that do or do not join them.
   Laid out by hand because the shape IS the argument: the budget side sits
   apart from the execution side with nothing between them. */
const GRAPH_NODES = [
  { id: 'p1',   x: 30,  y: 20,  w: 210, label: 'P-1 / R-1 exhibits', meta: 'budget line + system', tone: 'budget' },
  { id: 'wb',   x: 30,  y: 120, w: 210, label: 'Weapons book',       meta: 'system + published cost', tone: 'budget' },
  { id: 'fa',   x: 300, y: 20,  w: 200, label: 'File A',             meta: 'account balances', tone: 'exec' },
  { id: 'fb',   x: 300, y: 120, w: 200, label: 'File B',             meta: 'object class + activity', tone: 'exec' },
  { id: 'fc',   x: 300, y: 240, w: 200, label: 'File C',             meta: 'award financial', tone: 'exec' },
  { id: 'fpds', x: 300, y: 380, w: 200, label: 'FPDS award files',   meta: 'the contract action', tone: 'exec' },
] as const;

interface GraphEdge {
  id: string; d: string; ok: boolean; label: string; sub?: string;
  lx: number; ly: number; anchor?: 'start' | 'middle' | 'end';
}

const GRAPH_EDGES: GraphEdge[] = [
  { id: 'p1-fa', d: 'M240,42 L300,42', ok: true,
    label: 'account symbol', sub: '100% of lines', lx: 270, ly: 32 },
  { id: 'p1-wb', d: 'M135,64 L135,120', ok: false,
    label: 'name match', sub: '71 of 161 systems', lx: 145, ly: 96, anchor: 'start' },
  { id: 'fa-fb', d: 'M400,64 L400,120', ok: true,
    label: 'treasury_account_symbol', sub: 'discrete elements', lx: 410, ly: 88, anchor: 'start' },
  { id: 'fb-fc', d: 'M400,164 L400,240', ok: true,
    label: 'treasury_account_symbol', sub: '76 of 171 accounts appear', lx: 410, ly: 196, anchor: 'start' },
  { id: 'fc-fpds', d: 'M400,284 L400,380', ok: false,
    label: 'award_id_piid', sub: '4% of dollars reconcile', lx: 410, ly: 326, anchor: 'start' },
  { id: 'p1-fpds', d: 'M135,164 C135,300 135,400 300,402', ok: false,
    label: 'no shared element', sub: 'nothing to join on', lx: 150, ly: 330, anchor: 'start' },
  { id: 'fa-fpds', d: 'M500,42 C640,42 700,200 560,395 L505,400', ok: false,
    label: 'account as a text substring', sub: 'not a key', lx: 690, ly: 210, anchor: 'end' },
];

const SEAM_LABEL: Record<string, string> = {
  action_account: 'contract action → federal account',
  action_program: 'contract action → acquisition programme',
  award_filec: 'award files → File C',
  bli_account: 'budget line → Treasury account',
  bli_program: 'budget line → programme code',
  system_bli: 'weapon system → budget line',
  account_filea: 'Treasury account → File A',
};

const UNIT_LABEL: Record<string, string> = {
  lines: 'budget lines', accounts: 'accounts', systems: 'weapon systems',
  dollars: 'obligated dollars', actions: 'contract actions',
};


/** A quoted record is quoted: values print exactly as the source publishes them.
    Only an amount gets a gloss, and only where the field name says it is one —
    a fiscal year is not money and must never be rendered with a thousands
    separator, and a field published in thousands is not dollars. */
const AMOUNT_RE = /amount|obligat|outlay|balance|resources|value|_k$/i;
const THOUSANDS_RE = /_k$/i;

function RecordValue({ name, value }: { name: string; value: unknown }) {
  if (value === null || value === undefined || value === '') {
    return <span className="text-amber-400">null</span>;
  }
  const raw = String(value);
  const num = typeof value === 'number' ? value : Number(raw);
  const isAmount = AMOUNT_RE.test(name) && Number.isFinite(num) && Math.abs(num) >= 1000;
  return (
    <>
      {raw}
      {isAmount && (
        <span className="ml-2 text-navy-500">
          ({fmtT(THOUSANDS_RE.test(name) ? num * 1000 : num)})
        </span>
      )}
    </>
  );
}

function RecordTable({ record }: { record: Record<string, unknown> }) {
  return (
    <div className="scroll-x rounded border border-navy-800 bg-navy-950/60">
      <table className="min-w-full text-[12px]">
        <tbody>
          {Object.entries(record).map(([k, v]) => (
            <tr key={k} className="border-t border-navy-800/60 first:border-t-0">
              <td className="px-3 py-1.5 font-mono text-navy-500 whitespace-nowrap align-top">{k}</td>
              <td className="px-3 py-1.5 font-mono text-navy-100 break-all">
                <RecordValue name={k} value={v} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Badge({ children, tone = 'muted' }: {
  children: React.ReactNode; tone?: 'gold' | 'muted' | 'warn';
}) {
  const cls = tone === 'gold' ? 'bg-accent-500/15 text-accent-300 border-accent-500/30'
    : tone === 'warn' ? 'alert-warning border-transparent'
    : 'bg-navy-800 text-navy-300 border-navy-700';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium border ${cls}`}>
      {children}
    </span>
  );
}

export default async function LinkagePage() {
  if (!(await isLoaded())) return <Shell><NotLoaded /></Shell>;

  const [prov, seams, periods, spread, scope, memo, drift, coverage, controls, kb,
         fields, sourceSummary, samples, sfis, sfisBySource, lineage] =
    await Promise.all([
      getAllProvenance(), getSeams(), getFilecPeriods(), getFilecSpread(),
      getScopeComparison(), getMemoWeight(), getVintageDrift(), getProgramCoverage(),
      getControls(), getKbInventory(),
      getSourceFields(), getSourceSummary(), getJoinSamples(), getSfisCoverage(),
      getSfisBySource(), getLineage(),
    ]);
  const [sourceRows, trace, shared, fbGrain, fileAB] = await Promise.all([
    getSourceRows(), getTrace(), getSharedElements(), getFilebGrain(), getFileAB(),
  ]);

  // What the contract file shares, and with what. Computed rather than asserted:
  // the claim that matters is not "FPDS shares nothing" — it shares 23 names with
  // File C — but that it shares nothing with the two account files, and that
  // none of what it does share is an accounting element.
  const withContracts = shared.filter((s) => s.sources.includes('contracts'));
  const contractsAccountShare = withContracts.filter(
    (s) => s.sources.includes('file_a') || s.sources.includes('file_b')).length;
  const sfisNames = new Set(sfis.flatMap((e) => e.candidateFields ?? []));
  const contractsSfisShare = withContracts.filter((s) => sfisNames.has(s.fieldName)).length;

  // Coverage of the standard, computed rather than asserted.
  const sfisCarried = sfis.filter((e) => Number(e.sourceCount) > 0).length;
  const contractsCarried = Number(
    sfisBySource.find((s) => s.sourceKey === 'contracts')?.carried ?? 0);

  const byKey = Object.fromEntries(prov.map((p) => [p.datasetKey, p]));
  const used = Array.from(new Set(seams.flatMap((s) => [s.fromDataset, s.toDataset])))
    .map((k) => byKey[k]).filter(Boolean);

  const seam = (k: string) => seams.find((s) => s.key === k);
  const exact = seams.filter((s) => s.isExact);
  const derived = seams.filter((s) => s.isDerived);

  // ---- File C: the same year, read four ways --------------------------------
  const filecYears = Array.from(new Set(periods.map((p) => p.fiscalYear))).sort();
  const substantive = periods.filter((p) => p.isSubstantive);
  const thinPeriods = periods.length - substantive.length;
  const periodNos = Array.from(new Set(substantive.map((p) => p.periodNo)))
    .filter((n): n is number => n != null).sort((a, b) => a - b);
  const widest = [...spread].filter((s) => s.snapshots > 1)
    .sort((a, b) => (Number(b.hi) / Number(b.lo)) - (Number(a.hi) / Number(a.lo)))[0];

  // ---- File B: the year the activity key changed ---------------------------
  // The break is defined by the data, not by a hard-coded year: the affected
  // years are the ones the extract found rows repeated in. If a later
  // submission fixes the split, this section empties itself.
  const fbBroken = fbGrain.filter((g) => Number(g.replicatedRows) > 0);
  const fbWorst = [...fbBroken].sort((a, b) =>
    Number(b.overstatementPct) - Number(a.overstatementPct))[0];
  const fbKeyChange = fbGrain.find((g) => g.activityKey === 'program_activity_reporting_key');
  const fbLastCode = [...fbGrain].reverse()
    .find((g) => g.activityKey === 'program_activity_code');

  // ---- the scope trap, at its largest -------------------------------------
  const worstScope = [...scope].sort((a, b) =>
    Number(b.overstatementPct) - Number(a.overstatementPct))[0];
  const openDrift = drift.find((d) => !d.yearClosed);
  const closedDrift = drift.filter((d) => d.yearClosed);
  const closedWorst = closedDrift.length
    ? Math.max(...closedDrift.map((d) =>
        Math.abs(Number(d.obligationDelta)) / Number(d.obligationTo) * 100))
    : 0;
  const newestCoverage = [...coverage].filter((c) => !c.isPartialYear)
    .sort((a, b) => b.fiscalYear - a.fiscalYear)[0];
  const newestMemo = memo[memo.length - 1];
  const ctl = (code: string) => controls.find((c) => c.code === code);

  return (
    <Shell>
      <PageHeader
        eyebrow="Method · the seams between files"
        title={<>Every figure here is a <span className="text-accent-400">join</span></>}
        lede="No file in this corpus answers an interesting question on its own. A budget line lives in one book, the account it is appropriated to in another, the contracts written against it in a third, and the record tying those contracts back to the account in a fourth — built by different reporting chains, for different purposes, and sharing no key. The joins between them are where meaning is lost, and a number that has not been traced through its seam cannot be told apart from an artefact of it. This page measures every join the site depends on."
      />

      <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2">
        {used.map((p) => (
          <VintageChip key={p.datasetKey} source={p.label} vintage={p.vintage} />
        ))}
      </div>
      <p className="text-xs text-navy-500 mt-3 leading-relaxed max-w-3xl">
        Every seam below spans two of these datasets and is therefore as old as the older of the
        two. Where a figure combines them, both vintages are named rather than one.
      </p>

      <nav aria-label="On this page"
        className="mt-8 rounded-lg border border-navy-800 bg-navy-900/40 px-5 py-4">
        <h2 className="text-[11px] uppercase tracking-wider text-navy-500 mb-3">On this page</h2>
        <ol className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-2 text-sm">
          {[
            ['#seams', 'The seams, measured', `${seams.length} joins`],
            ['#trace', 'One account through every file', 'where it stops'],
            ['#graph', 'The elements, and what they join', `${shared.length} shared`],
            ['#rows', 'A record from every source', `${sourceRows.length} quoted whole`],
            ['#filec', 'File C, in depth', 'the 8× spread'],
            ['#fileb', 'File B changed its key', fbWorst
              ? `FY${fbWorst.fiscalYear} reads ${Number(fbWorst.overstatementPct).toFixed(0)}% high`
              : 'no rows repeated'],
            ['#narrowing', 'The seam that is narrowing', 'contracts to accounts'],
            ['#flow', 'The flow and the hierarchy', `${lineage.length} datasets`],
            ['#sfis', 'The standard: SFIS and SLOA', `${sfisCarried} of ${sfis.length} elements`],
            ['#records', 'The records that fail to join', `${samples.length} quoted`],
            ['#fields', 'What each source carries', `${fields.length} columns`],
            ['#traps', 'Where it looks complete', '6 traps'],
            ['#restatement', 'The same number, told twice', 'books and vintages'],
            ['#corpus', 'The document corpus', 'what text can answer'],
            ['#actions', 'What is missing', 'the action register'],
          ].map(([href, label, meta]) => (
            <li key={href}>
              <a href={href} className="text-accent-400 hover:underline">{label}</a>
              <span className="block text-[11px] text-navy-500">{meta}</span>
            </li>
          ))}
        </ol>
      </nav>

      {/* ================================================== the seam map === */}
      <Section id="seams" title="The seams, measured"
        note="What share of the left-hand side reaches the right-hand side. The unit differs by seam deliberately: a budget line either resolves to a Treasury account or it does not, so that seam is counted in lines, while the contract-to-account seam loses money rather than rows and is counted in dollars. Forcing them onto one scale would make the narrowest seam look like the widest.">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <StatTile label="Joins the site depends on" value={String(seams.length)}
            sub={`${exact.length} exact by construction, ${derived.length} derived here on evidence`}
            tone="accent" />
          <StatTile label="Budget line → Treasury account"
            value={seam('bli_account')?.pct != null ? fmtPct(seam('bli_account')!.pct!, 0) : '—'}
            sub="the one seam in the chain that loses nothing" />
          <StatTile label="Contract dollars traceable to an account"
            value={seam('action_account')?.pct != null ? fmtPct(seam('action_account')!.pct!) : '—'}
            tone="warning"
            sub="of obligations on the acquisition programs held, newest closed year" />
          <StatTile label="Contract dollars naming a program"
            value={seam('action_program')?.pct != null ? fmtPct(seam('action_program')!.pct!) : '—'}
            sub={newestCoverage
              ? `FY${newestCoverage.fiscalYear} — and only ${fmtPct(Number(newestCoverage.attributedActions) / Number(newestCoverage.totalActions) * 100, 1)} of actions`
              : undefined} />
        </div>

        <BarList
          format="pct"
          rows={seams.map((s) => ({
            key: s.key,
            label: `${s.fromLabel} → ${s.toLabel}`,
            value: s.pct ?? 0,
            meta: `${s.unit === 'dollars'
              ? `${money(s.numerator)} of ${money(s.denominator)}`
              : `${fmtInt(s.numerator)} of ${fmtInt(s.denominator)}`} ${UNIT_LABEL[s.unit] ?? s.unit}`
              + ` · joined on ${s.joinKey}`,
          }))}
          caption="Read as survival, not as quality. A seam at 2% is not a failure of the Department; it usually means the two files were never built to be joined and the site refuses to invent the missing key." />

        <div className="mt-10">
          <DataTable
            align={[1, 2, 3, 5]}
            caption="Exact means the two sides carry a shared identifier, so where the join fails it is because the key is absent rather than because the match was wrong. Derived means this site inferred the link from names, in which case every individual link records the evidence it rests on and can be rejected without disturbing the rest — and neither derived crosswalk is a Department-published mapping."
            head={['Seam', 'Joined on', 'Survives', 'Kind', 'What is lost']}
            rows={seams.map((s) => [
              <span key={s.key}>
                <span className="text-navy-100">{s.fromLabel}</span>
                <span className="block text-[12px] text-navy-500">→ {s.toLabel}</span>
              </span>,
              <span key={`${s.key}-j`} className="font-mono text-[11px] text-navy-400">
                {s.joinKey}
              </span>,
              <span key={`${s.key}-p`} className="text-navy-100">
                {s.pct != null ? fmtPct(s.pct) : '—'}
                <span className="block text-[11px] text-navy-500 font-normal">
                  {s.unit === 'dollars'
                    ? `${money(s.numerator)} of ${money(s.denominator)}`
                    : `${fmtInt(s.numerator)} / ${fmtInt(s.denominator)}`}
                </span>
              </span>,
              <span key={`${s.key}-k`} className="flex flex-wrap gap-1">
                {s.isExact ? <Badge tone="gold">exact</Badge> : <Badge>inferred</Badge>}
                {s.isDerived && <Badge tone="warn">derived here</Badge>}
              </span>,
              <span key={`${s.key}-n`} className="text-[12px] text-navy-400 leading-relaxed">
                {s.note}
              </span>,
            ])} />
        </div>
      </Section>

      {/* ============================================ the worked trace === */}
      <Section id="trace" title="One account, followed through every file"
        note="Aircraft Procurement, Navy — federal account 017-1506, the account the F-35 airframes are bought under. Every record below is real and quoted whole. Read down: the chain is intact for three steps, and then it is not."
        >
        <div className="space-y-4">
          {trace.map((t) => {
            let rec: Record<string, unknown> = {};
            try { rec = JSON.parse(t.record) as Record<string, unknown>; } catch { rec = {}; }
            return (
              <div key={t.step} className="relative pl-8">
                <span aria-hidden
                  className={`absolute left-0 top-4 w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold ${
                    t.isPresent ? 'bg-accent-500 text-navy-950' : 'bg-amber-500 text-navy-950'}`}>
                  {t.step}
                </span>
                {t.step < trace[trace.length - 1].step && (
                  <span aria-hidden
                    className="absolute left-[11px] top-10 bottom-0 w-px bg-navy-700" />
                )}
                <div className={`rounded-lg border px-5 py-4 ${
                  t.isPresent ? 'border-navy-700 bg-navy-900/40'
                              : 'border-amber-500/40 bg-amber-500/[0.05]'}`}>
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <h3 className="text-sm font-semibold text-navy-100">{t.sourceLabel}</h3>
                    {!t.isPresent && (
                      <span className="text-[11px] uppercase tracking-wider text-amber-300 font-semibold">
                        the chain stops here
                      </span>
                    )}
                  </div>
                  <p className="text-[12px] font-mono text-navy-500 mt-1">
                    joined on {t.keyField}
                    {t.keyValue ? <> = <span className="text-accent-300">{t.keyValue}</span></> : null}
                  </p>
                  <p className="text-[13px] text-navy-300 leading-relaxed mt-3 mb-3">{t.note}</p>
                  <RecordTable record={rec} />
                </div>
              </div>
            );
          })}
        </div>
        <Caveat>
          Step 4 was established over the whole file, not a sample: every row of File C for the
          fiscal year was read. Step 5 was found by searching text inside a display column, which
          is why it is shown as reached but not as joined.
        </Caveat>
      </Section>

      {/* ========================================== the element graph === */}
      <Section id="graph" title="The elements, and what they can join"
        note="Each source is a node; an edge exists only where two sources share a field name that could carry the join. The chain reads down the middle, and the shape is the argument: the contract file connects to exactly one other file, and not to either of the two that carry the accounting.">
        <div className="scroll-x">
          <svg viewBox="0 0 760 470" className="w-full h-auto min-w-[640px]" role="img"
            aria-label="Graph of the six sources and the data elements that join them">
            <defs>
              <marker id="lk-arrow" viewBox="0 0 10 10" refX="9" refY="5"
                markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                <path d="M0,0 L10,5 L0,10 z" fill="var(--series-1)" />
              </marker>
              <marker id="lk-arrow-bad" viewBox="0 0 10 10" refX="9" refY="5"
                markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                <path d="M0,0 L10,5 L0,10 z" fill="#f0b429" />
              </marker>
            </defs>
            {GRAPH_EDGES.map((e) => (
              <g key={e.id}>
                <path d={e.d} fill="none"
                  stroke={e.ok ? 'var(--series-1)' : '#f0b429'}
                  strokeWidth={e.ok ? 2 : 1.5}
                  strokeDasharray={e.ok ? undefined : '5 4'}
                  markerEnd={e.ok ? 'url(#lk-arrow)' : 'url(#lk-arrow-bad)'} />
                <text x={e.lx} y={e.ly} textAnchor={e.anchor ?? 'middle'}
                  className="fill-navy-400" style={{ fontSize: 10.5, fontFamily: 'ui-monospace, monospace' }}>
                  {e.label}
                </text>
                {e.sub && (
                  <text x={e.lx} y={e.ly + 12} textAnchor={e.anchor ?? 'middle'}
                    className={e.ok ? 'fill-navy-500' : 'fill-amber-400'}
                    style={{ fontSize: 10 }}>
                    {e.sub}
                  </text>
                )}
              </g>
            ))}
            {GRAPH_NODES.map((n) => (
              <g key={n.id}>
                <rect x={n.x} y={n.y} width={n.w} height={44} rx={7}
                  fill={n.tone === 'budget' ? 'rgba(212,175,55,0.10)' : 'rgba(30,58,95,0.55)'}
                  stroke={n.tone === 'budget' ? 'rgba(212,175,55,0.45)' : 'rgba(60,90,130,0.7)'} />
                <text x={n.x + n.w / 2} y={n.y + 19} textAnchor="middle"
                  className="fill-navy-100" style={{ fontSize: 12, fontWeight: 600 }}>
                  {n.label}
                </text>
                <text x={n.x + n.w / 2} y={n.y + 34} textAnchor="middle"
                  className="fill-navy-400" style={{ fontSize: 10 }}>
                  {n.meta}
                </text>
              </g>
            ))}
          </svg>
        </div>
        <div className="mt-5 grid grid-cols-1 lg:grid-cols-2 gap-x-10 gap-y-4 text-[13px] text-navy-300 leading-relaxed">
          <p>
            Solid arrows are joins on an element both sides carry as a discrete field. Dashed
            arrows are the ones the site has to infer — a text search inside a display column, or a
            match on names. There is no arrow between the budget line and any execution record at
            all, because the two share no field name whatsoever.
          </p>
          <p>
            <strong className="text-navy-100">The precise position.</strong> The contract file
            shares {withContracts.length} field names with File C — recipient, product code, award
            identifier, period of performance — and{' '}
            <strong className="text-amber-300">{contractsAccountShare}</strong> with File A or File
            B. Of the {withContracts.length} it does share,{' '}
            <strong className="text-amber-300">{contractsSfisShare}</strong> are SLOA accounting
            elements. So the contract file is not isolated; it is connected to the award side and
            severed from the accounting side, which is exactly the shape that makes an obligation
            impossible to place in an appropriation.
          </p>
        </div>

        <div className="mt-10">
          <h3 className="text-sm font-semibold text-navy-200 mb-4">
            Every element more than one source carries — the complete list of candidate keys
          </h3>
          <DataTable
            align={[0, 1, 2, 4]}
            caption={`${shared.length} of the 173 distinct field names across the four execution sources appear in more than one of them; the rest appear in exactly one file and can join nothing. Read the "carried by" column: the shared names split into two clusters that barely touch — account identifiers held by File A, File B and File C, and award descriptors held by File C and FPDS. File C is the only file in either cluster of the other, which is why the whole chain depends on it. Nothing on this list identifies a programme, a system or a budget line.`}
            head={['Element', 'Carried by', 'Sources', 'Populated', 'Example values']}
            rows={shared.map((s) => [
              <span key={s.fieldName} className="font-mono text-[12px] text-accent-300">
                {s.fieldName}
              </span>,
              <span key={`${s.fieldName}-s`} className="text-[11px] font-mono text-navy-400">
                {s.sources.join(', ')}
              </span>,
              String(s.sourceCount),
              s.populated == null ? '—' : fmtPct(Number(s.populated)),
              <span key={`${s.fieldName}-v`} className="font-mono text-[11px] text-navy-400 break-all">
                {s.samples ?? '—'}
              </span>,
            ])} />
        </div>
      </Section>

      {/* ============================================ sample records === */}
      <Section id="rows" title="A complete record from every source"
        note="One whole row from each file, chosen as the largest obligation in the batch scanned so it is recognisable rather than obscure. Nothing is abridged: these are the fields as the source publishes them.">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {sourceRows.map((r, i) => {
            let rec: Record<string, unknown> = {};
            try { rec = JSON.parse(r.record) as Record<string, unknown>; } catch { rec = {}; }
            return (
              <div key={i} className="rounded-lg border border-navy-800 bg-navy-900/40 px-5 py-4">
                <h3 className="text-sm font-semibold text-navy-100">{r.sourceLabel}</h3>
                <p className="text-[12px] text-navy-400 mt-1 mb-3">{r.why}</p>
                <RecordTable record={rec} />
              </div>
            );
          })}
        </div>
      </Section>

      {/* ================================================== File C in depth === */}
      <Section id="filec"
        title="File C: the seam where the answer depends on which copy you read"
        note="File C is the record that ties a contract award back to the Treasury account that funded it — the join that would close the gap between what the contract files say and what the accounting says. It is also the seam most often quoted as a single number, and that number turns out to be the product of a choice nobody had written down.">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatTile label="Snapshots held per fiscal year"
            value={String(periodNos.length)}
            sub={`at periods ${periodNos.join(', ')} — not a monthly series`} tone="accent" />
          <StatTile label="Periods carrying almost nothing"
            value={String(thinPeriods)}
            sub="fewer than a thirtieth of the volume of a real snapshot" />
          <StatTile label="Widest spread within one year"
            value={widest ? `${(Number(widest.hi) / Number(widest.lo)).toFixed(1)}×` : '—'}
            tone="warning"
            sub={widest
              ? `FY${widest.fiscalYear}: ${fmtPct(Number(widest.lo))} at period ${widest.loPeriod}, ${fmtPct(Number(widest.hi))} at period ${widest.hiPeriod}`
              : undefined} />
          <StatTile label="Years where the spread exceeds 2×"
            value={String(spread.filter((s) => s.snapshots > 1
              && Number(s.hi) / Number(s.lo) > 2).length)}
            sub={`of ${spread.filter((s) => s.snapshots > 1).length} years with more than one snapshot`} />
        </div>

        <div className="mt-10">
          <h3 className="text-sm font-semibold text-navy-200 mb-4">
            The same fiscal year, read from each snapshot the warehouse holds
          </h3>
          <DataTable
            align={[]}
            caption="Each cell is the linkage percentage that snapshot would produce: File C obligations for that period over the full-year contract obligations for that fiscal year. The marked cell is the one this site publishes — the snapshot with the most rows, on the reasoning that it is the most complete copy held. It is a defensible rule and it is still a rule."
            head={['Fiscal year', ...periodNos.map((n) => `Period ${n}`), 'Published', 'Spread']}
            rows={filecYears.map((fy) => {
              const row = spread.find((s) => s.fiscalYear === fy);
              const ratio = row && row.snapshots > 1 ? Number(row.hi) / Number(row.lo) : null;
              return [
                `FY${fy}`,
                ...periodNos.map((n) => {
                  const p = periods.find((x) => x.fiscalYear === fy && x.periodNo === n);
                  if (!p) return <span key={`${fy}-${n}`} className="text-navy-700">—</span>;
                  if (!p.isSubstantive) {
                    return (
                      <span key={`${fy}-${n}`} className="text-navy-600" title={`${fmtInt(Number(p.filecRows))} rows`}>
                        thin copy
                        <span className="block text-[11px]">{fmtInt(Number(p.filecRows))} rows</span>
                      </span>
                    );
                  }
                  return (
                    <span key={`${fy}-${n}`}
                      className={p.isChosen ? 'text-accent-300 font-semibold' : 'text-navy-100'}>
                      {p.linkagePct != null ? fmtPct(Number(p.linkagePct)) : '—'}
                      <span className="block text-[11px] text-navy-500 font-normal">
                        {fmtB(Number(p.obligation))}
                      </span>
                    </span>
                  );
                }),
                <span key={`${fy}-c`} className="text-accent-300">
                  {row?.chosenPeriod ? `period ${row.chosenPeriod}` : '—'}
                </span>,
                ratio == null
                  ? <span key={`${fy}-s`} className="text-navy-500">single snapshot</span>
                  : <span key={`${fy}-s`} className={ratio > 2 ? 'text-amber-300' : 'text-navy-100'}>
                      {ratio.toFixed(1)}×
                    </span>,
              ];
            })} />
        </div>

        <div className="mt-8 grid grid-cols-1 lg:grid-cols-2 gap-10">
          <div className="text-sm text-navy-300 leading-relaxed space-y-4">
            <p>
              <strong className="text-navy-100">This is the finding.</strong> Reading FY2022 at
              period 3 puts award-to-account linkage at {(() => {
                const s = spread.find((x) => x.fiscalYear === 2022);
                return s ? fmtPct(Number(s.lo)) : '—';
              })()}; reading the same year at period 12 puts it at {(() => {
                const s = spread.find((x) => x.fiscalYear === 2022);
                return s ? fmtPct(Number(s.hi)) : '—';
              })()}. Same warehouse, same fiscal year, same query — an eight-fold difference that
              comes entirely from which submission the copy was taken from. Neither figure is wrong.
            </p>
            <p>
              <strong className="text-navy-100">What follows from it.</strong> A year-over-year
              comparison of linkage is only meaningful if every year is read at the same period, and
              the period actually held differs by year. Comparing one year&rsquo;s period 6 with
              another&rsquo;s period 12 measures the copies, not the Department. That is why this
              site no longer draws a trend line through those figures — see{' '}
              <Link href="/reconciliation" className="text-accent-400 hover:underline">
                reconciliation
              </Link>, where the series is now shown per period rather than as a slope.
            </p>
            <p>
              <strong className="text-navy-100">What it is not.</strong> None of this says the
              Department failed to report. File C and the contract award files are two reporting
              chains, not one chain measured twice, and a dollar absent from File C is not a dollar
              that was not obligated. The linkage percentage measures how much of the contract file
              can be tied to an account in this cut — nothing more.
            </p>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-navy-200 mb-4">
              Volume held, by submission period
            </h3>
            <BarList format="int"
              rows={filecYears.flatMap((fy) =>
                periodNos.map((n) => {
                  const p = periods.find((x) => x.fiscalYear === fy && x.periodNo === n);
                  return p ? {
                    key: `${fy}-${n}`, label: `FY${fy} period ${n}`,
                    value: Number(p.filecRows),
                    meta: p.isSubstantive
                      ? `${fmtB(Number(p.obligation))} over ${fmtInt(Number(p.filecAwards))} awards`
                      : 'a thin copy — not a submission this small',
                  } : null;
                }).filter((x): x is NonNullable<typeof x> => x !== null))}
              caption="Row counts, not dollars. The four substantive snapshots a year sit at periods 3, 6, 9 and 12; every other period held carries fewer than thirty rows. Where a year shows only one substantive snapshot, the warehouse holds a thin copy of the other three — which is a fact about this collection, not about what the Department submitted." />
          </div>
        </div>

        <Caveat>
          Two controls hold this open. {ctl('FILEC-01')
            ? <><Link href="/controls" className="underline">FILEC-01</Link> is a shape rather
              than a check: it makes it structurally impossible to render the published figure
              without the snapshots it was chosen over. </>
            : null}
          {ctl('FILEC-02')
            ? <><Link href="/controls" className="underline">FILEC-02</Link> measures the size of
              that choice each year and reports a spread wider than a factor of two as a finding.
              It must never be satisfied by narrowing the series until the spread closes.</>
            : null}
        </Caveat>
      </Section>

      {/* ================================= File B changed its identifier === */}
      <Section id="fileb"
        title="File B: the year the program activity stopped having a code"
        note="File C's seam is a choice between copies. File B's is different in kind — the file changed the column that identifies a program activity, and the first submission under the new key does not split the money across it. Read as published, the Department obligated more in nine months of FY2026 than in all of FY2025. It did not.">
        {fbKeyChange ? (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <StatTile label="Identifier through FY2025"
                value={fbLastCode ? `FY${fbLastCode.fiscalYear}` : '—'}
                sub="program_activity_code, populated on every row" />
              <StatTile label="Identifier from FY2026"
                value={`FY${fbKeyChange.fiscalYear}`} tone="accent"
                sub={`program_activity_reporting_key — the old column is null on all ${fmtInt(Number(fbKeyChange.sourceRows))} rows`} />
              <StatTile label="Rows repeating a figure already published"
                value={fmtInt(Number(fbKeyChange.replicatedRows))} tone="warning"
                sub={`across ${fmtInt(Number(fbKeyChange.replicatedGroups))} account and object-class groups, of ${fmtInt(Number(fbKeyChange.sourceRows))} rows`} />
              <StatTile label="Overstatement if added up as published"
                value={`${Number(fbKeyChange.overstatementPct).toFixed(1)}%`} tone="warning"
                sub={`${fmtB(Number(fbKeyChange.asPublished))} against ${fmtB(Number(fbKeyChange.atGrain))} at the file's real grain`} />
            </div>

            <div className="mt-10 grid grid-cols-1 lg:grid-cols-2 gap-10">
              <div className="text-sm text-navy-300 leading-relaxed space-y-4">
                <p>
                  <strong className="text-navy-100">What changed.</strong> Through FY
                  {fbLastCode?.fiscalYear ?? 2025} every File B row names a program activity code.
                  In the FY{fbKeyChange.fiscalYear}{' '}
                  {fbKeyChange.submissionPeriod
                    ? fbKeyChange.submissionPeriod.replace(/^FY\d+/, 'period ').replace('P', '')
                    : ''}{' '}
                  submission that column is null on every row and the Program Activity Reporting
                  Key carries the identity instead. That much is a documented change of standard,
                  not a defect.
                </p>
                <p>
                  <strong className="text-navy-100">What went wrong with it.</strong> Where an
                  account holds several keys, the file repeats the account&rsquo;s object-class
                  figure verbatim against each one rather than splitting it between them. Account
                  017-2026/2030-1612-000 publishes the same $7,384,996,196.00 against object class
                  31.0 under four different keys. Adding the rows up counts the money once per key.
                </p>
                <p>
                  <strong className="text-navy-100">How that shows up.</strong> Summed as
                  published, Department-wide obligations for FY{fbKeyChange.fiscalYear} come to{' '}
                  {fmtB(Number(fbKeyChange.asPublished))} — above the whole of FY
                  {fbLastCode?.fiscalYear ?? 2025} on nine months of data, and{' '}
                  {Number(fbKeyChange.overstatementPct).toFixed(1)}% above what File A reports for
                  the same accounts in the same period. A reader with no reason to doubt the file
                  would have read that as a surge in spending.
                </p>
                <p>
                  <strong className="text-navy-100">What this site does about it.</strong> File B
                  is aggregated at its real grain — Treasury account, object class, direct or
                  reimbursable, emergency fund code — and a group whose rows differ only by
                  reporting key and repeat one figure counts once. The rule requires the old code
                  column to be null across the whole group, which is true only of FY
                  {fbKeyChange.fiscalYear}: it collapses nothing at all in FY
                  {fbGrain[0]?.fiscalYear}–{fbLastCode?.fiscalYear ?? 2025}, where two activities
                  may legitimately report the same amount and the code still tells them apart.
                </p>
                <p>
                  <strong className="text-navy-100">What it does not fix.</strong> The money is
                  now counted once, but it is not attributed. The FY{fbKeyChange.fiscalYear} file
                  does not say how an account&rsquo;s obligations divide between its reporting
                  keys, so File B answers &ldquo;how much&rdquo; for that year and no longer
                  answers &ldquo;on what activity&rdquo;. Object class survives; program activity
                  does not. The gross outlay column is also only partly repaired by this — it
                  disagrees between copies of the same row, and remains about three per cent above
                  File A after the collapse.
                </p>
              </div>

              <div>
                <h3 className="text-sm font-semibold text-navy-200 mb-4">
                  File A and File B, the same accounts and the same submission
                </h3>
                <DataTable
                  align={[]}
                  caption="File A reports the account; File B reports the same account broken out by object class and program activity. They are separate submissions and are expected to differ a little. Every year but the last differs by under two per cent. The last is the key change, and the final column is what this site publishes after counting each repeated group once."
                  head={['Fiscal year', 'File A', 'File B as published', 'Variance', 'File B at grain']}
                  rows={fileAB.map((r) => {
                    const g = fbGrain.find((x) => x.fiscalYear === r.fiscalYear);
                    const pub = g ? Number(g.asPublished) : Number(r.fileB);
                    const v = (pub - Number(r.fileA)) / Number(r.fileA) * 100;
                    const fixed = (Number(r.fileB) - Number(r.fileA)) / Number(r.fileA) * 100;
                    return [
                      <span key={`${r.fiscalYear}-y`}>
                        FY{r.fiscalYear}
                        <span className="block text-[11px] text-navy-500">
                          {r.periodA === r.periodB ? r.periodA : `A ${r.periodA} · B ${r.periodB}`}
                        </span>
                      </span>,
                      fmtB(Number(r.fileA)),
                      <span key={`${r.fiscalYear}-p`}
                        className={Math.abs(v) > 5 ? 'text-amber-300' : undefined}>
                        {fmtB(pub)}
                      </span>,
                      <span key={`${r.fiscalYear}-v`}
                        className={Math.abs(v) > 5 ? 'text-amber-300' : 'text-navy-400'}>
                        {v > 0 ? '+' : ''}{v.toFixed(1)}%
                      </span>,
                      <span key={`${r.fiscalYear}-f`} className="text-accent-300">
                        {fmtB(Number(r.fileB))}
                        <span className="block text-[11px] text-navy-500 font-normal">
                          {fixed > 0 ? '+' : ''}{fixed.toFixed(2)}% vs File A
                        </span>
                      </span>,
                    ];
                  })} />

                <h3 className="text-sm font-semibold text-navy-200 mt-8 mb-4">
                  Rows published against distinct rows of data
                </h3>
                <DataTable
                  align={[1]}
                  caption="Grain rows are the distinct combinations of Treasury account, object class, funding source and emergency fund code. Through FY2025 several rows share one of those combinations because they are genuinely different program activities. In FY2026 they share it because the same figure was published against several reporting keys."
                  head={['Fiscal year', 'Activity identified by', 'Rows', 'Distinct at grain', 'Repeated']}
                  rows={fbGrain.map((g) => [
                    `FY${g.fiscalYear}`,
                    <span key={`${g.fiscalYear}-k`}
                      className={g.activityKey === 'program_activity_reporting_key'
                        ? 'text-amber-300' : 'text-navy-300'}>
                      <code className="text-[11px]">{g.activityKey}</code>
                    </span>,
                    fmtInt(Number(g.sourceRows)),
                    fmtInt(Number(g.grainRows)),
                    Number(g.replicatedRows) === 0
                      ? <span key={`${g.fiscalYear}-r`} className="text-navy-600">none</span>
                      : <span key={`${g.fiscalYear}-r`} className="text-amber-300">
                          {fmtInt(Number(g.replicatedRows))}
                          <span className="block text-[11px] text-navy-500 font-normal">
                            in {fmtInt(Number(g.replicatedGroups))} groups
                          </span>
                        </span>,
                  ])} />
              </div>
            </div>
          </>
        ) : (
          <p className="text-sm text-navy-400">
            Every File B year held identifies its program activity by code, and no row repeats a
            figure published against another activity. This section describes a break that the
            current extract does not find.
          </p>
        )}

        <Caveat>
          {ctl('FILEB-01')
            ? <><Link href="/controls" className="underline">FILEB-01</Link> counts the repeated
              rows and fails while any remain, so the repair stays visible rather than becoming an
              assumption. It is not satisfied by the extract having handled it — only by a
              submission that splits the money across its keys. </>
            : null}
          {ctl('TIE-01')
            ? <><Link href="/controls" className="underline">TIE-01</Link> compares the two files
              and now reads the submission period off both rather than asserting in prose that
              they match.</>
            : null}
        </Caveat>
      </Section>

      {/* ============================================ the traceability decline === */}
      <Section id="narrowing" title="The seam that is genuinely narrowing"
        note="Not every seam is a measurement artefact. The share of contract dollars that can be tied to the account that funded them has fallen by more than half across the years held, on the acquisition programs this site carries — and unlike the File C figure, this one is read the same way every year.">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
          <div>
            <LineTrend label="Obligations traceable to an account" format="pct0"
              points={coverage.map((c) => ({
                x: c.fiscalYear,
                y: Number(c.attributedPct),
                partial: c.isPartialYear,
              }))} />
            <p className="text-xs text-navy-500 mt-3">
              Share of contract obligations carrying an acquisition program code, by fiscal year.
              The final year is period-to-date.
            </p>
          </div>
          <div className="text-sm text-navy-300 leading-relaxed space-y-4">
            <p>
              <strong className="text-navy-100">The account field is a list, not a key.</strong>{' '}
              A contract action names every federal account funding the award in one
              semicolon-separated field, with no apportionment between them. An obligation is
              counted as traceable only when the action names accounts at all; it is never split
              across them, because the file states no split and inventing one would be fabrication.
            </p>
            <p>
              <strong className="text-navy-100">The program field is a sentinel.</strong> FPDS
              records &ldquo;no acquisition program&rdquo; as the explicit code{' '}
              <span className="font-mono text-[12px]">000</span>, description{' '}
              <span className="font-mono text-[12px]">NONE</span> — so a null test finds nothing
              and reports full coverage. {newestCoverage && (
                <>In FY{newestCoverage.fiscalYear},{' '}
                  {fmtPct(Number(newestCoverage.attributedPct))} of obligated dollars and{' '}
                  {fmtPct(Number(newestCoverage.attributedActions) / Number(newestCoverage.totalActions) * 100, 1)}{' '}
                  of actions carry a program at all.</>
              )}
            </p>
          </div>
        </div>
      </Section>

      {/* ======================================================= the traps === */}
      <Section id="traps" title="Where the data looks complete and is not"
        note="Each of these has a measured cost, and each of them passed an internal consistency check before it was caught. That is the common shape: an extract can be perfectly consistent with itself and still be wrong, because consistency is a property of the extract and correctness is a property of the source.">
        <DataTable
          align={[0, 1, 2, 3]}
          caption="Every row here is a mistake this site made or came close to making. They are kept on the page because the next person to build on these files will meet all of them."
          head={['The trap', 'Why it passes unnoticed', 'Measured cost', 'What stops it now']}
          rows={[
            [
              <span key="t1" className="text-navy-100">A sentinel value that is not a null</span>,
              'FPDS writes “no acquisition program” as the code 000 with description NONE. A null test on the field finds nothing missing and reports complete coverage.',
              newestCoverage
                ? <span key="c1">{fmtPct(100 - Number(newestCoverage.attributedPct))} of obligations
                    <span className="block text-[11px] text-navy-500">
                      and {fmtPct(100 - Number(newestCoverage.attributedActions) / Number(newestCoverage.totalActions) * 100, 1)} of actions carry no program
                    </span>
                  </span>
                : '—',
              <span key="s1">Coverage is published as its own measure —{' '}
                <Link href="/controls" className="text-accent-400 hover:underline">PROG-06</Link>{' '}
                — rather than inferred from an absence.</span>,
            ],
            [
              <span key="t2" className="text-navy-100">Five agency codes in one file</span>,
              'File A carries five agency identifier codes, and one of them (011, the Executive Office of the President) is not the Department. Summing the file and calling it DoD looks like the obvious read.',
              worstScope
                ? <span key="c2">{money(Number(worstScope.all) - Number(worstScope.dow))}
                    <span className="block text-[11px] text-navy-500">
                      above the Department figure in FY{worstScope.fiscalYear} — {fmtPct(Number(worstScope.overstatementPct))} more
                      than the Department obligated
                    </span>
                  </span>
                : '—',
              <span key="s2">Every Department figure uses{' '}
                <span className="font-mono text-[11px]">scope = DOW</span>, and{' '}
                <Link href="/controls" className="text-accent-400 hover:underline">SCOPE-01</Link>{' '}
                blocks the load if one does not.</span>,
            ],
            [
              <span key="t3" className="text-navy-100">Rows that restate money counted elsewhere</span>,
              'The P-1R exhibit, R-1 lines outside total obligation authority, memo cost types and advance-procurement subtotals all restate money already carried on another line in the same book. Nothing in the file marks them as a duplicate.',
              newestMemo
                ? <span key="c3">{fmtT(K(Number(newestMemo.memoK)))}
                    <span className="block text-[11px] text-navy-500">
                      restated across {fmtInt(newestMemo.memoLines)} lines in the PB{newestMemo.pbYear} book
                    </span>
                  </span>
                : '—',
              <span key="s3">Memo rows are kept and flagged rather than dropped, every query excludes
                them, and{' '}
                <Link href="/controls" className="text-accent-400 hover:underline">EXH-03</Link>{' '}
                asserts no unflagged row carries a memo cost type.</span>,
            ],
            [
              <span key="t4" className="text-navy-100">An extract consistent with itself and wrong</span>,
              'The P-1 publishes an Advance Procurement row for a line and then restates the same money on the rows beneath it. Counting both is internally consistent — every subtotal foots — and overstates the request.',
              <span key="c4">$14.4B
                <span className="block text-[11px] text-navy-500">
                  in the PB2026 procurement request alone
                </span>
              </span>,
              <span key="s4">
                <Link href="/controls" className="text-accent-400 hover:underline">EXH-08</Link>{' '}
                checks the extract against the total the Department publishes in its own weapons
                book. It is the only control here that tests whether the extract is right rather
                than self-consistent.</span>,
            ],
            [
              <span key="t5" className="text-navy-100">A cumulative snapshot read as a period</span>,
              'File C states a fiscal year as of a submission period. Four snapshots of a year are held and each gives a different answer, so the figure quoted depends on which copy was opened.',
              widest
                ? <span key="c5">{(Number(widest.hi) / Number(widest.lo)).toFixed(1)}× spread
                    <span className="block text-[11px] text-navy-500">
                      within FY{widest.fiscalYear} alone
                    </span>
                  </span>
                : '—',
              <span key="s5">
                <Link href="/controls" className="text-accent-400 hover:underline">FILEC-01</Link>{' '}
                and{' '}
                <Link href="/controls" className="text-accent-400 hover:underline">FILEC-02</Link>{' '}
                publish the whole series and the size of the choice.</span>,
            ],
            [
              <span key="t6" className="text-navy-100">A year that is not over</span>,
              'The current fiscal year reports period-to-date and looks like a complete year in every chart it appears in. The source says so itself, in a field that is easy not to read.',
              openDrift
                ? <span key="c6">{fmtT(Math.abs(Number(openDrift.obligationDelta)))}
                    <span className="block text-[11px] text-navy-500">
                      FY{openDrift.fiscalYear} moved this much between two vintages a month apart
                    </span>
                  </span>
                : '—',
              <span key="s6">Partial years are marked wherever they are shown, from{' '}
                <span className="font-mono text-[11px]">submission_period</span>, and{' '}
                <Link href="/controls" className="text-accent-400 hover:underline">PART-01</Link>{' '}
                asserts the flag is set.</span>,
            ],
          ]} />
      </Section>

      {/* ================================================= restatement === */}
      <Section id="restatement" title="The same number, told twice"
        note="Two different mechanisms restate a figure that has already been published, and neither is an error. Confusing either one for a change in the underlying money is the most common way to read these files wrongly.">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
          <div>
            <h3 className="text-sm font-semibold text-navy-200 mb-4">
              A closed year barely moves; an open year moves in billions
            </h3>
            <DataTable
              caption="The same fiscal year as two vintages of the contract files describe it, one month apart. A closed year drifts by corrections; the open year is still being reported."
              head={['Fiscal year', 'Earlier vintage', 'Later vintage', 'Movement', 'Closed']}
              rows={drift.map((d) => [
                `FY${d.fiscalYear}`,
                fmtT(Number(d.obligationFrom)),
                fmtT(Number(d.obligationTo)),
                <span key={d.fiscalYear}
                  className={Math.abs(Number(d.obligationDelta)) / Number(d.obligationTo) > 0.01
                    ? 'text-amber-300' : 'text-navy-100'}>
                  {Number(d.obligationDelta) >= 0 ? '+' : '−'}
                  {fmtT(Math.abs(Number(d.obligationDelta)))}
                  <span className="block text-[11px] text-navy-500 font-normal">
                    {fmtPct(Math.abs(Number(d.obligationDelta)) / Number(d.obligationTo) * 100, 3)}
                  </span>
                </span>,
                d.yearClosed ? 'yes' : <span key={`${d.fiscalYear}-o`} className="text-amber-300">no</span>,
              ])} />
            <Caveat>
              Closed years move by at most {fmtPct(closedWorst, 3)} between these two vintages, which
              is what a corrections process looks like. The open year is a different kind of number
              altogether and should never be compared with a closed one.
            </Caveat>
          </div>
          <div className="text-sm text-navy-300 leading-relaxed space-y-4">
            <p>
              <strong className="text-navy-100">The budget books restate on purpose.</strong> Each
              President&rsquo;s Budget carries three fiscal years — the prior year as actuals, the
              current year as enacted, the budget year as requested — so one fiscal year appears in
              three successive books with three different numbers. That spread is the restatement
              history and it exists in no other source here. Collapsing it to one figure per year
              looks like tidying up and destroys the only record of a request becoming an
              appropriation.{' '}
              <Link href="/program#restatement" className="text-accent-400 hover:underline">
                The three-year structure
              </Link>{' '}
              is on the program roster.
            </p>
            <p>
              <strong className="text-navy-100">The execution files restate by correction.</strong>{' '}
              A vintage is a copy taken on a date. Comparing two vintages of a closed year measures
              the corrections process; comparing two vintages of the open year measures how much of
              the year had been reported when each copy was taken. The two look identical in a
              table and mean nothing alike.
            </p>
            <p>
              <strong className="text-navy-100">Obligations are not outlays.</strong> And outlays
              are not a subset of the current year&rsquo;s obligations — they include payment
              against obligations incurred in prior years, so a ratio of the two within one fiscal
              year is not a completion rate.
            </p>
          </div>
        </div>
      </Section>

      {/* ==================================================== the text layer === */}
      <Section id="corpus" title="What the document corpus can and cannot answer"
        note="The numbers are not the only evidence here. Regulation, statute, congressional direction and justification material are held as documents, and they answer a different kind of question — but they invite a specific mistake, which is to treat a count of files as a measurement of anything.">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
          <div>
            <BarList format="int"
              rows={kb.map((k) => ({
                key: `${k.collection}-${k.label}`, label: k.label,
                value: Number(k.docCount),
                meta: k.authorityTier === 1 ? 'primary authority' : 'reference material',
              }))}
              caption="Documents held by collection. This is an inventory of a corpus, and it is the only thing it is." />
          </div>
          <div className="text-sm text-navy-300 leading-relaxed space-y-4">
            <p>
              <strong className="text-navy-100">Counting files is not measuring quality.</strong> A
              GAO report is not a finding. A justification folder with five exhibits in it is not a
              better-justified programme than one with two. Nothing on this site infers quality,
              effort or compliance from a document count, and any figure that looks like it does is
              a defect.
            </p>
            <p>
              <strong className="text-navy-100">A filename is not a date.</strong> Hearing files in
              this corpus are named for the date they were acquired, not the date the hearing was
              held, so no hearing date is printed from a filename and no hearing is ever described
              as upcoming. The hearing date is on the first page of the document, which is a
              different and more expensive thing to read.
            </p>
            <p>
              <strong className="text-navy-100">Absence is absence in this cut.</strong> An empty
              result means the filter matched nothing in the vintage named above. It never means the
              Department did not publish the thing, and no copy on this site says otherwise.
            </p>
            <p>
              The corpus is searchable by authority rank on{' '}
              <Link href="/regulation" className="text-accent-400 hover:underline">regulation</Link>,
              and the terms it uses are defined, with citations, on{' '}
              <Link href="/definitions" className="text-accent-400 hover:underline">definitions</Link>.
            </p>
          </div>
        </div>
      </Section>

      {/* ================================================== the data flow === */}
      <Section id="flow" title="The flow, end to end"
        note="Read from the load record rather than drawn by hand, so it cannot drift from what actually ran. Each row is one dataset: where it came from, which script extracted it, the date of the copy, and how many rows reached the database.">
        <DataTable
          align={[0, 1, 2, 3]}
          caption="A vintage is the date of the copy, not the date of the money. Every figure on this site is as old as the vintage of the dataset it came from, and a figure that combines two datasets is as old as the older of them."
          head={['Dataset', 'Source', 'Extracted by', 'Vintage', 'Rows']}
          rows={lineage.map((n) => [
            <span key={n.datasetKey}>
              <span className="text-navy-100">{n.label}</span>
              <span className="block text-[11px] font-mono text-navy-500">{n.datasetKey}</span>
            </span>,
            <span key={`${n.datasetKey}-s`} className="text-[12px]">
              {n.sourceSystem}
              <span className="block font-mono text-[11px] text-navy-500">{n.sourcePath}</span>
            </span>,
            <span key={`${n.datasetKey}-e`} className="font-mono text-[11px] text-navy-400">
              {n.etlScript}
              <span className="block text-navy-600">v{n.etlVersion}</span>
            </span>,
            <span key={`${n.datasetKey}-v`} className="font-mono text-[12px]">
              {n.vintage}
              <span className="block text-[11px] text-navy-500">loaded {n.loadedAt}</span>
            </span>,
            fmtInt(Number(n.rowCount)),
          ])} />

        <div className="mt-8 grid grid-cols-1 lg:grid-cols-2 gap-10 text-sm text-navy-300 leading-relaxed">
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-navy-200">The hierarchy, from the top</h3>
            <ol className="space-y-2.5 text-[13px]">
              {[
                ['Appropriation', 'Congress enacts a Treasury account. Everything below inherits its period of availability and its fund type.'],
                ['Budget line', 'The P-1 and R-1 exhibits itemise the account into budget line items. This is the finest grain the budget publishes, and the last grain that names a system.'],
                ['Treasury account execution', 'File A reports budgetary resources, obligations and outlays for the account. The budget line does not survive into it.'],
                ['Object class and programme activity', 'File B splits the same account obligations by what was bought and under which activity. Still no budget line.'],
                ['Award financial', 'File C ties an obligation to an award identifier and a Treasury account, as discrete elements.'],
                ['Contract action', 'FPDS records the action itself: the recipient, the competition, the product. It names accounts only as a display string.'],
              ].map(([h, b], i) => (
                <li key={h} className="border-l-2 border-navy-700 pl-4">
                  <span className="text-navy-100 font-semibold">{i + 1}. {h}</span>
                  <span className="block text-navy-400 mt-0.5">{b}</span>
                </li>
              ))}
            </ol>
          </div>
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-navy-200">Where the hierarchy breaks</h3>
            <p>
              The break is between steps two and three, and it is a break in the
              <em> data</em>, not in the money. A budget line is appropriated into an account and
              then executed; the execution files carry the account and drop the line. From File A
              onward nothing in the published record says which budget line an obligation belongs
              to, so the chain that begins with a named weapon system ends with an account
              containing several of them.
            </p>
            <p>
              That is not an accident of these files. The Department defines a data element for
              exactly this — <strong className="text-navy-100">Budget Line Item</strong>, element 12
              of the Standard Line of Accounting — and requires it to be exchanged for business
              events with an accounting impact. It does not appear in any published file this site
              reads. The next section is that standard, measured against what the files carry.
            </p>
          </div>
        </div>
      </Section>

      {/* ============================================= the standard: SFIS === */}
      <Section id="sfis" title="The standard that would close these joins"
        note="The Standard Line of Accounting is the minimum set of SFIS data elements the Department requires to be exchanged for any business event with an accounting impact, from the initial commitment through to disbursement. It is not an aspiration — it is the answer to why these files do not join, because most of the joins this site cannot make are joins these elements were defined to make possible.">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatTile label="SLOA elements in the standard" value={String(sfis.length)}
            sub="the mandatory subset of SFIS" tone="accent" />
          <StatTile label="Reaching any published file"
            value={`${sfisCarried} of ${sfis.length}`}
            sub={`${fmtPct(sfisCarried / Math.max(sfis.length, 1) * 100, 0)} of the standard`}
            tone={sfisCarried / Math.max(sfis.length, 1) < 0.5 ? 'warning' : 'default'} />
          <StatTile label="Reaching the contract file"
            value={`${contractsCarried} of ${sfis.length}`}
            tone="critical"
            sub="FPDS carries none of them as a discrete element" />
          <StatTile label="Budget Line Item" value="absent"
            tone="critical"
            sub="element 12 — the key that would tie an obligation to the budget line it was appropriated under" />
        </div>

        <div className="mt-8">
          <DataTable
            align={[0, 1, 3, 4]}
            caption={`Coverage is computed from the field catalogue below rather than asserted, so it moves when a source adds or drops a column. “Not in these files” is a statement about the published data this site holds — never a claim that the Department does not hold the element in its own systems, which these files would not show.`}
            head={['#', 'SLOA element', 'Length', 'What carries it here', 'Definition']}
            rows={sfis.map((e, i) => [
              <span key={e.elementName} className="text-navy-500">{i + 1}</span>,
              <span key={`${e.elementName}-n`}
                className={e.sourceCount ? 'text-navy-100' : 'text-amber-300'}>
                {e.elementName}
              </span>,
              <span key={`${e.elementName}-l`} className="font-mono text-[12px]">
                {e.fieldLength ?? '—'}
              </span>,
              e.carriedBy
                ? <span key={`${e.elementName}-c`} className="font-mono text-[11px] text-navy-300">
                    {e.carriedBy}
                  </span>
                : <span key={`${e.elementName}-c`} className="text-[12px] text-amber-300">
                    not in these files
                  </span>,
              <span key={`${e.elementName}-d`} className="text-[12px] text-navy-400 leading-relaxed">
                {e.definition}
              </span>,
            ])} />
        </div>

        <div className="mt-8 grid grid-cols-1 lg:grid-cols-2 gap-10">
          <div>
            <h3 className="text-sm font-semibold text-navy-200 mb-4">
              Elements carried, by source
            </h3>
            <BarList format="int"
              rows={sfisBySource.map((s) => ({
                key: s.sourceKey, label: s.sourceLabel,
                value: Number(s.carried),
                meta: `${s.carried} of ${s.total} SLOA elements as discrete fields`,
              }))}
              caption="Discrete is the operative word. The award files name Treasury accounts, but as a semicolon-separated display string inside one column; the account files carry the same information as separate, typed elements. A string that contains an account is not the element, because nothing can be joined, validated or apportioned on it." />
          </div>
          <div className="text-sm text-navy-300 leading-relaxed space-y-4">
            <p>
              <strong className="text-navy-100">This reframes every seam on this page.</strong>{' '}
              &ldquo;These files do not join&rdquo; is a dead end. &ldquo;These files do not carry
              the elements that would join them, and the Department has defined those elements and
              required them since 2012&rdquo; is a finding with somewhere to go.
            </p>
            <p>
              <strong className="text-navy-100">Nine elements reach the account files.</strong> The
              Treasury Account Symbol arrives properly decomposed — department regular code,
              transfer code, main account, sub account, both periods of availability and the
              availability type as separate fields. That is why the budget-line-to-account and
              account-to-File-A seams are exact: the elements are there.
            </p>
            <p>
              <strong className="text-navy-100">None reach the contract file.</strong> FPDS carries
              its own vocabulary — PIID, modification number, product service code, competition
              codes — and represents the accounting side only as text. Every seam involving a
              contract action is inferred rather than joined, and that is the direct cause.
            </p>
            <p className="text-navy-400">
              Element list and definitions:{' '}
              <span className="text-[12px]">{sfis[0]?.authority}</span>. The full SFIS matrix is
              published by OUSD(C) as a spreadsheet that this build does not hold, so what is shown
              here is the mandatory SLOA subset rather than all of SFIS. The standard itself is
              now in the knowledge bank and is searchable with the rest of the corpus —{' '}
              <Link href="/definitions" className="text-accent-400 hover:underline">
                SFIS in the definitions register
              </Link>.
            </p>
          </div>
        </div>
      </Section>

      {/* ================================================ the records ==== */}
      <Section id="records" title="The records that fail to join"
        note="A gap asserted in prose is an opinion. Each of these is a real record, quoted from the source with no editing beyond choosing which columns to show, that fails the join the site needs.">
        <div className="space-y-6">
          {samples.map((s, i) => {
            let rec: Record<string, unknown> = {};
            try { rec = JSON.parse(s.record) as Record<string, unknown>; } catch { rec = {}; }
            const good = s.verdict === 'reaches File C' || s.verdict === 'programme named';
            return (
              <div key={i} className={`rounded-lg border px-5 py-4 ${
                good ? 'border-navy-700 bg-navy-900/40' : 'border-amber-500/25 bg-amber-500/[0.03]'}`}>
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-2">
                  <span className="font-mono text-[11px] uppercase tracking-wider text-navy-500">
                    {SEAM_LABEL[s.seamKey] ?? s.seamKey}
                  </span>
                  <span className={`text-sm font-semibold ${good ? 'text-accent-300' : 'text-amber-300'}`}>
                    {s.verdict}
                  </span>
                  {s.fiscalYear && (
                    <span className="text-[11px] text-navy-500">FY{s.fiscalYear}</span>
                  )}
                </div>
                <p className="text-[13px] text-navy-300 leading-relaxed mb-3">{s.why}</p>
                <RecordTable record={rec} />
              </div>
            );
          })}
        </div>
        <Caveat>
          These are drawn from one fiscal year of one partition and chosen as the largest example of
          each kind, not as a random sample. They demonstrate that the break exists and what it
          looks like; the seam table above is what measures how often it happens.
        </Caveat>
      </Section>

      {/* ============================================== the field catalogue === */}
      <Section id="fields" title="What each source actually carries"
        note="Every column of every source, how often it is populated, how many distinct values it holds, and three real values. The right-hand flag says whether this site reads the column at all — a reader is entitled to see what was available and not used, not only what was used.">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {sourceSummary.map((s) => (
            <StatTile key={s.sourceKey} label={s.sourceLabel}
              value={`${s.fieldsRead} of ${s.fields}`}
              sub={`columns read · profiled on ${fmtInt(Number(s.rowsScanned))} rows of FY${s.fiscalYear}`}
              tone={Number(s.fieldsRead) / Number(s.fields) < 0.15 ? 'warning' : 'default'} />
          ))}
        </div>

        {sourceSummary.map((s) => {
          const rows = fields.filter((f) => f.sourceKey === s.sourceKey);
          return (
            <details key={s.sourceKey} className="mb-4 rounded-lg border border-navy-800 bg-navy-900/30">
              <summary className="cursor-pointer select-none px-5 py-3 text-sm text-navy-200 hover:text-accent-300">
                <span className="font-semibold">{s.sourceLabel}</span>
                <span className="text-navy-500"> — {s.fields} columns, {s.fieldsRead} read</span>
              </summary>
              <div className="px-5 pb-5">
                <DataTable
                  align={[0, 1, 5, 6]}
                  head={['Column', 'Type', 'Populated', 'Distinct', 'Read', 'Example values']}
                  rows={rows.map((f) => [
                    <span key={f.fieldName}
                      className={f.isRead ? 'font-mono text-[12px] text-accent-300'
                                          : 'font-mono text-[12px] text-navy-400'}>
                      {f.fieldName}
                    </span>,
                    <span key={`${f.fieldName}-t`} className="text-[11px] text-navy-500">
                      {f.fieldKind}
                    </span>,
                    f.populatedPct == null ? '—' : fmtPct(Number(f.populatedPct)),
                    f.distinctCount == null ? '—' : fmtInt(Number(f.distinctCount)),
                    f.isRead
                      ? <span key={`${f.fieldName}-r`} className="text-accent-300">yes</span>
                      : <span key={`${f.fieldName}-r`} className="text-navy-600">—</span>,
                    <span key={`${f.fieldName}-s`} className="font-mono text-[11px] text-navy-400 break-all">
                      {f.sampleValues ?? <span className="text-navy-600">no populated value in the sample</span>}
                    </span>,
                  ])} />
              </div>
            </details>
          );
        })}
        <Caveat>
          Populated share, distinct counts and example values are measured on the first batch of
          rows of one fiscal year&rsquo;s partition, and the batch size is stated on each tile above.
          A parquet row group in these files is the whole file, so a complete profile of ninety
          columns costs more memory than the extract host has. Treat these as the shape of the
          column, not as a census of it.
        </Caveat>
      </Section>

      {/* =================================================== action register === */}
      <Section id="actions" title="What is missing, and what would close it"
        note="Stated as work rather than as a finding. Each row names the gap, what it costs today, and the specific thing that would close it — separated into what this site can do and what only the reporting chain can do.">
        <DataTable
          align={[0, 1, 2, 3]}
          caption="Nothing here is scheduled. It is the register of what a reader should know is unresolved, so that a figure on this site is never mistaken for a complete answer."
          head={['Gap', 'What it costs', 'What would close it', 'Whose move']}
          rows={[
            ['Budget Line Item is in no published file',
             'The budget-to-contract chain cannot be joined at all. The site infers 58 of 2,725 lines to a programme code on shared designators, and refuses to guess the rest.',
             'SLOA element 12 carried on the contract action, or on File C beside the award identifier it already holds.',
             'reporting chain'],
            ['The contract file carries no SLOA element as a discrete field',
             'Every seam involving a contract action is inferred rather than joined. Accounts arrive as a semicolon-separated string that cannot be validated or apportioned.',
             'The Treasury Account Symbol decomposed into its elements on the award record, as File C already does.',
             'reporting chain'],
            ['File C is held as four snapshots a year, and the figure moves 8× between them',
             'No year-over-year linkage trend is supportable. The published figure is one of four defensible answers.',
             'Every submission period retained, and the period stated wherever the figure is quoted. The retention half is now done here; the collector still requests one period per run.',
             'this site + collection'],
            ['The warehouse holds a thin copy of three FY2025 File C periods',
             'FY2025 has one substantive snapshot, so its spread cannot be measured and it cannot be compared like-for-like with FY2021 to FY2024.',
             'Re-collecting the missing periods, if USASpending still publishes them.',
             'collection'],
            ['Two crosswalks on this site are derived from names',
             'The weapons-system and programme-code links rest on shared designators and shared wording. 71 of 161 systems reach a budget line; the rest carry names no evidence ties back.',
             'Either source publishing the other’s key. Failing that, the links stay evidence-bearing and individually rejectable, which is the current design.',
             'this site + reporting chain'],
            ['Object class and programme activity are read for File B only',
             'File C carries both as discrete fields and the site does not use them, so an obligation cannot yet be followed from an award to what it bought.',
             'Extending the File C extract past the five columns it currently reads. The columns are already in the warehouse.',
             'this site'],
            ['The full SFIS matrix is not held',
             'Coverage here is measured against the mandatory SLOA subset, so an element outside SLOA cannot be assessed.',
             'Ingesting the OUSD(C) SFIS matrix spreadsheet into the knowledge bank and extending dm_sfis_element from it.',
             'this site'],
          ].map(([g, c, f, w]) => [
            <span key={g as string} className="text-navy-100">{g}</span>,
            <span key={`${g as string}-c`} className="text-[12px] text-navy-400 leading-relaxed">{c}</span>,
            <span key={`${g as string}-f`} className="text-[12px] text-navy-300 leading-relaxed">{f}</span>,
            <span key={`${g as string}-w`} className={`text-[12px] ${
              w === 'this site' ? 'text-accent-300' : 'text-amber-300'}`}>{w}</span>,
          ])} />
      </Section>

      {/* ==================================================== how to read === */}
      <Section title="How to use this page">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-10 gap-y-4 text-sm text-navy-300 leading-relaxed">
          <p>
            <strong className="text-navy-100">A narrow seam is not a scandal.</strong> Most of these
            joins are narrow because the two files were built by different chains for different
            purposes and share no key. The width of a seam tells you how much of a question these
            sources can answer — not how well the Department is run.
          </p>
          <p>
            <strong className="text-navy-100">Two of these joins are ours.</strong> The budget line
            to acquisition program crosswalk and the weapons system to budget line crosswalk are
            derived on this site from names, because neither source carries the other&rsquo;s key.
            Every individual link records its evidence so it can be rejected on its own, an
            ambiguous match produces no link at all, and neither may be presented as a
            Department-published mapping.
          </p>
          <p>
            <strong className="text-navy-100">Every seam has two vintages.</strong> A join between a
            budget book extracted in August and contract files extracted in a different month is as
            old as the older of the two. The chips at the top of this page are the dates that apply.
          </p>
          <p>
            <strong className="text-navy-100">The controls are the enforcement.</strong> Everything
            asserted here is checked inside the load transaction rather than in a test suite, so a
            break either blocks the load or is published as a finding beside the data it concerns.
          </p>
        </div>
        <p className="text-xs text-navy-500 mt-8">
          <Link href="/controls" className="text-accent-400 hover:underline">All {controls.length} controls</Link>
          {' '}· <Link href="/sources" className="text-accent-400 hover:underline">the data register and its vintages</Link>
          {' '}· <Link href="/traceability" className="text-accent-400 hover:underline">one programme followed through every seam on this page</Link>
          {' '}· <Link href="/reconciliation" className="text-accent-400 hover:underline">the File C reconciliation in full</Link>
        </p>
      </Section>
    </Shell>
  );
}

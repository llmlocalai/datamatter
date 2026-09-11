import type { Metadata } from 'next';
import Link from 'next/link';
import Shell, { Section } from '@/components/Shell';
import { StatTile } from '@/components/charts';
import { fmtT, fmtB, fmtPct, fmtInt } from '@/components/format';
import {
  getSbrSeries, getReconciliation, getControls, getAllProvenance, getDefinitions,
} from '@/lib/analytics';
import { pickFiscalYear } from '@/lib/fiscal';
import { getSplitByFy, splitReady, directRate } from '@/lib/funding';

export const metadata: Metadata = {
  title: 'datamatter · Department of War budget analytics',
  description:
    'Budget formulation, execution, and audit analytics over the USASpending warehouse and a curated DoD financial-management knowledge bank. Every figure names its source and vintage.',
};
export const revalidate = 900;

const PRODUCTS = [
  { href: '/execution', title: 'Budget to execution',
    desc: 'The fiscal year in progress: authority through obligation and outlay, File B at object-class and expenditure-stage grain, and contract timing measured against each category’s own year-end history.',
    tag: 'The year that is running' },
  { href: '/reconciliation', title: 'Reconciliation',
    desc: 'Award-file contract obligations against account-linked File C, and the movement of closed fiscal years between warehouse vintages.',
    tag: 'Two reporting chains' },
  { href: '/funds-control', title: 'Funds control',
    desc: 'Obligation and outlay rates, unobligated balances, and lapse exposure at Treasury account grain.',
    tag: 'TAS level' },
  { href: '/contracting', title: 'Contracting',
    desc: 'Contract obligations by set-aside, extent competed, recipient and industry — with those first two kept as the separate fields they are.',
    tag: 'FPDS award files' },
  { href: '/budget', title: 'FY2027 request',
    desc: 'The seven "-1" display tables drilled from appropriation to budget activity, sub-activity and budget line item, with every memo restatement excluded and stated.',
    tag: 'Justification exhibits' },
  { href: '/audit', title: 'Audit posture',
    desc: 'Opinion, material weakness counts and scope limitations, read from the Agency Financial Report rather than inferred from file counts.',
    tag: 'AFR and OIG' },
];

const METHOD = [
  { href: '/sources', title: 'Sources', desc: 'Every dataset with its grain, vintage, transformation and stated limitations.' },
  { href: '/definitions', title: 'Definitions', desc: 'Financial-management terms with their authorities. One meaning per term, site-wide.' },
  { href: '/controls', title: 'Controls', desc: 'Validation rules that run inside the load transaction. A critical failure refuses the load.' },
  { href: '/regulation', title: 'Regulatory search', desc: 'Authority-ranked passage retrieval across the curated knowledge wiki.' },
];

export default async function Home() {
  const [sbr, rec, controls, datasets, defs] = await Promise.all([
    getSbrSeries(), getReconciliation(), getControls(), getAllProvenance(), getDefinitions(),
  ]);
  // The front page opens on the year being executed, not the last one that
  // closed. The two File A tiles are that year, period-to-date; the two contract
  // tiles stay on the last CLOSED year and say so, because a linkage percentage
  // read off a part-year snapshot is the one figure on this site that moves by a
  // factor of eight depending on which snapshot you pick — see FILEC-02.
  const closed = sbr.filter((s) => !s.isPartialYear);
  const latest = pickFiscalYear(sbr) ?? closed[closed.length - 1];
  const closedRec = rec.filter((r) => !r.isPartialYear);
  const lastRec = closedRec[closedRec.length - 1];
  // Direct execution, not direct plus reimbursable -- see lib/funding.
  const splits = (await splitReady()) ? await getSplitByFy() : [];
  const latestSplit = latest ? splits.find((x) => x.fiscalYear === latest.fiscalYear) : undefined;
  const latestRate = latestSplit
    ? directRate(latestSplit.direct, latestSplit.resources, latestSplit.offsettingCollections) : null;
  const assertions = controls.reduce((s, c) => s + c.total, 0);
  const passing = controls.reduce((s, c) => s + c.pass, 0);
  const loaded = datasets.filter((d: any) => d.vintage).length;

  return (
    <Shell>
      <section className="pt-16 pb-12 border-b border-navy-800/60">
        <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-accent-400 mb-4">
          Department of War · budget, execution and audit analytics
        </p>
        <h1 className="text-4xl sm:text-5xl font-bold text-navy-50 leading-[1.08] max-w-4xl text-balance">
          Where the money was authorised, where it was obligated, and whether the two can be
          traced to each other
        </h1>
        <p className="mt-6 text-lg text-navy-300 leading-relaxed max-w-2xl">
          Analytic products built directly on the USASpending account and award warehouse and a
          curated financial-management knowledge bank. Every figure names its source and its vintage,
          every dataset publishes its limitations, and the validation rules run inside the load
          transaction rather than in a test suite nobody blocks on.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/execution"
            className="px-5 py-2.5 bg-accent-500 hover:bg-accent-600 text-navy-950 font-semibold rounded-lg text-sm transition-colors">
            Start with the execution chain
          </Link>
          <Link href="/reconciliation"
            className="px-5 py-2.5 border border-navy-600 hover:border-accent-500/60 text-navy-200 hover:text-accent-400 font-medium rounded-lg text-sm transition-colors">
            See the reconciliation
          </Link>
        </div>
      </section>

      {latest && lastRec && (
        <Section title={`FY${latest.fiscalYear}${latest.isPartialYear ? ' so far' : ''}, in four figures`}
          note={`Department scope — agency codes 097, 021, 017 and 057. Agency 011, which appears in `
            + `the same source file, is not the Department and is excluded.`
            + (latest.isPartialYear
                ? ` The first two figures are FY${latest.fiscalYear} period-to-date; the second two `
                  + `stay on FY${lastRec.fiscalYear}, the last closed year, because a linkage share `
                  + `read off a part-year snapshot measures the snapshot.`
                : '')}>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatTile label="Total budgetary resources" value={fmtT(latest.totalBudgetaryResources)}
              sub={`FY${latest.fiscalYear} across ${fmtInt(latest.tasCount)} Treasury accounts`
                + (latest.submissionPeriod ? ` · ${latest.submissionPeriod}` : '')} />
            <StatTile label="Direct obligations" value={latestSplit ? fmtT(latestSplit.direct) : '—'}
              sub={latestSplit
                ? `${latestRate != null ? `${fmtPct(latestRate)} of direct resources · ` : ''}`
                  + `${fmtT(latestSplit.reimbursable)} reimbursable not counted`
                  + `${latest.isPartialYear ? ', period-to-date' : ''}`
                : 'Direct/reimbursable split not loaded yet'} tone="accent" />
            <StatTile label="Contract obligations" value={fmtB(lastRec.awardObligation)}
              sub={`FY${lastRec.fiscalYear} · ${fmtInt(lastRec.awardActions)} contract actions`} />
            <StatTile label="Traceable to an account" value={fmtPct(lastRec.linkagePct)}
              sub={`FY${lastRec.fiscalYear} share of contract obligations carrying a Treasury account link`}
              tone="critical" />
          </div>
        </Section>
      )}

      <Section title="Analytic products">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {PRODUCTS.map((p) => (
            <Link key={p.href} href={p.href}
              className="glass-card rounded-lg p-5 hover:border-accent-500/40 transition-colors group">
              <span className="text-[12px] uppercase tracking-wider text-accent-400 font-semibold">{p.tag}</span>
              <h3 className="text-navy-50 font-semibold mt-2 group-hover:text-accent-400 transition-colors">{p.title}</h3>
              <p className="text-sm text-navy-400 mt-2 leading-relaxed">{p.desc}</p>
            </Link>
          ))}
        </div>
      </Section>

      <Section title="How it is built"
        note="The method is a published artifact, not an implementation detail. These four pages are what make the six above defensible.">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {METHOD.map((m) => (
            <Link key={m.href} href={m.href}
              className="border border-navy-800 rounded-lg p-4 hover:border-accent-500/40 transition-colors group">
              <h3 className="text-navy-100 font-semibold text-sm group-hover:text-accent-400 transition-colors">{m.title}</h3>
              <p className="text-xs text-navy-400 mt-1.5 leading-relaxed">{m.desc}</p>
            </Link>
          ))}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-6">
          <StatTile label="Control assertions passing" value={`${passing} / ${assertions}`}
            sub="Evaluated on every load; a critical failure rolls the load back"
            tone={passing === assertions ? 'good' : 'warning'} />
          <StatTile label="Datasets under provenance" value={String(loaded)}
            sub="Each with source, grain, vintage and stated limitations" />
          <StatTile label="Defined terms" value={String(defs.length)}
            sub="Every one carrying at least one authoritative source" />
        </div>
      </Section>
    </Shell>
  );
}

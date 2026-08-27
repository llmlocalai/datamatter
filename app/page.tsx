import type { Metadata } from 'next';
import Link from 'next/link';
import Shell, { Section } from '@/components/Shell';
import { StatTile } from '@/components/charts';
import { fmtT, fmtB, fmtPct, fmtInt } from '@/components/format';
import {
  getSbrSeries, getReconciliation, getControls, getAllProvenance, getDefinitions,
} from '@/lib/analytics';

export const metadata: Metadata = {
  title: 'datamatter · Department of War budget analytics',
  description:
    'Budget formulation, execution, and audit analytics over the USASpending warehouse and a curated DoD financial-management knowledge bank. Every figure names its source and vintage.',
};
export const revalidate = 900;

const PRODUCTS = [
  { href: '/execution', title: 'Budget to execution',
    desc: 'Appropriated authority through obligation, undelivered and delivered orders, and outlay — with the variance at each hand-off stated.',
    tag: 'Statement of Budgetary Resources' },
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
    desc: 'The seven "-1" display tables, de-duplicated to their canonical sheets, with a line-item explorer and the source documents.',
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
  const closed = sbr.filter((s) => !s.isPartialYear);
  const latest = closed[closed.length - 1];
  const closedRec = rec.filter((r) => !r.isPartialYear);
  const lastRec = closedRec[closedRec.length - 1];
  const assertions = controls.reduce((s, c) => s + c.total, 0);
  const passing = controls.reduce((s, c) => s + c.pass, 0);
  const loaded = datasets.filter((d: any) => d.vintage).length;

  return (
    <Shell>
      <section className="pt-16 pb-12 border-b border-navy-800/60">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-accent-400 mb-4">
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
        <Section title={`FY${latest.fiscalYear}, in four figures`}
          note="Department scope — agency codes 097, 021, 017 and 057. Agency 011, which appears in the same source file, is not the Department and is excluded.">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatTile label="Total budgetary resources" value={fmtT(latest.totalBudgetaryResources)}
              sub={`Across ${fmtInt(latest.tasCount)} Treasury accounts`} />
            <StatTile label="Obligations incurred" value={fmtT(latest.obligationsIncurred)}
              sub={`${fmtPct(latest.obligationsIncurred / latest.totalBudgetaryResources * 100)} of available resources`} tone="accent" />
            <StatTile label="Contract obligations" value={fmtB(lastRec.awardObligation)}
              sub={`${fmtInt(lastRec.awardActions)} contract actions`} />
            <StatTile label="Traceable to an account" value={fmtPct(lastRec.linkagePct)}
              sub="Share of contract obligations carrying a Treasury account link" tone="critical" />
          </div>
        </Section>
      )}

      <Section title="Analytic products">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {PRODUCTS.map((p) => (
            <Link key={p.href} href={p.href}
              className="glass-card rounded-lg p-5 hover:border-accent-500/40 transition-colors group">
              <span className="text-[10px] uppercase tracking-wider text-accent-400 font-semibold">{p.tag}</span>
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

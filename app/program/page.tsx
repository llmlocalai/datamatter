import type { Metadata } from 'next';
import Link from 'next/link';
import Shell, { PageHeader, Section } from '@/components/Shell';
import { ProvenanceBar, Caveat } from '@/components/Provenance';
import { StatTile, DataTable, BarList } from '@/components/charts';
import { fmtT, fmtPct, fmtInt } from '@/components/format';
import {
  getProvenance, getExhibitRoster, getExhibitFacets, getExhibitTotals, getExhibitTieouts,
} from '@/lib/analytics';
import { NotLoaded } from '../execution/page';
import ExecutionView from './execution-view';
import LineView from './line-view';

export const metadata: Metadata = {
  title: 'Programs · datamatter',
  description:
    "Every budget line in the President's Budget P-1 and R-1 exhibits, PB2020 through PB2027, at the grain the exhibits publish: a book year and a fiscal year. Each line can be followed from request to enactment to actual, then into the Treasury account it is appropriated to and the contracts written against it.",
};
export const revalidate = 900;

/** Exhibit amounts are published in thousands. Everything on the site is dollars. */
const K = (n: number | null | undefined) => Number(n ?? 0) * 1000;

const EXHIBIT_LABEL: Record<string, string> = {
  p1: 'P-1 procurement',
  r1: 'R-1 research and development',
  p1r: 'P-1R reserve and guard · memo only',
};

function Chip({ href, active, children, tone = 'default' }: {
  href: string; active?: boolean; children: React.ReactNode; tone?: 'default' | 'gold';
}) {
  return (
    <Link href={href} scroll={false}
      aria-current={active ? 'page' : undefined}
      className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
        active ? 'bg-accent-500 text-navy-950'
        : tone === 'gold' ? 'bg-navy-800 text-accent-300 hover:bg-navy-700'
        : 'bg-navy-800 text-navy-300 hover:bg-navy-700'}`}>
      {children}
    </Link>
  );
}

/** The roster: every budget line the -1 exhibits publish, searchable. */
async function RosterView({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  const q = searchParams.q?.trim() || '';
  const org = searchParams.org || '';
  const exhibit = searchParams.exhibit || '';
  const weaponsOnly = searchParams.mdap === '1';
  const page = Math.max(1, Number(searchParams.page) || 1);
  const perPage = 60;

  const [prov, facets, totals, tieouts, roster] = await Promise.all([
    getProvenance('budget_exhibits'), getExhibitFacets(), getExhibitTotals(),
    getExhibitTieouts(),
    getExhibitRoster({ q, organization: org, exhibit, weaponsOnly,
                       limit: perPage, offset: (page - 1) * perPage }),
  ]);
  if (!prov) return <Shell><NotLoaded /></Shell>;

  const books = Array.from(new Set(totals.map((t) => t.pbYear))).sort();
  const years = Array.from(new Set(totals.map((t) => t.fiscalYear))).sort();
  const newestBook = books[books.length - 1];
  const requestNewest = totals
    .filter((t) => t.pbYear === newestBook && t.fyRole === 'request')
    .reduce((s, t) => s + K(t.amountK), 0);
  const linesNewest = totals
    .filter((t) => t.pbYear === newestBook && t.fyRole === 'request')
    .reduce((s, t) => s + t.lines, 0);

  // The restatement picture, department-wide: for each fiscal year, what was
  // requested, what was enacted, and what was actually reported.
  const byYear = years.map((fy) => {
    const pick = (role: string) =>
      totals.filter((t) => t.fiscalYear === fy && t.fyRole === role)
            .reduce((s, t) => s + K(t.amountK), 0);
    return { fy, request: pick('request'), enacted: pick('enacted'), actual: pick('prior_actual') };
  });
  const complete = byYear.filter((y) => y.request && y.enacted && y.actual);

  const qs = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = { q, org, exhibit, mdap: weaponsOnly ? '1' : '', ...over };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `/program?${s}` : '/program';
  };

  const total = roster.total;
  const lastPage = Math.max(1, Math.ceil(total / perPage));

  return (
    <Shell>
      <PageHeader
        eyebrow="Budget · the program roster"
        title={<>Every budget line in the <span className="text-accent-400">President&rsquo;s Budget</span></>}
        lede="The P-1 and R-1 exhibits are the only source here keyed to a budget line rather than to a Treasury account, which makes them the spine everything else hangs from. Eight books are held, PB2020 through PB2027, and each one restates three fiscal years — so a single year appears three times with three different numbers, and all three are kept."
      />

      <div className="mt-6 space-y-5">
        <ProvenanceBar p={prov}
          extra="Amounts are total obligation authority as published, in thousands of dollars, converted here to dollars. They are not outlays and are not comparable to an execution figure without ageing prior-year balances." />
      </div>

      <Section title="What is held"
        note="Eight President's Budget books, three fiscal years each, at the grain the exhibits publish.">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatTile label="Budget lines in the roster" value={fmtInt(total)}
            sub={q || org || exhibit || weaponsOnly ? 'matching the current filter' : 'across every book held'}
            tone="accent" />
          <StatTile label={`PB${newestBook} request`} value={fmtT(requestNewest)}
            sub={`${fmtInt(linesNewest)} line-items in the newest book`} />
          <StatTile label="President's Budget books" value={String(books.length)}
            sub={`PB${books[0]} through PB${newestBook}`} />
          <StatTile label="Fiscal years described" value={String(years.length)}
            sub={`FY${years[0]} through FY${years[years.length - 1]}, each restated up to three times`} />
        </div>
      </Section>

      {/* ------------------------------------------- the three-year structure */}
      <Section title="Why every year appears three times"
        note="A -1 exhibit is not a snapshot. Each book carries the prior year's actuals, the current year as enacted, and the budget year as requested — so FY2024 is a request in the PB2024 book, an enactment in PB2025 and an actual in PB2026. The three numbers differ, and the difference is the point: it is the only place in these sources where a request can be watched becoming an appropriation and then an outturn."
        id="restatement">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
          <div>
            <h3 className="text-sm font-semibold text-navy-200 mb-4">
              The same years, three ways
            </h3>
            <DataTable
              caption="Read across, not down. Each row is one fiscal year as three different books described it; they are three statements about the same money, not three amounts to add. A blank means no book we hold covers that year in that role."
              head={['Fiscal year', 'Requested', 'Enacted', 'Actual', 'Request → enacted']}
              rows={byYear.map((y) => [
                `FY${y.fy}`,
                y.request ? fmtT(y.request) : '—',
                y.enacted ? fmtT(y.enacted) : '—',
                y.actual ? fmtT(y.actual) : '—',
                y.request && y.enacted
                  ? `${y.enacted >= y.request ? '+' : '−'}${fmtPct(Math.abs(y.enacted - y.request) / y.request * 100)}`
                  : '—',
              ])} />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-navy-200 mb-4">
              PB{newestBook} request by component
            </h3>
            <BarList rows={facets.organizations.map((o) => ({
              key: o.key, label: o.label, value: K(o.requestK),
              meta: `${fmtInt(o.lines)} budget lines`,
            }))} format="billions"
              caption="Each line's request in its own newest book, summed by the military department or defence agency whose account it sits in — derived from the account symbol, because the exhibits' own Organization column spells the same component four different ways across eight books. Lines last requested in an older book carry that older request, which is why this is a roster measure and not a fiscal-year total." />
          </div>
        </div>
      </Section>

      {/* ------------------------------------------------------- the tie-out */}
      {tieouts.length > 0 && (
        <Section title="Checked against the Department's own total"
          note="The Program Acquisition Cost by Weapon System book states the same request these exhibits itemise, totalled by the Department itself. It is the one external check available on this extract, and it is asserted in the load transaction rather than in a test suite.">
          <DataTable
            caption="Control EXH-08. A load whose exhibit lines do not total the published figure is rolled back, and the previous load stays current."
            head={['Book', 'Measure', 'Department publishes', 'These exhibit lines total', 'Difference']}
            rows={tieouts.filter((t) => t.exhibit).map((t) => [
              `PB${t.pbYear}`,
              t.measure === 'rdte' ? 'RDT&E (R-1)' : 'Procurement (P-1)',
              `$${Number(t.publishedB).toFixed(1)}B`,
              t.extractedB == null ? '—' : `$${Number(t.extractedB).toFixed(1)}B`,
              t.extractedB == null ? '—'
                : Math.abs(Number(t.extractedB) - Number(t.publishedB)) <= 0.05
                ? 'ties'
                : `$${(Number(t.extractedB) - Number(t.publishedB)).toFixed(1)}B`,
            ])} />
          <Caveat>
            This check earned its place. The P-1 publishes an{' '}
            <span className="font-mono text-[12px]">Advance Procurement (CY)</span> row for a line and
            then restates the same money on the{' '}
            <span className="font-mono text-[12px]">C (FY x for FY y) (M)</span> rows beneath it.
            Counting both put the PB2026 procurement request at $219.6B against the $205.2B the
            Department publishes — a $14.4B double count that no internal consistency check would have
            seen, because the extract was perfectly consistent with itself.
          </Caveat>
        </Section>
      )}

      {/* ---------------------------------------------------------- the roster */}
      <Section title="The roster"
        note="Ranked by the newest request rather than by lifetime dollars, so a line still being asked for outranks one that stopped being requested in 2021. Both are here.">
        <form method="get" action="/program" className="flex flex-wrap items-center gap-3 mb-5">
          <input type="search" name="q" defaultValue={q} placeholder="F-35, DDG, Golden Dome, 1506N, 017-1506…"
            aria-label="Search budget lines"
            className="flex-1 min-w-[16rem] px-3 py-2 rounded-lg bg-navy-800 border border-navy-700 text-sm text-navy-100 placeholder:text-navy-500 focus:outline-none focus:ring-2 focus:ring-accent-500" />
          {org && <input type="hidden" name="org" value={org} />}
          {exhibit && <input type="hidden" name="exhibit" value={exhibit} />}
          {weaponsOnly && <input type="hidden" name="mdap" value="1" />}
          <button type="submit"
            className="px-4 py-2 rounded-lg bg-accent-500 text-navy-950 text-sm font-semibold hover:bg-accent-400 transition-colors">
            Search
          </button>
          {(q || org || exhibit || weaponsOnly) && (
            <Link href="/program" className="text-sm text-navy-400 hover:text-accent-400">Clear</Link>
          )}
        </form>

        <div className="flex flex-wrap gap-2 mb-3">
          <Chip href={qs({ exhibit: '', page: undefined })} active={!exhibit}>All exhibits</Chip>
          {facets.exhibits.map((e) => (
            <Chip key={e.key} href={qs({ exhibit: e.key, page: undefined })} active={exhibit === e.key}>
              {EXHIBIT_LABEL[e.key] ?? e.key} · {fmtInt(e.lines)}
            </Chip>
          ))}
          <Chip href={qs({ mdap: weaponsOnly ? '' : '1', page: undefined })} active={weaponsOnly} tone="gold">
            In the weapons book
          </Chip>
        </div>
        <div className="flex flex-wrap gap-2 mb-6">
          <Chip href={qs({ org: '', page: undefined })} active={!org}>All components</Chip>
          {facets.organizations.map((o) => (
            <Chip key={o.key} href={qs({ org: o.key, page: undefined })} active={org === o.key}>
              {o.label} · {fmtInt(o.lines)}
            </Chip>
          ))}
        </div>

        {roster.rows.length === 0 ? (
          <p className="text-sm text-navy-400">
            Nothing in the roster matches that filter in the extract vintage named above. That is a
            statement about this cut, not about the President&rsquo;s Budget.
          </p>
        ) : (
          <DataTable
            caption={`${fmtInt(total)} budget lines match. Amounts are the request in each line's newest book — an actual or an enactment is a different claim about a year and is not mixed in here.`}
            head={['Budget line', 'Exhibit', 'Account', 'Line item', 'Newest request', 'Years', 'Weapons book']}
            rows={roster.rows.map((p) => [
              <Link key={p.slug} href={`/program?bli=${encodeURIComponent(`${p.exhibit}:${p.account}:${p.bli}`)}`}
                className="text-accent-400 hover:underline">{p.programName}</Link>,
              p.exhibit.toUpperCase(),
              <span key={`${p.slug}-a`} className="font-mono text-[12px]">
                {p.account}{p.treasuryAccount ? ` · ${p.treasuryAccount}` : ''}
                <span className="block text-navy-500">{p.accountTitle}</span>
              </span>,
              <span key={`${p.slug}-b`} className="font-mono text-[12px]">{p.bli}</span>,
              p.latestRequestK
                ? <span key={`${p.slug}-r`}>{fmtT(K(p.latestRequestK))}
                    <span className="block text-[12px] text-navy-500">PB{p.latestRequestPb}</span>
                  </span>
                : <span key={`${p.slug}-r`} className="text-navy-500">not requested in any book held</span>,
              `FY${p.firstFiscalYear}–${p.lastFiscalYear}`,
              p.inWeaponsBook ? <span key={`${p.slug}-w`} className="text-accent-300">yes</span> : '—',
            ])} />
        )}

        {lastPage > 1 && (
          <div className="flex items-center gap-3 mt-6 text-sm">
            {page > 1 && <Chip href={qs({ page: String(page - 1) })}>← Previous</Chip>}
            <span className="text-navy-400">Page {page} of {lastPage}</span>
            {page < lastPage && <Chip href={qs({ page: String(page + 1) })}>Next →</Chip>}
          </div>
        )}
      </Section>

      <Section title="How to read a figure on this page">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-10 gap-y-4 text-sm text-navy-300 leading-relaxed">
          <p>
            <strong className="text-navy-100">A request is not an appropriation.</strong> The newest
            request column is what the Department asked for in its most recent book covering that
            line. Open the line to see what was enacted and what was actually reported.
          </p>
          <p>
            <strong className="text-navy-100">Memo lines are held out.</strong> The P-1R exhibit is
            National Guard and Reserve equipment already counted inside the P-1 lines, and some R-1
            lines sit outside total obligation authority. They are kept and flagged rather than
            dropped — control{' '}
            <Link href="/controls" className="text-accent-400 hover:underline">EXH-03</Link> asserts
            no total includes them.
          </p>
          <p>
            <strong className="text-navy-100">One account, many lines.</strong> The exhibit account
            symbol resolves to a Treasury account, which is the join into execution — but several
            budget lines share one account and the execution files state no split between them.
            Nothing here apportions one.
          </p>
          <p>
            <strong className="text-navy-100">Absence is absence in this cut.</strong> An empty result
            means the filter matched nothing in the vintage named above — never that the Department
            did not publish it.
          </p>
        </div>
        <p className="text-xs text-navy-500 mt-8">
          Method and controls:{' '}
          <Link href="/controls" className="text-accent-400 hover:underline">EXH-01 through EXH-09</Link>{' '}
          · <Link href="/sources" className="text-accent-400 hover:underline">sources</Link>
          {' '}· <Link href="/traceability" className="text-accent-400 hover:underline">where the chain breaks</Link>
        </p>
      </Section>
    </Shell>
  );
}

export default async function ProgramPage({ searchParams }: {
  searchParams: { bli?: string; code?: string; fy?: string; q?: string; org?: string;
                  exhibit?: string; mdap?: string; page?: string; pb?: string };
}) {
  if (searchParams.bli) return <LineView searchParams={searchParams} />;
  if (searchParams.code) return <ExecutionView searchParams={searchParams} />;
  return <RosterView searchParams={searchParams} />;
}

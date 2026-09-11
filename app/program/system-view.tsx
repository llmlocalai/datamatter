import Link from 'next/link';
import Shell, { PageHeader, Section } from '@/components/Shell';
import { ProvenanceBar, Caveat } from '@/components/Provenance';
import { StatTile, DataTable } from '@/components/charts';
import { fmtT, fmtPct, fmtInt } from '@/components/format';
import {
  getProvenance, getSystemMeta, getSystemCost, getSystemAliases,
  getSystemRollup, getSystemLines, getAccountExecution,
} from '@/lib/analytics';
import { NotLoaded } from '../execution/page';

/** Exhibit amounts are published in thousands; the weapons book in millions. */
const K = (n: number | null | undefined) => Number(n ?? 0) * 1000;
const M = (n: number | null | undefined) => Number(n ?? 0) * 1_000_000;

const ROLE_LABEL: Record<string, string> = {
  request: 'requested', enacted: 'enacted', prior_actual: 'actual', other: 'other year',
};

function Badge({ children, tone = 'gold' }: { children: React.ReactNode; tone?: 'gold' | 'muted' }) {
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-md text-[12px] font-medium ${
      tone === 'gold' ? 'bg-accent-500/15 text-accent-300 border border-accent-500/30'
                      : 'bg-navy-800 text-navy-300 border border-navy-700'}`}>
      {children}
    </span>
  );
}

/**
 * One weapon system, costed two ways.
 *
 * The Department publishes a total for the system in Program Acquisition Cost by
 * Weapon System. The -1 exhibits itemise the same request across several budget
 * lines in several appropriations — the airframe on one line, its modifications
 * on another, its spares and support equipment on a third, its development in
 * the R-1 entirely. This page puts the two side by side, and the difference
 * between them is the honest subject of the page: it measures how much of a
 * programme the evidence-bearing crosswalk actually reaches, not how much money
 * exists.
 */
export default async function SystemView({ searchParams }: {
  searchParams: { system?: string; pb?: string };
}) {
  const name = (searchParams.system ?? '').trim();
  const [prov, meta] = await Promise.all([
    getProvenance('budget_exhibits'), getSystemMeta(name),
  ]);
  if (!prov || !meta) return <Shell><NotLoaded /></Shell>;

  const [cost, aliases, rollup, lines] = await Promise.all([
    getSystemCost(name), getSystemAliases(name), getSystemRollup(name), getSystemLines(name),
  ]);

  const books = Array.from(new Set(cost.map((c) => c.pbYear))).sort();
  const wanted = Number(searchParams.pb);
  const book = books.includes(wanted) ? wanted : books[books.length - 1];
  const inBook = cost.filter((c) => c.pbYear === book);
  const bookYears = Array.from(new Set(inBook.map((c) => c.fiscalYear))).sort();

  const cell = (kind: string, appr: string | null, svc: string | null, fy: number) =>
    inBook.find((c) => c.rowKind === kind && c.appropriation === appr
                    && c.service === svc && c.fiscalYear === fy);
  const totalFor = (fy: number) => inBook.find((c) => c.rowKind === 'total' && c.fiscalYear === fy);

  // The appropriations the book prints for this system, in the order it prints
  // them, with their services underneath.
  const blocks: { appr: string; services: (string | null)[] }[] = [];
  for (const c of inBook) {
    if (c.rowKind === 'total' || !c.appropriation) continue;
    let b = blocks.find((x) => x.appr === c.appropriation);
    if (!b) { b = { appr: c.appropriation, services: [] }; blocks.push(b); }
    if (!b.services.includes(c.service)) b.services.push(c.service);
  }

  const requestYear = bookYears[bookYears.length - 1];
  const published = totalFor(requestYear);
  const coverageNote = inBook.find((c) => c.coverageNote)?.coverageNote ?? meta.coverageNote;

  // The roll-up of the budget lines the crosswalk reaches, for the same book and
  // the same year, so the two figures are answering the same question.
  const rolled = rollup.filter((r) => r.pbYear === book && r.fiscalYear === requestYear
                                   && r.fyRole === 'request');
  const rolledK = rolled.reduce((s, r) => s + Number(r.amountK), 0);
  const publishedK = published?.amountM != null ? Number(published.amountM) * 1000 : null;
  const coverage = publishedK ? rolledK / publishedK * 100 : null;

  // File A for every Treasury account these lines are appropriated to. This is
  // account money, never the system's own.
  const accounts = Array.from(new Set(
    lines.map((l) => l.treasuryAccount).filter((x): x is string => !!x)));
  const execution = await Promise.all(accounts.slice(0, 6).map(async (a) => ({
    account: a,
    title: lines.find((l) => l.treasuryAccount === a)?.appropriation
        ?? lines.find((l) => l.treasuryAccount === a)?.accountTitle ?? a,
    rows: await getAccountExecution(a),
  })));

  return (
    <Shell>
      <PageHeader
        eyebrow={`Weapon system · ${meta.category ?? 'Program Acquisition Cost by Weapon System'}`}
        title={<span className="text-accent-400">{meta.programName}</span>}
        lede={`What the Department publishes for this system, and what the budget lines tied to it actually add up to. Held in ${meta.books} weapons book${meta.books === 1 ? '' : 's'}; ${lines.length} budget line${lines.length === 1 ? '' : 's'} in the P-1 and R-1 exhibits reach it on evidence.`}
      />

      <div className="mt-6 space-y-5">
        <ProvenanceBar p={prov}
          extra="The weapons book publishes in millions of dollars and the -1 exhibits in thousands; both are shown here in dollars. Every figure is a request, an enactment or an actual as the book states it — never a mixture." />
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/program" className="text-sm text-accent-400 hover:underline">← the roster</Link>
          {meta.category && <Badge>{meta.category}</Badge>}
          {aliases.map((a) => <Badge key={a.alias} tone="muted">also written {a.alias}</Badge>)}
          {books.length > 1 && (
            <span className="text-sm text-navy-400">
              book:{' '}
              {books.map((b) => (
                <Link key={b} href={`/program?system=${encodeURIComponent(name)}&pb=${b}`}
                  scroll={false}
                  className={b === book ? 'text-accent-400 font-semibold px-1'
                                        : 'text-accent-400 hover:underline px-1'}>
                  PB{b}
                </Link>
              ))}
            </span>
          )}
        </div>
      </div>

      {/* ------------------------------------- what the Department publishes */}
      <Section title={`What the Department publishes for this system · PB${book}`}
        note="Program Acquisition Cost by Weapon System states, on one page per system, the RDT&E and procurement cost of that system split by service, with quantities, for the three fiscal years the book restates. It is the only source here that states what a whole programme costs rather than what one budget line costs.">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatTile label={`FY${requestYear} ${ROLE_LABEL[published?.fyRole ?? 'request']}`}
            value={published?.amountM != null ? fmtT(M(published.amountM)) : '—'}
            tone="accent"
            sub={published?.quantity ? `${fmtInt(Number(published.quantity))} units` : 'the system total on the page'} />
          <StatTile label="Budget lines tied to it"
            value={String(lines.length)}
            sub={`across ${accounts.length} Treasury account${accounts.length === 1 ? '' : 's'}`} />
          <StatTile label="Those lines total"
            value={rolledK ? fmtT(K(rolledK)) : '—'}
            sub={`FY${requestYear} request, non-memo, from the PB${book} book`} />
          <StatTile label="Which is this much of it"
            value={coverage != null ? fmtPct(coverage) : '—'}
            tone={coverage != null && (coverage < 90 || coverage > 100.5) ? 'warning' : 'default'}
            sub="of the published system total — a measure of the crosswalk, not of the money" />
        </div>

        {inBook.length > 0 && (
          <div className="mt-8">
            <DataTable
              align={[1]}
              caption={`As printed on page ${meta.pageNo ?? '—'} of the PB${book} book. Read down to the Total: the subtotals are the book's own, and adding a subtotal to the services beneath it would count the same money twice.${coverageNote ? ` The page states: “${coverageNote}”.` : ''}`}
              head={['Appropriation', 'Service',
                     ...bookYears.map((y) => `FY${y} ${ROLE_LABEL[
                       inBook.find((c) => c.fiscalYear === y)?.fyRole ?? 'other']}`)]}
              rows={[
                ...blocks.flatMap((b) => [
                  ...b.services.filter((s) => s !== null).map((s) => [
                    <span key={`${b.appr}-${s}`} className="text-navy-500">{b.appr}</span>,
                    s as string,
                    ...bookYears.map((y) => {
                      const c = cell('detail', b.appr, s, y);
                      return c?.amountM == null ? '—' : (
                        <span key={`${b.appr}-${s}-${y}`}>
                          {fmtT(M(c.amountM))}
                          {c.quantity ? <span className="block text-[11px] text-navy-500">
                            {fmtInt(Number(c.quantity))} units</span> : null}
                        </span>
                      );
                    }),
                  ]),
                  ...(b.services.includes(null) || inBook.some((c) => c.rowKind === 'subtotal' && c.appropriation === b.appr)
                    ? [[
                        <span key={`${b.appr}-sub`} className="font-semibold text-navy-200">{b.appr}</span>,
                        <span key={`${b.appr}-sub2`} className="text-navy-500">subtotal</span>,
                        ...bookYears.map((y) => {
                          const c = cell('subtotal', b.appr, null, y) ?? cell('detail', b.appr, null, y);
                          return c?.amountM == null ? '—'
                            : <span key={`${b.appr}-sub-${y}`} className="font-semibold">{fmtT(M(c.amountM))}</span>;
                        }),
                      ]]
                    : []),
                ]),
                [
                  <span key="tot" className="font-semibold text-accent-300">System total</span>,
                  <span key="tot2" className="text-navy-500">as the book prints it</span>,
                  ...bookYears.map((y) => {
                    const c = totalFor(y);
                    return c?.amountM == null ? '—'
                      : <span key={`tot-${y}`} className="font-semibold text-accent-300">
                          {fmtT(M(c.amountM))}
                          {c.quantity ? <span className="block text-[11px] font-normal text-navy-500">
                            {fmtInt(Number(c.quantity))} units</span> : null}
                        </span>;
                  }),
                ],
              ]} />
            <Caveat>
              The book changes shape between eras — PB2020 and PB2021 split the budget year into base
              and OCO, PB2026 into discretionary and mandatory — so the figure for a year is the
              right-most column the book labels <em>Total</em>, and where it labels none, the sum of
              that year&rsquo;s components. Which rule produced each figure is recorded on the row.
              A right-most-column rule on its own would publish the PB2026 mandatory add as the whole
              year. Control{' '}
              <Link href="/controls" className="underline">WBC-01</Link> asserts each page foots to
              its own printed total.
            </Caveat>
          </div>
        )}
      </Section>

      {/* ------------------------------------------------- where the rest is */}
      <Section title="Where that money sits in the budget"
        note="The published system total is one number. The exhibits spread the same request across separate budget lines — the airframe on one, its modifications on another, its spares and support equipment on a third, its development in the R-1 entirely — and each of those lines is appropriated separately and executed in a different Treasury account.">
        {lines.length === 0 ? (
          <p className="text-sm text-navy-400">
            No budget line in the P-1 or R-1 exhibits carries a name that ties to this system on a
            shared type designator or shared wording, so none is claimed. That is the crosswalk
            declining to guess, not evidence that this system has no budget line.
          </p>
        ) : (
          <>
            <DataTable
              align={[1, 2, 3, 4, 5]}
              caption="Every line here is tied to this system by the evidence in the last column, and each can be rejected on its own without disturbing the rest. An ambiguous designator produces no row at all — 'PATRIOT P3I' yields P-3, which is the Orion, so it is refused rather than filed under a maritime patrol aircraft."
              head={['Budget line', 'Fund type', 'Appropriation', 'Category · J-book',
                     'Exhibit · line item', 'Newest request', 'Tied to this system by']}
              rows={lines.map((l) => [
                <Link key={l.slug} href={`/program?bli=${encodeURIComponent(`${l.exhibit}:${l.account}:${l.bli}`)}`}
                  className="text-accent-400 hover:underline">{l.programName}</Link>,
                l.fundType ?? '—',
                <span key={`${l.slug}-a`} className="text-[12px]">
                  {l.appropriation ?? l.accountTitle ?? '—'}
                  <span className="block font-mono text-navy-500">{l.treasuryAccount ?? l.account}</span>
                </span>,
                <span key={`${l.slug}-b`} className="text-[12px]">
                  {l.bsaTitle || '—'}
                  {(l.activityCount ?? 1) > 1 && (
                    <span className="block text-[11px] text-navy-500">
                      and {(l.activityCount ?? 1) - 1} more
                    </span>
                  )}
                </span>,
                <span key={`${l.slug}-e`} className="font-mono text-[12px]">
                  {l.exhibit.toUpperCase()} · {l.bli}
                </span>,
                l.latestRequestK ? fmtT(K(l.latestRequestK)) : '—',
                <span key={`${l.slug}-m`} className="text-[12px] text-navy-400">
                  {l.matchMethod === 'designator' ? `type designator ${l.matchEvidence}`
                   : l.matchMethod === 'designator_corroborated'
                     ? `designator ${l.matchEvidence}, corroborated by name`
                     : `shared wording: ${l.matchEvidence.split(';').join(', ').toLowerCase()}`}
                </span>,
              ])} />

            {publishedK != null && (
              <div className="mt-8">
                <h3 className="text-sm font-semibold text-navy-200 mb-4">
                  The two figures, side by side
                </h3>
                <DataTable
                  align={[1]}
                  caption="Both are FY-request figures from the same book, so they are answering the same question. The book’s own blocks are grouped here as RDT&E or procurement — a page that prints a separate “Mods” block is counted on the procurement side, which is where that money is appropriated — while the total row is the book’s own. Control WBC-02 reports both directions of the gap and closes neither."
                  head={['Fund type', 'What the book publishes for the system',
                         'What the tied budget lines total', 'Lines', 'Reached']}
                  rows={[
                    ...rolled.map((r) => {
                      const pub = r.publishedM != null ? Number(r.publishedM) * 1000 : null;
                      return [
                        r.fundType ?? '—',
                        pub != null ? fmtT(K(pub)) : '—',
                        fmtT(K(r.amountK)),
                        String(r.lines),
                        pub ? fmtPct(Number(r.amountK) / pub * 100) : '—',
                      ];
                    }),
                    [
                      <span key="all" className="font-semibold text-navy-200">All appropriations</span>,
                      <span key="all2" className="font-semibold">{fmtT(K(publishedK))}</span>,
                      <span key="all3" className="font-semibold">{fmtT(K(rolledK))}</span>,
                      String(lines.length),
                      <span key="all5" className="font-semibold">
                        {coverage != null ? fmtPct(coverage) : '—'}
                      </span>,
                    ],
                  ]} />
                <Caveat>
                  {coverage != null && coverage > 100.5 ? (
                    <>
                      The tied lines carry <em>more</em> than the book states for this system, and
                      that is not extra money: a budget line can be broader than one programme. A
                      single R-1 program element can fund several systems, and a procurement line can
                      carry an item the weapons-book page leaves out — the Next Generation Squad
                      Weapon ammunition line is the clearest case. The exhibits publish no split
                      inside a line, so nothing here apportions one, and the excess is shown rather
                      than trimmed away. Control{' '}
                      <Link href="/controls" className="underline">WBC-02</Link> names every system
                      where this happens.
                    </>
                  ) : coverage != null && coverage < 99.5 ? (
                    <>
                      The tied lines fall short of the published total, and the shortfall is a
                      statement about the crosswalk rather than about the money. A system&rsquo;s
                      spares, modification, support-equipment and post-production lines are separate
                      budget lines whose titles frequently carry no shared designator — &ldquo;Aircraft
                      Spares and Repair Parts&rdquo; names no aircraft — so they cannot be tied back on
                      evidence and are not counted here. The missing money was appropriated; this
                      site simply cannot prove which line it is on.
                    </>
                  ) : (
                    <>
                      The tied lines account for the published total. That agreement is a property of
                      this system&rsquo;s naming, not a general guarantee: for most systems the
                      crosswalk reaches only part of the programme.
                    </>
                  )}{' '}
                  Neither figure is a life-cycle cost. Both are a single year&rsquo;s request for
                  procurement and development, and neither includes the operation, maintenance or
                  military-personnel money that sustains a fielded system — those sit in
                  appropriations these exhibits do not cover at all.
                </Caveat>
              </div>
            )}
          </>
        )}
      </Section>

      {/* -------------------------------------------------- into execution */}
      {execution.some((e) => e.rows.length > 0) && (
        <Section title="Into execution: the accounts these lines are appropriated to"
          note="File A carries budgetary resources, obligations incurred, unobligated balance and outlays at Treasury account grain — the account-level status of budgetary resources. It is the furthest this system can be followed, and it is followed as accounts, never as a system.">
          {execution.filter((e) => e.rows.length > 0).map((e) => (
            <div key={e.account} className="mb-8">
              <h3 className="text-sm font-semibold text-navy-200 mb-3">
                <span className="font-mono">{e.account}</span> · {e.title}
              </h3>
              <DataTable
                head={['Fiscal year', 'Budgetary resources (D+R)', 'Obligations (D+R)', 'Direct (File B)',
                       'Reimbursable (File B)', 'Direct rate', 'Unobligated', 'Gross outlays']}
                rows={e.rows.map((r) => {
                  const den = Number(r.totalBudgetaryResources) - Math.max(0, Number(r.offsettingCollections ?? 0));
                  return [
                    `FY${r.fiscalYear}${r.isPartialYear ? ' *' : ''}`,
                    fmtT(Number(r.totalBudgetaryResources)),
                    fmtT(Number(r.obligationsIncurred)),
                    r.directObligations != null ? fmtT(Number(r.directObligations)) : '—',
                    r.reimbursableObligations != null ? fmtT(Number(r.reimbursableObligations)) : '—',
                    r.directObligations != null && den >= 1e6 ? fmtPct(Number(r.directObligations) / den * 100) : '—',
                    fmtT(Number(r.unobligatedBalance)),
                    fmtT(Number(r.grossOutlays)),
                  ];
                })} />
            </div>
          ))}
          <Caveat>
            This is where the chain stops being about this system. These are whole-account figures:
            every budget line in the account is inside them, and File A carries no budget line at
            all, so no part of an account obligation can be attributed to this system. Obligations
            are also not outlays, and the outlays include payment against prior-year obligations.
            A year marked <span className="font-mono">*</span> is period-to-date rather than a closed
            year. <Link href="/traceability" className="underline">Where the chain breaks</Link> is
            the page about this.
          </Caveat>
        </Section>
      )}

      {aliases.length > 0 && (
        <Section title="Why searching for an abbreviation finds this system"
          note="Every abbreviation carried here is one the weapons book itself expands into this system's own name, and the sentence it was read from is printed beside it.">
          <DataTable
            align={[1, 2]}
            head={['Abbreviation', 'How it was read', 'The book’s own words', 'Book']}
            rows={aliases.map((a) => [
              <span key={a.alias} className="font-mono text-accent-300">{a.alias}</span>,
              a.matchMethod === 'name_parenthetical'
                ? 'printed inside the system’s own name'
                : 'expanded in the system’s description, sharing its name',
              <span key={`${a.alias}-e`} className="text-[12px] text-navy-400">
                “{a.matchEvidence}”
              </span>,
              `PB${a.pbYear}`,
            ])} />
          <p className="text-xs text-navy-500 mt-4">
            Control <Link href="/controls" className="text-accent-400 hover:underline">WBC-03</Link>{' '}
            refuses any abbreviation that names no evidence. No synonym is invented on this site, and
            no figure is ever aggregated through this table — it steers a search and nothing else.
          </p>
        </Section>
      )}
    </Shell>
  );
}

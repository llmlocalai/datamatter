import Link from 'next/link';
import Shell, { PageHeader, Section } from '@/components/Shell';
import { ProvenanceBar, Caveat } from '@/components/Provenance';
import { StatTile, DataTable, LineTrend } from '@/components/charts';
import { fmtT, fmtPct, fmtInt } from '@/components/format';
import {
  getProvenance, getExhibitProgram, getExhibitRestatement, getExhibitCostTypes,
  getWeaponLinks, getProgramLinks, getAccountExecution, getAccountContracts,
  getProgramCoverage,
} from '@/lib/analytics';
import { NotLoaded } from '../execution/page';

/** Exhibit amounts are published in thousands. Everything on the site is dollars. */
const K = (n: number | null | undefined) => Number(n ?? 0) * 1000;

const ROLE_LABEL: Record<string, string> = {
  request: 'Requested', enacted: 'Enacted', prior_actual: 'Actual', other: 'Other year',
};
const BASIS_LABEL: Record<string, string> = {
  total_column: 'the exhibit’s own total column for that year',
  sole_column: 'the single amount column the exhibit published for that year',
  sum_of_components: 'the sum of that year’s component columns, because the exhibit published no total',
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
 * One budget line, followed as far as these sources go: what was asked for, what
 * was appropriated, what was reported, then the Treasury account it lives in and
 * the contracts written under the acquisition program it maps to.
 */
export default async function LineView({ searchParams }: {
  searchParams: { bli?: string; fy?: string; pb?: string };
}) {
  const parts = (searchParams.bli ?? '').split(':');
  if (parts.length !== 3) return <Shell><NotLoaded /></Shell>;
  const [exhibit, account, bli] = parts;

  const [prov, program] = await Promise.all([
    getProvenance('budget_exhibits'), getExhibitProgram(exhibit, account, bli),
  ]);
  if (!program) return <Shell><NotLoaded /></Shell>;

  const [matrix, weapons, links] = await Promise.all([
    getExhibitRestatement(exhibit, account, bli, program.isMemo),
    getWeaponLinks(exhibit, account, bli),
    getProgramLinks(exhibit, account, bli),
  ]);
  if (!matrix.length) return <Shell><NotLoaded /></Shell>;

  const years = Array.from(new Set(matrix.map((m) => m.fiscalYear))).sort();
  const books = Array.from(new Set(matrix.map((m) => m.pbYear))).sort();
  const cell = (fy: number, role: string) => matrix.find((m) => m.fiscalYear === fy && m.fyRole === role);

  // The year to open on: the newest one this line was requested for.
  const requested = matrix.filter((m) => m.fyRole === 'request');
  const wanted = Number(searchParams.fy);
  const focus = requested.find((m) => m.fiscalYear === wanted)
    ?? matrix.find((m) => m.fiscalYear === wanted)
    ?? requested[requested.length - 1] ?? matrix[matrix.length - 1];

  const [costTypes, execution] = await Promise.all([
    getExhibitCostTypes(exhibit, account, bli, focus.pbYear, focus.fiscalYear),
    program.treasuryAccount ? getAccountExecution(program.treasuryAccount) : Promise.resolve([]),
  ]);
  // The contract file runs to a different year than the budget books do: a
  // budget year is requested two years before its contracts exist. So the
  // contract section reads the newest contract year at or before the year in
  // focus, and says which year that is rather than showing an empty table for a
  // year the contract file has not reached.
  const coverage = await getProgramCoverage();
  const contractYears = coverage.map((c) => c.fiscalYear).sort((a, b) => a - b);
  const contractFy = contractYears.filter((y) => y <= focus.fiscalYear).pop()
    ?? contractYears[contractYears.length - 1] ?? focus.fiscalYear;
  const contracts = program.treasuryAccount
    ? await getAccountContracts(program.treasuryAccount, contractFy, 8)
    : [];

  // Request → enacted → actual for the years where all three exist.
  const chain = years.map((fy) => ({
    fy,
    request: K(cell(fy, 'request')?.amountK),
    enacted: K(cell(fy, 'enacted')?.amountK),
    actual: K(cell(fy, 'prior_actual')?.amountK),
  }));
  const settled = chain.filter((c) => c.request && c.enacted);
  const base = `/program?bli=${encodeURIComponent(`${exhibit}:${account}:${bli}`)}`;

  return (
    <Shell>
      <PageHeader
        eyebrow={`Budget line · ${exhibit.toUpperCase()} · ${program.accountTitle ?? account}`}
        title={<><span className="text-accent-400">{program.programName}</span></>}
        lede={`Line item ${bli} in account ${account}${program.treasuryAccount ? ` (Treasury account ${program.treasuryAccount})` : ''}. Held in ${books.length} President's Budget book${books.length === 1 ? '' : 's'}, describing fiscal years ${years[0]} through ${years[years.length - 1]}.`}
      />

      <div className="mt-6 space-y-5">
        <ProvenanceBar p={prov}
          extra="Amounts are total obligation authority as published in the exhibit, in thousands of dollars, converted here to dollars." />
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/program" className="text-sm text-accent-400 hover:underline">← the roster</Link>
          {program.inWeaponsBook && <Badge>In the weapons book</Badge>}
          {program.isMemo && <Badge tone="muted">Memo line — restates money counted elsewhere</Badge>}
          {links.map((l) => (
            <Link key={l.programCode} href={`/program?code=${l.programCode}`}>
              <Badge>Contracts: {l.programName} ({l.programCode}) →</Badge>
            </Link>
          ))}
        </div>
      </div>

      {program.isMemo && (
        <div className="mt-6 alert-warning rounded-lg px-4 py-3">
          <p className="text-sm leading-relaxed">
            <strong>This is a memo line.</strong> It restates money that is already counted on another
            line in the same book — reserve or National Guard equipment, a cost-type breakout, or an
            item outside total obligation authority. It is shown because dropping it would make its
            absence from the totals unexplainable, and it is excluded from every total on this site
            (control <Link href="/controls" className="underline">EXH-03</Link>).
          </p>
        </div>
      )}

      {/* ------------------------------------------------ the three-year view */}
      <Section title="What was asked for, what was appropriated, what was reported"
        note="Each President's Budget book restates three fiscal years: the prior year as actuals, the current year as enacted, and the budget year as requested. So this line appears in three successive books for the same fiscal year, and the three numbers differ. That difference is the restatement history, and it exists nowhere else in these sources.">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatTile label={`FY${focus.fiscalYear} ${ROLE_LABEL[focus.fyRole].toLowerCase()}`}
            value={fmtT(K(focus.amountK))} tone="accent"
            sub={`from the PB${focus.pbYear} book${focus.quantity ? ` · ${fmtInt(focus.quantity)} units` : ''}`} />
          <StatTile label="Enacted for that year"
            value={cell(focus.fiscalYear, 'enacted') ? fmtT(K(cell(focus.fiscalYear, 'enacted')!.amountK)) : '—'}
            sub={cell(focus.fiscalYear, 'enacted')
              ? `as stated in the PB${cell(focus.fiscalYear, 'enacted')!.pbYear} book`
              : `no book we hold states FY${focus.fiscalYear} as enacted yet`} />
          <StatTile label="Reported as actual"
            value={cell(focus.fiscalYear, 'prior_actual') ? fmtT(K(cell(focus.fiscalYear, 'prior_actual')!.amountK)) : '—'}
            sub={cell(focus.fiscalYear, 'prior_actual')
              ? `as stated in the PB${cell(focus.fiscalYear, 'prior_actual')!.pbYear} book`
              : `no book we hold states FY${focus.fiscalYear} as an actual yet`} />
          <StatTile label="Request to enactment"
            value={(() => {
              const r = K(cell(focus.fiscalYear, 'request')?.amountK);
              const e = K(cell(focus.fiscalYear, 'enacted')?.amountK);
              if (!r || !e) return '—';
              return `${e >= r ? '+' : '−'}${fmtPct(Math.abs(e - r) / r * 100)}`;
            })()}
            tone={(() => {
              const r = K(cell(focus.fiscalYear, 'request')?.amountK);
              const e = K(cell(focus.fiscalYear, 'enacted')?.amountK);
              if (!r || !e) return 'default';
              const d = Math.abs(e - r) / r * 100;
              return d > 25 ? 'warning' : 'default';
            })()}
            sub={`Congress against the FY${focus.fiscalYear} request`} />
        </div>

        <div className="mt-8">
          <DataTable
            caption={`Read across, not down: one fiscal year as up to three books described it. The book year is shown beside each figure because the same number means different things depending on which book it came from. ${books.length < 3 ? 'Fewer than three books cover some years, which is why some cells are blank.' : ''}`}
            head={['Fiscal year', 'Requested', 'Enacted', 'Actual', 'Request → enacted', 'Enacted → actual', 'Quantity']}
            rows={years.map((fy) => {
              const r = cell(fy, 'request'), e = cell(fy, 'enacted'), a = cell(fy, 'prior_actual');
              const money = (c?: typeof r) => c
                ? `${fmtT(K(c.amountK))}  ·  PB${c.pbYear}` : '—';
              const delta = (from?: typeof r, to?: typeof r) => (from && to && Number(from.amountK))
                ? `${Number(to.amountK) >= Number(from.amountK) ? '+' : '−'}${fmtPct(
                    Math.abs(Number(to.amountK) - Number(from.amountK)) / Math.abs(Number(from.amountK)) * 100)}`
                : '—';
              const qty = [r, e, a].map((c) => c?.quantity).find((q) => q);
              return [
                <Link key={fy} href={`${base}&fy=${fy}`} scroll={false}
                  className={fy === focus.fiscalYear ? 'text-accent-400 font-semibold' : 'text-accent-400 hover:underline'}>
                  FY{fy}
                </Link>,
                money(r), money(e), money(a), delta(r, e), delta(e, a),
                qty ? fmtInt(Number(qty)) : '—',
              ];
            })} />
        </div>

        {settled.length >= 3 && (
          <div className="mt-10 grid grid-cols-1 lg:grid-cols-2 gap-10">
            <div>
              <h3 className="text-sm font-semibold text-navy-200 mb-4">
                Enacted as a share of what was requested
              </h3>
              <LineTrend label="Enacted ÷ requested" format="pct0"
                reference={{ y: 100, label: 'Appropriated as requested' }}
                points={settled.map((c) => ({
                  x: c.fy, y: c.enacted / c.request * 100,
                }))} />
              <p className="text-xs text-navy-500 mt-3">
                The reference line is the request. Above it, Congress appropriated more than was
                asked for; below it, less. Neither is a finding on its own — a multiyear procurement,
                a rescission and a programme restructure all look like this from here.
              </p>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-navy-200 mb-4">Requested, by fiscal year</h3>
              <LineTrend label="Requested" format="money"
                points={chain.filter((c) => c.request).map((c) => ({ x: c.fy, y: c.request }))} />
              <p className="text-xs text-navy-500 mt-3">
                Each point is the request in the book that made it, not a restated figure. A line that
                disappears was not requested in a later book we hold.
              </p>
            </div>
          </div>
        )}
      </Section>

      {/* -------------------------------------------------- the cost types */}
      <Section title={`What makes up the FY${focus.fiscalYear} figure`}
        note={`The exhibit rows behind the number above, as published in the PB${focus.pbYear} book. Procurement lines are split by cost type — weapon system cost, advance procurement, subsequent full funding — and those parts are what the line's total is made of.`}>
        <DataTable
          caption={`The fiscal-year figure was taken from ${BASIS_LABEL[focus.totalBasis] ?? focus.totalBasis}. Which rule applied is recorded per row and asserted by control EXH-05, because the exhibits change shape between eras and the broadest figure for a year is not always in the same column.`}
          head={['Cost type', 'Amount', 'Quantity', 'Column read', 'Counted']}
          rows={costTypes.map((c, i) => [
            c.costTypeTitle || c.costType || '—',
            fmtT(K(c.amountK)),
            c.quantity ? fmtInt(Number(c.quantity)) : '—',
            <span key={i} className="font-mono text-[12px] text-navy-400">{c.totalColumn ?? '—'}</span>,
            c.isMemo ? 'memo — held out' : 'yes',
          ])} />
        {costTypes.some((c) => c.isMemo) && (
          <Caveat>
            The rows marked <em>memo — held out</em> restate money already counted on the rows above
            them. The P-1 publishes an <span className="font-mono text-[12px]">Advance Procurement
            (CY)</span> subtotal and then the same money again as{' '}
            <span className="font-mono text-[12px]">C (FY x for FY y) (M)</span> detail; counting both
            double-counts the line. Control{' '}
            <Link href="/controls" className="text-accent-400 hover:underline">EXH-08</Link> catches
            exactly this by tying the department-wide total to the figure the Department publishes.
          </Caveat>
        )}
      </Section>

      {/* ------------------------------------------------- the weapons book */}
      {weapons.length > 0 && (
        <Section title="What the Department calls this program"
          note="Program Acquisition Cost by Weapon System is the Department's own roster of major programs. Neither it nor the -1 exhibits carry the other's key, so this link is derived — and every row states the evidence it rests on so it can be rejected individually.">
          <DataTable
            head={['Book', 'Weapon system', 'Category', 'Page', 'Linked on']}
            rows={weapons.map((w) => [
              `PB${w.pbYear}`, w.weaponProgram, w.weaponCategory ?? '—', w.weaponPage ?? '—',
              w.matchMethod === 'designator' ? `type designator ${w.matchEvidence}`
              : w.matchMethod === 'designator_corroborated'
                ? `designator ${w.matchEvidence}, corroborated by name`
                : `shared wording: ${w.matchEvidence.split(';').join(', ').toLowerCase()}`,
            ])} />
        </Section>
      )}

      {/* --------------------------------------------------- into execution */}
      <Section title="Into execution: the Treasury account this line is appropriated to"
        note="The exhibit account symbol and the Treasury account symbol differ only by the organisation letter, and that crosswalk is the whole bridge from a budget line into the execution files. What it reaches is an ACCOUNT, not a line item.">
        {!program.treasuryAccount ? (
          <p className="text-sm text-navy-400">
            The account symbol <span className="font-mono">{account}</span> on this line is not four
            digits plus an organisation letter, so it does not resolve to a Treasury account in this
            extract.
          </p>
        ) : execution.length === 0 ? (
          <p className="text-sm text-navy-400">
            Treasury account <span className="font-mono">{program.treasuryAccount}</span> has no row
            in the File A cut of the vintage named above. That is a statement about this extract, not
            evidence that the account was not reported.
          </p>
        ) : (
          <>
            <DataTable
              caption={`File A, ${execution[0].label}. These are the whole account's figures — several budget lines share this account and File A states no split between them, so this is the ceiling this line was funded within, not this line's own execution.`}
              head={['Fiscal year', 'Budgetary resources', 'Obligations incurred', 'Unobligated', 'Gross outlays', 'Obligated share']}
              rows={execution.map((e) => [
                `FY${e.fiscalYear}${e.isPartialYear ? ' *' : ''}`,
                fmtT(Number(e.totalBudgetaryResources)),
                fmtT(Number(e.obligationsIncurred)),
                fmtT(Number(e.unobligatedBalance)),
                fmtT(Number(e.grossOutlays)),
                Number(e.totalBudgetaryResources)
                  ? fmtPct(Number(e.obligationsIncurred) / Number(e.totalBudgetaryResources) * 100)
                  : '—',
              ])} />
            <Caveat>
              This is the step where line-item precision is lost, and it is lost in the sources rather
              than here: File A is keyed to accounts and carries no budget line at all. An account
              obligation cannot be attributed to one of the budget lines inside it, and nothing on
              this page attempts to. A year marked <span className="font-mono">*</span> is
              period-to-date.
            </Caveat>
          </>
        )}
      </Section>

      {/* --------------------------------------------------- into contracts */}
      <Section title="Into contracts"
        note="Two routes reach the contract file from here, and they answer different questions. The acquisition program code follows this system; the account set follows the appropriation.">
        {links.length > 0 && (
          <div className="mb-8">
            <h3 className="text-sm font-semibold text-navy-200 mb-3">By acquisition program</h3>
            <DataTable
              caption="FPDS is the only place in the contract file keyed to a budget line rather than to an account. A link means the two names refer to the same system — it does not assert that this line's appropriation funded those contracts. Control EXH-09 accepts nothing weaker than a shared type designator."
              head={['Program code', 'Program name', 'Linked on', 'Contract detail']}
              rows={links.map((l) => [
                <span key={l.programCode} className="font-mono text-[12px]">{l.programCode}</span>,
                l.programName,
                l.matchMethod === 'exact_name' ? 'identical names'
                  : `type designator ${l.matchEvidence}`,
                <Link key={`${l.programCode}-x`} href={`/program?code=${l.programCode}`}
                  className="text-accent-400 hover:underline">open execution view →</Link>,
              ])} />
          </div>
        )}
        <h3 className="text-sm font-semibold text-navy-200 mb-3">
          By account named on the contract action, FY{contractFy}
          {contractFy !== focus.fiscalYear && (
            <span className="font-normal text-navy-400">
              {' '}— the newest year the contract file reaches, against a FY{focus.fiscalYear} budget year
            </span>
          )}
        </h3>
        {contracts.length === 0 ? (
          <p className="text-sm text-navy-400">
            No contract action in the FY{contractFy} cut of the acquisition programs this site
            carries named{' '}
            <span className="font-mono">{program.treasuryAccount ?? account}</span> among its funding
            accounts. The contract file is cut by acquisition program here, and roughly three quarters
            of DoD contract dollars carry no program code at all — so this is a narrow window, not a
            complete answer.
          </p>
        ) : (
          <DataTable
            caption="Read a row as: this much was obligated on actions that named this combination of accounts. The obligation is not split across the accounts in a set and is never summed by account — control PROG-02 asserts that."
            head={['Program', 'Accounts named on the action', 'Obligated', 'Actions']}
            rows={contracts.map((c, i) => [
              <Link key={i} href={`/program?code=${c.programCode}`} className="text-accent-400 hover:underline">
                {c.programName ?? c.programCode}
              </Link>,
              <span key={`${i}-a`} className="font-mono text-[12px]">
                {c.accountSet.split(';').join(' + ')}
              </span>,
              fmtT(Number(c.obligation)), fmtInt(Number(c.actionCount)),
            ])} />
        )}
      </Section>

      <Section title="How to read a figure on this page">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-10 gap-y-4 text-sm text-navy-300 leading-relaxed">
          <p>
            <strong className="text-navy-100">Three numbers, one year.</strong> A fiscal year&rsquo;s
            request, enactment and actual come from three different books and are three different
            claims. They are never averaged, reconciled away or shown as one figure here.
          </p>
          <p>
            <strong className="text-navy-100">The chain narrows, then breaks.</strong> Budget line →
            Treasury account is exact. Account → execution is exact but no longer line-specific.
            Account → contract is a window onto the quarter of the contract file that carries a
            program code. The{' '}
            <Link href="/traceability" className="text-accent-400 hover:underline">traceability</Link>{' '}
            page is about that break.
          </p>
          <p>
            <strong className="text-navy-100">Quantity is what was bought, not what was funded.</strong>{' '}
            Advance procurement and subsequent full funding move money between years without moving
            units, which is why a quantity can stay flat while an amount moves by multiples.
          </p>
          <p>
            <strong className="text-navy-100">Absence is absence in this cut.</strong> A blank cell
            means no book or file we hold covers that combination in the vintage named above — never
            that the Department did not report it.
          </p>
        </div>
        <p className="text-xs text-navy-500 mt-8">
          Method and controls:{' '}
          <Link href="/controls" className="text-accent-400 hover:underline">EXH-01 through EXH-09</Link>{' '}
          · <Link href="/sources" className="text-accent-400 hover:underline">sources</Link>
          {' '}· <Link href="/program" className="text-accent-400 hover:underline">back to the roster</Link>
        </p>
      </Section>
    </Shell>
  );
}

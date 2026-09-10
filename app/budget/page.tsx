import type { Metadata } from 'next';
import Shell, { PageHeader, Section } from '@/components/Shell';
import { ProvenanceBar, Caveat } from '@/components/Provenance';
import { StatTile, DataTable, Empty } from '@/components/charts';
import { fmtT, fmtPct, fmtInt } from '@/components/format';
import PbExplorer from '@/components/budget/PbExplorer';
import DocumentPanel from '@/components/budget/DocumentPanel';
import { getProvenance } from '@/lib/analytics';
import {
  getPbBooks, getPbExhibits, getPbTieouts, getPbMemoBreakdown, getPbDocuments,
} from '@/lib/pb';

export const metadata: Metadata = {
  title: 'FY2027 request · datamatter',
  description:
    'The FY2027 President\'s Budget request as the Department displays it: seven "-1" tables, '
    + 'drilled from appropriation to budget activity, sub-activity and budget line item, with every '
    + 'memo restatement excluded and stated.',
};
export const revalidate = 900;

export default async function BudgetPage() {
  const books = await getPbBooks();
  if (!books.length) return <Shell><NotLoaded /></Shell>;
  const pbYear = books[0].pbYear;
  const [prov, exhibits, tieouts, memo, docs] = await Promise.all([
    getProvenance('pb_display'),
    getPbExhibits(pbYear),
    getPbTieouts(pbYear),
    getPbMemoBreakdown(pbYear, pbYear),
    getPbDocuments(pbYear),
  ]);

  const counted = exhibits.filter((e) => !e.isMemoExhibit);
  const total = (k: 'fy2025' | 'fy2026' | 'fy2027') => counted.reduce((s, e) => s + e[k], 0);
  const fy27 = total('fy2027'), fy26 = total('fy2026'), fy25 = total('fy2025');
  const disc = counted.reduce((s, e) => s + e.discretionary, 0);
  const mand = counted.reduce((s, e) => s + e.mandatory, 0);
  const memoTotal = memo.filter((m) => m.reason !== 'less_reimbursables_offset')
                        .reduce((s, m) => s + m.amount, 0);
  const lines = exhibits.reduce((s, e) => s + e.lineCount, 0);
  const yoy = fy26 ? (fy27 - fy26) / fy26 * 100 : 0;

  const withPublished = tieouts.filter((t) => t.publishedK !== null);
  const off = withPublished.filter((t) => Math.abs(Number(t.differenceK ?? 0)) >= 1);

  return (
    <Shell>
      <PageHeader
        eyebrow={`Formulation · President's Budget FY${pbYear} · seven display tables`}
        title={<>What the Department is asking for, down to the budget line</>}
        lede={`The "-1" exhibits are the request as it is displayed: one table per appropriation `
          + `title, each carrying three fiscal years — FY${pbYear - 2} actual, FY${pbYear - 1} enacted `
          + `and the FY${pbYear} request — in the hierarchy the money is structured by. Every figure `
          + `here excludes the rows that restate money counted elsewhere in the same book, and what `
          + `was excluded is set out below rather than left implied.`}
      />

      <div className="mt-6"><ProvenanceBar p={prov} /></div>

      <Section title={`The FY${pbYear} request`}
        note={`Total obligation authority across the six exhibits that carry money. The P-1R is `
          + `excluded from every total on this page because it restates Guard and Reserve equipment `
          + `already inside the P-1 lines.`}>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatTile label={`FY${pbYear} total obligation authority`} value={fmtT(fy27)}
            sub={`${fmtInt(lines)} line-years across ${exhibits.length} exhibits`} tone="accent" />
          <StatTile label="Discretionary" value={fmtT(disc)}
            sub={`${fmtPct(fy27 ? disc / fy27 * 100 : 0)} of the request`} />
          <StatTile label="Mandatory and reconciliation" value={fmtT(mand)}
            sub={`${fmtPct(fy27 ? mand / fy27 * 100 : 0)} of the request`} />
          <StatTile label={`Change on FY${pbYear - 1} enacted`} value={`${yoy >= 0 ? '+' : '−'}${Math.abs(yoy).toFixed(1)}%`}
            sub={`${fmtT(fy26)} enacted → ${fmtT(fy27)} requested`}
            tone={yoy >= 0 ? 'good' : 'warning'} />
        </div>
        <Caveat>
          These six tables do not add to a Departmental topline and are not presented as one. They are
          the appropriation titles the Department displays; revolving funds sit beside the titles
          rather than inside them, and a topline additionally reflects transfers, receipts and
          financing that no display table carries.
        </Caveat>
      </Section>

      <Section title="Exhibit by exhibit"
        note={`Each row is one display table. "Published" is the total the workbook prints on its own `
          + `"Total of Displayed Rows" line; "counted" is what enters a total here; the difference is `
          + `the memo restatement, and control PB-01 asserts the three agree to the dollar.`}>
        <DataTable
          head={['Exhibit', `FY${pbYear - 2} actual`, `FY${pbYear - 1} enacted`, `FY${pbYear} counted`,
                 'Discretionary', 'Mandatory', 'Memo, not counted', 'Published total']}
          rows={exhibits.map((e) => [
            `${e.name} · ${e.long}`,
            // A memo exhibit contributes nothing to any counted column. Printing
            // $0 there says it was counted and came to nothing, which is the
            // opposite of what happened.
            e.isMemoExhibit ? 'memo' : fmtT(e.fy2025),
            e.isMemoExhibit ? 'memo' : fmtT(e.fy2026),
            e.isMemoExhibit ? 'memo exhibit' : fmtT(e.fy2027),
            e.discretionary ? fmtT(e.discretionary) : '—',
            e.mandatory ? fmtT(e.mandatory) : '—',
            e.memo ? fmtT(e.memo) : '—',
            e.publishedTotal === null ? '—' : fmtT(e.publishedTotal),
          ])}
          caption={off.length
            ? `${off.length} of ${withPublished.length} sheet-years do not tie to the workbook's own footer.`
            : `All ${withPublished.length} sheet-years across this book tie exactly to the totals the `
              + `workbooks print on themselves.`}
        />
      </Section>

      <Section title="The request, drilled into" id="explorer"
        note={`Expand a row to open the level beneath it: exhibit, component, appropriation, budget `
          + `activity, sub-activity or activity group, and budget line item. A level the exhibit does `
          + `not use — the R-1 has no sub-activity, the C-1 no activity group — is skipped rather than `
          + `drawn empty. Opening a budget line shows the rows behind it, cost type by cost type, `
          + `with memo rows visible and struck through rather than hidden.`}>
        <PbExplorer pbYear={pbYear} requestYear={pbYear} />
      </Section>

      <Section title="What is not counted, and why"
        note={`Four kinds of row restate money already counted elsewhere in the same book. They are `
          + `kept and flagged rather than dropped, because a total that silently omits a whole exhibit `
          + `cannot be explained. One kind that looks identical is counted: the M-1's "Less `
          + `Reimbursables" rows are negative offsets the published total includes.`}>
        {memo.length ? (
          <DataTable
            head={['Rule', 'What it is', 'Line-years', `FY${pbYear} amount`]}
            align={[1]}
            rows={memo.map((m) => [
              m.reason.replace(/_/g, ' '),
              m.explanation,
              fmtInt(m.lines),
              fmtT(m.amount),
            ])}
            caption={`${fmtT(memoTotal)} set aside in FY${pbYear}. Counting the display tables as `
              + `published — which is what a naive sum of the seven sheets does — would put the `
              + `request that much above what the exhibits themselves foot to.`}
          />
        ) : <Empty />}
        <Caveat>
          The rules are not one rule. <strong className="text-navy-200">Include in TOA = N</strong>{' '}
          means outside total obligation authority on the R-1 and identifies the Indefinite Accounts
          block on the O-1 — where the workbook settles the question itself by publishing
          &ldquo;OM Title&rdquo; and &ldquo;OM Title plus Indefinite&rdquo; as two sheets whose
          difference is exactly those rows. The same flag on the M-1 marks five negative
          &ldquo;Less Reimbursables&rdquo; offsets that the published M-1 total includes. Applying one
          rule across the seven exhibits is wrong in two directions at once, and nothing in the column
          itself says so.
        </Caveat>
      </Section>

      <Section title="Source documents"
        note={`${docs.length} cataloged FY${pbYear} files. Items held in the database are streamed `
          + `from it; the rest link to the Comptroller's published copy.`}>
        {docs.length ? <DocumentPanel documents={docs} /> : <Empty />}
      </Section>
    </Shell>
  );
}

function NotLoaded() {
  return (
    <div className="py-24 max-w-xl">
      <h1 className="text-2xl font-bold text-navy-50">No current load</h1>
      <p className="text-navy-300 mt-3 leading-relaxed">
        The display-table extract has not been loaded yet. Run{' '}
        <code className="font-mono text-accent-400 text-sm">npm run refresh</code> on a machine with
        access to the budget archive. Figures are withheld rather than shown without provenance.
      </p>
    </div>
  );
}

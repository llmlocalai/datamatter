/**
 * The FY2027 President's Budget request, read from the seven "-1" display
 * tables.
 *
 * Everything here reads `dm_pb_line`, which carries the hierarchy the exhibit is
 * printed in and a per-row memo flag whose rule differs by exhibit. Two things
 * follow and neither is optional:
 *
 *   1. Every total filters `is_memo = false`. The P-1R exhibit restates
 *      equipment already inside the P-1 lines, the P-1 advance-procurement
 *      subtotal restates its own detail rows, and the C-1 reconciliation sheets
 *      restate projects already in the year sheet. Summing the display tables as
 *      published puts the FY2027 request $30.1B above what the exhibits
 *      themselves foot to.
 *   2. Nothing collapses `pb_year`. A fiscal year appears in successive books
 *      with different figures because a request becomes an enactment becomes an
 *      actual; that is the restatement history, not drift.
 *
 * The drill-down is server-side by design. The FY2027 book is about 2,700
 * counted line-years and shipping all of them to the browser to group there
 * would work; doing it in SQL means the aggregation rule -- which rows are memo,
 * which column is the year's figure -- lives in one place instead of two.
 */
import { query } from './db';

export const PB_EXHIBIT: Record<string, { name: string; long: string }> = {
  c1:  { name: 'C-1',  long: 'Military Construction and Family Housing' },
  m1:  { name: 'M-1',  long: 'Military Personnel' },
  o1:  { name: 'O-1',  long: 'Operation and Maintenance' },
  p1:  { name: 'P-1',  long: 'Procurement' },
  p1r: { name: 'P-1R', long: 'Procurement, Guard and Reserve equipment' },
  r1:  { name: 'R-1',  long: 'Research, Development, Test and Evaluation' },
  rf1: { name: 'RF-1', long: 'Revolving and Management Funds' },
};

/** Why a row was set aside, in the words the ETL recorded, for the page. */
export const MEMO_REASON: Record<string, string> = {
  p1r_exhibit: 'The whole P-1R exhibit — Guard and Reserve equipment already inside the P-1 lines',
  advance_procurement_subtotal: 'The Advance Procurement (CY) subtotal of a line’s own by-year detail rows',
  memo_cost_type: 'A cost type marked (MEMO NON ADD) inside a line otherwise flagged Add',
  include_in_toa_n: 'Marked Include in TOA = N — outside total obligation authority',
  outside_toa_indefinite: 'The O-1 Indefinite Accounts block, which the workbook itself publishes as a separate sheet',
  c1_reconciliation_breakout: 'A C-1 Mandatory Reconciliation breakout of a project already in that year’s sheet',
  less_reimbursables_offset: 'A negative “Less Reimbursables” offset — counted, not set aside',
};

/** The levels the explorer can group by, and the columns each one is. */
export const PB_DIMS = {
  exhibit:   { col: 'exhibit',         label: 'exhibit',               title: 'Exhibit' },
  component: { col: 'component',       label: 'component',             title: 'Component' },
  account:   { col: 'account',         label: 'account_title',         title: 'Appropriation' },
  ba:        { col: 'budget_activity', label: 'budget_activity_title', title: 'Budget activity' },
  bsa:       { col: 'bsa',             label: 'bsa_title',             title: 'Sub-activity / activity group' },
  bli:       { col: 'bli',             label: 'bli_title',             title: 'Budget line item' },
} as const;
export type PbDim = keyof typeof PB_DIMS;
export const PB_DIM_ORDER: PbDim[] = ['exhibit', 'component', 'account', 'ba', 'bsa', 'bli'];

export interface PbBook { pbYear: number; vintage: string; lineCount: number }

export async function getPbBooks(): Promise<PbBook[]> {
  return query<PbBook>(
    `SELECT p.pb_year AS "pbYear", to_char(l.vintage,'YYYY-MM-DD') AS vintage,
            count(*)::int AS "lineCount"
       FROM dm_pb_line p JOIN dm_load l ON l.id = p.load_id AND l.is_current
      GROUP BY 1, 2 ORDER BY 1 DESC`);
}

export interface PbExhibitSummary {
  exhibit: string; name: string; long: string;
  fy2025: number; fy2026: number; fy2027: number;
  discretionary: number; mandatory: number;
  memo: number; publishedTotal: number | null; lineCount: number; isMemoExhibit: boolean;
}

/**
 * One row per exhibit for the focus book. Amounts are returned in DOLLARS; the
 * table stores thousands, and the multiplication happens once, here, rather than
 * in every caller that has ever got it wrong.
 */
export async function getPbExhibits(pbYear: number, request = pbYear): Promise<PbExhibitSummary[]> {
  const rows = await query<any>(
    `WITH t AS (
       SELECT exhibit,
              sum(amount_k) FILTER (WHERE fiscal_year = $2 AND NOT is_memo) AS a3,
              sum(amount_k) FILTER (WHERE fiscal_year = $2 - 1 AND NOT is_memo) AS a2,
              sum(amount_k) FILTER (WHERE fiscal_year = $2 - 2 AND NOT is_memo) AS a1,
              sum(discretionary_k) FILTER (WHERE fiscal_year = $2 AND NOT is_memo) AS disc,
              sum(mandatory_k) FILTER (WHERE fiscal_year = $2 AND NOT is_memo) AS mand,
              sum(amount_k) FILTER (WHERE fiscal_year = $2 AND is_memo) AS memo,
              count(*) FILTER (WHERE fiscal_year = $2)::int AS n
         FROM dm_pb_line p JOIN dm_load l ON l.id = p.load_id AND l.is_current
        WHERE pb_year = $1 GROUP BY exhibit),
     pub AS (
       SELECT exhibit, sum(published_k) AS published
         FROM dm_pb_tieout o JOIN dm_load l ON l.id = o.load_id AND l.is_current
        WHERE pb_year = $1 AND fiscal_year = $2 AND published_k IS NOT NULL
        GROUP BY exhibit)
     SELECT t.exhibit, coalesce(t.a1,0) a1, coalesce(t.a2,0) a2, coalesce(t.a3,0) a3,
            coalesce(t.disc,0) disc, coalesce(t.mand,0) mand, coalesce(t.memo,0) memo,
            t.n, pub.published
       FROM t LEFT JOIN pub USING (exhibit)`, [pbYear, request]);
  const K = 1000;
  return rows
    .map((r) => ({
      exhibit: r.exhibit,
      name: PB_EXHIBIT[r.exhibit]?.name ?? r.exhibit.toUpperCase(),
      long: PB_EXHIBIT[r.exhibit]?.long ?? '',
      fy2025: Number(r.a1) * K, fy2026: Number(r.a2) * K, fy2027: Number(r.a3) * K,
      discretionary: Number(r.disc) * K, mandatory: Number(r.mand) * K,
      memo: Number(r.memo) * K,
      publishedTotal: r.published === null ? null : Number(r.published) * K,
      lineCount: r.n,
      isMemoExhibit: Number(r.a3) === 0 && Number(r.memo) !== 0,
    }))
    .sort((a, b) => b.fy2027 - a.fy2027);
}

export interface PbTieout {
  pbYear: number; exhibit: string; sheetName: string; fiscalYear: number;
  publishedK: number | null; countedK: number; memoK: number; differenceK: number | null;
  rowCount: number;
}
export async function getPbTieouts(pbYear: number): Promise<PbTieout[]> {
  // Every column is qualified. dm_load carries its own row_count, so the
  // unqualified name is ambiguous the moment this table is joined to it -- and
  // an ambiguous column passes tsc and next build and throws at request time.
  return query<PbTieout>(
    `SELECT t.pb_year AS "pbYear", t.exhibit, t.sheet_name AS "sheetName",
            t.fiscal_year AS "fiscalYear", t.published_k AS "publishedK",
            t.counted_k AS "countedK", t.memo_k AS "memoK", t.difference_k AS "differenceK",
            t.row_count AS "rowCount"
       FROM dm_pb_tieout t JOIN dm_load l ON l.id = t.load_id AND l.is_current
      WHERE t.pb_year = $1 ORDER BY t.exhibit, t.fiscal_year, t.sheet_name`, [pbYear]);
}

export async function getPbMemoBreakdown(pbYear: number, fy: number) {
  const rows = await query<any>(
    `SELECT memo_reason AS reason, count(*)::int AS lines, sum(amount_k) AS amount_k
       FROM dm_pb_line p JOIN dm_load l ON l.id = p.load_id AND l.is_current
      WHERE pb_year = $1 AND fiscal_year = $2 AND is_memo
      GROUP BY 1 ORDER BY 3 DESC`, [pbYear, fy]);
  return rows.map((r) => ({
    reason: r.reason as string,
    explanation: MEMO_REASON[r.reason] ?? r.reason,
    lines: r.lines as number,
    amount: Number(r.amount_k) * 1000,
  }));
}

export interface PbNode {
  key: string; label: string; level: number; dim: PbDim; path: string[];
  fy2025: number; fy2026: number; fy2027: number;
  discretionary: number; mandatory: number;
  lines: number; hasChildren: boolean; nextDim: PbDim | null;
}

export interface PbTreeArgs {
  pbYear: number; request: number; path?: string[]; dims?: PbDim[];
  search?: string; exhibit?: string; component?: string;
}

/**
 * The children of one node.
 *
 * Levels are skipped when they are empty rather than drawn as a blank rung:
 * the R-1 has no sub-activity between the budget activity and the program
 * element, and the C-1 has no sub-activity at all, so a fixed six-level tree
 * would show those exhibits an empty row to click through. If every child at
 * the next level has no key, the next level down is used instead, and the
 * caller is told which dimension it actually got.
 */
export async function getPbTree(a: PbTreeArgs): Promise<{ nodes: PbNode[]; dim: PbDim | null; parentDims: PbDim[] }> {
  const dims = (a.dims?.length ? a.dims : PB_DIM_ORDER).filter((d) => d in PB_DIMS);
  const path = a.path ?? [];
  const params: any[] = [a.pbYear, a.request];
  const where = ['p.pb_year = $1', 'NOT p.is_memo'];
  for (let i = 0; i < path.length && i < dims.length; i++) {
    params.push(path[i]);
    where.push(`p.${PB_DIMS[dims[i]].col} = $${params.length}`);
  }
  if (a.exhibit) { params.push(a.exhibit); where.push(`p.exhibit = $${params.length}`); }
  if (a.component) { params.push(a.component); where.push(`p.component = $${params.length}`); }
  if (a.search?.trim()) {
    params.push(`%${a.search.trim()}%`);
    const i = params.length;
    where.push(`(p.bli_title ILIKE $${i} OR p.bsa_title ILIKE $${i} OR p.account_title ILIKE $${i}
                 OR p.bli ILIKE $${i} OR p.account ILIKE $${i}
                 OR p.budget_activity_title ILIKE $${i})`);
  }

  for (let level = path.length; level < dims.length; level++) {
    const d = dims[level];
    const { col, label } = PB_DIMS[d];
    const next = dims[level + 1];
    const rows = await query<any>(
      `SELECT coalesce(nullif(p.${col}, ''), '') AS key,
              max(nullif(p.${label}, '')) AS label,
              coalesce(sum(p.amount_k) FILTER (WHERE p.fiscal_year = $2 - 2), 0) AS a1,
              coalesce(sum(p.amount_k) FILTER (WHERE p.fiscal_year = $2 - 1), 0) AS a2,
              coalesce(sum(p.amount_k) FILTER (WHERE p.fiscal_year = $2), 0) AS a3,
              coalesce(sum(p.discretionary_k) FILTER (WHERE p.fiscal_year = $2), 0) AS disc,
              coalesce(sum(p.mandatory_k) FILTER (WHERE p.fiscal_year = $2), 0) AS mand,
              count(*)::int AS lines,
              ${next ? `count(DISTINCT nullif(p.${PB_DIMS[next].col}, ''))::int` : '0'} AS kids
         FROM dm_pb_line p JOIN dm_load l ON l.id = p.load_id AND l.is_current
        WHERE ${where.join(' AND ')}
        GROUP BY 1 ORDER BY a3 DESC, a2 DESC, 1`, params);
    // A level every child leaves blank is not a level. Fall through to the next.
    if (rows.length === 1 && rows[0].key === '' && level + 1 < dims.length) continue;
    const K = 1000;
    return {
      dim: d,
      parentDims: dims.slice(0, level),
      nodes: rows.map((r) => ({
        key: String(r.key),
        // The exhibit column IS its own label, so max(exhibit) returns "o1"
        // rather than a name. Every other level has a title column beside it.
        label: d === 'exhibit'
          ? `${PB_EXHIBIT[r.key]?.name ?? String(r.key).toUpperCase()} · `
            + `${PB_EXHIBIT[r.key]?.long ?? ''}`.trim().replace(/ · $/, '')
          : (r.label ?? (String(r.key) || 'No line item published')),
        level, dim: d, path: [...path.slice(0, level), String(r.key)],
        fy2025: Number(r.a1) * K, fy2026: Number(r.a2) * K, fy2027: Number(r.a3) * K,
        discretionary: Number(r.disc) * K, mandatory: Number(r.mand) * K,
        lines: r.lines,
        hasChildren: Number(r.kids) > 0,
        nextDim: next ?? null,
      })),
    };
  }
  return { nodes: [], dim: null, parentDims: dims };
}

export interface PbLeaf {
  account: string; accountTitle: string; component: string; exhibit: string;
  budgetActivity: string; budgetActivityTitle: string; bsa: string; bsaTitle: string;
  lineNumber: string; bli: string; bliTitle: string;
  costType: string; costTypeTitle: string; location: string;
  fy2025: number; fy2026: number; fy2027: number;
  discretionary: number; mandatory: number; quantity: number;
  totalColumn: string; totalBasis: string; isMemo: boolean; isOffset: boolean;
  memoReason: string | null; treasuryAccount: string | null;
}

/** The rows behind a node, cost type by cost type, memo rows included and flagged. */
export async function getPbLeaves(pbYear: number, request: number, dims: PbDim[], path: string[],
                                  limit = 400): Promise<PbLeaf[]> {
  const params: any[] = [pbYear, request];
  const where = ['p.pb_year = $1'];
  for (let i = 0; i < path.length && i < dims.length; i++) {
    params.push(path[i]);
    where.push(`p.${PB_DIMS[dims[i]].col} = $${params.length}`);
  }
  params.push(limit);
  return query<PbLeaf>(
    `SELECT p.account, p.account_title AS "accountTitle", p.component, p.exhibit,
            p.budget_activity AS "budgetActivity",
            p.budget_activity_title AS "budgetActivityTitle",
            p.bsa, p.bsa_title AS "bsaTitle", p.line_number AS "lineNumber",
            p.bli, p.bli_title AS "bliTitle", p.cost_type AS "costType",
            p.cost_type_title AS "costTypeTitle", p.location,
            coalesce(sum(p.amount_k) FILTER (WHERE p.fiscal_year = $2 - 2), 0) * 1000 AS "fy2025",
            coalesce(sum(p.amount_k) FILTER (WHERE p.fiscal_year = $2 - 1), 0) * 1000 AS "fy2026",
            coalesce(sum(p.amount_k) FILTER (WHERE p.fiscal_year = $2), 0) * 1000 AS "fy2027",
            coalesce(sum(p.discretionary_k) FILTER (WHERE p.fiscal_year = $2), 0) * 1000 AS discretionary,
            coalesce(sum(p.mandatory_k) FILTER (WHERE p.fiscal_year = $2), 0) * 1000 AS mandatory,
            coalesce(max(p.quantity) FILTER (WHERE p.fiscal_year = $2), 0) AS quantity,
            max(p.total_column) AS "totalColumn", max(p.total_basis) AS "totalBasis",
            bool_or(p.is_memo) AS "isMemo", bool_or(p.is_offset) AS "isOffset",
            max(p.memo_reason) AS "memoReason", max(p.treasury_account) AS "treasuryAccount"
       FROM dm_pb_line p JOIN dm_load l ON l.id = p.load_id AND l.is_current
      WHERE ${where.join(' AND ')}
      GROUP BY 1,2,3,4,5,6,7,8,9,10,11,12,13,14
      ORDER BY "fy2027" DESC, "fy2026" DESC
      LIMIT $${params.length}`, params);
}

/** The cataloged FY2027 source files, for the document panel. */
export async function getPbDocuments(fiscalYear = 2027) {
  const rows = await query<any>(
    `SELECT id, doc_code, title, format, byte_size, has_bytes, source_url
       FROM war_budget_document WHERE fiscal_year = $1
      ORDER BY has_bytes DESC, doc_code, format`, [fiscalYear]).catch((e: any) => {
    if (e?.code === '42P01') return [];
    throw e;
  });
  return rows.map((r: any) => ({
    id: Number(r.id), docCode: r.doc_code,
    name: r.title || (r.source_url ? String(r.source_url).split('/').pop() : 'document'),
    format: r.format, byteSize: Number(r.byte_size) || 0,
    hasBytes: !!r.has_bytes, sourceUrl: r.source_url || '',
  }));
}

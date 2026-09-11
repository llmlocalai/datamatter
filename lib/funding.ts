/**
 * DIRECT OR REIMBURSABLE.
 *
 * File B marks every row with `direct_or_reimbursable_funding_source`. A direct
 * obligation spends the account's own budget authority; a reimbursable one is
 * work the account performs for a customer and is paid back for. When that
 * customer is another Department account the same work is ALSO the customer's
 * direct obligation -- Operation and Maintenance orders parts, the Defense
 * Working Capital Fund buys them -- so a total that adds the two counts it
 * twice. In FY2025 $212.9B of $1,451.1B File B obligations (14.7%) were
 * reimbursable, $152.0B of it in the Defense Working Capital Fund alone.
 *
 * So execution figures default to DIRECT, reimbursable is shown beside them and
 * never added in, and the direct-plus-reimbursable total survives only where it
 * is the thing being reported: the Statement of Budgetary Resources, and the
 * File A / File B reconciliation.
 *
 * File A carries no direct/reimbursable attribute at all. Its obligations and
 * resources include reimbursable work, so:
 *   - direct AMOUNTS always come from File B;
 *   - the direct RATE divides File B direct obligations by File A resources
 *     other than spending authority from offsetting collections, which is the
 *     authority reimbursable work earns. Unobligated balances brought forward
 *     cannot be split in File A, so for prior-year and revolving money the
 *     denominator still carries some reimbursable carry-in, and the page says so.
 */
import { query } from './db';
import { missingColumns } from './schema';

export const SCOPE = 'DOW';
export type Side = 'direct' | 'reimbursable' | 'all';

export function parseSide(v: string | null | undefined): Side {
  return v === 'reimbursable' || v === 'all' ? v : 'direct';
}
/** Column suffix on the rollups for a side. Whitelisted: it is interpolated. */
export function sideSuffix(side: Side): '' | '_direct' | '_reimbursable' {
  return side === 'direct' ? '_direct' : side === 'reimbursable' ? '_reimbursable' : '';
}
/** The funding_source predicate on a detail row. */
export function sideWhere(side: Side, col = 'd.funding_source'): string {
  return side === 'direct' ? `${col} = 'D'` : side === 'reimbursable' ? `${col} = 'R'` : 'TRUE';
}
export const SIDE_LABEL: Record<Side, string> = {
  direct: 'Direct', reimbursable: 'Reimbursable', all: 'Direct + reimbursable',
};

/**
 * Whether this load carries the split. A database migrated but not reloaded has
 * the columns with NULL in them, and NULL read as zero would say the Department
 * obligated nothing directly -- so it is the same answer as a missing column.
 */
export async function splitReady(): Promise<boolean> {
  const missing = await missingColumns('dm_exec_account_fy', ['obligations_direct', 'obligations_reimbursable']);
  if (missing.length) return false;
  const r = await query<{ n: number }>(
    `SELECT count(*)::int AS n FROM dm_exec_account_fy f JOIN dm_load l ON l.id = f.load_id AND l.is_current
      WHERE f.obligations_direct IS NOT NULL`);
  return (r[0]?.n ?? 0) > 0;
}

export interface SplitYear {
  fiscalYear: number; submissionPeriod: string | null; isPartialYear: boolean;
  /** File A, direct and reimbursable together -- the statement as published. */
  resources: number; offsettingCollections: number; obligationsA: number;
  outlaysA: number; unobligatedA: number;
  /** File B, split. */
  obligationsB: number; direct: number; reimbursable: number;
  outlaysDirect: number; outlaysReimbursable: number;
  undeliveredDirect: number; undeliveredReimbursable: number;
  deliveredDirect: number; deliveredReimbursable: number;
}
export async function getSplitByFy(): Promise<SplitYear[]> {
  return query<SplitYear>(
    `SELECT s.fiscal_year AS "fiscalYear", s.submission_period AS "submissionPeriod",
            s.is_partial_year AS "isPartialYear",
            s.total_budgetary_resources AS resources, s.spending_auth_offsetting AS "offsettingCollections",
            s.obligations_incurred AS "obligationsA", s.gross_outlays AS "outlaysA",
            s.unobligated_balance AS "unobligatedA",
            o.obligations_incurred AS "obligationsB",
            o.obligations_incurred_direct AS direct, o.obligations_incurred_reimbursable AS reimbursable,
            o.gross_outlays_direct AS "outlaysDirect", o.gross_outlays_reimbursable AS "outlaysReimbursable",
            o.undelivered_orders_unpaid_direct AS "undeliveredDirect",
            o.undelivered_orders_unpaid_reimbursable AS "undeliveredReimbursable",
            o.delivered_orders_unpaid_direct AS "deliveredDirect",
            o.delivered_orders_unpaid_reimbursable AS "deliveredReimbursable"
       FROM dm_sbr_fy s JOIN dm_load ls ON ls.id = s.load_id AND ls.is_current
       JOIN dm_obligation_stage o ON o.fiscal_year = s.fiscal_year AND o.scope = s.scope
       JOIN dm_load lo ON lo.id = o.load_id AND lo.is_current
      WHERE s.scope = $1 AND o.obligations_incurred_direct IS NOT NULL
      ORDER BY s.fiscal_year`, [SCOPE]);
}

/** The direct rate, or null where there is too little authority to divide by. */
export function directRate(direct: number, resources: number, offsetting: number): number | null {
  const den = resources - Math.max(0, offsetting);
  return den >= 1e6 ? direct / den * 100 : null;
}

export type SplitDim = 'agency' | 'federal' | 'tas' | 'function';
const DIM_B: Record<SplitDim, { key: string; label: string }> = {
  agency: { key: 'ac.agency_code', label: 'ac.agency_name' },
  federal: { key: 'ac.federal_account', label: 'ac.federal_account_name' },
  tas: { key: 'ac.treasury_account', label: 'ac.treasury_account_name' },
  function: { key: 'ac.budget_function', label: 'ac.budget_function' },
};
/** File A at account grain carries no budget function, so that dimension has no resources side. */
const DIM_A: Partial<Record<SplitDim, { key: string; label: string }>> = {
  agency: { key: 'r.agency_code', label: 'r.agency_code' },
  federal: { key: 'r.federal_account', label: 'r.federal_account_name' },
  tas: { key: 'r.treasury_account', label: 'r.treasury_account_name' },
};
const AGENCY: Record<string, string> = {
  '097': 'Defense-wide', '021': 'Army', '017': 'Navy', '057': 'Air Force',
};

export interface SplitRow {
  key: string; label: string;
  direct: number; reimbursable: number; outlaysDirect: number; outlaysReimbursable: number;
  resources: number; offsettingCollections: number; obligationsA: number; unobligatedA: number;
}
/**
 * One fiscal year split by component, appropriation or Treasury account: File B
 * direct and reimbursable beside the same accounts' File A resources. Ranked by
 * DIRECT obligations, which is what moves the Defense Working Capital Fund from
 * the top of a total-obligations ranking to where its own appropriations put it.
 */
export async function getSplitByDim(fy: number, dim: SplitDim, limit = 12): Promise<SplitRow[]> {
  const b = DIM_B[dim], a = DIM_A[dim] ?? { key: 'NULL::text', label: 'NULL::text' };
  const aWhere = DIM_A[dim] ? 'TRUE' : 'FALSE';
  const rows = await query<any>(
    `WITH b AS (
       SELECT ${b.key} AS key, max(${b.label}) AS label,
              sum(f.obligations_direct) AS direct, sum(f.obligations_reimbursable) AS reimb,
              sum(f.gross_outlays_direct) AS od, sum(f.gross_outlays_reimbursable) AS orb
         FROM dm_exec_account_fy f JOIN dm_load l ON l.id = f.load_id AND l.is_current
         JOIN dm_exec_account ac ON ac.load_id = f.load_id AND ac.fiscal_year = f.fiscal_year
                                AND ac.treasury_account = f.treasury_account
        WHERE f.fiscal_year = $1 AND f.scope = $2 GROUP BY 1
     ), a AS (
       SELECT ${a.key} AS key, max(${a.label}) AS label,
              sum(r.total_budgetary_resources) AS tbr, sum(r.spending_auth_offsetting) AS saoc,
              sum(r.obligations_incurred) AS obl, sum(r.unobligated_balance) AS unob
         FROM dm_exec_resource r JOIN dm_load l ON l.id = r.load_id AND l.is_current
        WHERE r.fiscal_year = $1 AND r.scope = $2 AND ${aWhere} GROUP BY 1
     )
     SELECT coalesce(b.key, a.key) AS key, coalesce(b.label, a.label) AS label,
            coalesce(b.direct, 0) AS direct, coalesce(b.reimb, 0) AS reimb,
            coalesce(b.od, 0) AS od, coalesce(b.orb, 0) AS orb,
            coalesce(a.tbr, 0) AS tbr, coalesce(a.saoc, 0) AS saoc,
            coalesce(a.obl, 0) AS obl, coalesce(a.unob, 0) AS unob
       FROM b FULL JOIN a ON a.key = b.key
      ORDER BY coalesce(b.direct, 0) DESC LIMIT $3`, [fy, SCOPE, limit]);
  return rows.map((r) => ({
    key: r.key, label: dim === 'agency' ? (AGENCY[r.key] ?? r.label) : (r.label || r.key),
    direct: Number(r.direct), reimbursable: Number(r.reimb),
    outlaysDirect: Number(r.od), outlaysReimbursable: Number(r.orb),
    resources: Number(r.tbr), offsettingCollections: Number(r.saoc),
    obligationsA: Number(r.obl), unobligatedA: Number(r.unob),
  }));
}

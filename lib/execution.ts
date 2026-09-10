/**
 * Execution detail and execution timing.
 *
 * Two sources answering two different questions, and the page must never let
 * them be read as one:
 *
 *   File B  (dm_exec_*)   what kind of money an obligation is and how far
 *                         through the pipeline it has travelled. One submission
 *                         per fiscal year, so there is no within-year series in
 *                         it at all -- FY2026 is a single period-to-date
 *                         snapshot, not a curve.
 *   FPDS    (dm_fpds_*)   when contract money moved, to the day. About a fifth
 *                         of Department obligations, never the whole of them.
 *
 * Every function here returns the year's own completeness marker beside its
 * figures, because the live fiscal year is shorter than the years it is
 * compared with and that is the easiest mistake on this page to make silently.
 */
import { query } from './db';

export const SCOPE = 'DOW';

// ---------------------------------------------------------------- File B ----

export interface ExecFy {
  fiscalYear: number; submissionPeriod: string | null; sourceRows: number;
  detailRows: number; collapsedRows: number; hasDetail: boolean;
  accounts: number; objectClasses: number; activities: number;
  hasActivityNames: boolean; obligations: number;
}
export async function getExecFy(): Promise<ExecFy[]> {
  return query<ExecFy>(
    `SELECT fiscal_year AS "fiscalYear", submission_period AS "submissionPeriod",
            source_rows AS "sourceRows", detail_rows AS "detailRows",
            collapsed_rows AS "collapsedRows", has_detail AS "hasDetail",
            accounts, object_classes AS "objectClasses", activities,
            has_activity_names AS "hasActivityNames", obligations
       FROM dm_exec_fy e JOIN dm_load l ON l.id = e.load_id AND l.is_current
      WHERE scope = $1 ORDER BY fiscal_year`, [SCOPE]);
}

export interface ObjectClassRow {
  code: string; name: string; majorClass: string;
  obligations: number; undeliveredUnpaid: number; deliveredUnpaid: number;
  grossOutlays: number; deobligations: number;
}
export async function getExecObjectClasses(fy: number): Promise<ObjectClassRow[]> {
  return query<ObjectClassRow>(
    `SELECT object_class_code AS code, object_class_name AS name,
            major_class AS "majorClass", obligations,
            undelivered_unpaid AS "undeliveredUnpaid",
            delivered_unpaid AS "deliveredUnpaid",
            gross_outlays AS "grossOutlays", deobligations
       FROM dm_exec_object_class_fy o JOIN dm_load l ON l.id = o.load_id AND l.is_current
      WHERE fiscal_year = $1 AND scope = $2
      ORDER BY obligations DESC`, [fy, SCOPE]);
}

/**
 * Obligations split by how long the authority lasts.
 *
 * This is the split that matters in September and it is not a published field:
 * it is read off the beginning and ending periods of availability. Annual money
 * expires on 30 September; multi-year and no-year money does not.
 */
export async function getExecFundLife(fy: number) {
  return query<{ fundLife: string; obligations: number; undeliveredUnpaid: number;
                 grossOutlays: number; accounts: number }>(
    `SELECT fund_life AS "fundLife", sum(obligations) AS obligations,
            sum(undelivered_unpaid) AS "undeliveredUnpaid",
            sum(gross_outlays) AS "grossOutlays", count(*)::int AS accounts
       FROM dm_exec_account_fy a JOIN dm_load l ON l.id = a.load_id AND l.is_current
      WHERE fiscal_year = $1 AND scope = $2
      GROUP BY 1 ORDER BY obligations DESC`, [fy, SCOPE]);
}

/** The levels the execution explorer can group by. Column names, so whitelisted. */
export const EXEC_DIMS = {
  agency:      { expr: 'ac.agency_name',        label: 'ac.agency_name',          title: 'Component' },
  function:    { expr: 'ac.budget_function',    label: 'ac.budget_function',      title: 'Budget function' },
  subfunction: { expr: 'ac.budget_subfunction', label: 'ac.budget_subfunction',   title: 'Budget sub-function' },
  federal:     { expr: 'ac.federal_account',    label: 'ac.federal_account_name', title: 'Federal account' },
  account:     { expr: 'd.treasury_account',    label: 'ac.treasury_account_name', title: 'Treasury account' },
  fundLife:    { expr: 'd.fund_life',           label: 'd.fund_life',             title: 'Period of availability' },
  majorClass:  { expr: 'oc.major_class',        label: 'oc.major_class',          title: 'Object class group' },
  objectClass: { expr: 'd.object_class_code',   label: 'oc.object_class_name',    title: 'Object class' },
  activity:    { expr: 'd.activity_id',         label: "coalesce(nullif(av.activity_name,''), d.activity_id)", title: 'Program activity' },
  source:      { expr: 'd.funding_source',      label: 'd.funding_source',        title: 'Direct or reimbursable' },
  defc:        { expr: 'd.defc',                label: 'd.defc',                  title: 'Emergency fund code' },
} as const;
export type ExecDim = keyof typeof EXEC_DIMS;
export const EXEC_DIM_ORDER: ExecDim[] = [
  'agency', 'function', 'account', 'majorClass', 'objectClass', 'activity'];

export interface ExecNode {
  key: string; label: string; dim: ExecDim; level: number; path: string[];
  obligations: number; undeliveredUnpaid: number; deliveredUnpaid: number;
  grossOutlays: number; deobligations: number;
  upwardAdjustments: number; downwardAdjustments: number;
  rows: number; hasChildren: boolean;
}

const EXEC_FROM = `
  FROM dm_exec_detail d
  JOIN dm_load l ON l.id = d.load_id AND l.is_current
  LEFT JOIN dm_exec_account ac
    ON ac.fiscal_year = d.fiscal_year AND ac.treasury_account = d.treasury_account
   AND ac.load_id = d.load_id
  LEFT JOIN dm_exec_object_class_fy oc
    ON oc.fiscal_year = d.fiscal_year AND oc.object_class_code = d.object_class_code
   AND oc.scope = d.scope AND oc.load_id = d.load_id
  LEFT JOIN dm_exec_activity av
    ON av.fiscal_year = d.fiscal_year AND av.activity_id = d.activity_id
   AND av.load_id = d.load_id`;

export async function getExecTree(a: {
  fiscalYear: number; dims?: ExecDim[]; path?: string[]; search?: string;
}): Promise<{ nodes: ExecNode[]; dim: ExecDim | null }> {
  const dims = (a.dims?.length ? a.dims : EXEC_DIM_ORDER).filter((d) => d in EXEC_DIMS);
  const path = a.path ?? [];
  const params: any[] = [a.fiscalYear, SCOPE];
  const where = ['d.fiscal_year = $1', 'd.scope = $2'];
  for (let i = 0; i < path.length && i < dims.length; i++) {
    params.push(path[i]);
    where.push(`coalesce(${EXEC_DIMS[dims[i]].expr}, '') = $${params.length}`);
  }
  if (a.search?.trim()) {
    params.push(`%${a.search.trim()}%`);
    const i = params.length;
    where.push(`(ac.treasury_account_name ILIKE $${i} OR ac.federal_account_name ILIKE $${i}
                 OR oc.object_class_name ILIKE $${i} OR av.activity_name ILIKE $${i}
                 OR d.treasury_account ILIKE $${i})`);
  }

  for (let level = path.length; level < dims.length; level++) {
    const d = dims[level];
    const next = dims[level + 1];
    const rows = await query<any>(
      `SELECT coalesce(${EXEC_DIMS[d].expr}, '') AS key,
              max(nullif(${EXEC_DIMS[d].label}, '')) AS label,
              sum(d.obligations) AS obligations,
              sum(d.undelivered_unpaid) AS udo,
              sum(d.delivered_unpaid) AS dlo,
              sum(d.gross_outlays) AS outlays,
              sum(d.deobligations) AS deob,
              sum(d.upward_adjustments) AS up,
              sum(d.downward_adjustments) AS down,
              count(*)::int AS rows,
              ${next ? `count(DISTINCT nullif(${EXEC_DIMS[next].expr}, ''))::int` : '0'} AS kids
         ${EXEC_FROM}
        WHERE ${where.join(' AND ')}
        GROUP BY 1 ORDER BY obligations DESC NULLS LAST`, params);
    if (rows.length === 1 && rows[0].key === '' && level + 1 < dims.length) continue;
    return {
      dim: d,
      nodes: rows.map((r) => ({
        key: String(r.key),
        label: r.label ?? (String(r.key) || 'Not reported'),
        dim: d, level, path: [...path.slice(0, level), String(r.key)],
        obligations: Number(r.obligations ?? 0),
        undeliveredUnpaid: Number(r.udo ?? 0),
        deliveredUnpaid: Number(r.dlo ?? 0),
        grossOutlays: Number(r.outlays ?? 0),
        deobligations: Number(r.deob ?? 0),
        upwardAdjustments: Number(r.up ?? 0),
        downwardAdjustments: Number(r.down ?? 0),
        rows: r.rows,
        hasChildren: Number(r.kids) > 0,
      })),
    };
  }
  return { nodes: [], dim: null };
}

// ------------------------------------------------------------------ FPDS ----

export interface FpdsYear {
  fiscalYear: number; lastDayOfFy: number; lastActionDate: string | null;
  obligation: number; actionCount: number; isCompleteYear: boolean;
  fullMonthsObserved: number;
}
export async function getFpdsYears(): Promise<FpdsYear[]> {
  return query<FpdsYear>(
    `SELECT fiscal_year AS "fiscalYear", last_day_of_fy AS "lastDayOfFy",
            to_char(last_action_date,'YYYY-MM-DD') AS "lastActionDate",
            obligation, action_count AS "actionCount",
            is_complete_year AS "isCompleteYear",
            full_months_observed AS "fullMonthsObserved"
       FROM dm_fpds_year y JOIN dm_load l ON l.id = y.load_id AND l.is_current
      ORDER BY fiscal_year`);
}

/** The cumulative curve, thinned to a step the page can draw without 2,000 points. */
export async function getFpdsPace(step = 3) {
  return query<{ fiscalYear: number; dayOfFy: number; cumObligation: number; cumActions: number }>(
    `SELECT fiscal_year AS "fiscalYear", day_of_fy AS "dayOfFy",
            cum_obligation AS "cumObligation", cum_actions AS "cumActions"
       FROM dm_fpds_day d JOIN dm_load l ON l.id = d.load_id AND l.is_current
      WHERE day_of_fy % $1 = 0 OR day_of_fy IN (1, 366)
         OR day_of_fy = (SELECT max(day_of_fy) FROM dm_fpds_day d2 WHERE d2.fiscal_year = d.fiscal_year
                          AND d2.load_id = d.load_id)
      ORDER BY fiscal_year, day_of_fy`, [step]);
}

/** The last N days of each complete year, which is where a deadline lands. */
export async function getFpdsTailDays(days = 21) {
  return query<{ fiscalYear: number; dayOfFy: number; daysToEnd: number;
                 obligation: number; actionCount: number }>(
    `WITH last AS (
       SELECT fiscal_year, max(day_of_fy) AS last_day
         FROM dm_fpds_day d JOIN dm_load l ON l.id = d.load_id AND l.is_current
        GROUP BY 1)
     SELECT d.fiscal_year AS "fiscalYear", d.day_of_fy AS "dayOfFy",
            (last.last_day - d.day_of_fy) AS "daysToEnd",
            d.obligation, d.action_count AS "actionCount"
       FROM dm_fpds_day d JOIN dm_load l ON l.id = d.load_id AND l.is_current
       JOIN last ON last.fiscal_year = d.fiscal_year
      WHERE last.last_day >= 360 AND d.day_of_fy > last.last_day - $1
      ORDER BY d.fiscal_year, d.day_of_fy`, [days]);
}

export async function getFpdsMonths(dimension: string, keys: string[]) {
  if (!keys.length) return [];
  return query<{ fiscalYear: number; fyMonth: number; monthLabel: string;
                 dimKey: string; dimLabel: string; obligation: number; actionCount: number }>(
    `SELECT fiscal_year AS "fiscalYear", fy_month AS "fyMonth", month_label AS "monthLabel",
            dim_key AS "dimKey", dim_label AS "dimLabel", obligation, action_count AS "actionCount"
       FROM dm_fpds_month m JOIN dm_load l ON l.id = m.load_id AND l.is_current
      WHERE dimension = $1 AND dim_key = ANY($2)
      ORDER BY fiscal_year, fy_month`, [dimension, keys]);
}

/**
 * Department-wide monthly totals, derived from the daily curve rather than from
 * dm_fpds_month. The monthly table keeps the largest keys per dimension, so
 * summing it would total the top eighty of something and call it the whole.
 */
export async function getFpdsMonthTotals() {
  return query<{ fiscalYear: number; fyMonth: number; obligation: number; actionCount: number }>(
    `SELECT fiscal_year AS "fiscalYear",
            ((extract(month from make_date(fiscal_year - 1, 10, 1) + (day_of_fy - 1))::int + 2) % 12) + 1
              AS "fyMonth",
            sum(obligation) AS obligation, sum(action_count)::int AS "actionCount"
       FROM dm_fpds_day d JOIN dm_load l ON l.id = d.load_id AND l.is_current
      GROUP BY 1, 2 ORDER BY 1, 2`);
}

export interface EoyRow {
  fiscalYear: number; dimension: string; dimKey: string; dimLabel: string;
  fyObligation: number; fyActions: number; sepObligation: number; sepSharePct: number;
  q4Obligation: number; q4SharePct: number; last5Obligation: number; last5SharePct: number;
  monthsObserved: number; isCompleteYear: boolean;
}
export async function getEoy(dimension: string, fy?: number, limit = 25): Promise<EoyRow[]> {
  const params: any[] = [dimension];
  let filter = '';
  if (fy) { params.push(fy); filter = `AND fiscal_year = $${params.length}`; }
  params.push(limit);
  return query<EoyRow>(
    `SELECT fiscal_year AS "fiscalYear", dimension, dim_key AS "dimKey", dim_label AS "dimLabel",
            fy_obligation AS "fyObligation", fy_actions AS "fyActions",
            sep_obligation AS "sepObligation", sep_share_pct AS "sepSharePct",
            q4_obligation AS "q4Obligation", q4_share_pct AS "q4SharePct",
            last5_obligation AS "last5Obligation", last5_share_pct AS "last5SharePct",
            months_observed AS "monthsObserved", is_complete_year AS "isCompleteYear"
       FROM dm_fpds_eoy e JOIN dm_load l ON l.id = e.load_id AND l.is_current
      WHERE dimension = $1 ${filter}
      ORDER BY sep_obligation DESC LIMIT $${params.length}`, params);
}

export interface Signal {
  signalKind: string; dimension: string; dimKey: string; dimLabel: string;
  fiscalYear: number | null; metric: number | null; baseline: number | null;
  mad: number | null; deviation: number | null; amount: number | null;
  baselineYears: number; fullBaseline: boolean; direction: string | null;
  headline: string; evidence: string; method: string; severityRank: number;
}
export async function getSignals(opts: {
  kinds?: string[]; dimensions?: string[]; fiscalYear?: number; limit?: number;
} = {}): Promise<Signal[]> {
  const params: any[] = [];
  const where: string[] = [];
  if (opts.kinds?.length) { params.push(opts.kinds); where.push(`signal_kind = ANY($${params.length})`); }
  if (opts.dimensions?.length) { params.push(opts.dimensions); where.push(`dimension = ANY($${params.length})`); }
  if (opts.fiscalYear) { params.push(opts.fiscalYear); where.push(`fiscal_year = $${params.length}`); }
  params.push(opts.limit ?? 60);
  return query<Signal>(
    `SELECT signal_kind AS "signalKind", dimension, dim_key AS "dimKey", dim_label AS "dimLabel",
            fiscal_year AS "fiscalYear", metric, baseline, mad, deviation, amount,
            baseline_years AS "baselineYears", full_baseline AS "fullBaseline", direction,
            headline, evidence, method, severity_rank AS "severityRank"
       FROM dm_exec_signal s JOIN dm_load l ON l.id = s.load_id AND l.is_current
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY severity_rank LIMIT $${params.length}`, params);
}

export async function getSignalCounts() {
  return query<{ signalKind: string; dimension: string; n: number }>(
    `SELECT signal_kind AS "signalKind", dimension, count(*)::int AS n
       FROM dm_exec_signal s JOIN dm_load l ON l.id = s.load_id AND l.is_current
      GROUP BY 1, 2 ORDER BY 1, 2`);
}

export interface Executor {
  fiscalYear: number; dimKey: string; dimLabel: string;
  ytdObligation: number; ytdNorm: number; pacePct: number | null; monthsObserved: number;
  sepShareMedianPct: number | null; last5ShareMedianPct: number | null;
  projectedSep: number | null; projectedSepLow: number | null; projectedSepHigh: number | null;
  baselineYears: number; actionsYtd: number; rankInFy: number;
}
export async function getExecutors(): Promise<Executor[]> {
  return query<Executor>(
    `SELECT fiscal_year AS "fiscalYear", dim_key AS "dimKey", dim_label AS "dimLabel",
            ytd_obligation AS "ytdObligation", ytd_norm AS "ytdNorm", pace_pct AS "pacePct",
            months_observed AS "monthsObserved",
            sep_share_median_pct AS "sepShareMedianPct",
            last5_share_median_pct AS "last5ShareMedianPct",
            projected_sep AS "projectedSep", projected_sep_low AS "projectedSepLow",
            projected_sep_high AS "projectedSepHigh", baseline_years AS "baselineYears",
            actions_ytd AS "actionsYtd", rank_in_fy AS "rankInFy"
       FROM dm_exec_executor e JOIN dm_load l ON l.id = e.load_id AND l.is_current
      ORDER BY rank_in_fy`);
}

export interface FpdsAction {
  fiscalYear: number; bucket: string; rankInBucket: number;
  actionDate: string | null; dayOfFy: number | null; daysToYearEnd: number | null;
  awardIdPiid: string; recipientName: string; recipientState: string;
  subAgency: string; office: string; psc: string; pscDescription: string;
  pscClass: string; pscClassLabel: string; pscKind: string; naicsDescription: string;
  pricing: string; competition: string; actionType: string;
  obligation: number; description: string;
}
export async function getFpdsActions(bucket?: string, fy?: number, limit = 60): Promise<FpdsAction[]> {
  const params: any[] = [];
  const where: string[] = [];
  if (bucket) { params.push(bucket); where.push(`bucket = $${params.length}`); }
  if (fy) { params.push(fy); where.push(`fiscal_year = $${params.length}`); }
  params.push(limit);
  return query<FpdsAction>(
    `SELECT fiscal_year AS "fiscalYear", bucket, rank_in_bucket AS "rankInBucket",
            to_char(action_date,'YYYY-MM-DD') AS "actionDate", day_of_fy AS "dayOfFy",
            days_to_year_end AS "daysToYearEnd", award_id_piid AS "awardIdPiid",
            recipient_name AS "recipientName", recipient_state AS "recipientState",
            sub_agency AS "subAgency", office, psc, psc_description AS "pscDescription",
            psc_class AS "pscClass", psc_class_label AS "pscClassLabel", psc_kind AS "pscKind",
            naics_description AS "naicsDescription", pricing, competition,
            action_type AS "actionType", obligation, description
       FROM dm_fpds_action a JOIN dm_load l ON l.id = a.load_id AND l.is_current
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY fiscal_year DESC, bucket, rank_in_bucket LIMIT $${params.length}`, params);
}

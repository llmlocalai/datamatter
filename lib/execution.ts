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
 *   FPDS    (dm_fpds_*)   when contract money moved, to the day. A THIRD of
 *                         Department obligations -- 33.9% in FY2025 -- never the
 *                         whole of them. getContractCoverage measures it rather
 *                         than leaving the page to assert it.
 *
 * Every function here returns the year's own completeness marker beside its
 * figures, because the live fiscal year is shorter than the years it is
 * compared with and that is the easiest mistake on this page to make silently.
 */
import { query } from './db';
import { missingColumns } from './schema';

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


// ------------------------------------------------------------- currency ----

export interface Currency {
  /** What the account files in this load actually hold. */
  heldPeriod: string | null; heldFiscalYear: number | null; heldMonth: number | null;
  heldPeriodEnd: string | null;
  /** The newest monthly submission revealed on the public calendar. */
  newestPeriod: string | null; newestFiscalYear: number | null; newestMonth: number | null;
  newestPeriodEnd: string | null; newestRevealDate: string | null;
  /** How many submission periods behind the published record this load is. */
  periodsBehind: number | null;
  /** When the calendar itself was read. A calendar has a vintage like anything else. */
  calendarVintage: string | null;
  /** When the source directory the account files came from was last written. */
  warehouseVintage: string | null;
}

const MONTH_END = ['October', 'November', 'December', 'January', 'February', 'March',
                   'April', 'May', 'June', 'July', 'August', 'September'];
/** 'FY2026P09' -> 'June 2026'. The period number is not a month anyone reads. */
export function periodMonthName(fy: number, month: number): string {
  const name = MONTH_END[month - 1] ?? `period ${month}`;
  return `${name} ${month <= 3 ? fy - 1 : fy}`;
}

/**
 * How current this load is against what has actually been published.
 *
 * The account files carry the submission period they were extracted at, and a
 * period number means nothing on its own. Beside the public calendar it means
 * everything: on 2026-09-10 this warehouse held FY2026 P09, covering June, while
 * FY2026 P10 covering July had been revealed on 1 September and was not in it —
 * because the warehouse snapshot was taken on 21 August. The page said nothing,
 * and so presented June as current.
 */
export async function getCurrency(): Promise<Currency> {
  const [held, newest, cal] = await Promise.all([
    query<{ period: string; vintage: string }>(
      `SELECT s.submission_period AS period, to_char(l.vintage,'YYYY-MM-DD') AS vintage
         FROM dm_sbr_fy s JOIN dm_load l ON l.id = s.load_id AND l.is_current
        WHERE s.scope = $1 AND s.submission_period IS NOT NULL
        ORDER BY s.fiscal_year DESC LIMIT 1`, [SCOPE]),
    query<{ fiscal_year: number; fiscal_month: number; period_end: string; reveal_date: string }>(
      `SELECT p.fiscal_year, p.fiscal_month,
              to_char(p.period_end,'YYYY-MM-DD') AS period_end,
              to_char(p.reveal_date,'YYYY-MM-DD') AS reveal_date
         FROM dm_submission_period p JOIN dm_load l ON l.id = p.load_id AND l.is_current
        WHERE NOT p.is_quarter AND p.is_revealed
        ORDER BY p.fiscal_year DESC, p.fiscal_month DESC LIMIT 1`).catch(() => []),
    query<{ vintage: string }>(
      `SELECT to_char(vintage,'YYYY-MM-DD') AS vintage FROM dm_load
        WHERE dataset_key = 'submission_calendar' AND is_current LIMIT 1`).catch(() => []),
  ]);

  const h = held[0];
  const m = /FY(\d{4})P(\d{2})/.exec(h?.period ?? '');
  const heldFy = m ? Number(m[1]) : null;
  const heldMonth = m ? Number(m[2]) : null;
  const n = newest[0];
  const behind = (heldFy && heldMonth && n)
    ? (n.fiscal_year - heldFy) * 12 + (n.fiscal_month - heldMonth)
    : null;
  // A held period whose own end date is not on the calendar still has one; it is
  // the end of that fiscal month, which the calendar names for every period it
  // carries. Where the calendar is absent the page falls back to the period label.
  return {
    heldPeriod: h?.period ?? null, heldFiscalYear: heldFy, heldMonth,
    heldPeriodEnd: heldFy && heldMonth ? periodMonthName(heldFy, heldMonth) : null,
    newestPeriod: n ? `FY${n.fiscal_year}P${String(n.fiscal_month).padStart(2, '0')}` : null,
    newestFiscalYear: n?.fiscal_year ?? null, newestMonth: n?.fiscal_month ?? null,
    newestPeriodEnd: n ? periodMonthName(n.fiscal_year, n.fiscal_month) : null,
    newestRevealDate: n?.reveal_date ?? null,
    periodsBehind: behind,
    calendarVintage: cal[0]?.vintage ?? null,
    warehouseVintage: h?.vintage ?? null,
  };
}

// ------------------------------------------------------------------ FPDS ----

export interface FpdsYear {
  fiscalYear: number; lastDayOfFy: number; lastActionDate: string | null;
  obligation: number; actionCount: number; isCompleteYear: boolean;
  fullMonthsObserved: number;
  /** Where the file substantially IS, which is not where its latest date is.
   *  Null on a database migrated before the column existed — see lib/schema. */
  frontierDayOfFy: number | null; frontierDate: string | null;
  frontierObligation: number; frontierActions: number;
  /** What falls after the frontier and is excluded from every comparison. */
  tailActions: number; tailObligation: number;
}
const FRONTIER_COLS = ['frontier_day_of_fy', 'frontier_date', 'frontier_obligation',
                       'frontier_actions', 'tail_actions', 'tail_obligation'];

/**
 * The years, and whether this database knows where each file's data actually
 * ends.
 *
 * Every timing figure on the site is measured to the reporting frontier. A
 * database migrated before that column existed cannot supply one, and the
 * fallback -- the year's last action date -- is exactly the value the frontier
 * replaced, so it is not offered: `frontierDayOfFy` comes back null and the
 * page withholds the section. See lib/schema.
 */
export async function getFpdsYears(): Promise<FpdsYear[]> {
  const missing = await missingColumns('dm_fpds_year', FRONTIER_COLS);
  const frontier = missing.length
    ? `NULL::int AS "frontierDayOfFy", NULL::text AS "frontierDate",
       0 AS "frontierObligation", 0 AS "frontierActions",
       0 AS "tailActions", 0 AS "tailObligation"`
    : `y.frontier_day_of_fy AS "frontierDayOfFy",
       to_char(y.frontier_date,'YYYY-MM-DD') AS "frontierDate",
       y.frontier_obligation AS "frontierObligation",
       y.frontier_actions AS "frontierActions",
       y.tail_actions AS "tailActions", y.tail_obligation AS "tailObligation"`;
  return query<FpdsYear>(
    `SELECT y.fiscal_year AS "fiscalYear", y.last_day_of_fy AS "lastDayOfFy",
            to_char(y.last_action_date,'YYYY-MM-DD') AS "lastActionDate",
            y.obligation, y.action_count AS "actionCount",
            y.is_complete_year AS "isCompleteYear",
            y.full_months_observed AS "fullMonthsObserved",
            ${frontier}
       FROM dm_fpds_year y JOIN dm_load l ON l.id = y.load_id AND l.is_current
      ORDER BY y.fiscal_year`);
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


/**
 * How much of execution the contract timing view actually covers.
 *
 * The pace chart, the year-end shares and every signal are built on contract
 * actions, because an action carries a date and an account submission does not.
 * That is a third of Department obligations, and the page has no business
 * implying otherwise -- so the share is measured here, per year, from the two
 * totals the site already publishes, rather than written into copy where it
 * would drift.
 *
 * The largest block it does NOT cover is personnel compensation and benefits,
 * which is 40.4% of FY2025 obligations and has no year-end timing question in
 * it: pay is paid on a schedule. The share is reported, not excused.
 */
export async function getContractCoverage() {
  return query<{ fiscalYear: number; departmentObligations: number; contractObligations: number;
                 contractPct: number; submissionPeriod: string | null;
                 isPartialAccounts: boolean; isPartialAwards: boolean }>(
    `SELECT s.fiscal_year AS "fiscalYear",
            s.obligations_incurred AS "departmentObligations",
            a.obligation AS "contractObligations",
            round(a.obligation / nullif(s.obligations_incurred, 0) * 100, 2) AS "contractPct",
            s.submission_period AS "submissionPeriod",
            s.is_partial_year AS "isPartialAccounts",
            a.is_partial_year AS "isPartialAwards"
       FROM dm_sbr_fy s JOIN dm_load ls ON ls.id = s.load_id AND ls.is_current
       JOIN dm_award_fy a ON a.fiscal_year = s.fiscal_year
       JOIN dm_load la ON la.id = a.load_id AND la.is_current
      WHERE s.scope = $1 ORDER BY s.fiscal_year`, [SCOPE]);
}

/** Obligations by object-class group — what the timing view covers and what it does not. */
export async function getMajorClasses(fy: number) {
  return query<{ majorClass: string; obligations: number }>(
    `SELECT major_class AS "majorClass", sum(obligations) AS obligations
       FROM dm_exec_object_class_fy o JOIN dm_load l ON l.id = o.load_id AND l.is_current
      WHERE fiscal_year = $1 AND scope = $2
      GROUP BY 1 ORDER BY 2 DESC`, [fy, SCOPE]);
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

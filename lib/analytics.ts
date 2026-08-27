/**
 * Server-side data layer for the analytics pages.
 *
 * Every function returns rows joined to their dm_load row, so a caller always
 * has the vintage available to render. There is no path here that returns a
 * figure without its provenance — that is enforced by shape, not by discipline.
 *
 * All SQL is parameterized. Amounts are DOLLARS.
 */
import { query as rawQuery } from './db';

export const SCOPE_DOW = 'DOW';

/**
 * Before the first load the dm_* tables do not exist, and on Vercel a preview
 * deploy may point at a database that has never been loaded. That is a legitimate
 * empty state, not an error: return no rows so the page renders its "not loaded"
 * message. Anything else — a bad credential, a dropped connection — still throws,
 * because silently serving an empty page for a real fault is how a dashboard ends
 * up quietly wrong.
 */
async function query<T = any>(text: string, params?: unknown[]): Promise<T[]> {
  try {
    return await rawQuery<T>(text, params);
  } catch (e: any) {
    if (e?.code === '42P01') return [];   // undefined_table
    throw e;
  }
}

export interface Provenance {
  datasetKey: string;
  label: string;
  sourceSystem: string;
  sourcePath: string;
  grain: string;
  vintage: string;
  extractedAt: string;
  rowCount: number;
  limitations: string;
  refreshCadence: string;
}

const PROV_SELECT = `
  d.key AS "datasetKey", d.label, d.source_system AS "sourceSystem",
  d.source_path AS "sourcePath", d.grain, d.limitations,
  d.refresh_cadence AS "refreshCadence",
  to_char(l.vintage,'YYYY-MM-DD') AS vintage,
  to_char(l.extracted_at,'YYYY-MM-DD"T"HH24:MI:SSOF') AS "extractedAt",
  l.row_count AS "rowCount"`;

export async function getProvenance(datasetKey: string): Promise<Provenance | null> {
  const rows = await query<Provenance>(
    `SELECT ${PROV_SELECT} FROM dm_load l JOIN dm_dataset d ON d.key = l.dataset_key
      WHERE l.dataset_key = $1 AND l.is_current LIMIT 1`, [datasetKey]);
  return rows[0] ?? null;
}

export async function getAllProvenance(): Promise<Provenance[]> {
  return query<Provenance>(
    `SELECT ${PROV_SELECT}, d.description, d.sort_order
       FROM dm_dataset d LEFT JOIN dm_load l ON l.dataset_key = d.key AND l.is_current
      ORDER BY d.sort_order`);
}

/** True when the analytics tables have never been loaded. */
export async function isLoaded(): Promise<boolean> {
  try {
    const r = await query<{ n: number }>(`SELECT count(*)::int AS n FROM dm_load WHERE is_current`);
    return (r[0]?.n ?? 0) > 0;
  } catch { return false; }
}

// ------------------------------------------------------------- execution ----
export interface SbrYear {
  fiscalYear: number; scope: string; scopeLabel: string;
  submissionPeriod: string | null; isPartialYear: boolean; tasCount: number;
  baAppropriated: number; unobligatedBf: number; adjustmentsToUnobBf: number;
  borrowingAuthority: number; contractAuthority: number; spendingAuthOffsetting: number;
  otherBudgetaryResources: number; totalBudgetaryResources: number;
  obligationsIncurred: number; deobligations: number; unobligatedBalance: number;
  grossOutlays: number;
}
const SBR_COLS = `
  fiscal_year AS "fiscalYear", scope, scope_label AS "scopeLabel",
  submission_period AS "submissionPeriod", is_partial_year AS "isPartialYear",
  tas_count AS "tasCount", ba_appropriated AS "baAppropriated",
  unobligated_bf AS "unobligatedBf", adjustments_to_unob_bf AS "adjustmentsToUnobBf",
  borrowing_authority AS "borrowingAuthority", contract_authority AS "contractAuthority",
  spending_auth_offsetting AS "spendingAuthOffsetting",
  other_budgetary_resources AS "otherBudgetaryResources",
  total_budgetary_resources AS "totalBudgetaryResources",
  obligations_incurred AS "obligationsIncurred", deobligations,
  unobligated_balance AS "unobligatedBalance", gross_outlays AS "grossOutlays"`;

export async function getSbrSeries(scope = SCOPE_DOW): Promise<SbrYear[]> {
  return query<SbrYear>(
    `SELECT ${SBR_COLS} FROM dm_sbr_fy s JOIN dm_load l ON l.id = s.load_id AND l.is_current
      WHERE scope = $1 ORDER BY fiscal_year`, [scope]);
}

/** The scope finding: Department codes vs every code present in File A. */
export async function getScopeComparison(): Promise<{
  fiscalYear: number; dow: number; all: number; nonDow: number; eop: number; overstatementPct: number;
}[]> {
  return query(
    `WITH s AS (
       SELECT fiscal_year, scope, obligations_incurred
         FROM dm_sbr_fy f JOIN dm_load l ON l.id = f.load_id AND l.is_current)
     SELECT fiscal_year AS "fiscalYear",
            max(CASE WHEN scope='DOW' THEN obligations_incurred END) AS dow,
            max(CASE WHEN scope='ALL' THEN obligations_incurred END) AS all,
            max(CASE WHEN scope='NON_DOW' THEN obligations_incurred END) AS "nonDow",
            max(CASE WHEN scope='AGENCY:011' THEN obligations_incurred END) AS eop,
            round((max(CASE WHEN scope='ALL' THEN obligations_incurred END)
                 / nullif(max(CASE WHEN scope='DOW' THEN obligations_incurred END),0) - 1) * 100, 2)
              AS "overstatementPct"
       FROM s GROUP BY fiscal_year ORDER BY fiscal_year`);
}

export interface ObligationStage {
  fiscalYear: number; obligationsIncurred: number; undeliveredOrdersUnpaid: number;
  deliveredOrdersUnpaid: number; grossOutlays: number; deobligations: number;
}
export async function getObligationStages(): Promise<ObligationStage[]> {
  return query<ObligationStage>(
    `SELECT fiscal_year AS "fiscalYear", obligations_incurred AS "obligationsIncurred",
            undelivered_orders_unpaid AS "undeliveredOrdersUnpaid",
            delivered_orders_unpaid AS "deliveredOrdersUnpaid",
            gross_outlays AS "grossOutlays", deobligations
       FROM dm_obligation_stage s JOIN dm_load l ON l.id = s.load_id AND l.is_current
      WHERE scope = $1 ORDER BY fiscal_year`, [SCOPE_DOW]);
}

export async function getObjectClasses(fy: number) {
  return query<{ code: string; name: string; majorClass: string; obligations: number; rank: number }>(
    `SELECT object_class_code AS code, object_class_name AS name,
            major_class AS "majorClass", obligations, rank_in_fy AS rank
       FROM dm_object_class o JOIN dm_load l ON l.id = o.load_id AND l.is_current
      WHERE fiscal_year = $1 AND scope = $2 ORDER BY rank_in_fy`, [fy, SCOPE_DOW]);
}

export async function getSbrDim(fy: number, dimension: string, limit = 12) {
  return query<{ key: string; label: string; totalBudgetaryResources: number;
                 obligationsIncurred: number; unobligatedBalance: number; grossOutlays: number }>(
    `SELECT dim_key AS key, dim_label AS label,
            total_budgetary_resources AS "totalBudgetaryResources",
            obligations_incurred AS "obligationsIncurred",
            unobligated_balance AS "unobligatedBalance", gross_outlays AS "grossOutlays"
       FROM dm_sbr_dim d JOIN dm_load l ON l.id = d.load_id AND l.is_current
      WHERE fiscal_year = $1 AND dimension = $2 AND scope = $3
      ORDER BY rank_in_dim LIMIT $4`, [fy, dimension, SCOPE_DOW, limit]);
}

// -------------------------------------------------------------- contracts ---
export async function getAwardYears() {
  return query<{ fiscalYear: number; obligation: number; actionCount: number;
                 isPartialYear: boolean; vintage: string }>(
    `SELECT a.fiscal_year AS "fiscalYear", a.obligation, a.action_count AS "actionCount",
            a.is_partial_year AS "isPartialYear", to_char(a.vintage,'YYYY-MM-DD') AS vintage
       FROM dm_award_fy a JOIN dm_load l ON l.id = a.load_id AND l.is_current
      ORDER BY fiscal_year`);
}

export async function getAwardDim(fy: number, dimension: string, limit = 10) {
  return query<{ key: string; label: string; obligation: number; actionCount: number }>(
    `SELECT dim_key AS key, dim_label AS label, obligation, action_count AS "actionCount"
       FROM dm_award_dim d JOIN dm_load l ON l.id = d.load_id AND l.is_current
      WHERE fiscal_year = $1 AND dimension = $2 ORDER BY rank_in_dim LIMIT $3`,
    [fy, dimension, limit]);
}

// ---------------------------------------------------------- reconciliation --
export async function getReconciliation() {
  return query<{ fiscalYear: number; awardObligation: number; awardActions: number;
    filecObligation: number; filecRows: number; filecAwards: number;
    linkagePct: number; unlinkedObligation: number; isPartialYear: boolean }>(
    `SELECT fiscal_year AS "fiscalYear", award_obligation AS "awardObligation",
            award_actions AS "awardActions", filec_obligation AS "filecObligation",
            filec_rows AS "filecRows", filec_awards AS "filecAwards",
            linkage_pct AS "linkagePct", unlinked_obligation AS "unlinkedObligation",
            is_partial_year AS "isPartialYear"
       FROM dm_reconciliation r JOIN dm_load l ON l.id = r.load_id AND l.is_current
      ORDER BY fiscal_year`);
}

export async function getVintageDrift() {
  return query<{ fiscalYear: number; vintageFrom: string; vintageTo: string;
    obligationFrom: number; obligationTo: number; obligationDelta: number;
    actionsFrom: number; actionsTo: number; actionDelta: number; yearClosed: boolean }>(
    `SELECT fiscal_year AS "fiscalYear", to_char(vintage_from,'YYYY-MM-DD') AS "vintageFrom",
            to_char(vintage_to,'YYYY-MM-DD') AS "vintageTo",
            obligation_from AS "obligationFrom", obligation_to AS "obligationTo",
            obligation_delta AS "obligationDelta", actions_from AS "actionsFrom",
            actions_to AS "actionsTo", action_delta AS "actionDelta", year_closed AS "yearClosed"
       FROM dm_vintage_drift v JOIN dm_load l ON l.id = v.load_id AND l.is_current
      ORDER BY fiscal_year`);
}

// -------------------------------------------------------------- controls ----
export interface ControlRow {
  code: string; name: string; assertion: string; rationale: string;
  authority: string | null; severity: string;
  pass: number; fail: number; warn: number; total: number;
  results: { fiscalYear: number | null; status: string; message: string;
             observed: number | null; expected: number | null; variancePct: number | null }[];
  runAt: string | null;
}
export async function getControls(): Promise<ControlRow[]> {
  const controls = await query<any>(
    `SELECT code, name, assertion, rationale, authority, severity, sort_order
       FROM dm_control ORDER BY sort_order`);
  const results = await query<any>(
    `SELECT control_code AS code, fiscal_year AS "fiscalYear", status, message,
            observed, expected, variance_pct AS "variancePct",
            to_char(run_at,'YYYY-MM-DD"T"HH24:MI:SSOF') AS "runAt"
       FROM dm_control_result ORDER BY control_code, fiscal_year NULLS FIRST`);
  return controls.map((c) => {
    const rs = results.filter((r) => r.code === c.code);
    return { ...c,
      results: rs,
      pass: rs.filter((r) => r.status === 'pass').length,
      fail: rs.filter((r) => r.status === 'fail').length,
      warn: rs.filter((r) => r.status === 'warn').length,
      total: rs.length,
      runAt: rs[0]?.runAt ?? null };
  });
}

// ------------------------------------------------------------ definitions ---
export interface Definition {
  slug: string; term: string; definition: string; whyItMatters: string | null;
  keyRules: string | null; authorities: string[]; related: string[];
  sourceFile: string; lastVerified: string | null; topic: string | null;
}
export async function getDefinitions(): Promise<Definition[]> {
  return query<Definition>(
    `SELECT slug, term, definition, why_it_matters AS "whyItMatters", key_rules AS "keyRules",
            authorities, related, source_file AS "sourceFile",
            to_char(last_verified,'YYYY-MM-DD') AS "lastVerified", topic
       FROM dm_definition d JOIN dm_load l ON l.id = d.load_id AND l.is_current
      ORDER BY term`);
}

// -------------------------------------------------------- audit & oversight -
export async function getAuditPosture() {
  return query<{ fiscalYear: number; metricKey: string; metricLabel: string;
    metricValue: number | null; valueKind: string; valueText: string | null;
    citation: string; note: string | null }>(
    `SELECT fiscal_year AS "fiscalYear", metric_key AS "metricKey",
            metric_label AS "metricLabel", metric_value AS "metricValue",
            value_kind AS "valueKind", value_text AS "valueText", citation, note
       FROM dm_audit_posture a JOIN dm_load l ON l.id = a.load_id AND l.is_current
      ORDER BY sort_order`);
}

export async function getKbInventory(collection?: string) {
  return query<{ collection: string; folder: string; label: string;
                 docCount: number; authorityTier: number | null }>(
    `SELECT collection, folder, label, doc_count AS "docCount",
            authority_tier AS "authorityTier"
       FROM dm_kb_inventory k JOIN dm_load l ON l.id = k.load_id AND l.is_current
      WHERE ($1::text IS NULL OR collection = $1) ORDER BY sort_order`,
    [collection ?? null]);
}

export async function getJustificationExhibits() {
  return query<{ fiscalYear: number; activity: string; exhibitCount: number }>(
    `SELECT fiscal_year AS "fiscalYear", activity, exhibit_count AS "exhibitCount"
       FROM dm_justification_exhibit j JOIN dm_load l ON l.id = j.load_id AND l.is_current
      ORDER BY exhibit_count DESC`);
}

export async function getHearingSummary() {
  const byCongress = await query<{ congress: number; chamber: string; total: number; defense: number }>(
    `SELECT congress, chamber, count(*)::int AS total,
            count(*) FILTER (WHERE defense_related)::int AS defense
       FROM dm_hearing h JOIN dm_load l ON l.id = h.load_id AND l.is_current
      GROUP BY congress, chamber ORDER BY congress DESC, chamber`);
  const recent = await query<{ hearingId: string; congress: number; chamber: string;
                               title: string; ingestDate: string }>(
    `SELECT hearing_id AS "hearingId", congress, chamber, title,
            to_char(ingest_date,'YYYY-MM-DD') AS "ingestDate"
       FROM dm_hearing h JOIN dm_load l ON l.id = h.load_id AND l.is_current
      WHERE defense_related ORDER BY congress DESC, hearing_id LIMIT 24`);
  const totals = await query<{ total: number; defense: number }>(
    `SELECT count(*)::int AS total, count(*) FILTER (WHERE defense_related)::int AS defense
       FROM dm_hearing h JOIN dm_load l ON l.id = h.load_id AND l.is_current`);
  return { byCongress, recent, totals: totals[0] ?? { total: 0, defense: 0 } };
}

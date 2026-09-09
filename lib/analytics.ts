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

// -------------------------------------------------------------- assistance --
export async function getAssistanceYears() {
  return query<{ fiscalYear: number; obligation: number; actionCount: number;
                 isPartialYear: boolean; vintage: string }>(
    `SELECT a.fiscal_year AS "fiscalYear", a.obligation, a.action_count AS "actionCount",
            a.is_partial_year AS "isPartialYear", to_char(a.vintage,'YYYY-MM-DD') AS vintage
       FROM dm_assistance_fy a JOIN dm_load l ON l.id = a.load_id AND l.is_current
      ORDER BY fiscal_year`);
}

export async function getAssistanceDim(fy: number, dimension: string, limit = 10) {
  return query<{ key: string; label: string; obligation: number; actionCount: number }>(
    `SELECT dim_key AS key, dim_label AS label, obligation, action_count AS "actionCount"
       FROM dm_assistance_dim d JOIN dm_load l ON l.id = d.load_id AND l.is_current
      WHERE fiscal_year = $1 AND dimension = $2 ORDER BY rank_in_dim LIMIT $3`,
    [fy, dimension, limit]);
}

export async function getAssistanceVintageDrift() {
  return query<{ fiscalYear: number; vintageFrom: string; vintageTo: string;
    obligationFrom: number; obligationTo: number; obligationDelta: number;
    actionsFrom: number; actionsTo: number; actionDelta: number; yearClosed: boolean }>(
    `SELECT fiscal_year AS "fiscalYear", to_char(vintage_from,'YYYY-MM-DD') AS "vintageFrom",
            to_char(vintage_to,'YYYY-MM-DD') AS "vintageTo",
            obligation_from AS "obligationFrom", obligation_to AS "obligationTo",
            obligation_delta AS "obligationDelta", actions_from AS "actionsFrom",
            actions_to AS "actionsTo", action_delta AS "actionDelta", year_closed AS "yearClosed"
       FROM dm_assistance_vintage_drift d JOIN dm_load l ON l.id = d.load_id AND l.is_current
      ORDER BY fiscal_year`);
}

// -------------------------------------------------------------- program ----
/**
 * The program cut is the only one on this site keyed to a budget line rather
 * than to an account, and it is the one most able to mislead: an obligation
 * total here draws on prior-year balances, can carry Foreign Military Sales
 * dollars, and in recent years mostly does not name the Treasury account it
 * came from. So ProgramYear carries traceableObligation and traceablePct on the
 * same row as obligation — a caller cannot render the total without having the
 * share in hand. PROG-03 asserts the pair; this type is what makes obeying it
 * the path of least resistance.
 */
export interface ProgramYear {
  programCode: string; fiscalYear: number; vintage: string;
  obligation: number; traceableObligation: number; untraceableObligation: number;
  traceablePct: number; actionCount: number; awardCount: number;
  top5Obligation: number; top5Pct: number;
  lateQuarterObligation: number; lateQuarterPct: number;
  isPartialYear: boolean;
}
// Every column is table-qualified: dm_load also carries `vintage`, and an
// unqualified reference here is ambiguous. The page that surfaced this is
// server-rendered on demand, so the build did not catch it — which is why
// generateStaticParams below matters as much as the fix.
const PROGRAM_FY_COLS = `
  f.program_code AS "programCode", f.fiscal_year AS "fiscalYear",
  to_char(f.vintage,'YYYY-MM-DD') AS vintage, f.obligation,
  f.traceable_obligation AS "traceableObligation",
  f.untraceable_obligation AS "untraceableObligation",
  f.traceable_pct AS "traceablePct", f.action_count AS "actionCount",
  f.award_count AS "awardCount", f.top5_obligation AS "top5Obligation",
  f.top5_pct AS "top5Pct", f.late_quarter_obligation AS "lateQuarterObligation",
  f.late_quarter_pct AS "lateQuarterPct", f.is_partial_year AS "isPartialYear"`;

export interface ProgramRef {
  programCode: string; programName: string; totalObligation: number;
  firstFiscalYear: number; lastFiscalYear: number; isFeatured: boolean;
  rankByObligation: number;
}

/** Programs carried at full depth, for the picker. */
export async function getPrograms(): Promise<ProgramRef[]> {
  return query<ProgramRef>(
    `SELECT d.program_code AS "programCode", d.program_name AS "programName",
            d.total_obligation AS "totalObligation", d.first_fiscal_year AS "firstFiscalYear",
            d.last_fiscal_year AS "lastFiscalYear", d.is_featured AS "isFeatured",
            d.rank_by_obligation AS "rankByObligation"
       FROM dm_program_dim d JOIN dm_load l ON l.id = d.load_id AND l.is_current
      WHERE d.is_featured ORDER BY d.total_obligation DESC`);
}

export async function getProgramYears(programCode: string): Promise<ProgramYear[]> {
  return query<ProgramYear>(
    `SELECT ${PROGRAM_FY_COLS}
       FROM dm_program_fy f JOIN dm_load l ON l.id = f.load_id AND l.is_current
      WHERE f.program_code = $1 ORDER BY f.fiscal_year`, [programCode]);
}

/**
 * Program-dimension coverage of the contract file. FPDS records "no acquisition
 * program" as code 000 / description NONE rather than as a null, so this is the
 * denominator that stops a program page implying it covers the file: roughly
 * three quarters of DoD contract dollars carry no program at all.
 */
export async function getProgramCoverage() {
  return query<{ fiscalYear: number; totalObligation: number; totalActions: number;
    attributedObligation: number; attributedActions: number;
    unattributedObligation: number; unattributedActions: number;
    attributedPct: number; programCount: number; isPartialYear: boolean }>(
    `SELECT p.fiscal_year AS "fiscalYear", p.total_obligation AS "totalObligation",
            p.total_actions AS "totalActions", p.attributed_obligation AS "attributedObligation",
            p.attributed_actions AS "attributedActions",
            p.unattributed_obligation AS "unattributedObligation",
            p.unattributed_actions AS "unattributedActions",
            p.attributed_pct AS "attributedPct", p.program_count AS "programCount",
            p.is_partial_year AS "isPartialYear"
       FROM dm_program_coverage p JOIN dm_load l ON l.id = p.load_id AND l.is_current
      ORDER BY p.fiscal_year`);
}

export async function getProgramDim(programCode: string, fy: number, dimension: string, limit = 10) {
  return query<{ key: string; label: string; obligation: number; actionCount: number }>(
    `SELECT d.dim_key AS key, d.dim_label AS label, d.obligation, d.action_count AS "actionCount"
       FROM dm_program_dim_fy d JOIN dm_load l ON l.id = d.load_id AND l.is_current
      WHERE d.program_code = $1 AND d.fiscal_year = $2 AND d.dimension = $3
      ORDER BY d.rank_in_dim LIMIT $4`, [programCode, fy, dimension, limit]);
}

export async function getProgramAwards(programCode: string, fy: number, limit = 10) {
  return query<{ awardIdPiid: string; recipientName: string; obligation: number;
    actionCount: number; shareOfFyPct: number; hasAccountLink: boolean;
    largestActionDate: string | null; description: string | null }>(
    `SELECT a.award_id_piid AS "awardIdPiid", a.recipient_name AS "recipientName", a.obligation,
            a.action_count AS "actionCount", a.share_of_fy_pct AS "shareOfFyPct",
            a.has_account_link AS "hasAccountLink",
            to_char(a.largest_action_date,'YYYY-MM-DD') AS "largestActionDate", a.description
       FROM dm_program_award a JOIN dm_load l ON l.id = a.load_id AND l.is_current
      WHERE a.program_code = $1 AND a.fiscal_year = $2 ORDER BY a.rank_in_fy LIMIT $3`,
    [programCode, fy, limit]);
}

/**
 * The exact account sets NAMED on a program's actions. The obligation is not
 * apportioned across the accounts in a set and must never be summed by account
 * — PROG-02 asserts we do not, and the shape of this row (one string, not one
 * account) is what keeps a caller from trying.
 */
export async function getProgramAccounts(programCode: string, fy: number, limit = 8) {
  return query<{ accountSet: string; accountCount: number; obligation: number;
    actionCount: number; outOfScopeAccounts: string[] | null; hasOutOfScope: boolean }>(
    `SELECT a.account_set AS "accountSet", a.account_count AS "accountCount", a.obligation,
            a.action_count AS "actionCount", a.out_of_scope_accounts AS "outOfScopeAccounts",
            a.has_out_of_scope AS "hasOutOfScope"
       FROM dm_program_account a JOIN dm_load l ON l.id = a.load_id AND l.is_current
      WHERE a.program_code = $1 AND a.fiscal_year = $2 ORDER BY a.rank_in_fy LIMIT $3`,
    [programCode, fy, limit]);
}

export async function getProgramFilec(programCode: string) {
  return query<{ fiscalYear: number; filecObligation: number; filecRows: number;
    filecAwards: number; awardObligation: number; linkagePct: number;
    submissionPeriod: string | null; isPartialYear: boolean }>(
    `SELECT fiscal_year AS "fiscalYear", filec_obligation AS "filecObligation",
            filec_rows AS "filecRows", filec_awards AS "filecAwards",
            award_obligation AS "awardObligation", linkage_pct AS "linkagePct",
            submission_period AS "submissionPeriod", is_partial_year AS "isPartialYear"
       FROM dm_program_filec f JOIN dm_load l ON l.id = f.load_id AND l.is_current
      WHERE f.program_code = $1 ORDER BY f.fiscal_year`, [programCode]);
}

// --------------------------------------------------- traceability narrative --
/**
 * The F-35 budget lines, read live from the FY2027 "-1" exhibits in Neon rather
 * than transcribed from the memo. Amounts in the exhibit tables are $ THOUSANDS.
 *
 * Add rows only: weapon system cost, less prior-year advance procurement, plus
 * current-year AP. The Non-Add rows are the AP detail and would double count.
 * R-1 has no Add/Non-Add column, so every matching row counts once.
 *
 * "Joint Strike Missile" is a different program and is excluded deliberately.
 */
const F35_TITLE = `(
     upper(coalesce(values->>'Budget Line Item (BLI) Title','')) LIKE '%F-35%'
  OR upper(coalesce(values->>'Budget Line Item (BLI) Title','')) LIKE 'JSF%'
  OR upper(coalesce(values->>'Budget Line Item (BLI) Title','')) LIKE '%JOINT STRIKE FIGHTER%'
  OR upper(coalesce(values->>'Program Element/Budget Line Item (BLI) Title','')) LIKE '%F-35%'
  OR upper(coalesce(values->>'Program Element/Budget Line Item (BLI) Title','')) LIKE 'JSF%'
  OR upper(coalesce(values->>'Program Element/Budget Line Item (BLI) Title','')) LIKE '%JOINT STRIKE FIGHTER%'
)`;
const NUM = (k: string) => `coalesce(nullif(regexp_replace(coalesce(values->>'${k}',''),'[^0-9.-]','','g'),'')::numeric,0)`;

export interface F35BudgetLine {
  docCode: string; account: string; accountTitle: string; bli: string; title: string;
  fy25: number; fy26disc: number; fy26mand: number; fy27disc: number; fy27mand: number;
  qty25: number; qty26: number; qty27: number;
}

export async function getF35BudgetLines(): Promise<F35BudgetLine[]> {
  return query<F35BudgetLine>(
    `SELECT doc_code AS "docCode", coalesce(account,'') AS account,
            coalesce(account_title,'') AS "accountTitle",
            coalesce(values->>'Budget Line Item', values->>'PE/BLI', '') AS bli,
            coalesce(nullif(values->>'Budget Line Item (BLI) Title',''),
                     values->>'Program Element/Budget Line Item (BLI) Title','') AS title,
            sum(CASE WHEN doc_code='p1' THEN ${NUM('FY 2025 Total Amount')}
                     ELSE ${NUM('FY 2025 Total')} END) AS fy25,
            sum(CASE WHEN doc_code='p1' THEN ${NUM('FY 2026 Discretionary Enacted Amount')}
                     ELSE ${NUM('FY 2026 Discretionary Enacted')} END) AS fy26disc,
            sum(CASE WHEN doc_code='p1' THEN ${NUM('FY 2026 PL 119-21 Spend Plan Amount')}
                     ELSE ${NUM('FY 2026 PL 119-21 Spend Plan')} END) AS fy26mand,
            sum(CASE WHEN doc_code='p1' THEN ${NUM('FY 2027 Discretionary Request Amount')}
                     ELSE ${NUM('FY 2027 Discretionary Request')} END) AS fy27disc,
            sum(CASE WHEN doc_code='p1' THEN ${NUM('FY 2027 Mandatory Amount')}
                     ELSE ${NUM('FY 2027 Mandatory Request')} END) AS fy27mand,
            sum(CASE WHEN doc_code='p1' AND coalesce(values->>'Cost Type','')='A'
                     THEN ${NUM('FY 2025 Total Quantity')} ELSE 0 END) AS qty25,
            sum(CASE WHEN doc_code='p1' AND coalesce(values->>'Cost Type','')='A'
                     THEN ${NUM('FY 2026 Total Quantity')} ELSE 0 END) AS qty26,
            sum(CASE WHEN doc_code='p1' AND coalesce(values->>'Cost Type','')='A'
                     THEN ${NUM('FY 2027 Total Quantity')} ELSE 0 END) AS qty27
       FROM war_budget_line
      WHERE fiscal_year = 2027
        AND doc_code IN ('p1','r1')
        AND (doc_code = 'r1' OR coalesce(values->>'Add/Non-Add','Add') = 'Add')
        AND ${F35_TITLE}
      GROUP BY 1,2,3,4,5
      HAVING sum(CASE WHEN doc_code='p1' THEN ${NUM('FY 2025 Total Amount')}
                      ELSE ${NUM('FY 2025 Total')} END) <> 0
          OR sum(CASE WHEN doc_code='p1' THEN ${NUM('FY 2027 Discretionary Request Amount')}
                      ELSE ${NUM('FY 2027 Discretionary Request')} END) <> 0
          OR sum(CASE WHEN doc_code='p1' THEN ${NUM('FY 2027 Mandatory Amount')}
                      ELSE ${NUM('FY 2027 Mandatory Request')} END) <> 0
      ORDER BY doc_code, account, bli`);
}

/**
 * The exhibit tables predate the dm_load provenance system and carry their own
 * ingest stamp instead. The traceability page says so rather than implying the
 * budget figures hang off a dm_load row like every other measure on the site.
 */
export async function getWarBudgetVintage() {
  const r = await query<{ ingestedAt: string | null; lineCount: number }>(
    `SELECT to_char(max(ingested_at),'YYYY-MM-DD') AS "ingestedAt", count(*)::int AS "lineCount"
       FROM war_budget_line WHERE fiscal_year = 2027 AND doc_code IN ('p1','r1')`);
  return r[0] ?? { ingestedAt: null, lineCount: 0 };
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

export async function getAuditMwCategories(fiscalYear = 2025) {
  return query<{ fiscalYear: number; rank: number; category: string; citation: string }>(
    `SELECT fiscal_year AS "fiscalYear", rank_in_report AS rank, category, citation
       FROM dm_audit_mw_category m JOIN dm_load l ON l.id = m.load_id AND l.is_current
      WHERE fiscal_year = $1 ORDER BY rank_in_report`, [fiscalYear]);
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

/* ============================================================== exhibits ====
 * The President's Budget -1 exhibits: the program spine.
 *
 * Two things are true of every function below and neither is negotiable.
 *
 * The grain is (pb_year, fiscal_year) and it is never collapsed. Each PB book
 * restates three fiscal years — FY(pb-2) actuals, FY(pb-1) enacted, FY(pb)
 * request — so one fiscal year comes back three times with three different
 * numbers, and the difference between them is the restatement history rather
 * than noise to average away. Nothing here does a GROUP BY that loses pb_year.
 *
 * Memo rows are excluded from every total by default and are never silently
 * dropped: the P-1R exhibit, R-1 lines outside total obligation authority,
 * "(MEMO NON ADD)" cost types and the advance-procurement subtotal all restate
 * money counted elsewhere in the same book. `includeMemo` exists so a page can
 * show them as what they are.
 */

export type FyRole = 'prior_actual' | 'enacted' | 'request' | 'other';

export interface ExhibitProgram {
  exhibit: string; account: string; bli: string; treasuryAccount: string | null;
  component: string | null;
  programName: string; organization: string | null; accountTitle: string | null;
  budgetActivity: string | null; budgetActivityTitle: string | null;
  bsa: string | null; bsaTitle: string | null;
  /** How many budget activities the line actually spans in its newest book. */
  activityCount: number | null;
  /** Procurement or RDT&E — which exhibit the line is published in, not a guess. */
  fundType: string | null;
  /** One spelling per Treasury account; the books write the same account four ways. */
  appropriation: string | null;
  /** The Department's own category, only where its own weapons book names the system. */
  weaponCategory: string | null; weaponProgram: string | null;
  latestPb: number; isMemo: boolean;
  firstFiscalYear: number; lastFiscalYear: number;
  latestRequestK: number; latestRequestPb: number | null;
  lifetimeAmountK: number; pbYearCount: number;
  slug: string; inWeaponsBook: boolean;
  /** How this row met the search: text | alias | alias_designator | terms. */
  matchReason?: string | null;
  matchAlias?: string | null;
}

export interface ExhibitRestatement {
  pbYear: number; fiscalYear: number; fyRole: FyRole;
  amountK: number; quantity: number; costTypeCount: number;
  totalBasis: string; isMemo: boolean;
}

const EXHIBIT_PROGRAM_COLS = `
  p.exhibit, p.account, p.bli, p.treasury_account AS "treasuryAccount", p.component,
  p.program_name AS "programName", p.organization, p.account_title AS "accountTitle",
  p.budget_activity AS "budgetActivity",
  p.budget_activity_title AS "budgetActivityTitle",
  p.bsa, p.bsa_title AS "bsaTitle", p.activity_count AS "activityCount",
  p.fund_type AS "fundType", p.appropriation,
  p.weapon_category AS "weaponCategory", p.weapon_program AS "weaponProgram",
  p.latest_pb AS "latestPb",
  p.is_memo AS "isMemo", p.first_fiscal_year AS "firstFiscalYear",
  p.last_fiscal_year AS "lastFiscalYear", p.latest_request_k AS "latestRequestK",
  p.latest_request_pb AS "latestRequestPb",
  p.lifetime_amount_k AS "lifetimeAmountK", p.pb_year_count AS "pbYearCount",
  p.slug, p.in_weapons_book AS "inWeaponsBook"`;

export interface RosterFilters {
  q?: string;              // free text over title, line item, account and aliases
  organization?: string;   // the component derived from the account symbol
  accountTitle?: string;
  exhibit?: string;        // p1 | p1r | r1
  fundType?: string;       // Procurement | RDT&E
  appropriation?: string;  // the canonical account title
  weaponCategory?: string; // the weapons book's own category
  bsaTitle?: string;       // the J-book's own sub-activity
  weaponProgram?: string;  // every line tied to one weapon system
  weaponsOnly?: boolean;
  includeMemo?: boolean;
  sort?: string;           // see ROSTER_SORTS
  dir?: string;            // asc | desc
  limit?: number;
  offset?: number;
}

/**
 * The columns the roster may be ordered by, and the SQL for each.
 *
 * A whitelist rather than an interpolated column name: `sort` arrives from the
 * query string. Every entry names a real column, so a sorted view is a
 * shareable link and the sort applies to all 2,725 lines rather than to the
 * sixty on the screen.
 */
export const ROSTER_SORTS: Record<string, string> = {
  request: '"latestRequestK"',
  name: '"programName"',
  exhibit: 'exhibit',
  account: '"treasuryAccount"',
  appropriation: 'appropriation',
  bli: 'bli',
  component: 'component',
  fund: '"fundType"',
  category: '"weaponCategory"',
  bsa: '"bsaTitle"',
  years: '"lastFiscalYear"',
  lifetime: '"lifetimeAmountK"',
};

/**
 * Search that does not guess.
 *
 * Three layers, each of which can be explained on the row it produced, and no
 * similarity score anywhere:
 *
 *   1. NORMALISED TEXT. Case, spacing and punctuation are removed from both the
 *      query and the line, so "f35", "F-35" and "F 35" are one string. This is
 *      a normalisation, not a fuzzy match: it never makes two different
 *      designators equal.
 *   2. PUBLISHED ABBREVIATIONS. "JSF" reaches the F-35 because the weapons book
 *      writes "The F-35 Joint Strike Fighter (JSF)". The alias carries that
 *      sentence, and the row says which alias matched it. No synonym is
 *      invented here — see control WBC-03.
 *   3. ALL TERMS PRESENT. A multi-word query matches a line carrying every one
 *      of its words in any order, so "black hawk" and "golden dome" find their
 *      lines without a word-order rule.
 *
 * A line that matches none of the three is not returned. An empty result means
 * the filter matched nothing in this vintage — never that the Department did
 * not publish it.
 */
export async function getExhibitRoster(f: RosterFilters = {}) {
  const sortCol = ROSTER_SORTS[f.sort ?? ''] ?? ROSTER_SORTS.request;
  const dir = f.dir === 'asc' ? 'ASC' : 'DESC';
  const nulls = 'NULLS LAST';
  const rows = await query<ExhibitProgram & { total: number }>(
    `WITH q AS (
        SELECT $1::text AS raw,
               regexp_replace(lower(coalesce($1::text,'')), '[^a-z0-9]+', '', 'g') AS norm,
               (SELECT array_agg(t) FROM unnest(
                  regexp_split_to_array(lower(coalesce($1::text,'')), '[^a-z0-9]+')) AS t
                 WHERE length(t) >= 2) AS terms),
      alias AS (
        SELECT a.weapon_program, a.alias, a.designator_norm
          FROM dm_weapon_alias a
          JOIN dm_load l ON l.id = a.load_id AND l.is_current, q
         WHERE q.norm <> '' AND a.alias_norm = q.norm),
      hit AS (
        SELECT ${EXHIBIT_PROGRAM_COLS.replace(/\s+/g, ' ')},
               CASE
                 WHEN q.norm = '' THEN NULL
                 WHEN p.search_norm LIKE '%' || q.norm || '%' THEN 'text'
                 WHEN EXISTS (SELECT 1 FROM alias al
                               WHERE al.weapon_program IS NOT NULL
                                 AND al.weapon_program = p.weapon_program) THEN 'alias'
                 WHEN EXISTS (SELECT 1 FROM alias al, unnest(
                                 string_to_array(coalesce(al.designator_norm,''), ' ')) AS d
                               WHERE d <> '' AND p.search_norm LIKE '%' || d || '%')
                   THEN 'alias_designator'
                 ELSE 'terms'
               END AS "matchReason",
               (SELECT al.alias FROM alias al
                 WHERE al.weapon_program = p.weapon_program
                    OR EXISTS (SELECT 1 FROM unnest(
                                 string_to_array(coalesce(al.designator_norm,''), ' ')) AS d
                                WHERE d <> '' AND p.search_norm LIKE '%' || d || '%')
                 LIMIT 1) AS "matchAlias"
          FROM dm_exhibit_program p
          JOIN dm_load l ON l.id = p.load_id AND l.is_current, q
         WHERE ($5::boolean OR $4 = 'p1r' OR NOT p.is_memo)
           AND ($2::text IS NULL OR p.component = $2)
           AND ($3::text IS NULL OR p.account_title = $3)
           AND ($4::text IS NULL OR p.exhibit = $4)
           AND ($9::text  IS NULL OR p.fund_type = $9)
           AND ($10::text IS NULL OR p.appropriation = $10)
           AND ($11::text IS NULL OR p.weapon_category = $11)
           AND ($12::text IS NULL OR p.bsa_title = $12)
           AND ($13::text IS NULL OR p.weapon_program = $13)
           AND (NOT $6::boolean OR p.in_weapons_book)
           AND (q.norm = ''
                OR p.search_norm LIKE '%' || q.norm || '%'
                OR EXISTS (SELECT 1 FROM alias al
                            WHERE al.weapon_program = p.weapon_program)
                OR EXISTS (SELECT 1 FROM alias al, unnest(
                              string_to_array(coalesce(al.designator_norm,''), ' ')) AS d
                            WHERE d <> '' AND p.search_norm LIKE '%' || d || '%')
                OR (q.terms IS NOT NULL AND cardinality(q.terms) > 1
                    AND NOT EXISTS (SELECT 1 FROM unnest(q.terms) AS t
                                     WHERE p.search_norm NOT LIKE '%' || t || '%'))))
      SELECT hit.*, count(*) OVER () ::int AS total
        FROM hit
       ORDER BY ${sortCol} ${dir} ${nulls}, "programName"
       LIMIT $7 OFFSET $8`,
    [f.q?.trim() || null, f.organization || null, f.accountTitle || null,
     f.exhibit || null, !!f.includeMemo, !!f.weaponsOnly,
     Math.min(f.limit ?? 60, 400), f.offset ?? 0,
     f.fundType || null, f.appropriation || null, f.weaponCategory || null,
     f.bsaTitle || null, f.weaponProgram || null]);
  return { rows, total: rows[0]?.total ?? 0 };
}

/**
 * Every value the roster can be filtered by, with a count beside it.
 *
 * Two taxonomies are returned and they answer different questions, so the page
 * labels both rather than blending them:
 *
 *   weaponCategories — the Department's own grouping of major systems, read from
 *     Program Acquisition Cost by Weapon System. Authoritative, and sparse: it
 *     covers only the lines that tie to a system page. An empty cell means the
 *     line is not one of the systems that book itemises, which is a fact about
 *     the book rather than about the line.
 *   bsaTitles — the J-book's own budget sub-activity, as printed in the P-1
 *     ("Combat Aircraft", "Rotary", "Tactical Missiles", "Aircraft Spares and
 *     Repair Parts"). It covers every procurement line, because it is the
 *     structure the exhibit is organised by. The R-1 publishes none.
 */
export async function getExhibitFacets() {
  const organizations = await query<{ key: string; label: string; lines: number; requestK: number }>(
    `SELECT p.component AS key, p.component AS label, count(*)::int AS lines,
            sum(p.latest_request_k) AS "requestK"
       FROM dm_exhibit_program p JOIN dm_load l ON l.id = p.load_id AND l.is_current
      WHERE NOT p.is_memo AND coalesce(p.component,'') <> ''
      GROUP BY 1,2 ORDER BY 4 DESC NULLS LAST`);
  const accounts = await query<{ key: string; label: string; organization: string;
                                 lines: number; requestK: number }>(
    `SELECT p.treasury_account AS key, p.account_title AS label,
            min(p.organization) AS organization, count(*)::int AS lines,
            sum(p.latest_request_k) AS "requestK"
       FROM dm_exhibit_program p JOIN dm_load l ON l.id = p.load_id AND l.is_current
      WHERE NOT p.is_memo
      GROUP BY 1,2 ORDER BY 5 DESC NULLS LAST`);
  const exhibits = await query<{ key: string; lines: number; requestK: number }>(
    `SELECT p.exhibit AS key, count(*)::int AS lines, sum(p.latest_request_k) AS "requestK"
       FROM dm_exhibit_program p JOIN dm_load l ON l.id = p.load_id AND l.is_current
      GROUP BY 1 ORDER BY 1`);
  const facet = (col: string) => query<{ key: string; lines: number; requestK: number }>(
    `SELECT ${col} AS key, count(*)::int AS lines, sum(p.latest_request_k) AS "requestK"
       FROM dm_exhibit_program p JOIN dm_load l ON l.id = p.load_id AND l.is_current
      WHERE NOT p.is_memo AND coalesce(${col}, '') <> ''
      GROUP BY 1 ORDER BY 3 DESC NULLS LAST`);
  const [fundTypes, appropriations, weaponCategories, bsaTitles] = await Promise.all([
    facet('p.fund_type'), facet('p.appropriation'),
    facet('p.weapon_category'), facet('p.bsa_title'),
  ]);
  return { organizations, accounts, exhibits,
           fundTypes, appropriations, weaponCategories, bsaTitles };
}

/**
 * Every weapon system the Department's own book names, grouped by its own
 * category, for the roster's programme picker.
 *
 * `lines` is how many budget lines the evidence-bearing crosswalk ties to the
 * system, and it can be zero: a system whose budget lines carry names no shared
 * designator or phrase reaches is listed with nothing behind it rather than
 * being quietly dropped or matched on a guess.
 */
export async function getWeaponSystemPicker() {
  return query<{ category: string | null; programName: string; pbYear: number;
                 aliases: string | null; lines: number; requestK: number | null }>(
    `WITH newest AS (
        SELECT s.program_name, max(s.pb_year) AS pb_year
          FROM dm_weapon_system s JOIN dm_load l ON l.id = s.load_id AND l.is_current
         GROUP BY 1)
      SELECT s.category, s.program_name AS "programName", s.pb_year AS "pbYear",
             (SELECT string_agg(DISTINCT a.alias, ', ' ORDER BY a.alias)
                FROM dm_weapon_alias a
               WHERE a.load_id = s.load_id AND a.weapon_program = s.program_name) AS aliases,
             (SELECT count(DISTINCT (p.exhibit, p.account, p.bli))::int
                FROM dm_exhibit_program p
               WHERE p.load_id = s.load_id AND p.weapon_program = s.program_name) AS lines,
             (SELECT sum(p.latest_request_k)
                FROM dm_exhibit_program p
               WHERE p.load_id = s.load_id AND p.weapon_program = s.program_name
                 AND NOT p.is_memo) AS "requestK"
        FROM dm_weapon_system s
        JOIN dm_load l ON l.id = s.load_id AND l.is_current
        JOIN newest n ON n.program_name = s.program_name AND n.pb_year = s.pb_year
       ORDER BY s.category, s.program_name`);
}

/* ------------------------------------------ what a whole programme costs ---- */

export interface SystemCostRow {
  pbYear: number; appropriation: string | null; service: string | null;
  rowKind: string; fiscalYear: number; fyRole: FyRole;
  amountM: number | null; quantity: number | null;
  totalBasis: string; coverageNote: string | null;
}

/**
 * The weapons book's own cost table for one system: the same money the -1
 * exhibits itemise line by line, totalled by the Department against the system.
 *
 * row_kind separates what may be added from what may not. `detail` is one
 * service under one appropriation, `subtotal` is the book's own subtotal for
 * that appropriation, `total` is the book's own system total, and `block_check`
 * is the sum of the blocks as extracted — carried only so control WBC-01 can
 * assert the page foots, and never rendered as a figure. Summing across kinds
 * double counts, so every caller names the one it wants.
 */
export async function getSystemCost(programName: string) {
  return query<SystemCostRow>(
    `SELECT x.pb_year AS "pbYear", x.appropriation, x.service, x.row_kind AS "rowKind",
            x.fiscal_year AS "fiscalYear", x.fy_role AS "fyRole",
            x.amount_m AS "amountM", x.quantity, x.total_basis AS "totalBasis",
            x.coverage_note AS "coverageNote"
       FROM dm_weapon_system_cost x JOIN dm_load l ON l.id = x.load_id AND l.is_current
      WHERE x.program_name = $1 AND x.row_kind <> 'block_check'
      ORDER BY x.pb_year, x.fiscal_year, x.appropriation NULLS LAST, x.service NULLS LAST`,
    [programName]);
}

export async function getSystemMeta(programName: string) {
  const rows = await query<{ programName: string; category: string | null;
                             pbYear: number; pageNo: string | null;
                             primeContractor: string | null; coverageNote: string | null;
                             books: number }>(
    `SELECT s.program_name AS "programName", s.category, s.pb_year AS "pbYear",
            s.page_no AS "pageNo", s.prime_contractor AS "primeContractor",
            s.coverage_note AS "coverageNote",
            (SELECT count(DISTINCT s2.pb_year)::int FROM dm_weapon_system s2
              WHERE s2.load_id = s.load_id AND s2.program_name = s.program_name) AS books
       FROM dm_weapon_system s JOIN dm_load l ON l.id = s.load_id AND l.is_current
      WHERE s.program_name = $1
      ORDER BY s.pb_year DESC LIMIT 1`,
    [programName]);
  return rows[0] ?? null;
}

export async function getSystemAliases(programName: string) {
  return query<{ alias: string; matchMethod: string; matchEvidence: string; pbYear: number }>(
    `SELECT DISTINCT ON (a.alias) a.alias, a.match_method AS "matchMethod",
            a.match_evidence AS "matchEvidence", a.pb_year AS "pbYear"
       FROM dm_weapon_alias a JOIN dm_load l ON l.id = a.load_id AND l.is_current
      WHERE a.weapon_program = $1
      ORDER BY a.alias, a.pb_year DESC`,
    [programName]);
}

/**
 * Every budget line the crosswalk ties to one weapon system, rolled up by book
 * year and appropriation, beside the total the Department publishes for the
 * same system and year.
 *
 * The gap between the two is the point of the table, and it is a statement
 * about the CROSSWALK, not about the money: a system's spares, modification and
 * support lines are separate budget lines whose titles often carry no shared
 * designator, so they cannot be tied back on evidence and are not counted here.
 * Control WBC-02 refuses a load where a roll-up EXCEEDS the published total —
 * that would be double counting — and publishes the shortfalls as coverage.
 */
export async function getSystemRollup(programName: string) {
  return query<{ pbYear: number; fiscalYear: number; fyRole: FyRole;
                 fundType: string | null; lines: number; amountK: number;
                 publishedM: number | null }>(
    `WITH rolled AS (
        SELECT w.pb_year, f.fiscal_year, f.fy_role,
               CASE WHEN f.exhibit = 'r1' THEN 'RDT&E' ELSE 'Procurement' END AS fund_type,
               count(DISTINCT (f.exhibit, f.account, f.bli))::int AS lines,
               sum(f.amount_k) AS amount_k
          FROM dm_exhibit_weapon_link w
          JOIN dm_load l ON l.id = w.load_id AND l.is_current
          JOIN dm_exhibit_program_fy f
            ON f.load_id = w.load_id AND f.exhibit = w.exhibit AND f.account = w.account
           AND f.bli = w.bli AND f.pb_year = w.pb_year AND f.is_memo = false
         WHERE w.weapon_program = $1
         GROUP BY 1,2,3,4),
      -- The book's figure for one appropriation block, by the rule the book
      -- itself is laid out to: its Subtotal where one is printed, the block's
      -- own row where the heading carries the figure (the CH-47 page has no
      -- subtotal at all), and otherwise the sum of the services beneath it.
      -- Taking only the Subtotal row silently returns nothing for a third of
      -- these pages.
      block AS (
        SELECT c.pb_year, c.fiscal_year,
               CASE WHEN c.appropriation ILIKE '%RDT%' THEN 'RDT&E' ELSE 'Procurement' END
                 AS fund_type,
               coalesce(
                 max(c.amount_m) FILTER (WHERE c.row_kind = 'subtotal'),
                 max(c.amount_m) FILTER (WHERE c.row_kind = 'detail' AND c.service IS NULL),
                 sum(c.amount_m) FILTER (WHERE c.row_kind = 'detail' AND c.service IS NOT NULL)
               ) AS amount_m
          FROM dm_weapon_system_cost c
          JOIN dm_load l ON l.id = c.load_id AND l.is_current
         WHERE c.program_name = $1 AND c.appropriation IS NOT NULL
         GROUP BY c.pb_year, c.fiscal_year, c.appropriation)
      SELECT r.pb_year AS "pbYear", r.fiscal_year AS "fiscalYear", r.fy_role AS "fyRole",
             r.fund_type AS "fundType", r.lines, r.amount_k AS "amountK",
             (SELECT sum(b.amount_m) FROM block b
               WHERE b.pb_year = r.pb_year AND b.fiscal_year = r.fiscal_year
                 AND b.fund_type = r.fund_type) AS "publishedM"
        FROM rolled r
       ORDER BY r.pb_year, r.fiscal_year, r.fund_type`,
    [programName]);
}

/** Every budget line tied to one weapon system, for the system view's table. */
export async function getSystemLines(programName: string) {
  return query<ExhibitProgram & { matchMethod: string; matchEvidence: string }>(
    `SELECT ${EXHIBIT_PROGRAM_COLS},
            w.match_method AS "matchMethod", w.match_evidence AS "matchEvidence"
       FROM dm_exhibit_program p
       JOIN dm_load l ON l.id = p.load_id AND l.is_current
       JOIN LATERAL (
         SELECT match_method, match_evidence FROM dm_exhibit_weapon_link w2
          WHERE w2.load_id = p.load_id AND w2.exhibit = p.exhibit
            AND w2.account = p.account AND w2.bli = p.bli
            AND w2.weapon_program = $1
          ORDER BY w2.pb_year DESC LIMIT 1) w ON true
      WHERE p.weapon_program = $1
      ORDER BY p.latest_request_k DESC NULLS LAST, p.program_name`,
    [programName]);
}

export async function getExhibitProgram(exhibit: string, account: string, bli: string) {
  const rows = await query<ExhibitProgram>(
    `SELECT ${EXHIBIT_PROGRAM_COLS}
       FROM dm_exhibit_program p JOIN dm_load l ON l.id = p.load_id AND l.is_current
      WHERE p.exhibit = $1 AND p.account = $2 AND p.bli = $3 LIMIT 1`,
    [exhibit, account, bli]);
  return rows[0] ?? null;
}

/**
 * The restatement matrix for one budget line: every book, every fiscal year,
 * every role. This is the whole point of holding eight books rather than one.
 */
export async function getExhibitRestatement(
  exhibit: string, account: string, bli: string, includeMemo = false,
): Promise<ExhibitRestatement[]> {
  return query<ExhibitRestatement>(
    `SELECT f.pb_year AS "pbYear", f.fiscal_year AS "fiscalYear", f.fy_role AS "fyRole",
            f.amount_k AS "amountK", f.quantity, f.cost_type_count AS "costTypeCount",
            f.total_basis AS "totalBasis", f.is_memo AS "isMemo"
       FROM dm_exhibit_program_fy f JOIN dm_load l ON l.id = f.load_id AND l.is_current
      WHERE f.exhibit = $1 AND f.account = $2 AND f.bli = $3
        AND ($4::boolean OR NOT f.is_memo)
      ORDER BY f.fiscal_year, f.pb_year`,
    [exhibit, account, bli, includeMemo]);
}

/** The cost types behind one cell of the matrix — what the exhibit page shows. */
export async function getExhibitCostTypes(
  exhibit: string, account: string, bli: string, pbYear: number, fiscalYear: number,
) {
  return query<{ costType: string | null; costTypeTitle: string | null; amountK: number;
                 quantity: number; totalColumn: string | null; totalBasis: string;
                 isMemo: boolean; bsaTitle: string | null; lineNumber: string | null }>(
    `SELECT x.cost_type AS "costType", x.cost_type_title AS "costTypeTitle",
            x.amount_k AS "amountK", x.quantity, x.total_column AS "totalColumn",
            x.total_basis AS "totalBasis", x.is_memo AS "isMemo",
            x.bsa_title AS "bsaTitle", x.line_number AS "lineNumber"
       FROM dm_exhibit_line x JOIN dm_load l ON l.id = x.load_id AND l.is_current
      WHERE x.exhibit = $1 AND x.account = $2 AND x.bli = $3
        AND x.pb_year = $4 AND x.fiscal_year = $5
      ORDER BY x.is_memo, x.amount_k DESC`,
    [exhibit, account, bli, pbYear, fiscalYear]);
}

/** Department-wide totals by book, fiscal year and role — the roster header. */
export async function getExhibitTotals() {
  return query<{ exhibit: string; pbYear: number; fiscalYear: number; fyRole: FyRole;
                 amountK: number; lines: number }>(
    `SELECT f.exhibit, f.pb_year AS "pbYear", f.fiscal_year AS "fiscalYear",
            f.fy_role AS "fyRole", sum(f.amount_k) AS "amountK", count(*)::int AS lines
       FROM dm_exhibit_program_fy f JOIN dm_load l ON l.id = f.load_id AND l.is_current
      WHERE NOT f.is_memo
      GROUP BY 1,2,3,4 ORDER BY 1,3,2`);
}

/** What the Department publishes for the same request, and what we extracted. */
export async function getExhibitTieouts() {
  return query<{ pbYear: number; measure: string; exhibit: string | null;
                 publishedB: number; citation: string; extractedB: number | null }>(
    `SELECT t.pb_year AS "pbYear", t.measure, t.exhibit,
            t.published_b AS "publishedB", t.citation,
            CASE WHEN t.exhibit IS NULL THEN NULL ELSE (
              SELECT sum(f.amount_k) / 1e6 FROM dm_exhibit_program_fy f
               WHERE f.load_id = t.load_id AND f.pb_year = t.pb_year
                 AND f.exhibit = t.exhibit AND f.fy_role = 'request' AND NOT f.is_memo)
            END AS "extractedB"
       FROM dm_exhibit_tieout t JOIN dm_load l ON l.id = t.load_id AND l.is_current
      ORDER BY t.pb_year, t.measure`);
}

/** The Department's own answer to "is this a major program", by book year. */
export async function getWeaponLinks(exhibit: string, account: string, bli: string) {
  return query<{ pbYear: number; weaponProgram: string; weaponCategory: string | null;
                 weaponPage: string | null; matchMethod: string; matchEvidence: string }>(
    `SELECT w.pb_year AS "pbYear", w.weapon_program AS "weaponProgram",
            w.weapon_category AS "weaponCategory", w.weapon_page AS "weaponPage",
            w.match_method AS "matchMethod", w.match_evidence AS "matchEvidence"
       FROM dm_exhibit_weapon_link w JOIN dm_load l ON l.id = w.load_id AND l.is_current
      WHERE w.exhibit = $1 AND w.account = $2 AND w.bli = $3
      ORDER BY w.pb_year DESC`,
    [exhibit, account, bli]);
}

export async function getWeaponSystems(pbYear?: number) {
  return query<{ pbYear: number; programName: string; category: string | null;
                 pageNo: string | null; linkedLines: number }>(
    `SELECT s.pb_year AS "pbYear", s.program_name AS "programName", s.category,
            s.page_no AS "pageNo",
            (SELECT count(*)::int FROM dm_exhibit_weapon_link w
              WHERE w.load_id = s.load_id AND w.pb_year = s.pb_year
                AND w.weapon_program = s.program_name) AS "linkedLines"
       FROM dm_weapon_system s JOIN dm_load l ON l.id = s.load_id AND l.is_current
      WHERE ($1::int IS NULL OR s.pb_year = $1)
      ORDER BY s.pb_year DESC, s.category, s.page_no`,
    [pbYear ?? null]);
}

/* ------------------------------------------------- budget -> execution ---- */

/**
 * File A for the Treasury account a budget line is appropriated into. This is
 * the first step out of the budget and into execution, and it is an ACCOUNT
 * figure, not a line-item one: several budget lines share one account and File A
 * states no split between them. Nothing here apportions one.
 */
export async function getAccountExecution(treasuryAccount: string) {
  return query<{ fiscalYear: number; label: string; totalBudgetaryResources: number;
                 obligationsIncurred: number; unobligatedBalance: number;
                 grossOutlays: number; rankInDim: number; submissionPeriod: string | null;
                 isPartialYear: boolean }>(
    `SELECT d.fiscal_year AS "fiscalYear", d.dim_label AS label,
            d.total_budgetary_resources AS "totalBudgetaryResources",
            d.obligations_incurred AS "obligationsIncurred",
            d.unobligated_balance AS "unobligatedBalance",
            d.gross_outlays AS "grossOutlays", d.rank_in_dim AS "rankInDim",
            s.submission_period AS "submissionPeriod", s.is_partial_year AS "isPartialYear"
       FROM dm_sbr_dim d
       JOIN dm_load l ON l.id = d.load_id AND l.is_current
       LEFT JOIN dm_sbr_fy s ON s.load_id = d.load_id AND s.fiscal_year = d.fiscal_year
                            AND s.scope = 'DOW'
      WHERE d.dimension = 'federal_account' AND d.dim_key = $1 AND d.scope = 'DOW'
      ORDER BY d.fiscal_year`,
    [treasuryAccount]);
}

/**
 * The FPDS acquisition program codes a budget line reaches, and on what
 * evidence. A link means the two names refer to the same system — it does not
 * assert that this line's appropriation funded those contracts.
 */
export async function getProgramLinks(exhibit: string, account: string, bli: string) {
  return query<{ programCode: string; programName: string; isFeatured: boolean;
                 matchMethod: string; matchEvidence: string }>(
    `SELECT x.program_code AS "programCode", x.program_name AS "programName",
            x.is_featured AS "isFeatured", x.match_method AS "matchMethod",
            x.match_evidence AS "matchEvidence"
       FROM dm_exhibit_program_link x JOIN dm_load l ON l.id = x.load_id AND l.is_current
      WHERE x.exhibit = $1 AND x.account = $2 AND x.bli = $3
      ORDER BY x.is_featured DESC, x.program_code`,
    [exhibit, account, bli]);
}

/** Which budget lines reach a given FPDS program code — the reverse direction. */
export async function getLinesForProgramCode(programCode: string) {
  return query<{ exhibit: string; account: string; bli: string; bliTitle: string;
                 treasuryAccount: string | null; matchMethod: string; matchEvidence: string }>(
    `SELECT x.exhibit, x.account, x.bli, x.bli_title AS "bliTitle",
            x.treasury_account AS "treasuryAccount",
            x.match_method AS "matchMethod", x.match_evidence AS "matchEvidence"
       FROM dm_exhibit_program_link x JOIN dm_load l ON l.id = x.load_id AND l.is_current
      WHERE x.program_code = $1 ORDER BY x.exhibit, x.account, x.bli`,
    [programCode]);
}

/**
 * Contract account sets naming this Treasury account, across the acquisition
 * programs the contract file is cut by. The obligation on an action is never
 * split across the accounts named on it, so these are actions that NAMED the
 * account, not dollars drawn from it.
 */
export async function getAccountContracts(treasuryAccount: string, fiscalYear: number, limit = 10) {
  return query<{ programCode: string; programName: string; accountSet: string;
                 accountCount: number; obligation: number; actionCount: number }>(
    `SELECT a.program_code AS "programCode", d.program_name AS "programName",
            a.account_set AS "accountSet", a.account_count AS "accountCount",
            a.obligation, a.action_count AS "actionCount"
       FROM dm_program_account a
       JOIN dm_load l ON l.id = a.load_id AND l.is_current
       LEFT JOIN dm_program_dim d ON d.load_id = a.load_id AND d.program_code = a.program_code
      WHERE a.fiscal_year = $2
        AND ($1 = ANY (string_to_array(a.account_set, ';')))
      ORDER BY a.obligation DESC LIMIT $3`,
    [treasuryAccount, fiscalYear, limit]);
}

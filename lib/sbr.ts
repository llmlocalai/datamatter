/**
 * Data layer for the SBR assurance programme (/sbr).
 *
 * Same contract as the rest of `lib/analytics.ts`: nothing returns a figure
 * without the load that produced it. The one departure is the two user-owned
 * tables -- case state and case events are entered by people, not by a load, so
 * they carry no `load_id` and are read without joining `dm_load`. Joining it
 * there would return zero rows and report a case with a full remediation record
 * as untouched, which is the same defect `/controls` had with
 * `dm_control_result`.
 */
import { query as rawQuery } from './db';

const SCOPE = 'DOW';

async function query<T = any>(text: string, params?: unknown[]): Promise<T[]> {
  try {
    return await rawQuery<T>(text, params);
  } catch (e: any) {
    // Before the first load the dm_sbr_* tables do not exist. That is a
    // legitimate empty state; anything else still throws.
    if (e?.code === '42P01') return [];
    throw e;
  }
}

export interface SbrTest {
  code: string; name: string; kind: 'exception' | 'assurance' | 'not_testable';
  assertion: string; risk: string; criterion: string; method: string;
  severity: string; exposureBasis: string; limitation: string | null;
}

export async function getSbrTests() {
  return query<SbrTest>(
    `SELECT code, name, kind, assertion, risk, criterion, method, severity,
            exposure_basis AS "exposureBasis", limitation
       FROM dm_sbr_test ORDER BY sort_order`);
}

export async function getSbrCharter() {
  return query<{ element: string; value: string; basis: string; citation: string }>(
    `SELECT element, value, basis, citation
       FROM dm_sbr_charter c JOIN dm_load l ON l.id = c.load_id AND l.is_current
      ORDER BY c.sort_order`);
}

export async function getSbrYears() {
  return query<{ fiscalYear: number; isPartialYear: boolean; submissionPeriod: string | null }>(
    `SELECT DISTINCT fiscal_year AS "fiscalYear", is_partial_year AS "isPartialYear",
            submission_period AS "submissionPeriod"
       FROM dm_sbr_run r JOIN dm_load l ON l.id = r.load_id AND l.is_current
      ORDER BY fiscal_year`);
}

export async function getSbrRuns(fiscalYear?: number) {
  return query<{ testCode: string; fiscalYear: number; kind: string; name: string;
                 severity: string; assertion: string; population: number; exceptions: number;
                 exposure: number; populationAmount: number; isPartialYear: boolean }>(
    `SELECT r.test_code AS "testCode", r.fiscal_year AS "fiscalYear", t.kind, t.name,
            t.severity, t.assertion, r.population, r.exceptions, r.exposure,
            r.population_amount AS "populationAmount", r.is_partial_year AS "isPartialYear"
       FROM dm_sbr_run r
       JOIN dm_load l ON l.id = r.load_id AND l.is_current
       JOIN dm_sbr_test t ON t.code = r.test_code
      WHERE ($1::int IS NULL OR r.fiscal_year = $1)
      ORDER BY t.sort_order, r.fiscal_year`, [fiscalYear ?? null]);
}

export async function getSbrConfidence(fiscalYear: number) {
  return query<{ metricKey: string; metricLabel: string; valuePct: number | null;
                 detail: string; isBlocking: boolean }>(
    `SELECT metric_key AS "metricKey", metric_label AS "metricLabel",
            value_pct AS "valuePct", detail, is_blocking AS "isBlocking"
       FROM dm_sbr_confidence c JOIN dm_load l ON l.id = c.load_id AND l.is_current
      WHERE fiscal_year = $1 ORDER BY sort_order`, [fiscalYear]);
}

export interface SbrCase {
  caseKey: string; fiscalYear: number; treasuryAccount: string; accountName: string | null;
  federalAccount: string | null; agencyCode: string | null; fundLife: string | null;
  bpoa: number | null; epoa: number | null; obligations: number; totalResources: number;
  exceptionCount: number; testCodes: string; maxSeverity: string; exposure: number;
  riskScore: number; tier: number; recurrenceYears: number; anomalyZ: number | null;
  state: string | null; ownerOrg: string | null; dueDate: string | null;
  rootCause: string | null; correctiveAction: string | null;
  remediatedAt: string | null; closedAt: string | null; updatedAt: string | null;
}

const CASE_SELECT = `
  c.case_key AS "caseKey", c.fiscal_year AS "fiscalYear",
  c.treasury_account AS "treasuryAccount", c.account_name AS "accountName",
  c.federal_account AS "federalAccount", c.agency_code AS "agencyCode",
  c.fund_life AS "fundLife", c.bpoa, c.epoa, c.obligations,
  c.total_resources AS "totalResources", c.exception_count AS "exceptionCount",
  c.test_codes AS "testCodes", c.max_severity AS "maxSeverity", c.exposure,
  c.risk_score AS "riskScore", c.tier, c.recurrence_years AS "recurrenceYears",
  c.anomaly_z AS "anomalyZ",
  s.state, s.owner_org AS "ownerOrg", s.due_date AS "dueDate",
  s.root_cause AS "rootCause", s.corrective_action AS "correctiveAction",
  s.remediated_at AS "remediatedAt", s.closed_at AS "closedAt", s.updated_at AS "updatedAt"`;

export async function getSbrCases(fiscalYear: number, limit = 60) {
  return query<SbrCase>(
    `SELECT ${CASE_SELECT}
       FROM dm_sbr_case c
       JOIN dm_load l ON l.id = c.load_id AND l.is_current
       LEFT JOIN dm_sbr_case_state s ON s.case_key = c.case_key
      WHERE c.fiscal_year = $1
      ORDER BY c.risk_score DESC, c.exposure DESC LIMIT $2`, [fiscalYear, limit]);
}

export async function getSbrCase(caseKey: string) {
  const rows = await query<SbrCase>(
    `SELECT ${CASE_SELECT}
       FROM dm_sbr_case c
       JOIN dm_load l ON l.id = c.load_id AND l.is_current
       LEFT JOIN dm_sbr_case_state s ON s.case_key = c.case_key
      WHERE c.case_key = $1 LIMIT 1`, [caseKey]);
  return rows[0] ?? null;
}

export async function getSbrCaseKeys(limit = 400) {
  return query<{ caseKey: string }>(
    `SELECT c.case_key AS "caseKey" FROM dm_sbr_case c
       JOIN dm_load l ON l.id = c.load_id AND l.is_current
      ORDER BY c.risk_score DESC LIMIT $1`, [limit]);
}

export async function getSbrCaseFactors(caseKey: string) {
  return query<{ factor: string; points: number; maxPoints: number; detail: string }>(
    `SELECT factor, points, max_points AS "maxPoints", detail
       FROM dm_sbr_case_factor f JOIN dm_load l ON l.id = f.load_id AND l.is_current
      WHERE case_key = $1 ORDER BY sort_order`, [caseKey]);
}

export async function getSbrExceptions(caseKey: string) {
  return query<{ testCode: string; name: string; assertion: string; criterion: string;
                 severity: string; exposure: number; detail: string; evidenceJson: string;
                 exposureBasis: string }>(
    `SELECT e.test_code AS "testCode", t.name, t.assertion, t.criterion, t.severity,
            e.exposure, e.detail, e.evidence_json AS "evidenceJson",
            t.exposure_basis AS "exposureBasis"
       FROM dm_sbr_exception e
       JOIN dm_load l ON l.id = e.load_id AND l.is_current
       JOIN dm_sbr_test t ON t.code = e.test_code
      WHERE e.case_key = $1 ORDER BY t.sort_order`, [caseKey]);
}

/** The account's own six-year position. Context an investigator asks for first. */
export async function getSbrAccountHistory(treasuryAccount: string) {
  return query<{ fiscalYear: number; submissionPeriod: string | null;
                 totalResources: number; obligations: number; unobligated: number;
                 grossOutlays: number; exceptions: number }>(
    `SELECT r.fiscal_year AS "fiscalYear", r.submission_period AS "submissionPeriod",
            r.total_budgetary_resources AS "totalResources",
            r.obligations_incurred AS obligations,
            r.unobligated_balance AS unobligated, r.gross_outlays AS "grossOutlays",
            (SELECT count(*)::int FROM dm_sbr_exception e
              WHERE e.load_id = r.load_id AND e.treasury_account = r.treasury_account
                AND e.fiscal_year = r.fiscal_year) AS exceptions
       FROM dm_exec_resource r JOIN dm_load l ON l.id = r.load_id AND l.is_current
      WHERE r.treasury_account = $1 AND r.scope = $2
      ORDER BY r.fiscal_year`, [treasuryAccount, SCOPE]);
}

export async function getSbrEvents(caseKey: string) {
  return query<{ seq: number; kind: string; actionCode: string | null; actor: string;
                 modelLink: string | null; summary: string; payload: string | null;
                 createdAt: string }>(
    `SELECT seq, kind, action_code AS "actionCode", actor, model_link AS "modelLink",
            summary, payload, created_at AS "createdAt"
       FROM dm_sbr_case_event WHERE case_key = $1 ORDER BY seq DESC`, [caseKey]);
}

/**
 * Remediation validation. Exception count and exposure for a test across every
 * load that has run it -- the before-and-after that decides whether a
 * corrective action changed anything, rather than whether a plan completed.
 */
export async function getSbrTestTrend() {
  return query<{ testCode: string; fiscalYear: number; exceptions: number;
                 exposure: number; population: number; isPartialYear: boolean }>(
    `SELECT r.test_code AS "testCode", r.fiscal_year AS "fiscalYear", r.exceptions,
            r.exposure, r.population, r.is_partial_year AS "isPartialYear"
       FROM dm_sbr_run r JOIN dm_load l ON l.id = r.load_id AND l.is_current
       JOIN dm_sbr_test t ON t.code = r.test_code AND t.kind = 'exception'
      ORDER BY r.test_code, r.fiscal_year`);
}

export async function getSbrQueueSummary(fiscalYear: number) {
  const rows = await query<{ tier: number; cases: number; exposure: number;
                             open: number; closed: number }>(
    `SELECT c.tier, count(*)::int AS cases, COALESCE(sum(c.exposure),0) AS exposure,
            count(*) FILTER (WHERE COALESCE(s.state,'open') NOT IN ('closed','accepted_risk'))::int AS open,
            count(*) FILTER (WHERE s.state IN ('closed','accepted_risk'))::int AS closed
       FROM dm_sbr_case c
       JOIN dm_load l ON l.id = c.load_id AND l.is_current
       LEFT JOIN dm_sbr_case_state s ON s.case_key = c.case_key
      WHERE c.fiscal_year = $1 GROUP BY c.tier ORDER BY c.tier`, [fiscalYear]);
  return rows;
}

/** The material-weakness object this programme exists to work on. */
export async function getSbrLinkedWeakness() {
  const el = await query<{ elementNo: number; elementName: string; elementText: string;
                           basis: string; citation: string }>(
    `SELECT element_no AS "elementNo", element_name AS "elementName",
            element_text AS "elementText", basis, citation
       FROM dm_nfr_element e JOIN dm_load l ON l.id = e.load_id AND l.is_current
      WHERE mw_key = 'budgetary' ORDER BY element_no`);
  return el;
}

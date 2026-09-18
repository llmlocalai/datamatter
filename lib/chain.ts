/**
 * The funds-distribution chain and the execution lag.
 *
 * The unit is (fiscal year x component x colour of money) for the year's OWN
 * appropriation -- programme year equal to fiscal year. A fiscal year's File A
 * holds every programme year still executing in it, and a lag measured across
 * that mixture answers nothing a programme office asks.
 *
 * FOUR BASES, NEVER MIXED. Every figure this module returns belongs to exactly
 * one of them, and the page prints which:
 *
 *   measured, complete   File A and File B: budget authority, resources,
 *                        obligations, outlays, by object class. Every dollar --
 *                        and one submission a fiscal year, so no within-year
 *                        timing exists in them at all.
 *   measured, dated      enactment, continuing-resolution and lapse dates, each
 *                        cited to its public law.
 *   measured, censored   the execution ramp, from contract action dates against
 *                        accounts. An UPPER BOUND on how early money moved: only
 *                        1-6% of current-year dollars name their Treasury
 *                        account, and the attribution is award-level rather than
 *                        action-level. An earlier obligation that named no
 *                        account is invisible here.
 *   assumed              the interior of the distribution chain. Apportionment,
 *                        allocation, allotment and sub-allotment are published in
 *                        NO file available here. Only the endpoints are observed
 *                        and the interior divides a measured residual.
 *
 * Nothing assumed is ever added to anything measured, and CHN-03 blocks a load
 * where a unit assigns days to a step it never waited on.
 */
import { query } from './db';
import { missingColumns } from './schema';

export type UnitLevel = 'department' | 'component' | 'cell';

export type ChainUnit = {
  fiscalYear: number; agencyCode: string; agencyName: string | null;
  appropriation: string; level: UnitLevel;
  fundLife: string | null; accounts: number;
  baAppropriated: number; resources: number; obligations: number;
  outlays: number; unobligated: number;
};

export type ChainAuthority = {
  fiscalYear: number; agencyCode: string; appropriation: string; seq: number;
  eventDate: string; dayOfFy: number; state: 'lapse' | 'cr' | 'enacted';
  authorityAvailable: number; basis: 'measured' | 'derived';
  publicLaw: string | null; note: string | null;
};

export type ChainFirst = {
  fiscalYear: number; agencyCode: string; appropriation: string;
  ocGroup: string; ocLabel: string; firstDate: string | null; dayOfFy: number | null;
  d10Day: number | null; d50Day: number | null; d90Day: number | null;
  observedToDay: number | null; cmpDay: number | null;
  d10Cmp: number | null; d50Cmp: number | null; cmpAmount: number; cmpYears: number;
  daysFromEnactment: number | null; actions: number;
  sampleAmount: number; positiveAmount: number; ocFromFilePct: number | null;
};

export type ChainOc = {
  fiscalYear: number; agencyCode: string; appropriation: string;
  ocGroup: string; ocLabel: string; fundingSource: string | null;
  obligations: number; outlays: number; undelivered: number;
};

/** One step of one chain. `mode` says which chain: 'cr' is the one that runs
 *  while a continuing resolution is in force, where OMB has already apportioned
 *  automatically; 'enacted' is the full chain that runs from a full-year act. */
export type ChainLag = {
  fiscalYear: number; agencyCode: string; appropriation: string; level: UnitLevel;
  stepKey: string; stepLabel: string; actor: string | null; stepDetail: string | null;
  authority: string | null;
  basis: 'measured' | 'statutory' | 'regulatory' | 'practitioner';
  applies: boolean;
  minDays: number | null; likelyDays: number | null; maxDays: number | null;
  mode: 'cr' | 'enacted'; anchorDay: number | null; anchorLabel: string | null;
  modelMin: number | null; modelLikely: number | null; modelMax: number | null;
  regCeilingDays: number | null;
  observedGap: number | null;
  verdict: 'ahead_of_chain' | 'within_model' | 'beyond_model' | 'not_observed' | null;
  excessDays: number | null;
  applicable: boolean;
  residualDays: number | null; totalDays: number | null;
  authorityDayOfFy: number | null; gapToAuthority: number | null;
  d10Day: number | null; d50Day: number | null; d90Day: number | null;
  postEnactmentD10: number | null;
  sampleAmount: number; sampleActions: number;
  firstActionDay: number | null; enactedDayOfFy: number | null;
  firstObligationDate: string | null; firstOcLabel: string | null;
};

export type ChainArchetype = {
  fiscalYear: number; agencyCode: string; appropriation: string;
  archetypeKey: string; archetypeLabel: string; cluster: number; clusterSize: number;
  shape: number[]; centroid: number[]; halfByMonth: number | null; windowDays: number | null;
};

export type ChainAnomaly = {
  fiscalYear: number; agencyCode: string; appropriation: string; metric: string;
  value: number | null; baseline: number | null; deviation: number | null;
  baselineYears: number; direction: string | null; windowDays: number | null;
  sampleAmount: number | null; priorMedianAmount: number | null;
  headline: string; method: string;
};

export type LegislativeGate = {
  fiscalYear: number | null; gateKey: string; gateType: string; scopeLabel: string;
  treasuryAccount: string | null; days: number | null;
  barsObligation: boolean; isVerbatim: boolean;
  requirement: string; citation: string | null; authority: string | null; note: string | null;
  scopeBa: number | null; scopeResources: number | null; scopeObligations: number | null;
  scopeYears: number[]; scopeBasis: string | null;
};

export type ChainSensitivity = {
  agencyCode: string; agencyName: string | null; appropriation: string;
  metric: 'd10' | 'd50'; level: UnitLevel; profile: string | null;
  comparisonWindowDays: number; years: number;
  slopeDaysPerCrDay: number | null; daysPer30CrDays: number | null;
  observations: { fy: number; crDays: number; lapseDays: number;
                  d10: number; d50: number; amount: number }[];
};

const CUR = (a: string) => `JOIN dm_load l ON l.id = ${a}.load_id AND l.is_current`;

/**
 * Migrated AND loaded. Both halves, and neither falls back: a database with the
 * columns and no rows would read as a Department that obligated nothing.
 */
export async function chainReady(): Promise<boolean> {
  try {
    const missing = await Promise.all([
      missingColumns('dm_chain_unit', ['ba_appropriated', 'appropriation']),
      missingColumns('dm_chain_authority', ['state', 'authority_available']),
      missingColumns('dm_chain_lag', ['gap_to_authority', 'applicable', 'mode',
                                      'model_min', 'verdict', 'level']),
      missingColumns('dm_chain_archetype', ['archetype_key', 'centroid_json']),
      missingColumns('dm_legislative_gate', ['bars_obligation', 'is_verbatim']),
      missingColumns('dm_chain_sensitivity', ['days_per_30_cr_days', 'observations']),
    ]);
    if (missing.some((m) => m.length)) return false;
    const r = await query<{ n: number }>(
      `SELECT count(*)::int AS n FROM dm_chain_unit u
         JOIN dm_load l ON l.id = u.load_id AND l.is_current`);
    return (r[0]?.n ?? 0) > 0;
  } catch { return false; }
}

function iso(d: Date | string | null): string | null {
  if (d === null) return null;
  return typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10);
}

export async function getChainUnits(fiscalYear?: number): Promise<ChainUnit[]> {
  const p: any[] = []; let w = '';
  if (fiscalYear) { p.push(fiscalYear); w = 'WHERE u.fiscal_year = $1'; }
  const rows = await query<any>(
    `SELECT u.fiscal_year, u.agency_code, u.agency_name, u.appropriation, u.fund_life,
            u.level, u.accounts, u.ba_appropriated, u.resources, u.obligations,
            u.outlays, u.unobligated
       FROM dm_chain_unit u ${CUR('u')} ${w}
      ORDER BY u.fiscal_year, u.obligations DESC`, p);
  return rows.map((r) => ({
    fiscalYear: r.fiscal_year, agencyCode: r.agency_code, agencyName: r.agency_name,
    appropriation: r.appropriation, level: r.level, fundLife: r.fund_life,
    accounts: r.accounts,
    baAppropriated: r.ba_appropriated, resources: r.resources, obligations: r.obligations,
    outlays: r.outlays, unobligated: r.unobligated,
  }));
}

export async function getChainAuthority(
  fiscalYear?: number, agencyCode?: string, appropriation?: string,
): Promise<ChainAuthority[]> {
  const w: string[] = []; const p: any[] = [];
  if (fiscalYear) { p.push(fiscalYear); w.push(`a.fiscal_year = $${p.length}`); }
  if (agencyCode) { p.push(agencyCode); w.push(`a.agency_code = $${p.length}`); }
  if (appropriation) { p.push(appropriation); w.push(`a.appropriation = $${p.length}`); }
  const rows = await query<any>(
    `SELECT a.fiscal_year, a.agency_code, a.appropriation, a.seq, a.event_date, a.day_of_fy,
            a.state, a.authority_available, a.basis, a.public_law, a.note
       FROM dm_chain_authority a ${CUR('a')}
      ${w.length ? `WHERE ${w.join(' AND ')}` : ''}
      ORDER BY a.fiscal_year, a.agency_code, a.appropriation, a.seq`, p);
  return rows.map((r) => ({
    fiscalYear: r.fiscal_year, agencyCode: r.agency_code, appropriation: r.appropriation,
    seq: r.seq, eventDate: iso(r.event_date) as string, dayOfFy: r.day_of_fy,
    state: r.state, authorityAvailable: r.authority_available, basis: r.basis,
    publicLaw: r.public_law, note: r.note,
  }));
}

export async function getChainFirst(
  fiscalYear?: number, agencyCode?: string, appropriation?: string,
): Promise<ChainFirst[]> {
  const w: string[] = []; const p: any[] = [];
  if (fiscalYear) { p.push(fiscalYear); w.push(`f.fiscal_year = $${p.length}`); }
  if (agencyCode) { p.push(agencyCode); w.push(`f.agency_code = $${p.length}`); }
  if (appropriation) { p.push(appropriation); w.push(`f.appropriation = $${p.length}`); }
  const rows = await query<any>(
    `SELECT f.fiscal_year, f.agency_code, f.appropriation, f.oc_group, f.oc_label,
            f.first_date, f.day_of_fy, f.d10_day, f.d50_day, f.d90_day, f.observed_to_day,
            f.cmp_day, f.d10_cmp, f.d50_cmp, f.cmp_amount, f.cmp_years,
            f.days_from_enactment, f.actions, f.sample_amount, f.positive_amount,
            f.oc_from_file_pct
       FROM dm_chain_first f ${CUR('f')}
      ${w.length ? `WHERE ${w.join(' AND ')}` : ''}
      ORDER BY f.fiscal_year, f.agency_code, f.appropriation, f.d50_day NULLS LAST`, p);
  return rows.map((r) => ({
    fiscalYear: r.fiscal_year, agencyCode: r.agency_code, appropriation: r.appropriation,
    ocGroup: r.oc_group, ocLabel: r.oc_label, firstDate: iso(r.first_date),
    dayOfFy: r.day_of_fy, d10Day: r.d10_day, d50Day: r.d50_day, d90Day: r.d90_day,
    observedToDay: r.observed_to_day, cmpDay: r.cmp_day, d10Cmp: r.d10_cmp,
    d50Cmp: r.d50_cmp, cmpAmount: r.cmp_amount, cmpYears: r.cmp_years,
    daysFromEnactment: r.days_from_enactment, actions: r.actions,
    sampleAmount: r.sample_amount, positiveAmount: r.positive_amount,
    ocFromFilePct: r.oc_from_file_pct,
  }));
}

/** The complete dimensional table. Every dollar, and no timing in it. */
export async function getChainOc(
  fiscalYear?: number, agencyCode?: string, appropriation?: string,
): Promise<ChainOc[]> {
  const w: string[] = ["(o.funding_source = 'D' OR o.funding_source IS NULL)"];
  const p: any[] = [];
  if (fiscalYear) { p.push(fiscalYear); w.push(`o.fiscal_year = $${p.length}`); }
  if (agencyCode) { p.push(agencyCode); w.push(`o.agency_code = $${p.length}`); }
  if (appropriation) { p.push(appropriation); w.push(`o.appropriation = $${p.length}`); }
  const rows = await query<any>(
    `SELECT o.fiscal_year, o.agency_code, o.appropriation, o.oc_group, o.oc_label,
            o.funding_source, o.obligations, o.outlays, o.undelivered
       FROM dm_chain_oc o ${CUR('o')}
      WHERE ${w.join(' AND ')}
      ORDER BY o.fiscal_year, o.obligations DESC`, p);
  return rows.map((r) => ({
    fiscalYear: r.fiscal_year, agencyCode: r.agency_code, appropriation: r.appropriation,
    ocGroup: r.oc_group, ocLabel: r.oc_label, fundingSource: r.funding_source,
    obligations: r.obligations, outlays: r.outlays, undelivered: r.undelivered,
  }));
}

export async function getChainLag(
  fiscalYear?: number, agencyCode?: string, appropriation?: string,
): Promise<ChainLag[]> {
  const w: string[] = []; const p: any[] = [];
  if (fiscalYear) { p.push(fiscalYear); w.push(`x.fiscal_year = $${p.length}`); }
  if (agencyCode) { p.push(agencyCode); w.push(`x.agency_code = $${p.length}`); }
  if (appropriation) { p.push(appropriation); w.push(`x.appropriation = $${p.length}`); }
  const rows = await query<any>(
    `SELECT x.fiscal_year, x.agency_code, x.appropriation, x.level, x.step_key, x.step_label,
            x.actor, x.step_detail, x.authority, x.basis, x.applies,
            x.min_days, x.likely_days, x.max_days, x.mode, x.anchor_day, x.anchor_label,
            x.model_min, x.model_likely, x.model_max, x.reg_ceiling_days,
            x.observed_gap, x.verdict, x.excess_days,
            x.applicable, x.residual_days, x.total_days,
            x.authority_day_of_fy, x.gap_to_authority, x.d10_day, x.d50_day, x.d90_day,
            x.post_enactment_d10, x.sample_amount, x.sample_actions, x.first_action_day,
            x.enacted_day_of_fy, x.first_obligation_date, x.first_oc_label
       FROM dm_chain_lag x ${CUR('x')}
      ${w.length ? `WHERE ${w.join(' AND ')}` : ''}
      ORDER BY x.fiscal_year, x.agency_code, x.appropriation, x.mode, x.id`, p);
  return rows.map((r) => ({
    fiscalYear: r.fiscal_year, agencyCode: r.agency_code, appropriation: r.appropriation,
    level: r.level, stepKey: r.step_key, stepLabel: r.step_label, actor: r.actor,
    stepDetail: r.step_detail, authority: r.authority, basis: r.basis, applies: r.applies,
    minDays: r.min_days, likelyDays: r.likely_days, maxDays: r.max_days,
    mode: r.mode, anchorDay: r.anchor_day, anchorLabel: r.anchor_label,
    modelMin: r.model_min, modelLikely: r.model_likely, modelMax: r.model_max,
    regCeilingDays: r.reg_ceiling_days, observedGap: r.observed_gap,
    verdict: r.verdict, excessDays: r.excess_days,
    applicable: r.applicable, residualDays: r.residual_days, totalDays: r.total_days,
    authorityDayOfFy: r.authority_day_of_fy, gapToAuthority: r.gap_to_authority,
    d10Day: r.d10_day, d50Day: r.d50_day, d90Day: r.d90_day,
    postEnactmentD10: r.post_enactment_d10,
    sampleAmount: r.sample_amount, sampleActions: r.sample_actions,
    firstActionDay: r.first_action_day, enactedDayOfFy: r.enacted_day_of_fy,
    firstObligationDate: iso(r.first_obligation_date), firstOcLabel: r.first_oc_label,
  }));
}

export async function getChainSensitivity(metric: 'd10' | 'd50' = 'd50'): Promise<ChainSensitivity[]> {
  const rows = await query<any>(
    `SELECT s.agency_code, s.agency_name, s.appropriation, s.metric, s.level, s.profile,
            s.comparison_window_days, s.years, s.slope_days_per_cr_day,
            s.days_per_30_cr_days, s.observations
       FROM dm_chain_sensitivity s ${CUR('s')}
      WHERE s.metric = $1
      ORDER BY s.days_per_30_cr_days DESC NULLS LAST`, [metric]);
  return rows.map((r) => ({
    agencyCode: r.agency_code, agencyName: r.agency_name, appropriation: r.appropriation,
    metric: r.metric, level: r.level, profile: r.profile,
    comparisonWindowDays: r.comparison_window_days,
    years: r.years, slopeDaysPerCrDay: r.slope_days_per_cr_day,
    daysPer30CrDays: r.days_per_30_cr_days,
    observations: safeJson(r.observations),
  }));
}

// The observations ride as JSON text so the points a slope was taken over can be
// inspected beside it. A row that cannot be parsed returns no points rather than
// throwing: an unreadable audit trail is a missing one, not a broken page.
function safeJson(s: string | null): any[] {
  if (!s) return [];
  try { const v = JSON.parse(s); return Array.isArray(v) ? v : []; } catch { return []; }
}

/** Day of fiscal year to a readable date label. Day 1 is 1 October of fy-1. */
export function dayLabel(fy: number, day: number | null): string {
  if (!day) return '—';
  const d = new Date(Date.UTC(fy - 1, 9, 1));
  d.setUTCDate(d.getUTCDate() + day - 1);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

export const AGENCY_LABEL: Record<string, string> = {
  '097': 'Defense-wide', '021': 'Army', '017': 'Navy', '057': 'Air Force',
};


export async function getChainArchetypes(fiscalYear?: number): Promise<ChainArchetype[]> {
  const p: any[] = []; let w = '';
  if (fiscalYear) { p.push(fiscalYear); w = 'WHERE a.fiscal_year = $1'; }
  const rows = await query<any>(
    `SELECT a.fiscal_year, a.agency_code, a.appropriation, a.archetype_key, a.archetype_label,
            a.cluster, a.cluster_size, a.shape_json, a.centroid_json, a.half_by_month,
            a.window_days
       FROM dm_chain_archetype a ${CUR('a')} ${w}
      ORDER BY a.fiscal_year, a.agency_code, a.appropriation`, p);
  return rows.map((r) => ({
    fiscalYear: r.fiscal_year, agencyCode: r.agency_code, appropriation: r.appropriation,
    archetypeKey: r.archetype_key, archetypeLabel: r.archetype_label,
    cluster: r.cluster, clusterSize: r.cluster_size,
    shape: safeJson(r.shape_json), centroid: safeJson(r.centroid_json),
    halfByMonth: r.half_by_month, windowDays: r.window_days,
  }));
}

export async function getChainAnomalies(limit = 40): Promise<ChainAnomaly[]> {
  const rows = await query<any>(
    `SELECT a.fiscal_year, a.agency_code, a.appropriation, a.metric, a.value, a.baseline,
            a.deviation, a.baseline_years, a.direction, a.window_days, a.sample_amount,
            a.prior_median_amount, a.headline, a.method
       FROM dm_chain_anomaly a ${CUR('a')}
      ORDER BY abs(a.deviation) DESC NULLS LAST LIMIT $1`, [limit]);
  return rows.map((r) => ({
    fiscalYear: r.fiscal_year, agencyCode: r.agency_code, appropriation: r.appropriation,
    metric: r.metric, value: r.value, baseline: r.baseline, deviation: r.deviation,
    baselineYears: r.baseline_years, direction: r.direction, windowDays: r.window_days,
    sampleAmount: r.sample_amount, priorMedianAmount: r.prior_median_amount,
    headline: r.headline, method: r.method,
  }));
}

export async function getLegislativeGates(): Promise<LegislativeGate[]> {
  const rows = await query<any>(
    `SELECT g.fiscal_year, g.gate_key, g.gate_type, g.scope_label, g.treasury_account,
            g.days, g.bars_obligation, g.is_verbatim, g.requirement, g.citation,
            g.authority, g.note, g.scope_ba, g.scope_resources, g.scope_obligations,
            g.scope_years, g.scope_basis
       FROM dm_legislative_gate g ${CUR('g')}
      ORDER BY g.bars_obligation DESC, g.fiscal_year NULLS FIRST, g.gate_key`);
  return rows.map((r) => ({
    fiscalYear: r.fiscal_year, gateKey: r.gate_key, gateType: r.gate_type,
    scopeLabel: r.scope_label, treasuryAccount: r.treasury_account, days: r.days,
    barsObligation: r.bars_obligation, isVerbatim: r.is_verbatim,
    requirement: r.requirement, citation: r.citation, authority: r.authority, note: r.note,
    scopeBa: r.scope_ba, scopeResources: r.scope_resources,
    scopeObligations: r.scope_obligations, scopeYears: safeJson(r.scope_years),
    scopeBasis: r.scope_basis,
  }));
}

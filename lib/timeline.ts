/**
 * Fund distribution and the execution timeline.
 *
 * The question this answers -- when did the money move, for whom, on which
 * colour of money, using only the year's own appropriation -- cannot be
 * answered by any one file here, and the honest construction is three
 * populations kept apart:
 *
 *   OBSERVED, DATED    every contract action by fiscal month and by FUNDING
 *                      sub-agency. The fund holder is the only dimension on
 *                      this site that names WHS, MDA and SOCOM, because the
 *                      account chain does not decompose agency 097: File A's
 *                      owning agency reads "Department of Defense" on all
 *                      1,451.5B of FY2025. About a third of Department
 *                      obligations, and every figure says so.
 *
 *   OBSERVED, ANNUAL   File A at account grain by programme year and colour of
 *                      money. The whole population, and NO within-year timing:
 *                      the warehouse holds one submission per fiscal year.
 *
 *   MODELLED           the annual totals spread across the months using the
 *                      dated layer's shape. Marked modelled on every row and
 *                      never summed into an observed total.
 *
 * The join that would collapse the first two into one does not exist at usable
 * coverage. A contract action names exactly one Treasury account on 8.5% to
 * 23.0% of its dollars depending on the year -- and the obligation on an action
 * is never split across the accounts named on it -- so a dated cut by colour of
 * money and programme year is a SAMPLE whose size moves with the year. It is
 * published with its coverage on the same row, it carries shape and never
 * level, and it is never a denominator.
 *
 * The statistic the page rests on is `pre_enactment_pace_index`: the average
 * observed month before the full-year appropriation act, divided by the year's
 * own average observed month. A raw pre-enactment share is not comparable
 * between years, because the years differ both in how long the continuing
 * resolution ran and -- for a year in progress -- in how many months are
 * observed at all. TL-03 re-derives the index in SQL from the months and the
 * calendar, sharing no code with the extract that published it.
 */
import { query } from './db';
import { missingColumns } from './schema';

export type ApropEventKind = 'shutdown' | 'cr' | 'cr_extension' | 'enactment' | 'full_year_cr';

export type ApropEvent = {
  fiscalYear: number; eventKind: ApropEventKind;
  startDate: string; endDate: string | null;
  publicLaw: string | null; title: string;
  basis: 'reported' | 'derived'; citation: string | null; note: string | null;
  /** Day of fiscal year the span opens on; 1 is 1 October. */
  startDay: number; endDay: number | null; days: number | null;
};

export type TimelineMonth = {
  fiscalYear: number; fyMonth: number; monthLabel: string;
  dimension: 'total' | 'fund_holder'; dimKey: string; dimLabel: string;
  obligation: number; actionCount: number; cumObligation: number;
  sharePct: number; isObserved: boolean;
};

export type TimelineHolder = {
  fiscalYear: number; dimKey: string; dimLabel: string;
  fyObligation: number; actions: number;
  monthsObserved: number; isCompleteYear: boolean;
  q1SharePct: number | null; sepSharePct: number | null;
  preEnactmentSharePct: number | null; preEnactmentMonths: number | null;
  preEnactmentPaceIndex: number | null;
  enactedMonth: number | null; crDays: number | null; lapseDays: number;
  /** False where the holder's money arrives on a different appropriations bill,
   *  so the Defense enactment date does not govern it and its index is withheld. */
  inDefenseBill: boolean;
};

export type TimelineAnnual = {
  fiscalYear: number; programYear: number | null; appropriation: string;
  agencyCode: string; agencyName: string | null; isCurrentYear: boolean;
  accounts: number; resources: number; obligations: number;
  unobligated: number; outlays: number;
};

export type TimelineCyMonth = {
  fiscalYear: number; fyMonth: number; monthLabel: string; appropriation: string;
  obligation: number; sharePct: number; sampleObligation: number; coveragePct: number;
};

export type TimelineCoverage = {
  fiscalYear: number; measureKey: string; measureLabel: string;
  numerator: number; denominator: number; pct: number; note: string | null;
};

export type TimelineModel = {
  fiscalYear: number; fyMonth: number; monthLabel: string; appropriation: string;
  agencyCode: string; agencyName: string | null;
  modelledObligation: number; annualObligation: number;
  personnelSharePct: number; personnelShareBasis: string | null;
  shapeSource: string; method: string;
};

export type TimelineTrend = {
  fiscalYear: number; metricKey: string; metricLabel: string;
  value: number | null; unit: 'usd' | 'pct' | 'index';
  crDays: number | null; lapseDays: number; enactedDayOfFy: number | null;
  monthsObserved: number; isCompleteYear: boolean;
};

const CURRENT = 'JOIN dm_load l ON l.id = %.load_id AND l.is_current';

/**
 * Whether the database has been migrated AND loaded for this section.
 *
 * Both halves matter and neither falls back. A database migrated but not yet
 * loaded has the columns and no rows, and a page that read that as zero would
 * publish a Department that obligated nothing. See lib/schema on why a guard
 * must never substitute the value it replaced.
 */
export async function timelineReady(): Promise<boolean> {
  try {
    const missing = await Promise.all([
      missingColumns('dm_timeline_month', ['fiscal_year', 'fy_month', 'dimension', 'is_observed']),
      missingColumns('dm_timeline_holder', ['pre_enactment_pace_index', 'in_defense_bill']),
      missingColumns('dm_approp_event', ['event_kind', 'public_law', 'basis']),
    ]);
    if (missing.some((m) => m.length)) return false;
    const r = await query<{ n: number }>(
      `SELECT count(*)::int AS n FROM dm_timeline_month t
         JOIN dm_load l ON l.id = t.load_id AND l.is_current`);
    return (r[0]?.n ?? 0) > 0;
  } catch { return false; }
}

/**
 * The appropriation calendar, with each span's position in its own fiscal year
 * derived here rather than stored. Day 1 is 1 October, so a span's start day is
 * directly comparable with the timeline's own months.
 */
export async function getApropCalendar(): Promise<ApropEvent[]> {
  const rows = await query<any>(
    `SELECT a.fiscal_year, a.event_kind, a.start_date, a.end_date, a.public_law,
            a.title, a.basis, a.citation, a.note,
            (a.start_date - make_date(a.fiscal_year - 1, 10, 1) + 1)::int AS start_day,
            CASE WHEN a.end_date IS NOT NULL
                 THEN (a.end_date - make_date(a.fiscal_year - 1, 10, 1) + 1)::int END AS end_day,
            CASE WHEN a.end_date IS NOT NULL
                 THEN (a.end_date - a.start_date)::int END AS days
       FROM dm_approp_event a ${CURRENT.replace('%', 'a')}
      ORDER BY a.fiscal_year, a.start_date, a.event_kind`);
  return rows.map((r) => ({
    fiscalYear: r.fiscal_year, eventKind: r.event_kind,
    startDate: iso(r.start_date), endDate: r.end_date ? iso(r.end_date) : null,
    publicLaw: r.public_law, title: r.title, basis: r.basis,
    citation: r.citation, note: r.note,
    startDay: r.start_day, endDay: r.end_day, days: r.days,
  }));
}

// Dates cross the server/client boundary as ISO strings. A Date object is not a
// serialisable prop in a server component, and a Date rendered in two time zones
// is two different days.
function iso(d: Date | string): string {
  return typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10);
}

export async function getTimelineMonths(
  dimension: 'total' | 'fund_holder' = 'total', fiscalYear?: number, dimKey?: string,
): Promise<TimelineMonth[]> {
  const w: string[] = ['t.dimension = $1']; const p: any[] = [dimension];
  if (fiscalYear) { p.push(fiscalYear); w.push(`t.fiscal_year = $${p.length}`); }
  if (dimKey) { p.push(dimKey); w.push(`t.dim_key = $${p.length}`); }
  const rows = await query<any>(
    `SELECT t.fiscal_year, t.fy_month, t.month_label, t.dimension, t.dim_key, t.dim_label,
            t.obligation, t.action_count, t.cum_obligation, t.share_pct, t.is_observed
       FROM dm_timeline_month t ${CURRENT.replace('%', 't')}
      WHERE ${w.join(' AND ')}
      ORDER BY t.fiscal_year, t.dim_key, t.fy_month`, p);
  return rows.map((r) => ({
    fiscalYear: r.fiscal_year, fyMonth: r.fy_month, monthLabel: r.month_label,
    dimension: r.dimension, dimKey: r.dim_key, dimLabel: r.dim_label,
    obligation: r.obligation, actionCount: r.action_count,
    cumObligation: r.cum_obligation, sharePct: r.share_pct, isObserved: r.is_observed,
  }));
}

export async function getTimelineHolders(fiscalYear?: number): Promise<TimelineHolder[]> {
  const p: any[] = []; let w = '';
  if (fiscalYear) { p.push(fiscalYear); w = `WHERE h.fiscal_year = $1`; }
  const rows = await query<any>(
    `SELECT h.fiscal_year, h.dim_key, h.dim_label, h.fy_obligation, h.actions,
            h.months_observed, h.is_complete_year, h.q1_share_pct, h.sep_share_pct,
            h.pre_enactment_share_pct, h.pre_enactment_months, h.pre_enactment_pace_index,
            h.enacted_month, h.cr_days, h.lapse_days, h.in_defense_bill
       FROM dm_timeline_holder h ${CURRENT.replace('%', 'h')} ${w}
      ORDER BY h.fiscal_year, h.fy_obligation DESC`, p);
  return rows.map((r) => ({
    fiscalYear: r.fiscal_year, dimKey: r.dim_key, dimLabel: r.dim_label,
    fyObligation: r.fy_obligation, actions: r.actions,
    monthsObserved: r.months_observed, isCompleteYear: r.is_complete_year,
    q1SharePct: r.q1_share_pct, sepSharePct: r.sep_share_pct,
    preEnactmentSharePct: r.pre_enactment_share_pct,
    preEnactmentMonths: r.pre_enactment_months,
    preEnactmentPaceIndex: r.pre_enactment_pace_index,
    enactedMonth: r.enacted_month, crDays: r.cr_days, lapseDays: r.lapse_days,
    inDefenseBill: r.in_defense_bill,
  }));
}

/** The complete annual layer. `currentOnly` keeps the year's own appropriation. */
export async function getTimelineAnnual(
  fiscalYear?: number, currentOnly = false,
): Promise<TimelineAnnual[]> {
  const w: string[] = []; const p: any[] = [];
  if (fiscalYear) { p.push(fiscalYear); w.push(`n.fiscal_year = $${p.length}`); }
  if (currentOnly) w.push('n.is_current_year');
  const rows = await query<any>(
    `SELECT n.fiscal_year, n.program_year, n.appropriation, n.agency_code, n.agency_name,
            n.is_current_year, n.accounts, n.resources, n.obligations, n.unobligated, n.outlays
       FROM dm_timeline_annual n ${CURRENT.replace('%', 'n')}
      ${w.length ? `WHERE ${w.join(' AND ')}` : ''}
      ORDER BY n.fiscal_year, n.obligations DESC`, p);
  return rows.map((r) => ({
    fiscalYear: r.fiscal_year, programYear: r.program_year, appropriation: r.appropriation,
    agencyCode: r.agency_code, agencyName: r.agency_name, isCurrentYear: r.is_current_year,
    accounts: r.accounts, resources: r.resources, obligations: r.obligations,
    unobligated: r.unobligated, outlays: r.outlays,
  }));
}

export async function getTimelineCyMonths(fiscalYear?: number): Promise<TimelineCyMonth[]> {
  const p: any[] = []; let w = '';
  if (fiscalYear) { p.push(fiscalYear); w = 'WHERE c.fiscal_year = $1'; }
  const rows = await query<any>(
    `SELECT c.fiscal_year, c.fy_month, c.month_label, c.appropriation, c.obligation,
            c.share_pct, c.sample_obligation, c.coverage_pct
       FROM dm_timeline_cy_month c ${CURRENT.replace('%', 'c')} ${w}
      ORDER BY c.fiscal_year, c.appropriation, c.fy_month`, p);
  return rows.map((r) => ({
    fiscalYear: r.fiscal_year, fyMonth: r.fy_month, monthLabel: r.month_label,
    appropriation: r.appropriation, obligation: r.obligation, sharePct: r.share_pct,
    sampleObligation: r.sample_obligation, coveragePct: r.coverage_pct,
  }));
}

export async function getTimelineCoverage(): Promise<TimelineCoverage[]> {
  const rows = await query<any>(
    `SELECT v.fiscal_year, v.measure_key, v.measure_label, v.numerator, v.denominator,
            v.pct, v.note
       FROM dm_timeline_coverage v ${CURRENT.replace('%', 'v')}
      ORDER BY v.fiscal_year, v.measure_key`);
  return rows.map((r) => ({
    fiscalYear: r.fiscal_year, measureKey: r.measure_key, measureLabel: r.measure_label,
    numerator: r.numerator, denominator: r.denominator, pct: r.pct, note: r.note,
  }));
}

/**
 * The modelled monthly distribution. Complete years only -- MOD-02 blocks a load
 * that models a year in progress -- so an empty result for the live year is the
 * correct answer and not a gap to fill.
 */
export async function getTimelineModel(
  fiscalYear?: number, appropriation?: string,
): Promise<TimelineModel[]> {
  const w: string[] = []; const p: any[] = [];
  if (fiscalYear) { p.push(fiscalYear); w.push(`m.fiscal_year = $${p.length}`); }
  if (appropriation) { p.push(appropriation); w.push(`m.appropriation = $${p.length}`); }
  const rows = await query<any>(
    `SELECT m.fiscal_year, m.fy_month, m.month_label, m.appropriation, m.agency_code,
            m.agency_name, m.modelled_obligation, m.annual_obligation, m.personnel_share_pct,
            m.personnel_share_basis, m.shape_source, m.method
       FROM dm_timeline_model m ${CURRENT.replace('%', 'm')}
      ${w.length ? `WHERE ${w.join(' AND ')}` : ''}
      ORDER BY m.fiscal_year, m.appropriation, m.agency_code, m.fy_month`, p);
  return rows.map((r) => ({
    fiscalYear: r.fiscal_year, fyMonth: r.fy_month, monthLabel: r.month_label,
    appropriation: r.appropriation, agencyCode: r.agency_code, agencyName: r.agency_name,
    modelledObligation: r.modelled_obligation, annualObligation: r.annual_obligation,
    personnelSharePct: r.personnel_share_pct, personnelShareBasis: r.personnel_share_basis,
    shapeSource: r.shape_source, method: r.method,
  }));
}

export async function getTimelineTrend(): Promise<TimelineTrend[]> {
  const rows = await query<any>(
    `SELECT t.fiscal_year, t.metric_key, t.metric_label, t.value, t.unit, t.cr_days,
            t.lapse_days, t.enacted_day_of_fy, t.months_observed, t.is_complete_year
       FROM dm_timeline_trend t ${CURRENT.replace('%', 't')}
      ORDER BY t.fiscal_year, t.metric_key`);
  return rows.map((r) => ({
    fiscalYear: r.fiscal_year, metricKey: r.metric_key, metricLabel: r.metric_label,
    value: r.value, unit: r.unit, crDays: r.cr_days, lapseDays: r.lapse_days,
    enactedDayOfFy: r.enacted_day_of_fy, monthsObserved: r.months_observed,
    isCompleteYear: r.is_complete_year,
  }));
}

/** Trend rows keyed for lookup: trend[fy][metricKey]. */
export function byYear(rows: TimelineTrend[]): Record<number, Record<string, TimelineTrend>> {
  const m: Record<number, Record<string, TimelineTrend>> = {};
  for (const r of rows) (m[r.fiscalYear] ??= {})[r.metricKey] = r;
  return m;
}

/**
 * The state the Department was in on a given fiscal month, for labelling a
 * chart's x axis. Derived from the calendar rather than asserted, and a month
 * that straddles two states takes the one it starts in, which is stated on the
 * chart rather than silently resolved.
 */
export function monthState(
  fy: number, fyMonth: number, events: ApropEvent[],
): 'lapse' | 'cr' | 'enacted' {
  const first = monthStartDay(fyMonth);
  const y = events.filter((e) => e.fiscalYear === fy);
  for (const e of y) {
    if (e.eventKind !== 'shutdown' || e.endDay === null) continue;
    if (first >= e.startDay && first <= e.endDay) return 'lapse';
  }
  const act = y.find((e) => e.eventKind === 'enactment');
  if (act && first >= act.startDay) return 'enacted';
  return 'cr';
}

/** Day of fiscal year the given fiscal month opens on. 1 = 1 October. */
export function monthStartDay(fyMonth: number): number {
  const lens = [31, 30, 31, 31, 28, 31, 30, 31, 30, 31, 31, 30]; // Oct..Sep, non-leap
  let d = 1;
  for (let m = 1; m < fyMonth; m += 1) d += lens[m - 1];
  return d;
}

export const APPROP_ORDER = [
  'Military personnel', 'Operation and maintenance', 'Procurement', 'RDT&E',
  'Military construction', 'Family housing', 'Defense Health Program',
  'Retirement and health accrual', 'Revolving and management funds',
  'Trust and receipt accounts', 'Other',
];

export function sortAppropriations<T extends { appropriation: string }>(rows: T[]): T[] {
  const ix = (a: string) => {
    const i = APPROP_ORDER.indexOf(a); return i < 0 ? APPROP_ORDER.length : i;
  };
  return [...rows].sort((a, b) => ix(a.appropriation) - ix(b.appropriation));
}

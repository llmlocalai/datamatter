/**
 * Execution by PROGRAM YEAR.
 *
 * A fiscal year's File B holds every program year still executing in it. FY2026
 * obligations are not FY2026 money: they include FY2025 procurement still being
 * obligated, expired FY2025 operation and maintenance taking its adjustments,
 * and older multi-year money, beside the FY2026 appropriations themselves. An
 * execution rate that mixes them answers no question a program office asks, so
 * this view splits every figure by the program year the money was appropriated
 * for -- the beginning of its period of availability -- and lets the reader keep
 * to one of them.
 *
 * Two sources, each doing one job:
 *
 *   File B (dm_exec_account_fy / dm_exec_detail)   what was obligated and outlaid,
 *                                                  down to program activity and
 *                                                  object class
 *   File A (dm_exec_resource)                      what was available, at account
 *                                                  grain -- the denominator
 *
 * The rate is File A obligations over File A resources, so it foots to the
 * Statement of Budgetary Resources; the amounts are File B's. The two files
 * disagree slightly in some years (TIE-01), and a rate built from one file's
 * numerator and the other's denominator can pass 100% for no reason but that.
 *
 * WHAT THIS IS NOT: a curve. The warehouse holds one File B submission per
 * fiscal year, so each figure is a position as at that submission. What moves
 * across the chart is the program year's life -- the same money in its first,
 * second and third fiscal year -- not the months of one year.
 */
import { query } from './db';
import { columnsOf, missingColumns } from './schema';
import { type Side, sideSuffix, sideWhere } from './funding';

export const SCOPE = 'DOW';

export type Funds = 'all' | 'current' | 'prior' | 'old' | 'noyear' | `${number}`;
export type PyDim = 'agency' | 'federal' | 'account' | 'activity' | 'majorClass' | 'objectClass';
export type PyOrder = 'account' | 'object';

export const PY_ORDERS: Record<PyOrder, PyDim[]> = {
  account: ['agency', 'federal', 'account', 'activity', 'objectClass'],
  object: ['majorClass', 'objectClass', 'agency', 'federal', 'account'],
};

export const PY_DIM_TITLE: Record<PyDim, string> = {
  agency: 'Component', federal: 'Appropriation', account: 'Treasury account',
  activity: 'Program activity', majorClass: 'Object class group', objectClass: 'Object class',
};

export const AGENCY_LABEL: Record<string, string> = {
  '097': 'Defense-wide', '021': 'Army', '017': 'Navy', '057': 'Air Force',
};

/** Dimensions that exist on an account and so on File A too. */
const ACCOUNT_DIMS = new Set<PyDim>(['agency', 'federal', 'account']);

// Column expressions. Whitelisted: a column expression cannot be a bound
// parameter, so nothing from the request reaches SQL except through this map.
const B_KEY: Record<PyDim, string> = {
  agency: 'ac.agency_code', federal: 'ac.federal_account', account: 'ac.treasury_account',
  activity: 'd.activity_id', majorClass: 'oc.major_class', objectClass: 'd.object_class_code',
};
const B_LABEL: Record<PyDim, string> = {
  agency: 'ac.agency_code', federal: 'ac.federal_account_name', account: 'ac.treasury_account_name',
  activity: "nullif(av.activity_name, '')", majorClass: 'oc.major_class',
  objectClass: 'oc.object_class_name',
};
const A_KEY: Partial<Record<PyDim, string>> = {
  agency: 'r.agency_code', federal: 'r.federal_account', account: 'r.treasury_account',
};
const A_LABEL: Partial<Record<PyDim, string>> = {
  agency: 'r.agency_code', federal: 'r.federal_account_name', account: 'r.treasury_account_name',
};

export function parseFunds(v: string | null | undefined): Funds {
  if (v === 'current' || v === 'prior' || v === 'old' || v === 'noyear') return v;
  if (v && /^\d{4}$/.test(v)) return v as Funds;
  return 'all';
}

/** The program-year predicate on a bpoa column, with its parameter if any. */
function fundsWhere(funds: Funds, bpoa: string, fy: string, params: unknown[]): string {
  if (funds === 'current') return `${bpoa} = ${fy}`;
  if (funds === 'prior') return `${bpoa} < ${fy}`;
  if (funds === 'old') return `${bpoa} <= ${fy} - 3`;
  if (funds === 'noyear') return `${bpoa} IS NULL`;
  if (funds === 'all') return 'TRUE';
  params.push(Number(funds));
  return `${bpoa} = $${params.length}`;
}

export function fundsLabel(funds: Funds, fy: number): string {
  if (funds === 'current') return `FY${fy} money (current-year funds)`;
  if (funds === 'prior') return 'prior-year money still executing';
  if (funds === 'old') return 'money three or more years old';
  if (funds === 'noyear') return 'no-year money';
  if (funds === 'all') return 'all money executing';
  return `FY${funds} money`;
}

// ------------------------------------------------------------ readiness ----

/**
 * Whether this database can answer the view at all. A code deploy that lands
 * ahead of `npm run migrate` must withhold the section rather than fail the
 * build, and a database migrated but not yet reloaded carries the column with
 * nothing in it -- which is the same answer. There is no fallback: parsing the
 * year out of the account symbol in the page would be a second, unchecked
 * implementation of what POA-01 checks.
 */
export async function programYearReady(): Promise<boolean> {
  const [missing, resourceCols] = await Promise.all([
    missingColumns('dm_exec_account', ['bpoa', 'epoa']),
    columnsOf('dm_exec_resource'),
  ]);
  if (missing.length || !resourceCols.size) return false;
  const r = await query<{ b: number; a: number }>(
    `SELECT (SELECT count(*) FROM dm_exec_account ac JOIN dm_load l ON l.id = ac.load_id AND l.is_current
              WHERE ac.bpoa IS NOT NULL)::int AS b,
            (SELECT count(*) FROM dm_exec_resource r JOIN dm_load l ON l.id = r.load_id AND l.is_current
              WHERE r.bpoa IS NOT NULL)::int AS a`);
  return (r[0]?.b ?? 0) > 0 && (r[0]?.a ?? 0) > 0;
}

// ------------------------------------------------------------- overview ----

export interface PyYear {
  fiscalYear: number; submissionPeriod: string | null; hasDetail: boolean; isPartial: boolean;
}
export interface PyCell {
  fiscalYear: number; bpoa: number | null;
  /** File B, direct and reimbursable together. */
  obligations: number; outlays: number; undelivered: number;
  /** File B, split -- null on a load that predates the split. */
  obligationsDirect: number | null; obligationsReimbursable: number | null;
  outlaysDirect: number | null; outlaysReimbursable: number | null;
  undeliveredDirect: number | null; undeliveredReimbursable: number | null;
  /** File A. Carries no split; offsetting collections are what reimbursable work earns. */
  resources: number; offsettingCollections: number; obligationsA: number; unobligated: number;
}
export interface PyOverview {
  years: PyYear[]; cells: PyCell[];
  fileB: { vintage: string; extractedAt: string } | null;
  fileA: { vintage: string; extractedAt: string } | null;
  controls: { code: string; failed: number; message: string | null }[];
}

/** Every (execution year, program year) pair the load holds, with both files' figures. */
export async function getProgramYearOverview(): Promise<PyOverview> {
  const [years, cells, loads, controls] = await Promise.all([
    query<PyYear>(
      `SELECT e.fiscal_year AS "fiscalYear", e.submission_period AS "submissionPeriod",
              e.has_detail AS "hasDetail",
              (e.submission_period IS NULL OR e.submission_period NOT LIKE '%P12') AS "isPartial"
         FROM dm_exec_fy e JOIN dm_load l ON l.id = e.load_id AND l.is_current
        WHERE e.scope = $1 ORDER BY e.fiscal_year`, [SCOPE]),
    query<PyCell>(
      `WITH b AS (
         SELECT f.fiscal_year, ac.bpoa, sum(f.obligations) AS obl, sum(f.gross_outlays) AS outl,
                sum(f.undelivered_unpaid) AS udo,
                sum(f.obligations_direct) AS obl_d, sum(f.obligations_reimbursable) AS obl_r,
                sum(f.gross_outlays_direct) AS outl_d, sum(f.gross_outlays_reimbursable) AS outl_r,
                sum(f.undelivered_unpaid_direct) AS udo_d, sum(f.undelivered_unpaid_reimbursable) AS udo_r
           FROM dm_exec_account_fy f
           JOIN dm_load l ON l.id = f.load_id AND l.is_current
           JOIN dm_exec_account ac ON ac.load_id = f.load_id AND ac.fiscal_year = f.fiscal_year
                                  AND ac.treasury_account = f.treasury_account
          WHERE f.scope = $1 GROUP BY 1, 2
       ), a AS (
         SELECT r.fiscal_year, r.bpoa, sum(r.total_budgetary_resources) AS tbr,
                sum(r.spending_auth_offsetting) AS saoc,
                sum(r.obligations_incurred) AS obl, sum(r.unobligated_balance) AS unob
           FROM dm_exec_resource r JOIN dm_load l ON l.id = r.load_id AND l.is_current
          WHERE r.scope = $1 GROUP BY 1, 2
       )
       SELECT coalesce(b.fiscal_year, a.fiscal_year) AS "fiscalYear", coalesce(b.bpoa, a.bpoa) AS bpoa,
              coalesce(b.obl, 0) AS obligations, coalesce(b.outl, 0) AS outlays,
              coalesce(b.udo, 0) AS undelivered,
              b.obl_d AS "obligationsDirect", b.obl_r AS "obligationsReimbursable",
              b.outl_d AS "outlaysDirect", b.outl_r AS "outlaysReimbursable",
              b.udo_d AS "undeliveredDirect", b.udo_r AS "undeliveredReimbursable",
              coalesce(a.tbr, 0) AS resources, coalesce(a.saoc, 0) AS "offsettingCollections",
              coalesce(a.obl, 0) AS "obligationsA", coalesce(a.unob, 0) AS unobligated
         FROM b FULL JOIN a ON a.fiscal_year = b.fiscal_year AND a.bpoa IS NOT DISTINCT FROM b.bpoa
        ORDER BY 1, 2 DESC NULLS LAST`, [SCOPE]),
    query<{ key: string; vintage: string; extractedAt: string }>(
      `SELECT dataset_key AS key, to_char(vintage, 'YYYY-MM-DD') AS vintage,
              to_char(extracted_at, 'YYYY-MM-DD HH24:MI') AS "extractedAt"
         FROM dm_load WHERE is_current AND dataset_key IN ('file_b_detail', 'file_a_sbr')`),
    query<{ code: string; failed: number; message: string | null }>(
      `SELECT control_code AS code, count(*) FILTER (WHERE status = 'fail')::int AS failed,
              max(message) FILTER (WHERE status = 'fail') AS message
         FROM dm_control_result WHERE control_code IN ('POA-01', 'POA-02', 'DR-01', 'DR-02', 'TIE-01')
        GROUP BY 1 ORDER BY 1`).catch(() => []),
  ]);
  const load = (k: string) => {
    const r = loads.find((x) => x.key === k);
    return r ? { vintage: r.vintage, extractedAt: r.extractedAt } : null;
  };
  return { years, cells, fileB: load('file_b_detail'), fileA: load('file_a_sbr'), controls };
}

// ---------------------------------------------------------------- drill ----

export interface PyMeasures {
  obligations: number; outlays: number; undelivered: number; deliveredUnpaid: number;
  deobligations: number; upward: number; downward: number;
}
export interface PyResources {
  resources: number; appropriated: number; broughtForward: number; offsettingCollections: number;
  obligations: number; unobligated: number; outlays: number; accounts: number;
}
export interface PyNode {
  key: string; label: string; dim: PyDim; path: string[];
  b: PyMeasures | null; a: PyResources | null; rows: number; hasChildren: boolean;
}
export interface PyLifeRow {
  fiscalYear: number; submissionPeriod: string | null;
  /** File B, on the side asked for. */
  obligations: number; outlays: number; undelivered: number;
  /** File A, direct and reimbursable together. */
  resources: number; offsettingCollections: number; appropriated: number;
  obligationsA: number; unobligated: number;
}
export interface PyDrill {
  fiscalYear: number; funds: Funds; side: Side; order: PyOrder; dims: PyDim[];
  level: number; dim: PyDim | null; hasDetail: boolean;
  /** Set when the level asked for needs detail this fiscal year does not carry. */
  unavailable: string | null;
  totals: { b: PyMeasures | null; a: PyResources | null };
  nodes: PyNode[];
  /** Crumb labels for the path, resolved server-side so a shared link reads. */
  crumbs: { key: string; label: string; dim: PyDim }[];
  lifecycle: { programYear: number; accountScoped: boolean; rows: PyLifeRow[] } | null;
}

const B_SUMS = `
  sum(%s.obligations) AS obl, sum(%s.gross_outlays) AS outl, sum(%s.undelivered_unpaid) AS udo,
  sum(%s.delivered_unpaid) AS dlo, sum(%s.deobligations) AS deob,
  sum(%s.upward_adjustments) AS up, sum(%s.downward_adjustments) AS down, count(*)::int AS n`;
/**
 * The File B sums for a side. On the account rollup the split lives in suffixed
 * columns; on the detail table it is the row's own funding_source, filtered in
 * the WHERE clause, so the plain columns are right. Upward and downward
 * adjustments are not split on the rollup and are not shown on this chart.
 */
const bSums = (alias: string, side: Side) => {
  if (alias === 'd' || side === 'all') return B_SUMS.replace(/%s/g, alias);
  const x = sideSuffix(side);
  return `
  sum(f.obligations${x}) AS obl, sum(f.gross_outlays${x}) AS outl, sum(f.undelivered_unpaid${x}) AS udo,
  sum(f.delivered_unpaid${x}) AS dlo, sum(f.deobligations${x}) AS deob,
  0 AS up, 0 AS down, count(*)::int AS n`;
};
const A_SUMS = `
  sum(r.total_budgetary_resources) AS tbr, sum(r.ba_appropriated) AS ba,
  sum(r.spending_auth_offsetting) AS saoc,
  sum(r.unobligated_bf) AS bf, sum(r.obligations_incurred) AS aobl,
  sum(r.unobligated_balance) AS unob, sum(r.gross_outlays) AS aoutl,
  count(*) FILTER (WHERE r.total_budgetary_resources <> 0 OR r.obligations_incurred <> 0
                     OR r.unobligated_balance <> 0)::int AS accts`;

const toB = (r: any): PyMeasures | null => r.n == null ? null : ({
  obligations: Number(r.obl ?? 0), outlays: Number(r.outl ?? 0), undelivered: Number(r.udo ?? 0),
  deliveredUnpaid: Number(r.dlo ?? 0), deobligations: Number(r.deob ?? 0),
  upward: Number(r.up ?? 0), downward: Number(r.down ?? 0),
});
const toA = (r: any): PyResources | null => r.accts == null ? null : ({
  resources: Number(r.tbr ?? 0), appropriated: Number(r.ba ?? 0), broughtForward: Number(r.bf ?? 0),
  offsettingCollections: Number(r.saoc ?? 0),
  obligations: Number(r.aobl ?? 0), unobligated: Number(r.unob ?? 0), outlays: Number(r.aoutl ?? 0),
  accounts: Number(r.accts ?? 0),
});

export async function getProgramYearDrill(a: {
  fiscalYear: number; funds: Funds; order?: PyOrder; path?: string[]; side?: Side;
}): Promise<PyDrill> {
  const side: Side = a.side ?? 'direct';
  const order: PyOrder = a.order === 'object' ? 'object' : 'account';
  const dims = PY_ORDERS[order];
  const path = (a.path ?? []).slice(0, dims.length - 1).map(String);
  const level = path.length;
  const dim = dims[level] ?? null;
  const fy = a.fiscalYear;

  const yr = await query<{ has_detail: boolean }>(
    `SELECT e.has_detail FROM dm_exec_fy e JOIN dm_load l ON l.id = e.load_id AND l.is_current
      WHERE e.fiscal_year = $1 AND e.scope = $2`, [fy, SCOPE]);
  const hasDetail = !!yr[0]?.has_detail;

  const pathDims = dims.slice(0, level);
  const pathIsAccount = pathDims.every((d) => ACCOUNT_DIMS.has(d));
  const levelIsDetail = !!dim && !ACCOUNT_DIMS.has(dim);
  // File A has no program activity or object class, so it applies to a level
  // only when the level and everything above it are account attributes, and to
  // the totals when the path above is.
  const aForTotals = pathIsAccount;
  const aForNodes = pathIsAccount && !levelIsDetail;
  const empty: PyDrill = {
    fiscalYear: fy, funds: a.funds, side, order, dims, level, dim, hasDetail, unavailable: null,
    totals: { b: null, a: null }, nodes: [], crumbs: [], lifecycle: null,
  };

  // File B comes from the detail table only when a detail dimension is in play;
  // otherwise from the account rollup, which every year carries. EXEC-02 asserts
  // the two foot to the same total.
  const bSource = (detail: boolean, params: unknown[]) => {
    const t = detail ? 'd' : 'f';
    const from = detail
      ? `FROM dm_exec_detail d
         JOIN dm_load l ON l.id = d.load_id AND l.is_current
         JOIN dm_exec_account ac ON ac.load_id = d.load_id AND ac.fiscal_year = d.fiscal_year
                                AND ac.treasury_account = d.treasury_account
         LEFT JOIN dm_exec_object_class_fy oc ON oc.load_id = d.load_id AND oc.fiscal_year = d.fiscal_year
                                AND oc.scope = d.scope AND oc.object_class_code = d.object_class_code
         LEFT JOIN dm_exec_activity av ON av.load_id = d.load_id AND av.fiscal_year = d.fiscal_year
                                AND av.activity_id = d.activity_id`
      : `FROM dm_exec_account_fy f
         JOIN dm_load l ON l.id = f.load_id AND l.is_current
         JOIN dm_exec_account ac ON ac.load_id = f.load_id AND ac.fiscal_year = f.fiscal_year
                                AND ac.treasury_account = f.treasury_account`;
    const where = [`${t}.fiscal_year = $1`, `${t}.scope = $2`,
                   fundsWhere(a.funds, 'ac.bpoa', `${t}.fiscal_year`, params)];
    if (detail) where.push(sideWhere(side));
    path.forEach((v, i) => {
      params.push(v);
      where.push(`coalesce(${B_KEY[dims[i]]}, '') = $${params.length}`);
    });
    return { t, from, where: where.join(' AND ') };
  };
  const aSource = (params: unknown[]) => {
    const where = ['r.fiscal_year = $1', 'r.scope = $2',
                   fundsWhere(a.funds, 'r.bpoa', 'r.fiscal_year', params)];
    path.forEach((v, i) => {
      params.push(v);
      where.push(`coalesce(${A_KEY[dims[i]]}, '') = $${params.length}`);
    });
    return { from: `FROM dm_exec_resource r JOIN dm_load l ON l.id = r.load_id AND l.is_current`,
             where: where.join(' AND ') };
  };

  const pathNeedsDetail = !pathIsAccount;
  if (pathNeedsDetail && !hasDetail) {
    return { ...empty, unavailable:
      `FY${fy} is held as account rollups only, so it cannot be broken down below the Treasury `
      + 'account. Program activity and object class are carried for the three most recent fiscal years.' };
  }
  const tp: unknown[] = [fy, SCOPE];
  const tb = bSource(pathNeedsDetail, tp);
  const ap: unknown[] = [fy, SCOPE];
  const ta = aForTotals ? aSource(ap) : null;
  const [bTot, aTot] = await Promise.all([
    query(`SELECT ${bSums(tb.t, side)} ${tb.from} WHERE ${tb.where}`, tp),
    ta ? query(`SELECT ${A_SUMS} ${ta.from} WHERE ${ta.where}`, ap) : Promise.resolve([] as any[]),
  ]);

  let unavailable: string | null = null;
  let nodes: PyNode[] = [];
  if (dim && levelIsDetail && !hasDetail) {
    unavailable = `FY${fy} is held as account rollups only, so it cannot be broken down by `
      + `${PY_DIM_TITLE[dim].toLowerCase()}. Program activity and object class are carried for the `
      + 'three most recent fiscal years.';
  } else if (dim) {
    const next = dims[level + 1];
    const nextNeedsDetail = !!next && (levelIsDetail || pathNeedsDetail || !ACCOUNT_DIMS.has(next));
    const np: unknown[] = [fy, SCOPE];
    const nb = bSource(pathNeedsDetail || levelIsDetail, np);
    const nap: unknown[] = [fy, SCOPE];
    const na = aForNodes ? aSource(nap) : null;
    const [bRows, aRows] = await Promise.all([
      query(`SELECT coalesce(${B_KEY[dim]}, '') AS key, max(${B_LABEL[dim]}) AS label, ${bSums(nb.t, side)}
               ${nb.from} WHERE ${nb.where} GROUP BY 1`, np),
      na
        ? query(`SELECT coalesce(${A_KEY[dim]}, '') AS key, max(${A_LABEL[dim]}) AS label, ${A_SUMS}
                   ${na.from} WHERE ${na.where} GROUP BY 1`, nap)
        : Promise.resolve([] as any[]),
    ]);
    const byKey = new Map<string, PyNode>();
    for (const r of bRows) {
      byKey.set(r.key, { key: r.key, label: r.label ?? r.key, dim, path: [...path, r.key],
        b: toB(r), a: null, rows: r.n, hasChildren: !!next && (!nextNeedsDetail || hasDetail) });
    }
    for (const r of aRows) {
      const res = toA(r);
      // An account with no resources, obligations or balance in the year says
      // nothing; it is in File A because the account exists.
      if (!res || (!res.resources && !res.obligations && !res.unobligated)) continue;
      const hit = byKey.get(r.key);
      if (hit) hit.a = res;
      else {
        // Resources with no File B line at all: money available and not yet
        // reported against, which is exactly what an execution review looks for.
        byKey.set(r.key, { key: r.key, label: r.label ?? r.key, dim, path: [...path, r.key],
          b: null, a: res, rows: 0, hasChildren: false });
      }
    }
    nodes = Array.from(byKey.values()).map((n) => ({
      ...n, label: dim === 'agency' ? (AGENCY_LABEL[n.key] ?? n.label) : (n.label || n.key),
    }));
    nodes.sort((x, y) => (y.b?.obligations ?? 0) - (x.b?.obligations ?? 0)
      || (y.a?.resources ?? 0) - (x.a?.resources ?? 0));
  }

  // ---- crumbs: resolve each path key to the label a reader recognises.
  const crumbs = await Promise.all(path.map(async (key, i) => {
    const d = dims[i];
    if (d === 'agency') return { key, dim: d, label: AGENCY_LABEL[key] ?? key };
    if (d === 'majorClass') return { key, dim: d, label: key || 'Not reported' };
    const sql = d === 'federal'
      ? `SELECT max(ac.federal_account_name) AS label FROM dm_exec_account ac JOIN dm_load l ON l.id = ac.load_id AND l.is_current WHERE ac.federal_account = $1`
      : d === 'account'
        ? `SELECT max(ac.treasury_account_name) AS label FROM dm_exec_account ac JOIN dm_load l ON l.id = ac.load_id AND l.is_current WHERE ac.treasury_account = $1`
        : d === 'objectClass'
          ? `SELECT max(oc.object_class_name) AS label FROM dm_exec_object_class_fy oc JOIN dm_load l ON l.id = oc.load_id AND l.is_current WHERE oc.object_class_code = $1`
          : `SELECT max(nullif(av.activity_name, '')) AS label FROM dm_exec_activity av JOIN dm_load l ON l.id = av.load_id AND l.is_current WHERE av.activity_id = $1`;
    const r = await query<{ label: string | null }>(sql, [key]);
    return { key, dim: d, label: r[0]?.label ?? (key || 'Not reported') };
  }));

  // ---- lifecycle: one program year across every fiscal year it executes in.
  let lifecycle: PyDrill['lifecycle'] = null;
  const programYear = a.funds === 'current' ? fy : /^\d{4}$/.test(a.funds) ? Number(a.funds) : null;
  if (programYear) {
    const acctPath = path.map((v, i) => [dims[i], v] as const).filter(([d]) => ACCOUNT_DIMS.has(d));
    const lb: unknown[] = [SCOPE, programYear];
    const la: unknown[] = [SCOPE, programYear];
    const lbWhere = ['f.scope = $1', 'ac.bpoa = $2'];
    const laWhere = ['r.scope = $1', 'r.bpoa = $2'];
    for (const [d, v] of acctPath) {
      lb.push(v); lbWhere.push(`coalesce(${B_KEY[d]}, '') = $${lb.length}`);
      la.push(v); laWhere.push(`coalesce(${A_KEY[d]}, '') = $${la.length}`);
    }
    const [lbRows, laRows, periods] = await Promise.all([
      query(`SELECT f.fiscal_year, sum(f.obligations${sideSuffix(side)}) AS obl,
                    sum(f.gross_outlays${sideSuffix(side)}) AS outl,
                    sum(f.undelivered_unpaid${sideSuffix(side)}) AS udo
               FROM dm_exec_account_fy f JOIN dm_load l ON l.id = f.load_id AND l.is_current
               JOIN dm_exec_account ac ON ac.load_id = f.load_id AND ac.fiscal_year = f.fiscal_year
                                      AND ac.treasury_account = f.treasury_account
              WHERE ${lbWhere.join(' AND ')} GROUP BY 1`, lb),
      query(`SELECT r.fiscal_year, sum(r.total_budgetary_resources) AS tbr, sum(r.ba_appropriated) AS ba,
                    sum(r.spending_auth_offsetting) AS saoc,
                    sum(r.obligations_incurred) AS obl, sum(r.unobligated_balance) AS unob
               FROM dm_exec_resource r JOIN dm_load l ON l.id = r.load_id AND l.is_current
              WHERE ${laWhere.join(' AND ')} GROUP BY 1`, la),
      query(`SELECT e.fiscal_year, e.submission_period FROM dm_exec_fy e
               JOIN dm_load l ON l.id = e.load_id AND l.is_current WHERE e.scope = $1`, [SCOPE]),
    ]);
    const years = Array.from(new Set([...lbRows, ...laRows].map((r: any) => Number(r.fiscal_year))))
      .sort((x, y) => x - y);
    lifecycle = {
      programYear, accountScoped: acctPath.length < path.length,
      rows: years.map((y) => {
        const b = lbRows.find((r: any) => Number(r.fiscal_year) === y) ?? {};
        const ar = laRows.find((r: any) => Number(r.fiscal_year) === y) ?? {};
        return {
          fiscalYear: y,
          submissionPeriod: periods.find((p: any) => Number(p.fiscal_year) === y)?.submission_period ?? null,
          obligations: Number((b as any).obl ?? 0), outlays: Number((b as any).outl ?? 0),
          undelivered: Number((b as any).udo ?? 0),
          resources: Number((ar as any).tbr ?? 0), appropriated: Number((ar as any).ba ?? 0),
          offsettingCollections: Number((ar as any).saoc ?? 0),
          obligationsA: Number((ar as any).obl ?? 0), unobligated: Number((ar as any).unob ?? 0),
        };
      }),
    };
  }

  return {
    ...empty, unavailable,
    totals: { b: bTot[0] && bTot[0].n > 0 ? toB(bTot[0]) : null,
              a: aForTotals && aTot[0] && Number(aTot[0].accts) > 0 ? toA(aTot[0]) : null },
    nodes, crumbs, lifecycle,
  };
}

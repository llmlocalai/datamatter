/**
 * Executes the SBR assurance suite inside the load transaction.
 *
 * Order matters and is not arbitrary:
 *   1. population confidence   -- a test over a population that cannot be shown
 *                                 complete proves nothing, so it is measured first
 *   2. tests and assurance     -- exceptions and run rows
 *   3. cases                   -- exceptions aggregated per account, risk scored
 *   4. factors                 -- why each case scored what it scored
 *
 * The risk score is built to be ARGUED WITH. Every case carries its components
 * and each component carries the sentence that justifies it, because the score
 * exists to persuade the organisation that owns the account to spend effort on
 * it, and a number nobody can interrogate persuades nobody.
 */
const { TESTS, ASSURANCE, NOT_TESTABLE, SCOPE, caseKey } = require('./sbr_assurance');

// Materiality is a WORKING threshold set here, not the auditor's. It is stated
// on the page as such. Planning materiality of 1% of the Department's total
// budgetary resources is at the conservative end of the range an auditor would
// consider for a budgetary statement; performance materiality is half of it.
const PLANNING_MATERIALITY_PCT = 0.01;
const PERFORMANCE_FRACTION = 0.5;

const CHARTER = [
  ['Financial process', 'Funds control and budget execution, from enacted authority to '
    + 'obligation to outlay.', 'derived'],
  ['Statement and account', 'Statement of Budgetary Resources: budgetary resources, '
    + 'obligations incurred, unobligated balance, gross outlays, at Treasury Account Symbol.',
    'reported'],
  ['Material weakness', 'Budgetary Resources. On the DoD OIG Agency-Wide roster in all seven '
    + 'years a roster was published, FY2018 through FY2025.', 'reported'],
  ['Assertions', 'Completeness and existence of recorded budgetary activity; rights and '
    + 'obligations in the purpose, time and amount sense of 31 U.S.C.; presentation.', 'derived'],
  ['Risk statement', 'Obligations are recorded against the wrong account, in the wrong period, '
    + 'against authority that had expired or cancelled, or without the document that created '
    + 'them, so the reported balances misstate what authority remains available and what the '
    + 'Department owes.', 'derived'],
  ['Population', 'Every Department Treasury Account Symbol in File A, joined to File B where a '
    + 'row exists. Department scope excludes agency 011.', 'derived'],
  ['Control', 'Obligations recorded when incurred against a valid documented commitment, '
    + 'reconciled to the undelivered order balance, with the Statement of Budgetary Resources '
    + 'tied to the general ledger, and the tri-annual review validating open obligations.',
    'derived'],
  ['Root cause', 'The obligation is recorded in the accounting system and the document that '
    + 'created it lives in a contract writing system, so the tri-annual review validates '
    + 'balances rather than the instruments behind them. A balance reviewed against itself '
    + 'always passes.', 'derived'],
  ['Owner', 'The fund holder and the accounting office for the Treasury Account Symbol. This '
    + 'site derives the organisation from the agency identifier on the account and nothing '
    + 'finer; it is not an org chart.', 'derived'],
  ['Detection objective', 'Identify, over the whole population rather than a sample, the '
    + 'accounts where a budgetary assertion cannot be supported from the reported data, and '
    + 'rank them so a finite team can work them in order.', 'derived'],
  ['Management objective', 'Remediate before the next audit cycle, and hold evidence that the '
    + 'control operated across the period rather than that a plan completed.', 'derived'],
  ['Success measure', 'Exception rate and exposure per test falling and staying down across '
    + 'consecutive loads, with no recurrence of a closed case.', 'derived'],
];

const SEVERITY_POINTS = { critical: 35, high: 25, moderate: 15, informational: 5 };
const SEVERITY_RANK = { critical: 4, high: 3, moderate: 2, informational: 1 };

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const num = (v) => (v === null || v === undefined ? 0 : Number(v));

async function upsertCatalogue(client) {
  const all = [
    ...TESTS.map((t) => ({ ...t, kind: 'exception' })),
    ...ASSURANCE.map((t) => ({ ...t, kind: 'assurance' })),
    ...NOT_TESTABLE.map((t) => ({ ...t, kind: 'not_testable' })),
  ];
  for (const t of all) {
    if (t.kind === 'not_testable' && !t.limitation) {
      throw new Error(`${t.code}: a not_testable row must carry its limitation.`);
    }
    if (t.kind !== 'not_testable' && !t.sql) {
      throw new Error(`${t.code}: a runnable test must carry its SQL.`);
    }
    await client.query(
      `INSERT INTO dm_sbr_test (code, name, kind, assertion, risk, criterion, method,
                                severity, exposure_basis, limitation, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (code) DO UPDATE SET
         name = EXCLUDED.name, kind = EXCLUDED.kind, assertion = EXCLUDED.assertion,
         risk = EXCLUDED.risk, criterion = EXCLUDED.criterion, method = EXCLUDED.method,
         severity = EXCLUDED.severity, exposure_basis = EXCLUDED.exposure_basis,
         limitation = EXCLUDED.limitation, sort_order = EXCLUDED.sort_order`,
      [t.code, t.name, t.kind, t.assertion, t.risk, t.criterion, t.method,
       t.severity, t.exposure_basis, t.limitation ?? null, t.sort_order]);
  }
  return all.length;
}

/**
 * Population confidence. Every metric names what it counted, because a
 * confidence score whose components are hidden is a mood, not a measure.
 */
async function confidence(client, loadId, fy, period, partial) {
  const rows = [];
  const one = async (sql, params) => (await client.query(sql, params)).rows[0];

  const a = await one(`
    SELECT count(*)::int AS accounts,
           COALESCE(sum(total_budgetary_resources),0) AS tbr,
           COALESCE(sum(obligations_incurred),0) AS obl,
           count(*) FILTER (WHERE bpoa IS NOT NULL)::int AS dated,
           count(*) FILTER (WHERE bpoa IS NULL AND COALESCE(fund_life,'') = 'no-year')::int AS noyear,
           count(*) FILTER (WHERE bpoa IS NULL AND COALESCE(fund_life,'') <> 'no-year')::int AS untestable,
           count(DISTINCT treasury_account)::int AS distinct_accounts
      FROM dm_exec_resource WHERE load_id = $1 AND scope = $2 AND fiscal_year = $3`,
    [loadId, SCOPE, fy]);

  const pub = await one(`
    SELECT COALESCE(total_budgetary_resources,0) AS tbr, COALESCE(obligations_incurred,0) AS obl
      FROM dm_sbr_fy WHERE load_id = $1 AND scope = $2 AND fiscal_year = $3`,
    [loadId, SCOPE, fy]);

  const b = await one(`
    SELECT count(*)::int AS in_b,
           count(*) FILTER (WHERE a.treasury_account IS NOT NULL)::int AS matched
      FROM dm_exec_account_fy b
      JOIN dm_load lb ON lb.id = b.load_id AND lb.is_current
      LEFT JOIN dm_exec_resource a ON a.load_id = $1 AND a.scope = b.scope
           AND a.fiscal_year = b.fiscal_year AND a.treasury_account = b.treasury_account
     WHERE b.scope = $2 AND b.fiscal_year = $3`, [loadId, SCOPE, fy]);

  const covered = await one(`
    SELECT count(*)::int AS n, COALESCE(sum(a.total_budgetary_resources),0) AS tbr
      FROM dm_exec_resource a
     WHERE a.load_id = $1 AND a.scope = $2 AND a.fiscal_year = $3
       AND EXISTS (SELECT 1 FROM dm_exec_account_fy b
                     JOIN dm_load lb ON lb.id = b.load_id AND lb.is_current
                    WHERE b.scope = a.scope AND b.fiscal_year = a.fiscal_year
                      AND b.treasury_account = a.treasury_account)`, [loadId, SCOPE, fy]);

  const dup = await one(`
    SELECT COALESCE(count(*),0)::int AS dups FROM (
      SELECT treasury_account FROM dm_exec_resource
       WHERE load_id = $1 AND scope = $2 AND fiscal_year = $3
       GROUP BY treasury_account HAVING count(*) > 1) t`, [loadId, SCOPE, fy]);

  const accounts = a.accounts;
  const tbr = num(a.tbr);
  const pctOf = (n, d) => (d ? (n / d) * 100 : null);

  // 1. Does the account population reproduce the published Department total?
  const footPct = pub && num(pub.tbr)
    ? 100 - Math.abs(tbr - num(pub.tbr)) / Math.abs(num(pub.tbr)) * 100 : null;
  rows.push({
    metric_key: 'foots_to_published', metric_label: 'Account rows reproduce the published total',
    value_pct: footPct, numerator: tbr, denominator: num(pub?.tbr ?? 0), is_blocking: true,
    sort_order: 10,
    detail: pub && num(pub.tbr)
      ? `${accounts} accounts sum to ${(tbr / 1e9).toFixed(1)}B of budgetary resources against the `
        + `${(num(pub.tbr) / 1e9).toFixed(1)}B this load publishes for the Department. The test `
        + 'population is the published population or it is not a population.'
      : 'No published Department total in this load to reproduce.' });

  // 2. Can the time-based tests reach every account that has a period?
  rows.push({
    metric_key: 'time_testable', metric_label: 'Accounts a time-based test can reach',
    value_pct: pctOf(a.dated + a.noyear, accounts), numerator: a.dated + a.noyear,
    denominator: accounts, is_blocking: false, sort_order: 20,
    detail: `${a.dated} accounts carry a period of availability and ${a.noyear} are no-year, `
      + `which correctly have none. ${a.untestable} carry neither, and those drop out of every `
      + 'expired and cancelled-authority test -- assurance SBR-P03 exists to make that visible '
      + 'rather than silent.' });

  // 3. How much of File A has detail behind it at all?
  rows.push({
    metric_key: 'detail_coverage', metric_label: 'Budgetary resources with object-class detail',
    value_pct: pctOf(num(covered.tbr), tbr), numerator: num(covered.tbr), denominator: tbr,
    is_blocking: false, sort_order: 30,
    detail: `${covered.n} of ${accounts} accounts have a File B row. The ${accounts - covered.n} `
      + 'without one hold '
      + `${((tbr - num(covered.tbr)) / 1e9).toFixed(2)}B of budgetary resources; where such an `
      + 'account also reports obligations, SBR-X05 raises it as an exception.' });

  // 4. Duplicates would double-count a population.
  rows.push({
    metric_key: 'no_duplicates', metric_label: 'Accounts appear once',
    value_pct: accounts ? pctOf(accounts - dup.dups, accounts) : null,
    numerator: accounts - dup.dups, denominator: accounts, is_blocking: true, sort_order: 40,
    detail: dup.dups
      ? `${dup.dups} Treasury Account Symbols appear more than once and would be counted twice.`
      : 'No Treasury Account Symbol appears twice in the year.' });

  // 5. Is the year finished?
  rows.push({
    metric_key: 'period_complete', metric_label: 'Reporting period complete',
    value_pct: partial ? 0 : 100, numerator: null, denominator: null,
    is_blocking: false, sort_order: 50,
    detail: partial
      ? `Submission period ${period} is period-to-date, so every count and every exposure below `
        + 'is a position part way through the year and will move.'
      : `Submission period ${period} is a year-end submission.` });

  for (const r of rows) {
    await client.query(
      `INSERT INTO dm_sbr_confidence (load_id, fiscal_year, metric_key, metric_label,
              value_pct, numerator, denominator, detail, is_blocking, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (load_id, fiscal_year, metric_key) DO UPDATE SET
         value_pct = EXCLUDED.value_pct, detail = EXCLUDED.detail`,
      [loadId, fy, r.metric_key, r.metric_label,
       r.value_pct === null || Number.isNaN(r.value_pct) ? null : r.value_pct.toFixed(4),
       r.numerator, r.denominator, r.detail, r.is_blocking, r.sort_order]);
  }
  return rows;
}

async function runOne(client, loadId, t, fy, vintage, period, partial) {
  const pop = (await client.query(t.populationSql, [loadId, SCOPE, fy])).rows[0]
           ?? { population: 0, amount: 0 };
  const exc = (await client.query(t.sql, [loadId, SCOPE, fy])).rows;
  let exposure = 0;
  for (const e of exc) {
    exposure += Math.abs(num(e.exposure));
    await client.query(
      `INSERT INTO dm_sbr_exception (load_id, test_code, fiscal_year, case_key,
         treasury_account, account_name, agency_code, fund_life, bpoa, epoa,
         exposure, observed, expected, detail, evidence_json)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       ON CONFLICT (load_id, test_code, fiscal_year, treasury_account) DO NOTHING`,
      [loadId, t.code, fy, caseKey(fy, e.treasury_account), e.treasury_account,
       e.account_name ?? null, e.agency_code ?? null, e.fund_life ?? null,
       e.bpoa ?? null, e.epoa ?? null, Math.abs(num(e.exposure)),
       e.observed ?? null, e.expected ?? null, e.detail, e.evidence_json]);
  }
  await client.query(
    `INSERT INTO dm_sbr_run (load_id, test_code, fiscal_year, vintage, submission_period,
       is_partial_year, population, exceptions, exposure, population_amount)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (load_id, test_code, fiscal_year) DO UPDATE SET
       exceptions = EXCLUDED.exceptions, exposure = EXCLUDED.exposure`,
    [loadId, t.code, fy, vintage, period, partial,
     pop.population ?? 0, exc.length, exposure, num(pop.amount)]);
  return { code: t.code, fy, exceptions: exc.length, exposure, population: pop.population ?? 0 };
}

/**
 * Robust anomaly, per account, against ITS OWN closed-year history.
 *
 * Median and scaled MAD rather than mean and standard deviation: with five
 * observations one unusual year drags a mean far enough to hide the year after
 * it. The MAD is floored at 5% of the median so a nearly flat history cannot
 * manufacture a z of several hundred, and the result is capped, because past a
 * point the number stops being a measurement and only says "far outside its own
 * history". Accounts without a full closed-year history get no score at all.
 */
async function anomalies(client, loadId, closedYears) {
  if (closedYears.length < 4) return new Map();
  // The rows this runs over were bulk-inserted moments ago in this same
  // transaction, so the planner has no statistics for them and picks a nested
  // loop that turns a 34ms query into minutes. Materialising the observations
  // into a temp table and analysing it gives the planner real numbers. ON
  // COMMIT DROP, so nothing survives the load.
  await client.query('DROP TABLE IF EXISTS sbr_obs');
  await client.query(`
    CREATE TEMP TABLE sbr_obs ON COMMIT DROP AS
      SELECT treasury_account, fiscal_year,
             obligations_incurred / NULLIF(total_budgetary_resources, 0) AS ratio
        FROM dm_exec_resource
       WHERE load_id = $1 AND scope = $2 AND fiscal_year = ANY($3)
         AND total_budgetary_resources <> 0
         AND obligations_incurred / NULLIF(total_budgetary_resources, 0) IS NOT NULL`,
    [loadId, SCOPE, closedYears]);
  await client.query('ANALYZE sbr_obs');

  const { rows } = await client.query(`
    WITH hist AS (
      SELECT treasury_account FROM sbr_obs
       GROUP BY treasury_account HAVING count(*) = $1),
    med AS (
      SELECT o.treasury_account,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY o.ratio) AS med
        FROM sbr_obs o JOIN hist h USING (treasury_account)
       GROUP BY o.treasury_account),
    dev AS (
      SELECT o.treasury_account, o.fiscal_year, o.ratio, m.med,
             abs(o.ratio - m.med) AS abs_dev
        FROM sbr_obs o JOIN med m USING (treasury_account)),
    mad AS (
      -- percentile_cont is an ordered-set aggregate and cannot be a window
      -- function, so the median absolute deviation is its own aggregation over
      -- the deviations rather than an OVER () on the same pass.
      SELECT treasury_account,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY abs_dev) AS mad
        FROM dev GROUP BY treasury_account)
    SELECT d.treasury_account, d.fiscal_year, d.ratio, d.med, a.mad,
           LEAST(99, abs(0.6745 * (d.ratio - d.med)
                 / GREATEST(a.mad, abs(d.med) * 0.05, 1e-6))) AS z
      FROM dev d JOIN mad a USING (treasury_account)`,
    [closedYears.length]);
  const m = new Map();
  for (const r of rows) m.set(`${r.fiscal_year}|${r.treasury_account}`, {
    z: num(r.z), ratio: num(r.ratio), med: num(r.med), mad: num(r.mad) });
  return m;
}

async function buildCases(client, loadId, years, closedYears) {
  const anom = await anomalies(client, loadId, closedYears);

  // Materiality per year, from the Department total this same load published.
  const matRows = (await client.query(
    `SELECT fiscal_year, total_budgetary_resources FROM dm_sbr_fy
      WHERE load_id = $1 AND scope = $2`, [loadId, SCOPE])).rows;
  const materiality = new Map(matRows.map((r) => {
    const planning = Math.abs(num(r.total_budgetary_resources)) * PLANNING_MATERIALITY_PCT;
    return [r.fiscal_year, { planning, performance: planning * PERFORMANCE_FRACTION }];
  }));

  // Recurrence: the same account failing the same test in more than one year is
  // the signal that a corrective action did not take, and it is the difference
  // between a case worth opening and a one-year artefact.
  const recur = new Map();
  for (const r of (await client.query(
    `SELECT treasury_account, test_code, count(DISTINCT fiscal_year)::int AS yrs
       FROM dm_sbr_exception WHERE load_id = $1 GROUP BY 1,2`, [loadId])).rows) {
    recur.set(`${r.treasury_account}|${r.test_code}`, r.yrs);
  }

  // Prefetched once. The first cut ran two queries per case and a separate
  // insert per factor, which is six thousand round trips on this population --
  // slow enough to look like a hang and pointless when the whole lookup fits in
  // two queries and a Map.
  const sevByCode = new Map((await client.query(
    `SELECT code, severity FROM dm_sbr_test`)).rows.map((r) => [r.code, r.severity]));
  const acctFacts = new Map((await client.query(
    `SELECT fiscal_year, treasury_account, treasury_account_name, federal_account,
            agency_code, obligations_incurred, total_budgetary_resources
       FROM dm_exec_resource WHERE load_id = $1 AND scope = $2`,
    [loadId, SCOPE])).rows.map((r) => [`${r.fiscal_year}|${r.treasury_account}`, r]));

  const cases = (await client.query(`
    SELECT e.case_key, e.fiscal_year, e.treasury_account,
           max(e.account_name) AS account_name, max(e.agency_code) AS agency_code,
           max(e.fund_life) AS fund_life, max(e.bpoa) AS bpoa, max(e.epoa) AS epoa,
           count(*)::int AS exception_count,
           string_agg(DISTINCT e.test_code, ',' ORDER BY e.test_code) AS test_codes,
           sum(e.exposure) AS exposure
      FROM dm_sbr_exception e
      JOIN dm_sbr_test t ON t.code = e.test_code AND t.kind = 'exception'
     WHERE e.load_id = $1
     GROUP BY e.case_key, e.fiscal_year, e.treasury_account`, [loadId])).rows;

  let n = 0;
  for (const c of cases) {
    const codes = c.test_codes.split(',');
    const worst = codes.map((k) => sevByCode.get(k) ?? 'moderate')
      .sort((a, b) => SEVERITY_RANK[b] - SEVERITY_RANK[a])[0] ?? 'moderate';
    const acct = acctFacts.get(`${c.fiscal_year}|${c.treasury_account}`) ?? {};

    const mat = materiality.get(c.fiscal_year) ?? { planning: 1e9, performance: 5e8 };
    const exposure = Math.abs(num(c.exposure));
    const maxRecur = Math.max(...codes.map((k) => recur.get(`${c.treasury_account}|${k}`) ?? 1));
    const a = anom.get(`${c.fiscal_year}|${c.treasury_account}`);

    const factors = [];
    const sevPts = SEVERITY_POINTS[worst] ?? 15;
    factors.push({ factor: 'Assertion severity', points: sevPts, max: 35, sort: 10,
      detail: `The most severe test this account failed is ${worst}: `
        + `${codes.join(', ')}.` });

    // Log scale: an exposure two orders of magnitude below performance
    // materiality still deserves a position in the queue, and a linear scale
    // would put it at zero and hide it behind rounding.
    const expPts = 25 * clamp(
      Math.log10(Math.max(exposure, 1) / 1e6) / Math.log10(Math.max(mat.performance, 2e6) / 1e6),
      0, 1);
    factors.push({ factor: 'Exposure against materiality', points: expPts, max: 25, sort: 20,
      detail: `${(exposure / 1e6).toFixed(2)}M of exposure against a working performance `
        + `materiality of ${(mat.performance / 1e9).toFixed(2)}B, which is half of one percent `
        + 'of the Department’s budgetary resources for the year. The scale is logarithmic '
        + 'so a small exposure keeps a position in the queue rather than rounding to nothing.' });

    const breadthPts = 10 * clamp((codes.length - 1) / 2, 0, 1);
    factors.push({ factor: 'Breadth across tests', points: breadthPts, max: 10, sort: 30,
      detail: codes.length > 1
        ? `${codes.length} separate tests fail on this account, which points at the account `
          + 'rather than at one test’s threshold.'
        : 'One test fails on this account.' });

    const recurPts = 15 * clamp((maxRecur - 1) / 4, 0, 1);
    factors.push({ factor: 'Recurrence', points: recurPts, max: 15, sort: 40,
      detail: maxRecur > 1
        ? `The same test fails on this account in ${maxRecur} of the fiscal years in this load. `
          + 'A condition that survives a year is a control that is not operating, not an isolated '
          + 'error.'
        : 'First year this account fails these tests in the loaded history.' });

    const z = a ? a.z : null;
    const anomPts = z === null ? 0 : 15 * clamp(z / 6, 0, 1);
    factors.push({ factor: 'Behaviour against own history', points: anomPts, max: 15, sort: 50,
      detail: z === null
        ? 'No score: this account is not present in every closed year in the load, so it has no '
          + 'history to be measured against and a comparison would be made against a history '
          + 'with its small years missing.'
        : `Obligation rate of ${(a.ratio * 100).toFixed(1)}% against this account’s own `
          + `median of ${(a.med * 100).toFixed(1)}%, a robust z of ${z.toFixed(2)} `
          + `${z >= 99 ? '(capped, which means far outside its own history rather than a measurement)' : ''}.` });

    const score = clamp(factors.reduce((s, f) => s + f.points, 0), 0, 100);
    const tier = (worst === 'critical' || score >= 70) ? 1 : score >= 45 ? 2 : 3;

    await client.query(
      `INSERT INTO dm_sbr_case (load_id, case_key, fiscal_year, treasury_account, account_name,
         federal_account, agency_code, agency_name, fund_life, bpoa, epoa, obligations,
         total_resources, exception_count, test_codes, max_severity, exposure, risk_score,
         tier, recurrence_years, anomaly_z)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
       ON CONFLICT (load_id, case_key) DO UPDATE SET risk_score = EXCLUDED.risk_score`,
      [loadId, c.case_key, c.fiscal_year, c.treasury_account,
       c.account_name ?? acct.treasury_account_name ?? null, acct.federal_account ?? null,
       c.agency_code ?? acct.agency_code ?? null, null, c.fund_life ?? null,
       c.bpoa ?? null, c.epoa ?? null, num(acct.obligations_incurred),
       num(acct.total_budgetary_resources), c.exception_count, c.test_codes, worst,
       exposure, score.toFixed(2), tier, maxRecur, z === null ? null : z.toFixed(3)]);

    const vals = [];
    const params = [loadId, c.case_key];
    factors.forEach((f, i) => {
      const b = params.length;
      vals.push(`($1,$2,$${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5})`);
      params.push(f.factor, f.points.toFixed(2), f.max, f.detail, f.sort);
    });
    await client.query(
      `INSERT INTO dm_sbr_case_factor (load_id, case_key, factor, points, max_points,
         detail, sort_order) VALUES ${vals.join(',')}`, params);
    n += 1;
  }
  return n;
}

async function runSbrAssurance(client, loadId, vintage) {
  const catalogue = await upsertCatalogue(client);
  // Same reason as the temp table in anomalies(): everything this suite reads
  // was inserted in this transaction and carries no statistics yet.
  await client.query('ANALYZE dm_exec_resource');
  await client.query('ANALYZE dm_exec_account_fy');

  const years = (await client.query(
    `SELECT DISTINCT fiscal_year, submission_period FROM dm_exec_resource
      WHERE load_id = $1 AND scope = $2 ORDER BY fiscal_year`, [loadId, SCOPE])).rows;
  if (!years.length) return { skipped: true };

  const closed = years.filter((y) => (y.submission_period ?? '').endsWith('P12'))
    .map((y) => y.fiscal_year);

  await client.query('DELETE FROM dm_sbr_exception WHERE load_id = $1', [loadId]);
  await client.query('DELETE FROM dm_sbr_case_factor WHERE load_id = $1', [loadId]);
  await client.query('DELETE FROM dm_sbr_case WHERE load_id = $1', [loadId]);

  const charterRows = CHARTER.map((c, i) => ({ element: c[0], value: c[1], basis: c[2], i }));
  for (const c of charterRows) {
    await client.query(
      `INSERT INTO dm_sbr_charter (load_id, sort_order, element, value, basis, citation)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (load_id, element) DO UPDATE SET value = EXCLUDED.value`,
      [loadId, (c.i + 1) * 10, c.element, c.value, c.basis,
       c.basis === 'reported'
         ? 'DoD OIG report DODIG-2026-032; File A as published to USASpending'
         : 'Structured reading of the material weakness on /nfr, applied to File A and File B']);
  }

  const summary = [];
  for (const y of years) {
    const partial = !(y.submission_period ?? '').endsWith('P12');
    await confidence(client, loadId, y.fiscal_year, y.submission_period, partial);
    for (const t of [...TESTS, ...ASSURANCE]) {
      summary.push(await runOne(client, loadId, t, y.fiscal_year, vintage,
                                y.submission_period, partial));
    }
  }
  const cases = await buildCases(client, loadId, years.map((y) => y.fiscal_year), closed);
  return { catalogue, years: years.length, closed: closed.length, cases, summary };
}

module.exports = { runSbrAssurance, PLANNING_MATERIALITY_PCT, PERFORMANCE_FRACTION };

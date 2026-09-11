#!/usr/bin/env node
/**
 * Load staged analytics payloads into Postgres, then run the control suite.
 *
 *   node scripts/load_analytics.js [--staging .staging] [--dry-run]
 *
 * Everything happens in ONE transaction: schema, seed, measures, and control
 * results. If a control with severity 'critical' fails, the transaction rolls
 * back and the previous load stays current — a bad extract can never become the
 * published figures. That is the whole point of running the controls here
 * rather than in a test suite that nothing blocks on.
 *
 * DATABASE_URL comes from the environment (or .env.local for local runs). It is
 * never written to a file, logged, or included in any output.
 */
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const ROOT = path.dirname(__dirname);
const args = process.argv.slice(2);
const argv = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const DRY = args.includes('--dry-run');
const STAGING = path.resolve(ROOT, argv('--staging', '.staging'));

function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  for (const f of ['.env.local', '.env']) {
    const p = path.join(ROOT, f);
    if (!fs.existsSync(p)) continue;
    const m = fs.readFileSync(p, 'utf-8').match(/^\s*DATABASE_URL\s*=\s*(.+?)\s*$/m);
    if (m) return m[1].replace(/^["']|["']$/g, '');
  }
  throw new Error('DATABASE_URL is not set. Export it or put it in .env.local.');
}

// ---------------------------------------------------------------- helpers --
const CHUNK = 500;
async function bulk(client, table, cols, rows, extra = {}) {
  if (!rows.length) return 0;
  const allCols = [...Object.keys(extra), ...cols];
  let n = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const vals = [];
    const tuples = slice.map((r) => {
      const t = allCols.map((c) => {
        vals.push(c in extra ? extra[c] : (r[c] === undefined ? null : r[c]));
        return `$${vals.length}`;
      });
      return `(${t.join(',')})`;
    });
    await client.query(
      `INSERT INTO ${table} (${allCols.map((c) => `"${c}"`).join(',')}) VALUES ${tuples.join(',')}`,
      vals
    );
    n += slice.length;
  }
  return n;
}

async function openLoad(client, datasetKey, p, script) {
  await client.query('UPDATE dm_load SET is_current = false WHERE dataset_key = $1', [datasetKey]);
  const { rows } = await client.query(
    `INSERT INTO dm_load (dataset_key, vintage, extracted_at, row_count, etl_script, etl_version, is_current, notes)
     VALUES ($1,$2,$3,$4,$5,$6,true,$7) RETURNING id`,
    [datasetKey, p.vintage, p.extracted_at,
     Object.values(p.rows).reduce((s, v) => s + v.length, 0),
     script, p.etl_version, p.source_path || null]
  );
  return rows[0].id;
}

// ------------------------------------------------------------- the controls --
// Each returns [{fiscal_year, status, observed, expected, tolerance, message}]
const CONTROLS = {
  'SBR-01': async (c) => (await c.query(`
    SELECT fiscal_year,
           total_budgetary_resources AS expected,
           obligations_incurred + unobligated_balance AS observed
      FROM dm_sbr_fy s JOIN dm_load l ON l.id = s.load_id AND l.is_current
     WHERE scope = 'DOW' ORDER BY fiscal_year`)).rows.map((r) => {
    const v = Math.abs(r.observed - r.expected) / Math.max(1, Math.abs(r.expected)) * 100;
    return { fiscal_year: r.fiscal_year, observed: r.observed, expected: r.expected,
      tolerance: 0.1, variance_pct: v, status: v <= 0.1 ? 'pass' : 'fail',
      message: `FY${r.fiscal_year}: obligations + unobligated is ${v.toFixed(4)}% from total budgetary resources.` };
  }),
  'SBR-02': async (c) => (await c.query(`
    SELECT fiscal_year, total_budgetary_resources AS expected,
           ba_appropriated + unobligated_bf + adjustments_to_unob_bf
           + other_budgetary_resources AS observed
      FROM dm_sbr_fy s JOIN dm_load l ON l.id = s.load_id AND l.is_current
     WHERE scope = 'DOW' ORDER BY fiscal_year`)).rows.map((r) => {
    const v = Math.abs(r.observed - r.expected) / Math.max(1, Math.abs(r.expected)) * 100;
    return { fiscal_year: r.fiscal_year, observed: r.observed, expected: r.expected,
      tolerance: 0.5, variance_pct: v, status: v <= 0.5 ? 'pass' : 'fail',
      message: `FY${r.fiscal_year}: resource components sum to within ${v.toFixed(4)}% of the reported total.` };
  }),
  'SBR-03': async (c) => (await c.query(`
    SELECT fiscal_year, gross_outlays AS observed, total_budgetary_resources AS expected
      FROM dm_sbr_fy s JOIN dm_load l ON l.id = s.load_id AND l.is_current
     WHERE scope='DOW' ORDER BY fiscal_year`)).rows.map((r) => ({
    fiscal_year: r.fiscal_year, observed: r.observed, expected: r.expected,
    status: Number(r.observed) <= Number(r.expected) ? 'pass' : 'fail',
    message: `FY${r.fiscal_year}: gross outlays are ${(r.observed / r.expected * 100).toFixed(1)}% of total budgetary resources.` })),
  // The assertion names a submission period, so the control has to read one.
  // It used to join on fiscal year and scope alone and then assert "same
  // submission period" in prose -- true, as it happened, but nothing here
  // checked it. A period mismatch now fails the control on its own terms
  // rather than showing up as an unexplained variance.
  'TIE-01': async (c) => (await c.query(`
    SELECT a.fiscal_year, a.obligations_incurred AS expected, b.obligations_incurred AS observed,
           a.submission_period AS period_a, b.submission_period AS period_b,
           b.periods_available, b.replicated_rows
      FROM dm_sbr_fy a
      JOIN dm_load la ON la.id=a.load_id AND la.is_current
      JOIN dm_obligation_stage b ON b.fiscal_year=a.fiscal_year AND b.scope=a.scope
      JOIN dm_load lb ON lb.id=b.load_id AND lb.is_current
     WHERE a.scope='DOW' ORDER BY a.fiscal_year`)).rows.map((r) => {
    const v = Math.abs(r.observed - r.expected) / Math.max(1, Math.abs(r.expected)) * 100;
    const same = !!r.period_a && r.period_a === r.period_b;
    const base = { fiscal_year: r.fiscal_year, observed: r.observed, expected: r.expected,
      tolerance: 0.5, variance_pct: v };
    if (!same) return { ...base, status: 'fail',
      message: `FY${r.fiscal_year}: the two files are not the same submission period `
        + `(File A ${r.period_a || 'none recorded'}, File B ${r.period_b || 'none recorded'}`
        + `${Number(r.periods_available) > 1 ? `, File B holds ${r.periods_available} periods` : ''}`
        + `) -- the obligation comparison is not meaningful until they are.` };
    const rep = Number(r.replicated_rows) > 0
      ? ` File B's ${Number(r.replicated_rows).toLocaleString()} PARK-replicated rows are counted once.` : '';
    return { ...base, status: v <= 0.5 ? 'pass' : 'fail',
      message: `FY${r.fiscal_year}: File B obligations are ${(r.observed>r.expected?'above':'below')} File A by ${v.toFixed(3)}% `
        + `(File A ${(r.expected/1e9).toFixed(1)}B, File B ${(r.observed/1e9).toFixed(1)}B, both ${r.period_a}).${rep}` };
  }),
  // File B's activity identifier moved from program_activity_code to the
  // Program Activity Reporting Key in FY2026, and the extract repeats each
  // account's object-class figure against every PARK instead of splitting it.
  // The extract counts a replicated group once; this control publishes how much
  // that was worth, so the repair is visible rather than assumed.
  'FILEB-01': async (c) => (await c.query(`
    SELECT fiscal_year, activity_key, source_rows, grain_rows, replicated_groups,
           replicated_rows, obligations_as_published, obligations_at_grain, overstatement_pct
      FROM dm_fileb_grain g JOIN dm_load l ON l.id=g.load_id AND l.is_current
     WHERE scope='DOW' ORDER BY fiscal_year`)).rows.map((r) => {
    const n = Number(r.replicated_rows);
    return { fiscal_year: r.fiscal_year, observed: n, expected: 0,
      status: n === 0 ? 'pass' : 'fail',
      message: n === 0
        ? `FY${r.fiscal_year}: every File B row is a distinct ${r.activity_key.replace(/_/g, ' ')} `
          + `at account, object class, funding source and emergency fund (${Number(r.source_rows).toLocaleString()} rows, `
          + `${Number(r.grain_rows).toLocaleString()} distinct).`
        : `FY${r.fiscal_year}: ${n.toLocaleString()} of ${Number(r.source_rows).toLocaleString()} File B rows repeat a figure `
          + `already published against another ${r.activity_key.replace(/_/g, ' ')} for the same account and object class. `
          + `Summing as published gives ${(r.obligations_as_published/1e9).toFixed(1)}B against `
          + `${(r.obligations_at_grain/1e9).toFixed(1)}B at the real grain, ${Number(r.overstatement_pct).toFixed(1)}% too high.` };
  }),
  'SCOPE-01': async (c) => {
    const { rows } = await c.query(`
      SELECT count(*)::int AS n FROM dm_sbr_dim d JOIN dm_load l ON l.id=d.load_id AND l.is_current
       WHERE d.scope='DOW' AND d.dimension='agency' AND d.dim_key='011'`);
    return [{ observed: rows[0].n, expected: 0, status: rows[0].n === 0 ? 'pass' : 'fail',
      message: rows[0].n === 0
        ? 'No Department-scope figure includes agency code 011 (Executive Office of the President).'
        : `${rows[0].n} Department-scope rows include agency code 011.` }];
  },
  // File C is cumulative per period, so a row built from more than one snapshot
  // is double counted. REC-01 asserts the single-snapshot rule as well as the
  // ratio — summing periods is the specific error this control now blocks.
  'REC-01': async (c) => (await c.query(`
    SELECT fiscal_year, filec_obligation AS observed, award_obligation AS expected, linkage_pct,
           submission_period, periods_available
      FROM dm_reconciliation r JOIN dm_load l ON l.id=r.load_id AND l.is_current
     ORDER BY fiscal_year`)).rows.map((r) => {
    const named = !!r.submission_period;
    const ok = Number(r.observed) <= Number(r.expected) && named;
    return { fiscal_year: r.fiscal_year, observed: r.observed, expected: r.expected,
      variance_pct: r.linkage_pct, status: ok ? 'pass' : 'fail',
      message: named
        ? `FY${r.fiscal_year}: File C snapshot ${r.submission_period} (of ${r.periods_available} periods held) `
          + `covers ${Number(r.linkage_pct).toFixed(1)}% of award-file obligations.`
        : `FY${r.fiscal_year}: no single submission period named — the figure may sum overlapping cumulative snapshots.` };
  }),
  'VIN-01': async (c) => {
    const { rows } = await c.query(
      `SELECT count(*)::int AS n FROM dm_load WHERE is_current AND (vintage IS NULL OR extracted_at IS NULL)`);
    return [{ observed: rows[0].n, expected: 0, status: rows[0].n === 0 ? 'pass' : 'fail',
      message: rows[0].n === 0 ? 'Every current load carries a vintage and an extraction timestamp.'
                               : `${rows[0].n} current loads are missing a vintage.` }];
  },
  'PART-01': async (c) => (await c.query(`
    SELECT fiscal_year, submission_period, is_partial_year
      FROM dm_sbr_fy s JOIN dm_load l ON l.id=s.load_id AND l.is_current
     WHERE scope='DOW' ORDER BY fiscal_year`)).rows.map((r) => {
    const shouldBe = !!(r.submission_period && !/P12$/.test(r.submission_period));
    return { fiscal_year: r.fiscal_year, status: shouldBe === r.is_partial_year ? 'pass' : 'fail',
      message: `FY${r.fiscal_year} (${r.submission_period}) is ${r.is_partial_year ? '' : 'not '}flagged partial.` };
  }),
  'DEF-01': async (c) => {
    const { rows } = await c.query(`
      SELECT count(*)::int AS n FROM dm_definition d JOIN dm_load l ON l.id=d.load_id AND l.is_current
       WHERE coalesce(array_length(authorities,1),0) = 0`);
    const { rows: tot } = await c.query(`SELECT count(*)::int AS n FROM dm_definition d JOIN dm_load l ON l.id=d.load_id AND l.is_current`);
    return [{ observed: rows[0].n, expected: 0, status: rows[0].n === 0 ? 'pass' : 'warn',
      message: `${tot[0].n - rows[0].n} of ${tot[0].n} published definitions name an authority.` }];
  },
  'AWD-01': async (c) => (await c.query(`
    SELECT d.fiscal_year, d.dimension, sum(d.obligation) AS observed, max(f.obligation) AS expected
      FROM dm_award_dim d JOIN dm_load l ON l.id=d.load_id AND l.is_current
      JOIN dm_award_fy f ON f.fiscal_year=d.fiscal_year AND f.load_id=d.load_id
     GROUP BY d.fiscal_year, d.dimension ORDER BY d.fiscal_year, d.dimension`)).rows.map((r) => ({
    fiscal_year: r.fiscal_year, observed: r.observed, expected: r.expected,
    status: Number(r.observed) <= Number(r.expected) * 1.0001 ? 'pass' : 'fail',
    message: `FY${r.fiscal_year} ${r.dimension}: retained buckets total ${(r.observed / r.expected * 100).toFixed(1)}% of the fiscal-year award total.` })),
  'ASSIST-01': async (c) => (await c.query(`
    SELECT d.fiscal_year, d.dimension, sum(d.obligation) AS observed, max(f.obligation) AS expected
      FROM dm_assistance_dim d JOIN dm_load l ON l.id=d.load_id AND l.is_current
      JOIN dm_assistance_fy f ON f.fiscal_year=d.fiscal_year AND f.load_id=d.load_id
     GROUP BY d.fiscal_year, d.dimension ORDER BY d.fiscal_year, d.dimension`)).rows.map((r) => ({
    fiscal_year: r.fiscal_year, observed: r.observed, expected: r.expected,
    status: Number(r.observed) <= Number(r.expected) * 1.0001 ? 'pass' : 'fail',
    message: `FY${r.fiscal_year} ${r.dimension}: retained buckets total ${(r.observed / r.expected * 100).toFixed(1)}% of the fiscal-year assistance total.` })),

  // ------------------------------------------------------------- program --
  // PROG-01 and PROG-02 are critical: the first makes a program figure
  // citable, the second stops the one fabrication this data invites.
  'PROG-01': async (c) => {
    const { rows } = await c.query(`
      SELECT count(*)::int AS n FROM dm_program_fy f
        JOIN dm_load l ON l.id = f.load_id AND l.is_current
       WHERE coalesce(f.program_code,'') = ''
          OR f.vintage IS NULL
          OR NOT EXISTS (SELECT 1 FROM dm_program_dim d
                          WHERE d.load_id = f.load_id AND d.program_code = f.program_code)`);
    return [{ observed: rows[0].n, expected: 0, status: rows[0].n === 0 ? 'pass' : 'fail',
      message: rows[0].n === 0
        ? 'Every program measure names a program that exists in the registry, and carries a vintage.'
        : `${rows[0].n} program rows have no program identity, no vintage, or no registry entry.` }];
  },
  'PROG-02': async (c) => (await c.query(`
    SELECT f.fiscal_year, f.program_code,
           f.obligation AS expected,
           coalesce(sum(a.obligation), 0) AS observed
      FROM dm_program_fy f
      JOIN dm_load l ON l.id = f.load_id AND l.is_current
      LEFT JOIN dm_program_account a
             ON a.load_id = f.load_id AND a.program_code = f.program_code
            AND a.fiscal_year = f.fiscal_year
     GROUP BY f.fiscal_year, f.program_code, f.obligation
     ORDER BY f.fiscal_year, f.program_code`)).rows.map((r) => {
    // Retained account sets are a top-N subset of a program's actions, and the
    // obligation is never split across the accounts in a set, so the retained
    // total must sit at or below the program's own fiscal-year total.
    const ok = Math.abs(Number(r.observed)) <= Math.abs(Number(r.expected)) * 1.0001 + 1;
    return { fiscal_year: r.fiscal_year, observed: r.observed, expected: r.expected,
      status: ok ? 'pass' : 'fail',
      message: `FY${r.fiscal_year} program ${r.program_code}: named account sets total `
        + `${(Math.abs(r.observed) / Math.max(1, Math.abs(r.expected)) * 100).toFixed(1)}% of the program's obligations.` };
  }),
  'PROG-03': async (c) => (await c.query(`
    SELECT fiscal_year, program_code, obligation,
           traceable_obligation, untraceable_obligation, traceable_pct
      FROM dm_program_fy f JOIN dm_load l ON l.id = f.load_id AND l.is_current
     ORDER BY fiscal_year, program_code`)).rows.map((r) => {
    const parts = Number(r.traceable_obligation) + Number(r.untraceable_obligation);
    const foots = Math.abs(parts - Number(r.obligation)) <= Math.max(1, Math.abs(Number(r.obligation)) * 1e-6);
    const pct = Number(r.obligation) ? Number(r.traceable_obligation) / Number(r.obligation) * 100 : 0;
    const pctOk = Math.abs(pct - Number(r.traceable_pct)) <= 0.01;
    const why = !foots
      ? `traceable + untraceable (${(parts / 1e9).toFixed(3)}B) does not foot to the obligation `
        + `(${(Number(r.obligation) / 1e9).toFixed(3)}B)`
      : !pctOk
      ? `traceable_pct is ${Number(r.traceable_pct).toFixed(2)}% but the components give ${pct.toFixed(2)}%`
      : null;
    return { fiscal_year: r.fiscal_year, observed: parts, expected: r.obligation,
      variance_pct: Number(r.traceable_pct),
      status: why ? 'fail' : 'pass',
      message: why
        ? `FY${r.fiscal_year} program ${r.program_code}: ${why} — the traceable share cannot be published beside this total.`
        : `FY${r.fiscal_year} program ${r.program_code}: `
          + `${Number(r.traceable_pct).toFixed(1)}% of obligations name a funding Treasury account.` };
  }),
  'PROG-04': async (c) => {
    const { rows } = await c.query(`
      SELECT count(*)::int AS n FROM dm_program_account a
        JOIN dm_load l ON l.id = a.load_id AND l.is_current
       WHERE a.has_out_of_scope
         AND coalesce(array_length(a.out_of_scope_accounts, 1), 0) = 0`);
    const { rows: found } = await c.query(`
      SELECT count(*)::int AS n, coalesce(sum(a.obligation),0) AS ob
        FROM dm_program_account a JOIN dm_load l ON l.id = a.load_id AND l.is_current
       WHERE a.has_out_of_scope`);
    return [{ observed: rows[0].n, expected: 0, status: rows[0].n === 0 ? 'pass' : 'fail',
      message: rows[0].n === 0
        ? `${found[0].n} account sets naming an out-of-scope account (${(found[0].ob / 1e9).toFixed(2)}B) are disclosed with the accounts named.`
        : `${rows[0].n} rows are flagged out-of-scope without naming which account.` }];
  },
  'PROG-05': async (c) => {
    const { rows } = await c.query(`
      SELECT f.fiscal_year, bool_or(f.is_partial_year) AS flagged
        FROM dm_program_fy f JOIN dm_load l ON l.id = f.load_id AND l.is_current
       GROUP BY f.fiscal_year ORDER BY f.fiscal_year`);
    const newest = Math.max(...rows.map((r) => r.fiscal_year));
    return rows.map((r) => ({ fiscal_year: r.fiscal_year,
      status: r.flagged === (r.fiscal_year === newest) ? 'pass' : 'fail',
      message: `FY${r.fiscal_year} is ${r.flagged ? '' : 'not '}flagged period-to-date`
        + ` (newest year in the current contract vintage is FY${newest}).` }));
  },
  'PROG-06': async (c) => (await c.query(`
    SELECT fiscal_year, total_obligation, attributed_obligation, unattributed_obligation,
           attributed_pct, program_count
      FROM dm_program_coverage p JOIN dm_load l ON l.id = p.load_id AND l.is_current
     ORDER BY fiscal_year`)).rows.map((r) => {
    const parts = Number(r.attributed_obligation) + Number(r.unattributed_obligation);
    const foots = Math.abs(parts - Number(r.total_obligation)) <= Math.max(1, Math.abs(Number(r.total_obligation)) * 1e-6);
    return { fiscal_year: r.fiscal_year, observed: r.attributed_obligation, expected: r.total_obligation,
      variance_pct: Number(r.attributed_pct), status: foots ? 'pass' : 'fail',
      message: foots
        ? `FY${r.fiscal_year}: ${Number(r.attributed_pct).toFixed(1)}% of contract obligations `
          + `carry an acquisition program code across ${r.program_count} programs; the rest are FPDS code 000 (NONE).`
        : `FY${r.fiscal_year}: attributed + unattributed (${(parts / 1e9).toFixed(2)}B) does not foot to the `
          + `fiscal-year total (${(Number(r.total_obligation) / 1e9).toFixed(2)}B), so the coverage denominator is not trustworthy.` };
  }),

  // ------------------------------------------------------------ exhibits --
  // The -1 books are the only source here keyed on a budget line. Four of these
  // five are critical, because each blocks a specific way the restatement
  // structure can be flattened into a single wrong number.
  'EXH-01': async (c) => (await c.query(`
    WITH cover AS (
      SELECT f.fiscal_year,
             count(DISTINCT b.pb_year) AS books_held,
             count(DISTINCT f.fy_role) AS roles_present
        FROM dm_exhibit_program_fy f
        JOIN dm_load l ON l.id = f.load_id AND l.is_current
        LEFT JOIN (SELECT DISTINCT load_id, pb_year FROM dm_exhibit_program_fy) b
               ON b.load_id = f.load_id
              AND b.pb_year IN (f.fiscal_year, f.fiscal_year + 1, f.fiscal_year + 2)
       GROUP BY f.fiscal_year)
    SELECT fiscal_year, books_held, roles_present FROM cover ORDER BY fiscal_year`)).rows.map((r) => {
    const ok = Number(r.roles_present) === Number(r.books_held);
    return { fiscal_year: r.fiscal_year, observed: r.roles_present, expected: r.books_held,
      status: ok ? 'pass' : 'fail',
      message: ok
        ? `FY${r.fiscal_year} is restated in all ${r.books_held} President's Budget book(s) that cover it `
          + `(${r.roles_present} distinct role${Number(r.roles_present) === 1 ? '' : 's'} kept).`
        : `FY${r.fiscal_year} appears in ${r.books_held} book(s) but only ${r.roles_present} role(s) survived `
          + `— the restatement history has been collapsed.` };
  }),
  'EXH-02': async (c) => {
    const q = (t) => `
      SELECT count(*)::int AS n FROM ${t} x JOIN dm_load l ON l.id = x.load_id AND l.is_current
       WHERE x.fy_role <> CASE WHEN x.fiscal_year = x.pb_year - 2 THEN 'prior_actual'
                               WHEN x.fiscal_year = x.pb_year - 1 THEN 'enacted'
                               WHEN x.fiscal_year = x.pb_year     THEN 'request'
                               ELSE 'other' END`;
    const a = (await c.query(q('dm_exhibit_line'))).rows[0].n;
    const b = (await c.query(q('dm_exhibit_program_fy'))).rows[0].n;
    return [{ observed: a + b, expected: 0, status: a + b === 0 ? 'pass' : 'fail',
      message: a + b === 0
        ? "Every exhibit row's role — actual, enacted or request — is derived from the book year it was read from."
        : `${a + b} exhibit rows carry a role that does not follow from their book year.` }];
  },
  'EXH-03': async (c) => {
    const { rows } = await c.query(`
      SELECT count(*)::int AS n FROM dm_exhibit_line x JOIN dm_load l ON l.id = x.load_id AND l.is_current
       WHERE x.is_memo = false
         AND (x.exhibit = 'p1r' OR coalesce(x.cost_type_title,'') ILIKE '%MEMO NON ADD%')`);
    const { rows: kept } = await c.query(`
      SELECT count(*)::int AS n, coalesce(sum(x.amount_k),0) AS k
        FROM dm_exhibit_line x JOIN dm_load l ON l.id = x.load_id AND l.is_current
       WHERE x.is_memo`);
    return [{ observed: rows[0].n, expected: 0, status: rows[0].n === 0 ? 'pass' : 'fail',
      message: rows[0].n === 0
        ? `${kept[0].n} memo rows (${(kept[0].k / 1e6).toFixed(1)}B of reserve, guard and non-TOA restatement) `
          + 'are flagged and held out of every total.'
        : `${rows[0].n} memo rows are unflagged and would be summed into a published total.` }];
  },
  'EXH-04': async (c) => {
    const { rows } = await c.query(`
      SELECT count(*)::int AS n FROM (
        SELECT r.amount_k AS rolled, coalesce(sum(x.amount_k), 0) AS detail
          FROM dm_exhibit_program_fy r
          JOIN dm_load l ON l.id = r.load_id AND l.is_current
          LEFT JOIN dm_exhibit_line x
                 ON x.load_id = r.load_id AND x.exhibit = r.exhibit AND x.account = r.account
                AND x.bli = r.bli AND x.pb_year = r.pb_year AND x.fiscal_year = r.fiscal_year
                AND x.is_memo = r.is_memo
         GROUP BY r.id, r.amount_k) t
       WHERE abs(t.rolled - t.detail) > greatest(0.001, abs(t.rolled) * 1e-5)`);
    const { rows: tot } = await c.query(`
      SELECT count(*)::int AS n FROM dm_exhibit_program_fy r
        JOIN dm_load l ON l.id = r.load_id AND l.is_current`);
    return [{ observed: rows[0].n, expected: 0, status: rows[0].n === 0 ? 'pass' : 'fail',
      message: rows[0].n === 0
        ? `All ${tot[0].n.toLocaleString()} rolled-up budget-line figures foot to the exhibit rows they came from.`
        : `${rows[0].n} rolled-up figures do not foot to their own detail.` }];
  },
  'EXH-05': async (c) => {
    const { rows } = await c.query(`
      SELECT count(*)::int AS n FROM dm_exhibit_line x JOIN dm_load l ON l.id = x.load_id AND l.is_current
       WHERE x.total_basis NOT IN ('total_column','sole_column','sum_of_components')
          OR coalesce(x.total_column,'') = ''`);
    const { rows: mix } = await c.query(`
      SELECT x.total_basis AS basis, count(*)::int AS n
        FROM dm_exhibit_line x JOIN dm_load l ON l.id = x.load_id AND l.is_current
       GROUP BY 1 ORDER BY 2 DESC`);
    return [{ observed: rows[0].n, expected: 0, status: rows[0].n === 0 ? 'pass' : 'fail',
      message: rows[0].n === 0
        ? 'Every exhibit figure names the column it came from: '
          + mix.map((m) => `${m.n.toLocaleString()} ${m.basis.replace(/_/g, ' ')}`).join(', ') + '.'
        : `${rows[0].n} exhibit figures do not name the column they came from.` }];
  },
  'EXH-06': async (c) => {
    const { rows } = await c.query(`
      SELECT count(*)::int AS n FROM dm_exhibit_program p JOIN dm_load l ON l.id = p.load_id AND l.is_current
       WHERE p.treasury_account IS NOT NULL AND p.treasury_account !~ '^[0-9]{3}-[0-9]{4}$'`);
    const { rows: cov } = await c.query(`
      SELECT count(*)::int AS n,
             count(*) FILTER (WHERE p.treasury_account IS NOT NULL)::int AS resolved
        FROM dm_exhibit_program p JOIN dm_load l ON l.id = p.load_id AND l.is_current`);
    const pct = cov[0].n ? cov[0].resolved / cov[0].n * 100 : 0;
    return [{ observed: cov[0].resolved, expected: cov[0].n, variance_pct: pct,
      status: rows[0].n === 0 ? 'pass' : 'fail',
      message: rows[0].n === 0
        ? `${pct.toFixed(1)}% of budget lines (${cov[0].resolved.toLocaleString()} of `
          + `${cov[0].n.toLocaleString()}) resolve to a Treasury account, and every one is well formed.`
        : `${rows[0].n} budget lines carry a malformed Treasury account symbol.` }];
  },
  'EXH-07': async (c) => {
    const { rows } = await c.query(`
      SELECT count(*)::int AS n FROM dm_exhibit_weapon_link w JOIN dm_load l ON l.id = w.load_id AND l.is_current
       WHERE coalesce(w.match_method,'') = '' OR coalesce(w.match_evidence,'') = ''`);
    const { rows: cov } = await c.query(`
      WITH newest AS (SELECT max(s.pb_year) AS pb FROM dm_weapon_system s
                        JOIN dm_load l ON l.id = s.load_id AND l.is_current)
      SELECT count(*)::int AS systems,
             count(*) FILTER (WHERE EXISTS (
               SELECT 1 FROM dm_exhibit_weapon_link w
                WHERE w.load_id = s.load_id AND w.weapon_program = s.program_name
                  AND w.pb_year = s.pb_year))::int AS linked
        FROM dm_weapon_system s
        JOIN dm_load l ON l.id = s.load_id AND l.is_current
       WHERE s.pb_year = (SELECT pb FROM newest)`);
    const pct = cov[0].systems ? cov[0].linked / cov[0].systems * 100 : 0;
    return [{ observed: cov[0].linked, expected: cov[0].systems, variance_pct: pct,
      status: rows[0].n === 0 ? 'pass' : 'fail',
      message: rows[0].n === 0
        ? `${cov[0].linked} of ${cov[0].systems} weapon systems in the newest book reach a budget line `
          + `(${pct.toFixed(0)}%); every link names the evidence it rests on.`
        : `${rows[0].n} weapons-book links do not name how they were made.` }];
  },
  // The only control here that reaches outside the extract for its expectation.
  'EXH-08': async (c) => (await c.query(`
    SELECT t.pb_year, t.measure, t.exhibit, t.published_b, t.citation,
           coalesce(sum(f.amount_k), 0) / 1e6 AS extracted_b
      FROM dm_exhibit_tieout t
      JOIN dm_load l ON l.id = t.load_id AND l.is_current
      LEFT JOIN dm_exhibit_program_fy f
             ON f.load_id = t.load_id AND f.pb_year = t.pb_year
            AND f.fy_role = 'request' AND f.is_memo = false
            AND f.exhibit = t.exhibit
     WHERE t.exhibit IS NOT NULL
     GROUP BY t.pb_year, t.measure, t.exhibit, t.published_b, t.citation
     ORDER BY t.pb_year, t.measure`)).rows.map((r) => {
    // The book prints one decimal place, so anything inside half of that last
    // digit is agreement and anything outside it is a real difference.
    const d = Math.abs(Number(r.extracted_b) - Number(r.published_b));
    const ok = d <= 0.05;
    return { fiscal_year: r.pb_year, observed: r.extracted_b, expected: r.published_b,
      tolerance: 0.05, variance_pct: Number(r.published_b) ? d / Number(r.published_b) * 100 : 0,
      status: ok ? 'pass' : 'fail',
      message: ok
        ? `PB${r.pb_year} ${r.measure}: the ${r.exhibit.toUpperCase()} lines total `
          + `$${Number(r.extracted_b).toFixed(1)}B, the figure the Department publishes in `
          + `${r.citation.split(',')[0]}.`
        : `PB${r.pb_year} ${r.measure}: the ${r.exhibit.toUpperCase()} lines total `
          + `$${Number(r.extracted_b).toFixed(1)}B against the $${Number(r.published_b).toFixed(1)}B `
          + `the Department publishes — a $${d.toFixed(1)}B difference the extract cannot explain.` };
  }),
  // --------------------------------------------- File C, and what it can bear --
  // FILEC-01 is a SHAPE, not a check, in the sense PROG-03 is: it asserts the
  // data layer cannot render the published linkage figure without the
  // alternatives that were rejected to produce it. Every fiscal year with a
  // published figure must carry its full submission-period series, and the
  // published period must be in that series.
  'FILEC-01': async (c) => {
    const { rows } = await c.query(`
      SELECT count(*)::int AS years,
             count(*) FILTER (WHERE p.periods IS NULL OR p.periods = 0)::int AS no_series,
             count(*) FILTER (WHERE p.chosen IS DISTINCT FROM true)::int AS no_chosen
        FROM dm_reconciliation r
        JOIN dm_load l ON l.id = r.load_id AND l.is_current
        LEFT JOIN LATERAL (
          SELECT count(*)::int AS periods,
                 bool_or(f.submission_period = r.submission_period AND f.is_chosen) AS chosen
            FROM dm_filec_period f
           WHERE f.load_id = r.load_id AND f.fiscal_year = r.fiscal_year) p ON true`);
    const { years, no_series, no_chosen } = rows[0];
    const bad = no_series + no_chosen;
    return [{ observed: years - bad, expected: years, status: bad === 0 ? 'pass' : 'fail',
      message: bad === 0
        ? `All ${years} fiscal years carry the full File C submission-period series behind the `
          + 'figure published for them, with the published period flagged inside it. The headline '
          + 'cannot be rendered without the snapshots it was chosen over.'
        : `${bad} fiscal years publish a File C figure with no series behind it, or name a period `
          + 'that is not in the series.' }];
  },
  // FILEC-02 is the finding itself. It is not an error to be fixed: it measures
  // how much the answer moves when a different snapshot of the SAME year is
  // read. Where that spread is large, a year-over-year comparison of linkage is
  // not supportable at all, and the site must not draw a trend line through it.
  'FILEC-02': async (c) => (await c.query(`
    WITH sub AS (
      SELECT f.fiscal_year, f.period_no, f.obligation, f.award_obligation, f.filec_rows,
             max(f.filec_rows) OVER (PARTITION BY f.fiscal_year) AS max_rows
        FROM dm_filec_period f JOIN dm_load l ON l.id = f.load_id AND l.is_current
       WHERE f.award_obligation > 0),
    keep AS (SELECT * FROM sub WHERE filec_rows >= max_rows * 0.05)
    SELECT fiscal_year,
           count(*)::int AS snapshots,
           min(obligation / award_obligation * 100) AS lo,
           max(obligation / award_obligation * 100) AS hi
      FROM keep GROUP BY 1 ORDER BY 1`)).rows.map((r) => {
    const lo = Number(r.lo), hi = Number(r.hi);
    const ratio = lo > 0 ? hi / lo : null;
    const ok = r.snapshots < 2 || (ratio !== null && ratio <= 2);
    return { fiscal_year: r.fiscal_year, observed: hi.toFixed(2), expected: lo.toFixed(2),
      variance_pct: ratio === null ? null : (ratio - 1) * 100,
      status: ok ? 'pass' : 'fail',
      message: r.snapshots < 2
        ? `FY${r.fiscal_year}: only one substantive File C snapshot is held, so the linkage figure `
          + 'has no alternative to be compared against and no spread can be measured.'
        : ok
        ? `FY${r.fiscal_year}: ${r.snapshots} snapshots put linkage between ${lo.toFixed(1)}% and `
          + `${hi.toFixed(1)}%, within a factor of two of each other.`
        : `FY${r.fiscal_year}: reading a different File C snapshot of the same year puts linkage `
          + `anywhere between ${lo.toFixed(1)}% and ${hi.toFixed(1)}% — a factor of `
          + `${ratio.toFixed(1)}. The published figure is one of ${r.snapshots} defensible answers, `
          + 'so no year-over-year trend in linkage is supportable from these files.' };
  }),
  // ------------------------------------------- the weapons book's own totals --
  // WBC-01 is an INTERNAL check on the cost-table extract: the book prints a
  // total for each system and the appropriation blocks above it, and they must
  // agree. A page that does not foot has been read wrongly, or is typeset so
  // tightly that a figure cannot be assigned to a column at all -- which is a
  // finding about a handful of pages, not a reason to refuse a load of 545, so
  // the failures are published rather than blocking.
  'WBC-01': async (c) => {
    const { rows } = await c.query(`
      WITH t AS (
        SELECT pb_year, program_name, fiscal_year, amount_m
          FROM dm_weapon_system_cost x JOIN dm_load l ON l.id = x.load_id AND l.is_current
         WHERE x.row_kind = 'total' AND x.amount_m IS NOT NULL),
      b AS (
        SELECT pb_year, program_name, fiscal_year, amount_m
          FROM dm_weapon_system_cost x JOIN dm_load l ON l.id = x.load_id AND l.is_current
         WHERE x.row_kind = 'block_check')
      SELECT count(*)::int AS n,
             count(*) FILTER (WHERE abs(b.amount_m - t.amount_m)
                                    > greatest(0.6, abs(t.amount_m) * 0.002))::int AS off
        FROM t JOIN b USING (pb_year, program_name, fiscal_year)`);
    const { n, off } = rows[0];
    const pct = n ? (n - off) / n * 100 : 0;
    return [{ observed: n - off, expected: n, variance_pct: n ? off / n * 100 : 0,
      status: off / Math.max(n, 1) <= 0.03 ? 'pass' : 'fail',
      message: `${n - off} of ${n} weapon-system years foot to the total printed on the same page `
        + `(${pct.toFixed(1)}%). The ${off} that do not are pages whose figures cannot be assigned `
        + 'to a column with confidence; they are kept and named rather than absorbed.' }];
  },
  // WBC-02 is the per-system version of EXH-08, and it is the one that answers
  // "do these budget lines carry the whole programme". The weapons book states
  // what a system costs; the -1 exhibits itemise the same request across several
  // budget lines and several appropriations. Neither direction of a break is an
  // arithmetic error, and both are published rather than repaired:
  //
  //   SHORT -- the crosswalk has not reached some of the system's spares,
  //     modification or support lines. Their titles carry no shared designator
  //     ("Aircraft Spares and Repair Parts" names no aircraft), so they cannot
  //     be tied back on evidence and are not counted. This is the common case
  //     and it is why no programme total on this site is called complete.
  //   OVER -- the lines tied to the system carry MORE than the book states for
  //     it, because a budget line can be broader than one programme: the NGSW
  //     ammunition line funds the ammunition the weapons-book page excludes, and
  //     one R-1 program element can fund several systems. The exhibits publish
  //     no split inside a line, so nothing here apportions one.
  //
  // What this control must never be allowed to do is make the roll-up agree by
  // dropping links until it fits. It reports the gap; it does not close it.
  'WBC-02': async (c) => {
    const { rows } = await c.query(`
      WITH pub AS (
        SELECT x.pb_year, x.program_name, x.amount_m * 1000 AS published_k
          FROM dm_weapon_system_cost x JOIN dm_load l ON l.id = x.load_id AND l.is_current
         WHERE x.row_kind = 'total' AND x.fy_role = 'request' AND x.amount_m IS NOT NULL),
      roll AS (
        SELECT w.pb_year, w.weapon_program AS program_name,
               sum(f.amount_k) AS rolled_k, count(DISTINCT (f.exhibit, f.account, f.bli))::int AS lines
          FROM dm_exhibit_weapon_link w
          JOIN dm_load l ON l.id = w.load_id AND l.is_current
          JOIN dm_exhibit_program_fy f
            ON f.load_id = w.load_id AND f.exhibit = w.exhibit AND f.account = w.account
           AND f.bli = w.bli AND f.pb_year = w.pb_year AND f.fy_role = 'request'
           AND f.is_memo = false
         GROUP BY 1, 2)
      SELECT count(*)::int AS n,
             count(*) FILTER (WHERE r.rolled_k > p.published_k * 1.005)::int AS over,
             count(*) FILTER (WHERE r.rolled_k < p.published_k * 0.995)::int AS under,
             coalesce(sum(r.rolled_k) / nullif(sum(p.published_k), 0) * 100, 0) AS covered_pct
        FROM pub p JOIN roll r USING (pb_year, program_name)`);
    const { n, over, under, covered_pct } = rows[0];
    return [{ observed: Number(covered_pct).toFixed(1), expected: 100, variance_pct: over,
      status: over === 0 ? 'pass' : 'fail',
      message: over === 0
        ? `Across ${n} system-years the budget lines tied to a weapon system total `
          + `${Number(covered_pct).toFixed(0)}% of what the Department publishes for those systems; `
          + `${under} fall short, which is the crosswalk missing a spares, modification or support `
          + 'line rather than money going missing. None carries more than its published total.'
        : `${under} of ${n} system-years reach less than the Department publishes for the system — `
          + 'the crosswalk cannot tie back spares, modification and support lines whose titles name '
          + `no system. ${over} reach MORE, because a budget line can be broader than one programme `
          + '(the NGSW ammunition line, one R-1 element funding several systems), and the exhibits '
          + 'publish no split inside a line for anything here to apportion. Both gaps are shown on '
          + 'the system, and neither is closed by dropping links until the figures agree.' }];
  },
  // An alias is a search aid, so the risk it carries is not an arithmetic one:
  // it is that "JSF" quietly starts meaning something the book never said.
  'WBC-03': async (c) => {
    const { rows } = await c.query(`
      SELECT count(*)::int AS n,
             count(*) FILTER (WHERE coalesce(a.match_evidence,'') = ''
                                 OR a.match_method NOT IN ('book_parenthetical','name_parenthetical')
                                 OR NOT EXISTS (SELECT 1 FROM dm_weapon_system s
                                                 WHERE s.load_id = a.load_id
                                                   AND s.program_name = a.weapon_program))::int AS bad
        FROM dm_weapon_alias a JOIN dm_load l ON l.id = a.load_id AND l.is_current`);
    const { n, bad } = rows[0];
    return [{ observed: n - bad, expected: n, status: bad === 0 ? 'pass' : 'fail',
      message: bad === 0
        ? `${n} search abbreviations, every one of them a phrase the weapons book itself expands `
          + 'into the named system, quoted on the row. No synonym is invented here.'
        : `${bad} abbreviations name no evidence or no system in the book.` }];
  },
  'EXH-09': async (c) => {
    const { rows } = await c.query(`
      SELECT count(*)::int AS n FROM dm_exhibit_program_link x
        JOIN dm_load l ON l.id = x.load_id AND l.is_current
       WHERE x.match_method NOT IN ('designator','exact_name')
          OR coalesce(x.match_evidence,'') = ''
          OR NOT EXISTS (SELECT 1 FROM dm_exhibit_program p
                          WHERE p.exhibit = x.exhibit AND p.account = x.account AND p.bli = x.bli)`);
    const { rows: cov } = await c.query(`
      SELECT count(DISTINCT (x.exhibit, x.account, x.bli))::int AS lines,
             count(DISTINCT x.program_code)::int AS codes
        FROM dm_exhibit_program_link x JOIN dm_load l ON l.id = x.load_id AND l.is_current`);
    const { rows: tot } = await c.query(`
      SELECT count(*)::int AS n FROM dm_program_dim d
        JOIN dm_load l ON l.id = d.load_id AND l.is_current`);
    return [{ observed: cov[0].lines, expected: null, status: rows[0].n === 0 ? 'pass' : 'fail',
      message: rows[0].n === 0
        ? `${cov[0].lines} budget lines reach ${cov[0].codes} of ${tot[0].n} FPDS acquisition program `
          + 'codes on a shared type designator or an identical name; nothing weaker is accepted, so a '
          + 'line with no link has none rather than a plausible one.'
        : `${rows[0].n} budget-line links name no evidence or no budget line.` }];
  },
  // ---- the seven display tables ------------------------------------------
  // PB-01 is the one that makes the memo rules on these exhibits checkable
  // rather than merely argued: every sheet prints its own column totals, so an
  // extract that drops a row it should not stops matching the Department's own
  // footer straight away.
  // The comparison is made against dm_pb_line, NOT against the counted and memo
  // columns of dm_pb_tieout. Those two columns come from the same in-memory
  // sums as the tieout's own footer figure, so a control reading them checks the
  // extract's bookkeeping against itself and passes however wrong the rows that
  // actually reach the page are. Re-summing the published lines is what makes
  // this an assertion about the data rather than about the ETL -- and it is what
  // a deliberate corruption of a single O-1 line proved: the earlier form of
  // this control did not notice.
  'PB-01': async (c) => (await c.query(`
    WITH lines AS (
      SELECT pb_year, exhibit, sheet_name, fiscal_year, sum(amount_k) AS got
        FROM dm_pb_line p JOIN dm_load l ON l.id = p.load_id AND l.is_current
       GROUP BY 1, 2, 3, 4)
    SELECT t.pb_year, t.exhibit, t.sheet_name, t.fiscal_year,
           t.published_k AS expected, coalesce(lines.got, 0) AS observed
      FROM dm_pb_tieout t JOIN dm_load l ON l.id = t.load_id AND l.is_current
      LEFT JOIN lines ON lines.pb_year = t.pb_year AND lines.exhibit = t.exhibit
                     AND lines.sheet_name = t.sheet_name AND lines.fiscal_year = t.fiscal_year
     WHERE t.published_k IS NOT NULL
     ORDER BY t.pb_year, t.exhibit, t.fiscal_year`)).rows.map((r) => {
    const d = Math.abs(Number(r.observed) - Number(r.expected));
    return { fiscal_year: r.fiscal_year, observed: r.observed, expected: r.expected,
      tolerance: 1, status: d <= 1 ? 'pass' : 'fail',
      message: `PB${r.pb_year} ${r.exhibit.toUpperCase()} ${r.sheet_name}, FY${r.fiscal_year}: `
        + `the published lines sum to $${(d / 1e3).toFixed(3)}M from the sheet's own published total.` };
  }),
  'PB-02': async (c) => (await c.query(`
    SELECT pb_year, exhibit, fiscal_year,
           sum(amount_k) AS expected, sum(discretionary_k) + sum(mandatory_k) AS observed
      FROM dm_pb_line p JOIN dm_load l ON l.id = p.load_id AND l.is_current
     GROUP BY pb_year, exhibit, fiscal_year
     ORDER BY pb_year, exhibit, fiscal_year`)).rows.map((r) => {
    const d = Math.abs(Number(r.observed) - Number(r.expected));
    return { fiscal_year: r.fiscal_year, observed: r.observed, expected: r.expected,
      tolerance: 1, status: d <= 1 ? 'pass' : 'fail',
      message: `PB${r.pb_year} ${r.exhibit.toUpperCase()} FY${r.fiscal_year}: `
        + `discretionary plus mandatory is $${(d / 1e3).toFixed(3)}M from the total.` };
  }),
  'PB-03': async (c) => {
    const { rows } = await c.query(`
      SELECT pb_year, count(*)::int AS n, coalesce(sum(amount_k),0) AS amt
        FROM dm_pb_line p JOIN dm_load l ON l.id = p.load_id AND l.is_current
       WHERE exhibit = 'p1r' AND is_memo = false
       GROUP BY pb_year ORDER BY pb_year`);
    const held = await c.query(`
      SELECT coalesce(sum(amount_k),0) AS amt
        FROM dm_pb_line p JOIN dm_load l ON l.id = p.load_id AND l.is_current
       WHERE exhibit = 'p1r' AND fy_role = 'request'`);
    if (!rows.length) return [{ observed: 0, expected: 0, status: 'pass',
      message: 'No P-1R row is counted into a total. The exhibit holds $'
        + (Number(held.rows[0].amt) / 1e6).toFixed(1) + 'B of equipment already inside the P-1 lines.' }];
    return rows.map((r) => ({ fiscal_year: r.pb_year, observed: r.n, expected: 0, status: 'fail',
      message: `PB${r.pb_year}: ${r.n} P-1R rows carrying $${(Number(r.amt) / 1e6).toFixed(1)}B `
        + 'are not flagged memo and would be counted twice.' }));
  },
  'PB-04': async (c) => (await c.query(`
    WITH recon AS (
      SELECT p.pb_year, p.account, p.bli, p.fiscal_year, sum(p.amount_k) AS recon_k
        FROM dm_pb_line p JOIN dm_load l ON l.id = p.load_id AND l.is_current
       WHERE p.exhibit = 'c1' AND p.memo_reason = 'c1_reconciliation_breakout'
       GROUP BY 1,2,3,4),
    yearsheet AS (
      SELECT p.pb_year, p.account, p.bli, p.fiscal_year, sum(p.amount_k) AS year_k
        FROM dm_pb_line p JOIN dm_load l ON l.id = p.load_id AND l.is_current
       WHERE p.exhibit = 'c1' AND p.memo_reason IS DISTINCT FROM 'c1_reconciliation_breakout'
       GROUP BY 1,2,3,4)
    SELECT r.pb_year, r.fiscal_year,
           count(*)::int AS n,
           count(*) FILTER (WHERE y.year_k IS NOT NULL AND y.year_k >= r.recon_k - 1)::int AS ok,
           coalesce(sum(r.recon_k),0) AS recon_k
      FROM recon r LEFT JOIN yearsheet y
        ON y.pb_year=r.pb_year AND y.account=r.account AND y.bli=r.bli AND y.fiscal_year=r.fiscal_year
     GROUP BY 1,2 ORDER BY 1,2`)).rows.map((r) => ({
    fiscal_year: r.fiscal_year, observed: r.ok, expected: r.n,
    status: r.ok === r.n ? 'pass' : 'fail',
    message: `PB${r.pb_year} FY${r.fiscal_year}: ${r.ok} of ${r.n} reconciliation projects carrying `
      + `$${(Number(r.recon_k) / 1e6).toFixed(2)}B are inside the year sheet at no less than the `
      + 'reconciliation amount, so the sheet is a breakout rather than money beside it.' })),
  'PB-05': async (c) => (await c.query(`
    SELECT pb_year, count(*)::int AS n,
           count(*) FILTER (WHERE treasury_account IS NOT NULL)::int AS resolved
      FROM dm_pb_line p JOIN dm_load l ON l.id = p.load_id AND l.is_current
     WHERE is_memo = false
     GROUP BY pb_year ORDER BY pb_year`)).rows.map((r) => ({
    fiscal_year: r.pb_year, observed: r.resolved, expected: r.n,
    status: r.resolved === r.n ? 'pass' : 'fail',
    message: `PB${r.pb_year}: ${r.resolved} of ${r.n} counted rows resolve their exhibit account `
      + 'symbol to a Treasury agency and account.' })),

  // ---- execution detail and timing ---------------------------------------
  // The detail is only worth having if it adds up to the figure the site
  // already publishes. EXEC-01 is that assertion, and it is critical: a detail
  // table that does not foot to its own total is worse than no detail table,
  // because every drill-down built on it would disagree with the page above it.
  'EXEC-01': async (c) => (await c.query(`
    SELECT s.fiscal_year, s.obligations_incurred AS expected,
           coalesce(sum(a.obligations), 0) AS observed
      FROM dm_obligation_stage s
      JOIN dm_load ls ON ls.id = s.load_id AND ls.is_current
      LEFT JOIN dm_exec_account_fy a ON a.fiscal_year = s.fiscal_year AND a.scope = s.scope
      LEFT JOIN dm_load la ON la.id = a.load_id AND la.is_current
     WHERE s.scope = 'DOW'
     GROUP BY s.fiscal_year, s.obligations_incurred
     ORDER BY s.fiscal_year`)).rows.map((r) => {
    const v = Math.abs(r.observed - r.expected) / Math.max(1, Math.abs(r.expected)) * 100;
    return { fiscal_year: r.fiscal_year, observed: r.observed, expected: r.expected,
      tolerance: 0.01, variance_pct: v, status: v <= 0.01 ? 'pass' : 'fail',
      message: `FY${r.fiscal_year}: account-level File B detail is ${v.toFixed(4)}% from the `
        + 'Department obligation total the execution page publishes.' };
  }),
  'EXEC-02': async (c) => (await c.query(`
    SELECT f.fiscal_year, f.obligations AS expected,
           coalesce(sum(d.obligations), 0) AS observed, f.detail_rows, f.collapsed_rows
      FROM dm_exec_fy f
      JOIN dm_load lf ON lf.id = f.load_id AND lf.is_current
      LEFT JOIN dm_exec_detail d ON d.fiscal_year = f.fiscal_year AND d.scope = f.scope
      LEFT JOIN dm_load ld ON ld.id = d.load_id AND ld.is_current
     WHERE f.scope = 'DOW' AND f.has_detail
     GROUP BY f.fiscal_year, f.obligations, f.detail_rows, f.collapsed_rows
     ORDER BY f.fiscal_year`)).rows.map((r) => {
    const v = Math.abs(r.observed - r.expected) / Math.max(1, Math.abs(r.expected)) * 100;
    return { fiscal_year: r.fiscal_year, observed: r.observed, expected: r.expected,
      tolerance: 0.01, variance_pct: v, status: v <= 0.01 ? 'pass' : 'fail',
      message: `FY${r.fiscal_year}: ${Number(r.detail_rows).toLocaleString()} detail rows `
        + `(${Number(r.collapsed_rows).toLocaleString()} PARK-replicated source rows counted once) `
        + `sum to within ${v.toFixed(4)}% of the year's obligations.` };
  }),
  // Not a pass/fail on the Department: a measurement of how much of the year's
  // money this extract can say expires on 30 September and how much it cannot.
  'EXEC-03': async (c) => (await c.query(`
    SELECT fiscal_year, sum(obligations) AS total,
           sum(obligations) FILTER (WHERE fund_life = 'unknown') AS unknown,
           sum(obligations) FILTER (WHERE fund_life = 'annual') AS annual
      FROM dm_exec_account_fy a JOIN dm_load l ON l.id = a.load_id AND l.is_current
     WHERE scope = 'DOW' GROUP BY fiscal_year ORDER BY fiscal_year`)).rows.map((r) => {
    const unk = Number(r.unknown || 0), tot = Number(r.total || 1);
    const pct = Math.abs(unk / tot * 100);
    return { fiscal_year: r.fiscal_year, observed: unk, expected: 0, tolerance: 1,
      variance_pct: pct, status: pct <= 1 ? 'pass' : 'fail',
      message: `FY${r.fiscal_year}: $${(Number(r.annual || 0) / 1e9).toFixed(1)}B of obligations are `
        + `on annual authority that expires 30 September; ${pct.toFixed(2)}% of the year could not `
        + 'have its period of availability resolved.' };
  }),
  // The daily curve is the spine of every pace and year-end figure on the
  // execution page. If it does not foot to the contract total the site already
  // publishes, every projection drawn from it is wrong by the same amount.
  'TIME-01': async (c) => (await c.query(`
    SELECT y.fiscal_year, a.obligation AS expected, y.obligation AS observed,
           y.last_day_of_fy, y.is_complete_year
      FROM dm_fpds_year y JOIN dm_load ly ON ly.id = y.load_id AND ly.is_current
      JOIN dm_award_fy a ON a.fiscal_year = y.fiscal_year
      JOIN dm_load la ON la.id = a.load_id AND la.is_current
     ORDER BY y.fiscal_year`)).rows.map((r) => {
    const v = Math.abs(r.observed - r.expected) / Math.max(1, Math.abs(r.expected)) * 100;
    return { fiscal_year: r.fiscal_year, observed: r.observed, expected: r.expected,
      tolerance: 0.01, variance_pct: v, status: v <= 0.01 ? 'pass' : 'fail',
      message: `FY${r.fiscal_year}: the day-by-day curve sums to within ${v.toFixed(4)}% of the `
        + `contract obligation total, through day ${r.last_day_of_fy}`
        + `${r.is_complete_year ? '' : ' (year in progress)'}.` };
  }),
  // A signal computed against fewer than three of a category's own years is an
  // anecdote with a z-score printed on it.
  'TIME-02': async (c) => {
    const { rows } = await c.query(`
      SELECT count(*)::int AS n,
             count(*) FILTER (WHERE baseline_years >= 3)::int AS ok,
             count(*) FILTER (WHERE evidence = '' OR method = '')::int AS bare,
             count(*) FILTER (WHERE abs(deviation) >= 99)::int AS capped
        FROM dm_exec_signal s JOIN dm_load l ON l.id = s.load_id AND l.is_current`);
    const r = rows[0];
    if (!r || !r.n) return [];
    return [{ observed: r.ok, expected: r.n,
      status: (r.ok === r.n && r.bare === 0) ? 'pass' : 'fail',
      message: `${r.ok} of ${r.n} signals are computed against at least three of the category's own `
        + `years and every one names its evidence and method; ${r.capped} report a deviation at the `
        + 'cap, which means far outside the category’s own history rather than a measurement.' }];
  },
  // The live year is shorter than the years it is compared with, and saying so
  // is the whole difference between a pace figure and a false decline.
  'TIME-03': async (c) => (await c.query(`
    SELECT fiscal_year, is_complete_year, last_day_of_fy, full_months_observed,
           to_char(last_action_date,'YYYY-MM-DD') AS last_date
      FROM dm_fpds_year y JOIN dm_load l ON l.id = y.load_id AND l.is_current
     ORDER BY fiscal_year`)).rows.map((r) => ({
    fiscal_year: r.fiscal_year, observed: r.last_day_of_fy,
    expected: r.is_complete_year ? r.last_day_of_fy : null,
    status: (r.is_complete_year === (r.last_day_of_fy >= 360)) ? 'pass' : 'fail',
    message: `FY${r.fiscal_year}: ${r.is_complete_year ? 'complete' : 'in progress'}, last action `
      + `${r.last_date}, ${r.full_months_observed} whole fiscal months observed.` })),

  // The frontier is what every pace figure and September projection on the
  // execution page is measured over. If it were taken from the maximum action
  // date instead, the live year would be compared over months it does not have.
  // RECOMPUTED from dm_fpds_day, not read back from dm_fpds_year. A control
  // that only bounds-checks the published frontier -- non-zero, no later than
  // the last action, a small tail -- passes a frontier taken straight from the
  // maximum action date, which is exactly the bug this control exists for. It
  // was written that way first and a deliberate corruption walked through it.
  // So the month rule is applied again here, in SQL, against the daily rows: a
  // fiscal month is observed when it carries at least half the median month's
  // action count, and the frontier is the end of the last observed month
  // counting consecutively from October.
  'TIME-04': async (c) => (await c.query(`
    WITH months AS (
      SELECT y.fiscal_year, g.fy_month,
             coalesce(sum(d.action_count), 0) AS n
        FROM (SELECT DISTINCT fiscal_year FROM dm_fpds_day dd
               JOIN dm_load l ON l.id = dd.load_id AND l.is_current) y
        CROSS JOIN generate_series(1, 12) AS g(fy_month)
        LEFT JOIN dm_fpds_day d
          ON d.fiscal_year = y.fiscal_year
         AND ((extract(month from make_date(d.fiscal_year - 1, 10, 1) + (d.day_of_fy - 1))::int + 2) % 12) + 1
             = g.fy_month
         AND d.load_id = (SELECT id FROM dm_load WHERE is_current AND dataset_key = 'contract_timing' LIMIT 1)
       GROUP BY 1, 2),
    med AS (
      SELECT fiscal_year, percentile_cont(0.5) WITHIN GROUP (ORDER BY n) AS med
        FROM months WHERE n > 0 GROUP BY 1),
    flagged AS (
      SELECT m.fiscal_year, m.fy_month, (m.n > 0 AND m.n >= 0.5 * med.med) AS observed
        FROM months m JOIN med ON med.fiscal_year = m.fiscal_year),
    run AS (
      SELECT fiscal_year,
             coalesce(min(fy_month) FILTER (WHERE NOT observed), 13) - 1 AS full_months
        FROM flagged GROUP BY 1)
    SELECT y.fiscal_year, y.full_months_observed AS observed, run.full_months AS expected,
           y.frontier_day_of_fy, y.tail_actions, y.tail_obligation, y.action_count,
           to_char(y.frontier_date,'YYYY-MM-DD') AS frontier,
           to_char(y.last_action_date,'YYYY-MM-DD') AS last_date,
           (CASE WHEN run.full_months >= 12
                 THEN make_date(y.fiscal_year, 9, 30)
                 ELSE make_date(CASE WHEN run.full_months + 1 <= 3 THEN y.fiscal_year - 1 ELSE y.fiscal_year END,
                                (10 + run.full_months - 1) % 12 + 1, 1) - 1 END
            - make_date(y.fiscal_year - 1, 10, 1)) + 1 AS expected_day
      FROM dm_fpds_year y JOIN dm_load l ON l.id = y.load_id AND l.is_current
      JOIN run ON run.fiscal_year = y.fiscal_year
     ORDER BY y.fiscal_year`)).rows.map((r) => {
    const tailPct = Number(r.action_count) ? Number(r.tail_actions) / Number(r.action_count) * 100 : 0;
    const ok = Number(r.observed) === Number(r.expected)
      && Number(r.frontier_day_of_fy) === Number(r.expected_day)
      && tailPct < 20;
    return { fiscal_year: r.fiscal_year, observed: r.observed, expected: r.expected,
      tolerance: 20, variance_pct: tailPct, status: ok ? 'pass' : 'fail',
      message: ok
        ? `FY${r.fiscal_year}: ${r.observed} whole months observed, frontier ${r.frontier}, `
          + `last action dated ${r.last_date}; `
          + (Number(r.tail_actions)
              ? `${Number(r.tail_actions).toLocaleString()} straggler actions `
                + `(${tailPct.toFixed(2)}% of the year, $${(Number(r.tail_obligation) / 1e6).toFixed(1)}M) `
                + 'fall after it and are excluded from every pace and projection.'
              : 'nothing falls after it.')
        : `FY${r.fiscal_year}: the published frontier is ${r.frontier} (day ${r.frontier_day_of_fy}, `
          + `${r.observed} whole months) but the daily rows put it at day ${r.expected_day} `
          + `(${r.expected} whole months)`
          + (tailPct >= 20 ? `, and ${tailPct.toFixed(1)}% of the year falls after it` : '')
          + '. Every pace figure and September projection is measured over that window.' };
  }),

  // ---- currency ------------------------------------------------------------
  // Not a check on the extract: a check on how old it is. An execution page is
  // for the year being executed, and a load that silently trails the published
  // record by a month presents last month as this month.
  'CUR-01': async (c) => {
    const { rows: cal } = await c.query(`
      SELECT max(fiscal_year * 100 + fiscal_month) AS newest,
             count(*)::int AS n,
             to_char(max(reveal_date),'YYYY-MM-DD') AS newest_reveal
        FROM dm_submission_period p JOIN dm_load l ON l.id = p.load_id AND l.is_current
       WHERE NOT is_quarter AND is_revealed`);
    if (!cal.length || cal[0].newest === null) {
      return [{ status: 'not_applicable',
        message: 'No submission calendar in this load, so how far behind it is cannot be '
          + 'measured. Run the currency step from a machine with network access.' }];
    }
    const newest = Number(cal[0].newest);
    // Two queries rather than a UNION: ORDER BY and LIMIT inside a UNION branch
    // are not valid Postgres, and the error aborted the whole load transaction.
    const [fileA, fileB] = await Promise.all([
      c.query(`SELECT submission_period AS period
                 FROM dm_sbr_fy s JOIN dm_load l ON l.id = s.load_id AND l.is_current
                WHERE s.scope = 'DOW' AND s.submission_period IS NOT NULL
                ORDER BY s.fiscal_year DESC LIMIT 1`),
      c.query(`SELECT submission_period AS period
                 FROM dm_exec_fy e JOIN dm_load l ON l.id = e.load_id AND l.is_current
                WHERE e.scope = 'DOW' AND e.submission_period IS NOT NULL
                ORDER BY e.fiscal_year DESC LIMIT 1`),
    ]);
    const held = { rows: [
      ...fileA.rows.map((r) => ({ src: 'File A (Statement of Budgetary Resources)', period: r.period })),
      ...fileB.rows.map((r) => ({ src: 'File B (execution detail)', period: r.period })),
    ] };
    const label = (k) => `FY${Math.floor(k / 100)}P${String(k % 100).padStart(2, '0')}`;
    return held.rows.map((r) => {
      const m = /FY(\d{4})P(\d{2})/.exec(r.period || '');
      if (!m) {
        return { observed: null, expected: newest, status: 'fail',
          message: `${r.src}: submission period "${r.period}" is not readable, so currency `
            + 'cannot be measured.' };
      }
      const have = Number(m[1]) * 100 + Number(m[2]);
      // Periods are 1..12 within a fiscal year, so the gap is months, not the
      // arithmetic difference of the two keys.
      const behind = (Math.floor(newest / 100) - Math.floor(have / 100)) * 12
                   + (newest % 100) - (have % 100);
      return { observed: have, expected: newest, tolerance: 0, variance_pct: behind,
        status: behind <= 0 ? 'pass' : 'fail',
        message: behind <= 0
          ? `${r.src} holds ${label(have)}, which is the newest submission published.`
          : `${r.src} holds ${label(have)} but ${label(newest)} was published on `
            + `${cal[0].newest_reveal} — this load is ${behind} submission period`
            + `${behind === 1 ? '' : 's'} behind. Rebuild the warehouse snapshot, then re-run `
            + 'the ETL and the load.' };
    });
  },

  // ---- direct or reimbursable -----------------------------------------------
  // Every execution figure on the site now defaults to DIRECT, so the split has
  // to be right in the same way the total does. DR-01 recomputes it twice over,
  // from tables the split did not come from:
  //   * the stage totals (step_obligations) against the account rollups
  //     (step_execution) -- two separate passes over the file;
  //   * for years carrying detail, the detail rows summed by their own
  //     funding_source against the account rollup's direct and reimbursable
  //     columns, account by account.
  // A NULL split on any current row fails it: NULL means the load predates the
  // split, and a page reading it as zero would show no direct execution at all.
  'DR-01': async (c) => (await c.query(`
    WITH acct AS (
      SELECT f.fiscal_year,
             sum(f.obligations_direct) AS d, sum(f.obligations_reimbursable) AS r,
             sum(f.obligations) AS t,
             count(*) FILTER (WHERE f.obligations_direct IS NULL OR f.obligations_reimbursable IS NULL)::int AS nulls,
             count(*) FILTER (WHERE abs(f.obligations - coalesce(f.obligations_direct, 0)
                                      - coalesce(f.obligations_reimbursable, 0)) > 1
                                AND f.obligations_direct IS NOT NULL)::int AS overfull
        FROM dm_exec_account_fy f JOIN dm_load l ON l.id = f.load_id AND l.is_current
       WHERE f.scope = 'DOW' GROUP BY f.fiscal_year
    ), det AS (
      SELECT d.fiscal_year, d.treasury_account,
             sum(d.obligations) FILTER (WHERE d.funding_source = 'D') AS d,
             sum(d.obligations) FILTER (WHERE d.funding_source = 'R') AS r
        FROM dm_exec_detail d JOIN dm_load l ON l.id = d.load_id AND l.is_current
       WHERE d.scope = 'DOW' GROUP BY 1, 2
    ), detail_check AS (
      SELECT det.fiscal_year,
             count(*) FILTER (WHERE abs(coalesce(det.d, 0) - coalesce(f.obligations_direct, 0)) > 1
                                 OR abs(coalesce(det.r, 0) - coalesce(f.obligations_reimbursable, 0)) > 1)::int AS bad,
             count(*)::int AS n
        FROM det JOIN dm_exec_account_fy f ON f.fiscal_year = det.fiscal_year
                                          AND f.treasury_account = det.treasury_account AND f.scope = 'DOW'
        JOIN dm_load l ON l.id = f.load_id AND l.is_current
       GROUP BY det.fiscal_year
    )
    SELECT a.fiscal_year, a.d, a.r, a.t, a.nulls, a.overfull,
           s.obligations_incurred_direct AS sd, s.obligations_incurred_reimbursable AS sr,
           dc.bad AS detail_bad, dc.n AS detail_n
      FROM acct a
      LEFT JOIN dm_obligation_stage s ON s.fiscal_year = a.fiscal_year AND s.scope = 'DOW'
       AND s.load_id = (SELECT id FROM dm_load WHERE dataset_key = 'file_b_obligations' AND is_current LIMIT 1)
      LEFT JOIN detail_check dc ON dc.fiscal_year = a.fiscal_year
     ORDER BY a.fiscal_year`)).rows.map((r) => {
    const pct = (o, e) => Math.abs(Number(o ?? 0) - Number(e ?? 0)) / Math.max(1, Math.abs(Number(e ?? 0))) * 100;
    const v = Math.max(pct(r.d, r.sd), pct(r.r, r.sr));
    const ok = Number(r.nulls) === 0 && Number(r.overfull) === 0 && r.sd != null && v <= 0.01
      && Number(r.detail_bad ?? 0) === 0;
    return { fiscal_year: r.fiscal_year, observed: r.d, expected: r.sd, tolerance: 0.01, variance_pct: v,
      status: ok ? 'pass' : 'fail',
      message: ok
        ? `FY${r.fiscal_year}: direct $${(Number(r.d) / 1e9).toFixed(1)}B and reimbursable `
          + `$${(Number(r.r) / 1e9).toFixed(1)}B agree between the stage totals and the account rollups`
          + `${r.detail_n ? `, and account by account with ${Number(r.detail_n).toLocaleString()} accounts' detail rows` : ''}.`
        : `FY${r.fiscal_year}: the direct/reimbursable split does not foot — `
          + `${r.nulls} account rows carry no split, ${r.overfull} split to a different amount than their own total, `
          + `stage vs rollup differs by ${v.toFixed(4)}%`
          + `${r.detail_bad ? `, ${r.detail_bad} accounts disagree with their own detail rows` : ''}.` };
  }),

  // DR-02 publishes what the split is for: how much of File B is reimbursable,
  // where it sits, and how much carries no funding source at all (which is in
  // the total and in neither side). More than 0.1% unresolved fails it.
  'DR-02': async (c) => (await c.query(`
    WITH y AS (
      SELECT f.fiscal_year, sum(f.obligations) AS t, sum(f.obligations_direct) AS d,
             sum(f.obligations_reimbursable) AS r
        FROM dm_exec_account_fy f JOIN dm_load l ON l.id = f.load_id AND l.is_current
       WHERE f.scope = 'DOW' GROUP BY 1
    ), top AS (
      SELECT DISTINCT ON (f.fiscal_year) f.fiscal_year, ac.federal_account_name AS name,
             sum(f.obligations_reimbursable) AS r
        FROM dm_exec_account_fy f JOIN dm_load l ON l.id = f.load_id AND l.is_current
        JOIN dm_exec_account ac ON ac.load_id = f.load_id AND ac.fiscal_year = f.fiscal_year
                               AND ac.treasury_account = f.treasury_account
       WHERE f.scope = 'DOW' GROUP BY f.fiscal_year, ac.federal_account_name
       ORDER BY f.fiscal_year, sum(f.obligations_reimbursable) DESC NULLS LAST
    )
    SELECT y.fiscal_year, y.t, y.d, y.r, top.name, top.r AS top_r
      FROM y LEFT JOIN top ON top.fiscal_year = y.fiscal_year ORDER BY 1`)).rows.map((r) => {
    const t = Number(r.t || 0), d = Number(r.d || 0), rb = Number(r.r || 0);
    const unresolved = t - d - rb;
    const uPct = Math.abs(unresolved) / Math.max(1, Math.abs(t)) * 100;
    return { fiscal_year: r.fiscal_year, observed: rb, expected: t, tolerance: 0.1, variance_pct: uPct,
      status: uPct <= 0.1 ? 'pass' : 'fail',
      message: `FY${r.fiscal_year}: $${(rb / 1e9).toFixed(1)}B of $${(t / 1e9).toFixed(1)}B File B `
        + `obligations (${(rb / Math.max(1, t) * 100).toFixed(1)}%) are reimbursable and are not counted as `
        + `direct execution; the largest share sits in ${r.name ?? '—'} ($${(Number(r.top_r || 0) / 1e9).toFixed(1)}B). `
        + `${uPct <= 0.1 ? 'Every dollar' : `All but $${(unresolved / 1e9).toFixed(2)}B`} carries a funding source.` };
  }),

  // ---- raw data ------------------------------------------------------------
  // The raw-data page shows the first records of every file the extract reads,
  // every column, under the file's own names. Its one way to mislead is to put a
  // value under the wrong column, show a stale file, or leave out a file a figure
  // came from. RAW-01 re-derives each of those from something the sample did not
  // produce:
  //   * structure: each record's value count against the column list, the row
  //     numbers against 1..min(5, total rows), from the rows themselves;
  //   * coverage: the set of files the measures were loaded from -- the File A,
  //     File B, File C, contract and assistance loads, and every (PB year,
  //     exhibit) that has a line in dm_exhibit_line or dm_pb_line -- each must
  //     have a sample;
  //   * currency: the File A and File B sample records' own submission_period
  //     against the period the Statement of Budgetary Resources and the File B
  //     stage are published under, and the contract sample's vintage directory
  //     against the contract load's vintage.
  'RAW-01': async (c) => {
    const src = (await c.query(`
      SELECT s.source_key, s.label, s.sample_path, s.total_rows, s.column_count, s.columns_json
        FROM dm_raw_source s JOIN dm_load l ON l.id = s.load_id AND l.is_current
       ORDER BY s.sort_order`)).rows;
    if (!src.length) {
      return [{ status: 'fail', observed: 0, message: 'No raw samples are loaded, so the raw-data page has '
        + 'nothing to show. Run scripts/etl_analytics.py --step raw, then the load.' }];
    }
    const rowsBy = new Map();
    for (const r of (await c.query(`
      SELECT r.source_key, r.row_no, r.values_json
        FROM dm_raw_row r JOIN dm_load l ON l.id = r.load_id AND l.is_current
       ORDER BY r.source_key, r.row_no`)).rows) {
      if (!rowsBy.has(r.source_key)) rowsBy.set(r.source_key, []);
      rowsBy.get(r.source_key).push(r);
    }
    const out = [];

    // structure
    const bad = [];
    let records = 0;
    for (const s of src) {
      let cols = null;
      try { cols = JSON.parse(s.columns_json); } catch { cols = null; }
      const rs = rowsBy.get(s.source_key) || [];
      records += rs.length;
      const want = Math.min(5, Number(s.total_rows ?? 5));
      const why = [];
      if (!Array.isArray(cols) || cols.length !== Number(s.column_count) || !cols.length) {
        why.push(`column list has ${Array.isArray(cols) ? cols.length : 'no'} entries for ${s.column_count} columns`);
      } else if (cols.some((k) => !k || !String(k.name || '').trim())) {
        why.push('a column has no name');
      }
      if (rs.length !== want) why.push(`${rs.length} records where ${want} were expected`);
      rs.forEach((r, i) => {
        let v = null;
        try { v = JSON.parse(r.values_json); } catch { v = null; }
        if (Number(r.row_no) !== i + 1) why.push(`record ${i + 1} is numbered ${r.row_no}`);
        if (!Array.isArray(v)) why.push(`record ${r.row_no} is not a value list`);
        else if (v.length !== Number(s.column_count)) why.push(`record ${r.row_no} has ${v.length} values for ${s.column_count} columns`);
        else if (!v.some((x) => x !== null && x !== '')) why.push(`record ${r.row_no} is empty`);
      });
      if (why.length) bad.push(`${s.label}: ${why.slice(0, 3).join('; ')}`);
    }
    out.push({ observed: bad.length, expected: 0, tolerance: 0, status: bad.length ? 'fail' : 'pass',
      message: bad.length
        ? `${bad.length} of ${src.length} raw samples would show values under the wrong columns or the wrong number of records — ${bad.slice(0, 4).join(' | ')}.`
        : `${src.length} files, ${records} records: every record carries exactly one value per column of its file, numbered 1 to ${Math.min(5, records)}.` });

    // coverage
    const have = new Set(src.map((s) => s.source_key));
    const loads = new Set((await c.query(`SELECT dataset_key FROM dm_load WHERE is_current`)).rows.map((r) => r.dataset_key));
    const need = [];
    for (const [ds, key] of [['file_a_sbr', 'file_a'], ['file_b_obligations', 'file_b'], ['file_b_detail', 'file_b'],
      ['file_c_reconciliation', 'file_c_contracts'], ['contract_awards', 'contracts'], ['contract_timing', 'contracts'],
      ['assistance_awards', 'assistance']]) {
      if (loads.has(ds)) need.push(key);
    }
    for (const t of ['dm_exhibit_line', 'dm_pb_line']) {
      for (const r of (await c.query(`
        SELECT DISTINCT x.pb_year, x.exhibit FROM ${t} x JOIN dm_load l ON l.id = x.load_id AND l.is_current`)).rows) {
        need.push(`pb${r.pb_year}_${r.exhibit}`);
      }
    }
    const uniq = [...new Set(need)];
    const lacking = uniq.filter((k) => !have.has(k));
    out.push({ observed: uniq.length - lacking.length, expected: uniq.length, tolerance: 0,
      status: lacking.length ? 'fail' : 'pass',
      message: lacking.length
        ? `${lacking.length} of the ${uniq.length} files this load's figures come from have no raw sample: ${lacking.slice(0, 8).join(', ')}.`
        : `All ${uniq.length} files this load's figures come from have a raw sample${have.has('submission_periods') ? ', and so does the submission calendar' : ''}.` });

    // currency
    const stale = [];
    const periodFy = async (sql) => new Map((await c.query(sql)).rows.map((r) => [Number(r.fiscal_year), r.submission_period]));
    const pubA = await periodFy(`SELECT s.fiscal_year, s.submission_period FROM dm_sbr_fy s
      JOIN dm_load l ON l.id = s.load_id AND l.is_current WHERE s.scope = 'DOW'`);
    const pubB = await periodFy(`SELECT s.fiscal_year, s.submission_period FROM dm_obligation_stage s
      JOIN dm_load l ON l.id = s.load_id AND l.is_current WHERE s.scope = 'DOW'`);
    let checked = 0;
    for (const [key, pub, what] of [['file_a', pubA, 'the Statement of Budgetary Resources'], ['file_b', pubB, 'the File B stage']]) {
      const s = src.find((x) => x.source_key === key);
      if (!s || !pub.size) continue;
      const names = JSON.parse(s.columns_json).map((k) => k.name);
      const iP = names.indexOf('submission_period'), iY = names.indexOf('fiscal_year');
      if (iP < 0 || iY < 0) { stale.push(`${s.label} carries no submission_period/fiscal_year column`); continue; }
      for (const r of rowsBy.get(key) || []) {
        const v = JSON.parse(r.values_json);
        const fy = Number(v[iY]); const expect = pub.get(fy);
        checked += 1;
        if (!expect) stale.push(`${s.label} record ${r.row_no} is FY${fy}, which ${what} does not hold`);
        else if (v[iP] !== expect) stale.push(`${s.label} record ${r.row_no} is ${v[iP]} but ${what} is published as ${expect}`);
      }
    }
    const cs = src.find((x) => x.source_key === 'contracts');
    const cv = (await c.query(`SELECT vintage::text AS vintage FROM dm_load WHERE dataset_key = 'contract_awards' AND is_current`)).rows[0]?.vintage;
    if (cs && cv) {
      checked += 1;
      const m = /vintage=(\d{4}-\d{2}-\d{2})/.exec(cs.sample_path || '');
      if (!m || m[1] !== String(cv)) stale.push(`the contract sample is from ${m ? m[1] : 'no vintage'} but the contract figures are vintage ${cv}`);
    }
    out.push({ observed: stale.length, expected: 0, tolerance: 0, status: stale.length ? 'fail' : 'pass',
      message: stale.length
        ? `The raw samples are not the files the figures were built from: ${stale.slice(0, 4).join('; ')}.`
        : `${checked} checks: the File A and File B sample records carry the same submission period the published statements do, and the contract sample is the vintage the contract figures use.` });
    return out;
  },

  // ---- program year --------------------------------------------------------
  // The program-year view splits a fiscal year's execution by the year the money
  // was appropriated for. Both halves of it have to be right: the year each
  // account is filed under, and the resources the obligations are measured
  // against.
  //
  // POA-01 RE-DERIVES the program year rather than reading it back. The ETL
  // takes it from the published beginning_period_of_availability column; the
  // Treasury account symbol writes the same two years independently
  // (017-2025/2027-1506-000). Where the two disagree, one of them is not the
  // year the money belongs to and every figure filed under it is misfiled.
  // ------------------------------------------------------------- the J-book --
  // JB-01 is the grain. A book identity spans up to twenty-nine President's
  // Budgets and each edition restates its own format, so (book_key, pb_year) is
  // the grain and collapsing it averages format history into a book that was
  // never published. This RE-COUNTS the edition rows and the section rows in SQL
  // and compares them with what the book header and the edition row claim --
  // reading dm_jbook_book's own years_held against dm_jbook_book_year's own
  // count is the check that matters, because an aggregation that dropped
  // pb_year shows up here as a header that no longer matches its detail.
  'JB-01': async (c) => (await c.query(`
    WITH y AS (
      SELECT y.book_key, count(*)::int AS editions, min(y.pb_year) AS first_pb,
             max(y.pb_year) AS last_pb
        FROM dm_jbook_book_year y JOIN dm_load l ON l.id = y.load_id AND l.is_current
       GROUP BY 1
    ), s AS (
      SELECT s.book_key, s.pb_year, count(*)::int AS titles,
             count(*) FILTER (WHERE s.time_hits > 0)::int AS time_titles
        FROM dm_jbook_book_section s JOIN dm_load l ON l.id = s.load_id AND l.is_current
       GROUP BY 1, 2
    ), hdr AS (
      SELECT b.fund_key, count(*)::int AS books,
             count(*) FILTER (WHERE y.editions IS DISTINCT FROM b.years_held
                                 OR y.first_pb IS DISTINCT FROM b.first_pb_year
                                 OR y.last_pb  IS DISTINCT FROM b.latest_pb_year)::int AS bad_header,
             max(b.book_key) FILTER (WHERE y.editions IS DISTINCT FROM b.years_held) AS example
        FROM dm_jbook_book b JOIN dm_load l ON l.id = b.load_id AND l.is_current
        LEFT JOIN y ON y.book_key = b.book_key
       GROUP BY 1
    ), det AS (
      SELECT b.fund_key,
             count(*) FILTER (WHERE coalesce(s.titles, 0) IS DISTINCT FROM ye.titles
                                 OR coalesce(s.time_titles, 0) IS DISTINCT FROM ye.time_sections)::int AS bad_edition,
             count(*)::int AS editions,
             max(ye.book_key || ' PB' || ye.pb_year) FILTER (
               WHERE coalesce(s.titles, 0) IS DISTINCT FROM ye.titles) AS example
        FROM dm_jbook_book_year ye JOIN dm_load l ON l.id = ye.load_id AND l.is_current
        JOIN dm_jbook_book b ON b.load_id = ye.load_id AND b.book_key = ye.book_key
        LEFT JOIN s ON s.book_key = ye.book_key AND s.pb_year = ye.pb_year
       GROUP BY 1
    )
    SELECT hdr.fund_key, hdr.books, hdr.bad_header, det.editions, det.bad_edition,
           coalesce(hdr.example, det.example) AS example
      FROM hdr LEFT JOIN det ON det.fund_key = hdr.fund_key
     ORDER BY hdr.books DESC`)).rows.map((r) => {
    const bad = Number(r.bad_header) + Number(r.bad_edition ?? 0);
    return { dimension: r.fund_key, observed: bad, expected: 0, tolerance: 0,
      variance_pct: r.editions ? bad / Number(r.editions) * 100 : 0,
      status: bad === 0 ? 'pass' : 'fail',
      message: bad === 0
        ? `${r.fund_key}: ${Number(r.books).toLocaleString()} books over `
          + `${Number(r.editions ?? 0).toLocaleString()} editions, and every book's year span and `
          + 'every edition\'s section count re-count in SQL to what the extract published.'
        : `${r.fund_key}: ${r.bad_header} books and ${r.bad_edition} editions do not re-count`
          + `${r.example ? ` (e.g. ${r.example})` : ''}. The (book, PB year) grain has been `
          + 'collapsed or rows were dropped; a book\'s format history is wrong.' };
  }),

  // JB-02 re-derives the weighted skeleton share from the section rows and the
  // edition weights, which is the independent path: the published figure came
  // from the extract's own observation lists, this one comes from the rows that
  // were actually written. A skeleton built over the wrong set of editions --
  // or one that kept a stale weight after a new book landed -- differs here.
  'JB-02': async (c) => (await c.query(`
    WITH w AS (
      SELECT y.book_key, y.pb_year, y.recency_weight
        FROM dm_jbook_book_year y JOIN dm_load l ON l.id = y.load_id AND l.is_current
    ), tot AS (
      SELECT book_key, sum(recency_weight) AS wsum, count(*)::int AS editions FROM w GROUP BY 1
    ), seen AS (
      SELECT s.book_key, s.norm_title, count(*)::int AS years_seen,
             sum(w.recency_weight) AS wseen
        FROM dm_jbook_book_section s JOIN dm_load l ON l.id = s.load_id AND l.is_current
        JOIN w ON w.book_key = s.book_key AND w.pb_year = s.pb_year
       GROUP BY 1, 2
    )
    SELECT k.book_key, count(*)::int AS rows,
           count(*) FILTER (WHERE seen.years_seen IS DISTINCT FROM k.years_seen
                               OR tot.editions IS DISTINCT FROM k.years_total
                               OR abs(coalesce(seen.wseen / nullif(tot.wsum, 0) * 100, -1)
                                      - k.weighted_share_pct) > 0.15)::int AS bad,
           max(k.book_key || ' / ' || k.norm_title) FILTER (
             WHERE seen.years_seen IS DISTINCT FROM k.years_seen) AS example
      FROM dm_jbook_book_skeleton k JOIN dm_load l ON l.id = k.load_id AND l.is_current
      LEFT JOIN seen ON seen.book_key = k.book_key AND seen.norm_title = k.norm_title
      LEFT JOIN tot ON tot.book_key = k.book_key
     GROUP BY k.book_key HAVING count(*) FILTER (
       WHERE seen.years_seen IS DISTINCT FROM k.years_seen
          OR tot.editions IS DISTINCT FROM k.years_total
          OR abs(coalesce(seen.wseen / nullif(tot.wsum, 0) * 100, -1) - k.weighted_share_pct) > 0.15) > 0
     ORDER BY 2 DESC LIMIT 50`)).rows.length === 0
    ? [{ dimension: 'all books', observed: 0, expected: 0, tolerance: 0.15, variance_pct: 0,
         status: 'pass',
         message: 'Every skeleton row re-derives from its own book\'s section rows and edition '
           + 'weights: the years it was seen in, the years the book has, and the recency-weighted '
           + 'share all recompute in SQL to within 0.15 points.' }]
    : (await c.query(`
        WITH w AS (
          SELECT y.book_key, y.pb_year, y.recency_weight
            FROM dm_jbook_book_year y JOIN dm_load l ON l.id = y.load_id AND l.is_current
        ), tot AS (
          SELECT book_key, sum(recency_weight) AS wsum, count(*)::int AS editions FROM w GROUP BY 1
        ), seen AS (
          SELECT s.book_key, s.norm_title, count(*)::int AS years_seen, sum(w.recency_weight) AS wseen
            FROM dm_jbook_book_section s JOIN dm_load l ON l.id = s.load_id AND l.is_current
            JOIN w ON w.book_key = s.book_key AND w.pb_year = s.pb_year
           GROUP BY 1, 2
        )
        SELECT k.book_key, k.norm_title, k.years_seen, k.years_total, k.weighted_share_pct,
               seen.years_seen AS re_seen, tot.editions AS re_total,
               round(coalesce(seen.wseen / nullif(tot.wsum, 0) * 100, -1), 2) AS re_share
          FROM dm_jbook_book_skeleton k JOIN dm_load l ON l.id = k.load_id AND l.is_current
          LEFT JOIN seen ON seen.book_key = k.book_key AND seen.norm_title = k.norm_title
          LEFT JOIN tot ON tot.book_key = k.book_key
         WHERE seen.years_seen IS DISTINCT FROM k.years_seen
            OR tot.editions IS DISTINCT FROM k.years_total
            OR abs(coalesce(seen.wseen / nullif(tot.wsum, 0) * 100, -1) - k.weighted_share_pct) > 0.15
         ORDER BY k.book_key LIMIT 200`)).rows.map((r) => ({
      dimension: `${r.book_key} / ${r.norm_title}`, observed: r.re_share, expected: r.weighted_share_pct,
      tolerance: 0.15, variance_pct: Math.abs(Number(r.re_share) - Number(r.weighted_share_pct)),
      status: 'fail',
      message: `${r.book_key}: "${r.norm_title}" is published as seen in ${r.years_seen} of `
        + `${r.years_total} editions at a ${r.weighted_share_pct}% weighted share, and re-derives `
        + `from the section rows as ${r.re_seen} of ${r.re_total} at ${r.re_share}%. The skeleton `
        + 'and the sections it is measured from disagree.' })),

  // JB-03. Bodies are held only for current books, and every one names the file
  // and page it was read from -- an exemplar a drafter cannot trace back to a
  // published page is an anonymous paragraph, which is exactly what this feature
  // must not produce.
  'JB-03': async (c) => (await c.query(`
    WITH ranked AS (
      SELECT y.book_key, y.pb_year,
             row_number() OVER (PARTITION BY y.book_key ORDER BY y.pb_year DESC) AS rn
        FROM dm_jbook_book_year y JOIN dm_load l ON l.id = y.load_id AND l.is_current
    )
    SELECT count(*)::int AS n, count(DISTINCT e.book_key)::int AS books,
           count(*) FILTER (WHERE r.rn IS NULL OR r.rn > 2)::int AS stale,
           count(*) FILTER (WHERE e.source_file IS NULL OR e.page_no IS NULL
                               OR length(coalesce(e.body, '')) < 40)::int AS untraceable,
           count(*) FILTER (WHERE b.book_key IS NULL)::int AS orphan,
           max(e.book_key || ' PB' || e.pb_year) FILTER (
             WHERE r.rn IS NULL OR r.rn > 2 OR e.source_file IS NULL OR b.book_key IS NULL) AS example
      FROM dm_jbook_book_exemplar e JOIN dm_load l ON l.id = e.load_id AND l.is_current
      LEFT JOIN ranked r ON r.book_key = e.book_key AND r.pb_year = e.pb_year
      LEFT JOIN dm_jbook_book b ON b.load_id = e.load_id AND b.book_key = e.book_key
                               AND b.is_current`)).rows.map((r) => {
    const bad = Number(r.stale) + Number(r.untraceable) + Number(r.orphan);
    return { dimension: 'exemplar bodies', observed: bad, expected: 0, tolerance: 0,
      variance_pct: r.n ? bad / Number(r.n) * 100 : 0, status: bad === 0 ? 'pass' : 'fail',
      message: bad === 0
        ? `${Number(r.n).toLocaleString()} exemplar passages across ${r.books} current books, every `
          + 'one taken from that book\'s own two most recent editions and naming the file and page it '
          + 'was read from. Older editions contribute structure and measurement, not text.'
        : `${bad} exemplar passages are wrong: ${r.stale} come from an edition that is not one of `
          + `their own book\'s two most recent, ${r.untraceable} name no source file or page, `
          + `${r.orphan} belong to a book not marked current`
          + `${r.example ? ` (e.g. ${r.example})` : ''}.` };
  }),

  'POA-01': async (c) => (await c.query(`
    WITH acct AS (
      SELECT 'File B' AS src, a.fiscal_year, a.treasury_account, a.bpoa, a.epoa, a.availability_type
        FROM dm_exec_account a JOIN dm_load l ON l.id = a.load_id AND l.is_current
      UNION ALL
      SELECT 'File A', r.fiscal_year, r.treasury_account, r.bpoa, r.epoa, r.availability_type
        FROM dm_exec_resource r JOIN dm_load l ON l.id = r.load_id AND l.is_current
       WHERE r.scope = 'DOW'
    ), derived AS (
      SELECT *, substring(treasury_account from '-([0-9]{4})/[0-9]{4}-[0-9]{4}-[0-9]{3}$')::int AS sym_bpoa,
                substring(treasury_account from '-[0-9]{4}/([0-9]{4})-[0-9]{4}-[0-9]{3}$')::int AS sym_epoa
        FROM acct
    )
    SELECT fiscal_year, count(*)::int AS n,
           count(*) FILTER (WHERE bpoa IS DISTINCT FROM sym_bpoa OR epoa IS DISTINCT FROM sym_epoa)::int AS bad,
           count(*) FILTER (WHERE bpoa IS NULL AND coalesce(availability_type, '') <> 'X')::int AS unresolved,
           max(src || ' ' || treasury_account || ' carries ' || coalesce(bpoa::text, 'none') || '/'
               || coalesce(epoa::text, 'none'))
             FILTER (WHERE bpoa IS DISTINCT FROM sym_bpoa OR epoa IS DISTINCT FROM sym_epoa) AS example
      FROM derived GROUP BY fiscal_year ORDER BY fiscal_year`)).rows.map((r) => ({
    fiscal_year: r.fiscal_year, observed: r.bad + r.unresolved, expected: 0, tolerance: 0,
    variance_pct: r.n ? (r.bad + r.unresolved) / r.n * 100 : 0,
    status: r.bad + r.unresolved === 0 ? 'pass' : 'fail',
    message: r.bad + r.unresolved === 0
      ? `FY${r.fiscal_year}: all ${Number(r.n).toLocaleString()} File A and File B accounts carry the `
        + 'program year their Treasury account symbol states; every account without one is no-year.'
      : `FY${r.fiscal_year}: ${r.bad} of ${Number(r.n).toLocaleString()} accounts carry a period of `
        + `availability their symbol contradicts${r.example ? ` (e.g. ${r.example})` : ''}, and `
        + `${r.unresolved} have no program year without being no-year. Their figures are filed under `
        + 'the wrong program year.' })),

  // POA-02 is the footing, and it is critical for the same reason EXEC-01 is: a
  // drill-down whose parts do not add up to the figure printed above it is
  // worse than no drill-down. Two ways it breaks, both silent on the page:
  // File A's account table dropping accounts (a rate over too few resources),
  // and a File B account with no dimension row (its money falls out of every
  // program year and lands in none).
  'POA-02': async (c) => (await c.query(`
    WITH a AS (
      SELECT r.fiscal_year, sum(r.total_budgetary_resources) AS tbr, sum(r.obligations_incurred) AS obl,
             sum(r.unobligated_balance) AS unob
        FROM dm_exec_resource r JOIN dm_load l ON l.id = r.load_id AND l.is_current
       WHERE r.scope = 'DOW' GROUP BY r.fiscal_year
    ), b AS (
      SELECT f.fiscal_year, sum(f.obligations) AS obl,
             count(*) FILTER (WHERE ac.treasury_account IS NULL)::int AS orphans
        FROM dm_exec_account_fy f JOIN dm_load l ON l.id = f.load_id AND l.is_current
        LEFT JOIN dm_exec_account ac ON ac.load_id = f.load_id AND ac.fiscal_year = f.fiscal_year
                                    AND ac.treasury_account = f.treasury_account
       WHERE f.scope = 'DOW' GROUP BY f.fiscal_year
    )
    SELECT s.fiscal_year, s.total_budgetary_resources AS s_tbr, s.obligations_incurred AS s_obl,
           s.unobligated_balance AS s_unob, a.tbr, a.obl, a.unob,
           e.obligations AS e_obl, b.obl AS b_obl, coalesce(b.orphans, 0) AS orphans
      FROM dm_sbr_fy s JOIN dm_load ls ON ls.id = s.load_id AND ls.is_current
      LEFT JOIN a ON a.fiscal_year = s.fiscal_year
      LEFT JOIN b ON b.fiscal_year = s.fiscal_year
      LEFT JOIN dm_exec_fy e ON e.fiscal_year = s.fiscal_year AND e.scope = 'DOW'
       AND e.load_id = (SELECT id FROM dm_load WHERE dataset_key = 'file_b_detail' AND is_current LIMIT 1)
     WHERE s.scope = 'DOW' ORDER BY s.fiscal_year`)).rows.map((r) => {
    const pct = (o, e) => Math.abs(Number(o ?? 0) - Number(e ?? 0)) / Math.max(1, Math.abs(Number(e ?? 0))) * 100;
    const v = Math.max(pct(r.tbr, r.s_tbr), pct(r.obl, r.s_obl), pct(r.unob, r.s_unob),
                       r.e_obl == null ? 0 : pct(r.b_obl, r.e_obl));
    const ok = r.tbr != null && v <= 0.01 && Number(r.orphans) === 0;
    return { fiscal_year: r.fiscal_year, observed: r.tbr, expected: r.s_tbr, tolerance: 0.01,
      variance_pct: v, status: ok ? 'pass' : 'fail',
      message: r.tbr == null
        ? `FY${r.fiscal_year}: no File A account rows in this load, so no program year can be rated.`
        : ok
          ? `FY${r.fiscal_year}: File A accounts sum to the Statement of Budgetary Resources for total `
            + 'resources, obligations and unobligated balance, and every File B account is filed '
            + `under a program year, to within ${v.toFixed(4)}%.`
          : `FY${r.fiscal_year}: the program-year split is off by ${v.toFixed(4)}%`
            + `${Number(r.orphans) ? `, and ${r.orphans} File B accounts have no dimension row and fall `
              + 'out of every program year' : ''}.` };
  }),

};

// -------------------------------------------------------------------- main --
(async () => {
  const url = databaseUrl();
  // Verify the server certificate for any real network connection. A local
  // socket or localhost (the schema-verification harness) has no TLS to verify,
  // so requiring it there would only break the check.
  const isLocal = /host=\/|@(localhost|127\.0\.0\.1)[:/]/.test(url);
  const pool = new Pool({ connectionString: url, max: 4,
    connectionTimeoutMillis: 20000,
    ssl: isLocal ? false : { rejectUnauthorized: true } });
  const client = await pool.connect();
  const t0 = Date.now();
  try {
    await client.query('BEGIN');

    console.log('· schema');
    await client.query(fs.readFileSync(path.join(ROOT, 'database/schema.analytics.sql'), 'utf-8'));

    const seed = JSON.parse(fs.readFileSync(path.join(ROOT, 'database/seed_analytics.json'), 'utf-8'));
    console.log('· seed: datasets + controls');
    for (const d of seed.datasets) {
      await client.query(
        `INSERT INTO dm_dataset (key,label,source_system,source_path,grain,description,refresh_cadence,limitations,sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (key) DO UPDATE SET label=EXCLUDED.label, source_system=EXCLUDED.source_system,
           source_path=EXCLUDED.source_path, grain=EXCLUDED.grain, description=EXCLUDED.description,
           refresh_cadence=EXCLUDED.refresh_cadence, limitations=EXCLUDED.limitations, sort_order=EXCLUDED.sort_order`,
        [d.key, d.label, d.source_system, d.source_path, d.grain, d.description, d.refresh_cadence, d.limitations, d.sort_order]);
    }
    for (const c of seed.controls) {
      await client.query(
        `INSERT INTO dm_control (code,name,assertion,rationale,authority,severity,sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (code) DO UPDATE SET name=EXCLUDED.name, assertion=EXCLUDED.assertion,
           rationale=EXCLUDED.rationale, authority=EXCLUDED.authority, severity=EXCLUDED.severity,
           sort_order=EXCLUDED.sort_order`,
        [c.code, c.name, c.assertion, c.rationale, c.authority, c.severity, c.sort_order]);
    }

    const FILES = [
      ['sbr.json',        'file_a_sbr',            'scripts/etl_analytics.py --step sbr'],
      ['obligations.json','file_b_obligations',    'scripts/etl_analytics.py --step obligations'],
      ['awards.json',     'contract_awards',       'scripts/etl_analytics.py --step awards'],
      ['filec.json',      'file_c_reconciliation', 'scripts/etl_analytics.py --step filec'],
      ['assistance.json', 'assistance_awards',     'scripts/etl_analytics.py --step assistance'],
      ['exhibits.json',   'budget_exhibits',       'scripts/etl_analytics.py --step exhibits'],
      ['pb_display.json', 'pb_display',            'scripts/etl_analytics.py --step pb_display'],
      ['execution.json',  'file_b_detail',         'scripts/etl_analytics.py --step execution'],
      ['timing.json',     'contract_timing',       'scripts/etl_analytics.py --step timing'],
      ['currency.json',   'submission_calendar',   'scripts/etl_analytics.py --step currency'],
      ['program.json',    'program_execution',     'scripts/etl_analytics.py --step program'],
      ['crosswalk.json',  'budget_execution_crosswalk', 'scripts/etl_analytics.py --step crosswalk'],
      ['knowledge.json',  'knowledge_bank',        'scripts/etl_analytics.py --step knowledge'],
      ['catalog.json',    'source_catalog',        'scripts/etl_analytics.py --step catalog'],
      ['jbook.json',      'jbook_corpus',          'scripts/etl_analytics.py --step jbook'],
      ['raw.json',        'raw_samples',           'scripts/etl_analytics.py --step raw'],
    ];
    const COLS = {
      dm_sbr_fy: ['fiscal_year','scope','scope_label','submission_period','is_partial_year','tas_count',
        'ba_appropriated','unobligated_bf','adjustments_to_unob_bf','borrowing_authority','contract_authority',
        'spending_auth_offsetting','other_budgetary_resources','total_budgetary_resources','obligations_incurred',
        'deobligations','unobligated_balance','gross_outlays'],
      dm_sbr_dim: ['fiscal_year','scope','dimension','dim_key','dim_label','total_budgetary_resources',
        'obligations_incurred','unobligated_balance','gross_outlays','rank_in_dim'],
      dm_obligation_stage: ['fiscal_year','scope','obligations_incurred','undelivered_orders_unpaid',
        'delivered_orders_unpaid','gross_outlays','deobligations','submission_period',
        'periods_available','source_rows','grain_rows','replicated_rows',
        'obligations_incurred_direct','obligations_incurred_reimbursable','undelivered_orders_unpaid_direct',
        'undelivered_orders_unpaid_reimbursable','delivered_orders_unpaid_direct',
        'delivered_orders_unpaid_reimbursable','gross_outlays_direct','gross_outlays_reimbursable',
        'deobligations_direct','deobligations_reimbursable'],
      dm_fileb_grain: ['fiscal_year','scope','activity_key','source_rows','grain_rows',
        'replicated_groups','replicated_rows','obligations_as_published','obligations_at_grain',
        'overstatement_pct'],
      dm_object_class: ['fiscal_year','scope','object_class_code','object_class_name','major_class','obligations','rank_in_fy'],
      dm_award_fy: ['vintage','fiscal_year','obligation','action_count','is_partial_year'],
      dm_award_dim: ['fiscal_year','dimension','dim_key','dim_label','obligation','action_count','rank_in_dim'],
      dm_vintage_drift: ['fiscal_year','vintage_from','vintage_to','obligation_from','obligation_to',
        'obligation_delta','actions_from','actions_to','action_delta','year_closed'],
      dm_reconciliation: ['fiscal_year','award_obligation','award_actions','filec_obligation','filec_rows',
        'filec_awards','linkage_pct','unlinked_obligation','submission_period','periods_available',
        'period_row_counts','is_partial_year'],
      dm_assistance_fy: ['vintage','fiscal_year','obligation','action_count','is_partial_year'],
      dm_assistance_dim: ['fiscal_year','dimension','dim_key','dim_label','obligation','action_count','rank_in_dim'],
      dm_assistance_vintage_drift: ['fiscal_year','vintage_from','vintage_to','obligation_from','obligation_to',
        'obligation_delta','actions_from','actions_to','action_delta','year_closed'],
      dm_program_dim: ['program_code','program_name','total_obligation','first_fiscal_year',
        'last_fiscal_year','is_featured','rank_by_obligation'],
      dm_program_coverage: ['vintage','fiscal_year','total_obligation','total_actions',
        'attributed_obligation','attributed_actions','unattributed_obligation','unattributed_actions',
        'attributed_pct','program_count','is_partial_year'],
      dm_program_fy: ['vintage','program_code','fiscal_year','obligation','traceable_obligation',
        'untraceable_obligation','traceable_pct','action_count','award_count','top5_obligation',
        'top5_pct','late_quarter_obligation','late_quarter_pct','is_partial_year'],
      dm_program_dim_fy: ['program_code','fiscal_year','dimension','dim_key','dim_label',
        'obligation','action_count','rank_in_dim'],
      dm_program_award: ['program_code','fiscal_year','award_id_piid','recipient_name','obligation',
        'action_count','share_of_fy_pct','has_account_link','largest_action_date','description','rank_in_fy'],
      dm_program_account: ['program_code','fiscal_year','account_set','account_count','obligation',
        'action_count','out_of_scope_accounts','has_out_of_scope','rank_in_fy'],
      dm_program_filec: ['program_code','fiscal_year','filec_obligation','filec_rows','filec_awards',
        'award_obligation','linkage_pct','submission_period','is_partial_year'],
      dm_exhibit_line: ['pb_year','exhibit','account','account_main','treasury_agency','treasury_account',
        'account_title','organization','budget_activity','budget_activity_title','bsa','bsa_title',
        'line_number','bli','bli_title','cost_type','cost_type_title','is_memo','fiscal_year','fy_role',
        'amount_k','quantity','total_column','total_basis','component_count'],
      dm_exhibit_program_fy: ['account','treasury_account','exhibit','bli','pb_year','fiscal_year','fy_role',
        'bli_title','organization','account_title','budget_activity','budget_activity_title','is_memo',
        'amount_k','quantity','cost_type_count','total_basis'],
      dm_exhibit_program: ['account','treasury_account','component','exhibit','bli','program_name','latest_pb',
        'organization','account_title','budget_activity','budget_activity_title','bsa','bsa_title',
        'fund_type','appropriation','weapon_category','weapon_program','search_norm','activity_count','is_memo','first_fiscal_year',
        'last_fiscal_year','latest_request_k','latest_request_pb','lifetime_amount_k','pb_year_count','slug','in_weapons_book'],
      dm_weapon_system: ['pb_year','program_name','category','page_no','prime_contractor','coverage_note'],
      dm_weapon_system_cost: ['pb_year','program_name','page_no','appropriation','service','row_kind',
        'fiscal_year','fy_role','amount_m','quantity','total_basis','component_count','coverage_note'],
      dm_weapon_alias: ['alias','alias_norm','weapon_program','pb_year','designator_norm','linked_lines',
        'match_method','match_evidence'],
      dm_exec_detail: ['fiscal_year','scope','treasury_account','object_class_code','activity_id',
        'activity_kind','activity_count','funding_source','defc','fund_life','source_rows',
        'is_replicated','obligations','undelivered_unpaid','undelivered_unpaid_bf','delivered_unpaid',
        'gross_outlays','outlays_prepaid','outlays_paid','deobligations','upward_adjustments',
        'downward_adjustments'],
      dm_exec_account: ['fiscal_year','treasury_account','treasury_account_name','federal_account',
        'federal_account_name','agency_code','agency_name','budget_function','budget_subfunction','fund_life',
        'bpoa','epoa','availability_type'],
      dm_exec_resource: ['fiscal_year','scope','treasury_account','treasury_account_name','federal_account',
        'federal_account_name','agency_code','bpoa','epoa','availability_type','fund_life','submission_period',
        'source_rows','ba_appropriated','unobligated_bf','adjustments_to_unob_bf','borrowing_authority',
        'contract_authority','spending_auth_offsetting','other_budgetary_resources','total_budgetary_resources',
        'obligations_incurred','deobligations','unobligated_balance','gross_outlays'],
      dm_exec_activity: ['fiscal_year','activity_id','activity_kind','activity_name'],
      dm_exec_account_fy: ['fiscal_year','scope','treasury_account','fund_life','detail_rows',
        'obligations','undelivered_unpaid','undelivered_unpaid_bf','delivered_unpaid','gross_outlays',
        'outlays_prepaid','outlays_paid','deobligations','upward_adjustments','downward_adjustments',
        'obligations_direct','obligations_reimbursable','gross_outlays_direct','gross_outlays_reimbursable','undelivered_unpaid_direct','undelivered_unpaid_reimbursable','delivered_unpaid_direct','delivered_unpaid_reimbursable','deobligations_direct','deobligations_reimbursable'],
      dm_exec_object_class_fy: ['fiscal_year','scope','object_class_code','object_class_name',
        'major_class','detail_rows','obligations','undelivered_unpaid','undelivered_unpaid_bf',
        'delivered_unpaid','gross_outlays','outlays_prepaid','outlays_paid','deobligations',
        'upward_adjustments','downward_adjustments',
        'obligations_direct','obligations_reimbursable','gross_outlays_direct','gross_outlays_reimbursable','undelivered_unpaid_direct','undelivered_unpaid_reimbursable','delivered_unpaid_direct','delivered_unpaid_reimbursable','deobligations_direct','deobligations_reimbursable'],
      dm_exec_fy: ['fiscal_year','scope','submission_period','source_rows','detail_rows',
        'collapsed_rows','has_detail','accounts','object_classes','activities','has_activity_names','obligations',
        'obligations_direct','obligations_reimbursable'],
      dm_submission_period: ['fiscal_year','fiscal_month','fiscal_quarter','is_quarter',
        'period_start','period_end','submission_due_date','reveal_date','is_revealed'],
      dm_fpds_day: ['fiscal_year','day_of_fy','obligation','action_count','cum_obligation','cum_actions'],
      dm_fpds_month: ['fiscal_year','fy_month','month_label','dimension','dim_key','dim_label',
        'obligation','action_count'],
      dm_fpds_eoy: ['fiscal_year','dimension','dim_key','dim_label','fy_obligation','fy_actions',
        'sep_obligation','sep_share_pct','q4_obligation','q4_share_pct','last5_obligation',
        'last5_share_pct','months_observed','is_complete_year'],
      dm_fpds_year: ['fiscal_year','last_day_of_fy','last_action_date','obligation','action_count',
        'is_complete_year','full_months_observed','frontier_day_of_fy','frontier_date',
        'frontier_obligation','frontier_actions','tail_actions','tail_obligation'],
      dm_exec_signal: ['signal_kind','dimension','dim_key','dim_label','fiscal_year','metric',
        'baseline','mad','deviation','amount','baseline_years','full_baseline','direction',
        'headline','evidence','method','severity_rank'],
      dm_exec_executor: ['fiscal_year','dim_key','dim_label','ytd_obligation','ytd_norm','pace_pct',
        'months_observed','sep_share_median_pct','last5_share_median_pct','projected_sep',
        'projected_sep_low','projected_sep_high','baseline_years','actions_ytd','rank_in_fy'],
      dm_fpds_action: ['fiscal_year','bucket','rank_in_bucket','action_date','day_of_fy',
        'days_to_year_end','award_id_piid','recipient_name','recipient_state','sub_agency','office',
        'psc','psc_description','psc_class','psc_class_label','psc_kind','naics_description',
        'pricing','competition','action_type','obligation','description'],
      dm_pb_line: ['pb_year','exhibit','sheet_name','account','account_main','account_sub',
        'treasury_agency','treasury_account','account_title','component','organization',
        'budget_activity','budget_activity_title','bsa','bsa_title','line_number','bli','bli_title',
        'cost_type','cost_type_title','location','is_memo','is_offset','memo_reason','include_in_toa',
        'fiscal_year','fy_role','amount_k','discretionary_k','mandatory_k','quantity',
        'total_column','total_basis','component_count'],
      dm_pb_tieout: ['pb_year','exhibit','sheet_name','fiscal_year','published_k','counted_k',
        'memo_k','difference_k','row_count'],
      dm_exhibit_tieout: ['pb_year','measure','exhibit','published_b','citation'],
      dm_exhibit_program_link: ['exhibit','account','bli','treasury_account','bli_title',
        'program_code','program_name','is_featured','match_method','match_evidence'],
      dm_exhibit_weapon_link: ['account','exhibit','bli','pb_year','weapon_program','weapon_category',
        'weapon_page','match_method','match_evidence'],
      dm_source_field: ['source_key','source_label','fiscal_year','field_name','field_kind',
        'rows_scanned','populated_pct','distinct_count','sample_values','is_read','note'],
      dm_join_sample: ['seam_key','fiscal_year','verdict','why','record'],
      dm_jbook_exhibit: ['slug','exhibit','exhibit_title','pb_year','book_date','component',
        'fund_key','fund_label','appropriation_code','appropriation','budget_activity',
        'budget_activity_title','pe','pe_title','project_number','project_title','r1_line',
        'pages','page_of','source_file'],
      dm_jbook_section: ['slug','letter','title','is_table','body','word_count',
        'sentence_count','avg_sentence_words','opening'],
      dm_jbook_skeleton: ['exhibit','letter','title','is_table','seen_count',
        'exhibits_total','share_pct','is_required'],
      dm_jbook_style: ['component','fund_label','letter','title','sample_size',
        'median_words','min_words','max_words','avg_sentence_words','example_opening'],
      dm_jbook_book: ['book_key','fund_key','fund_label','title','folder','file_names','files',
        'years_held','first_pb_year','latest_pb_year','latest_source_file','latest_book_date',
        'pages','sections','time_sections','exhibits','has_text','is_current','sort_order'],
      dm_jbook_book_year: ['book_key','pb_year','files','source_file','source_rel','book_date',
        'pb_basis','pages','text_chars','sections','titles','words','time_hits','time_sections',
        'exhibits','recency_weight','is_latest','has_text'],
      dm_jbook_book_section: ['book_key','pb_year','norm_title','title','shape','mark','level',
        'exhibit','seq','first_page','occurrences','median_words','total_words',
        'avg_sentence_words','time_hits','money_hits'],
      dm_jbook_book_skeleton: ['book_key','norm_title','title','shape','mark','level','exhibit',
        'rank','years_seen','years_total','first_seen_pb','last_seen_pb','share_pct',
        'weighted_share_pct','is_required','is_current','median_words','p10_words','p90_words',
        'avg_sentence_words','time_share_pct'],
      dm_jbook_book_exemplar: ['book_key','pb_year','norm_title','title','mark','shape',
        'source_file','page_no','exhibit','words','sentences','avg_sentence_words','time_hits',
        'money_hits','body'],
      dm_source_row: ['source_key','source_label','row_label','why','record'],
      dm_trace_row: ['step','source_key','source_label','key_field','key_value','note',
        'is_present','record'],
      dm_sfis_element: ['sort_order','element_name','field_length','definition','is_sloa',
        'candidate_fields','authority'],
      dm_filec_period: ['fiscal_year','submission_period','period_no','obligation','filec_rows',
        'filec_awards','award_obligation','is_chosen'],
      dm_definition: ['slug','term','definition','why_it_matters','key_rules','authorities','related',
        'source_file','last_verified','topic'],
      dm_kb_inventory: ['collection','folder','label','doc_count','authority_tier','note','sort_order'],
      dm_justification_exhibit: ['fiscal_year','activity','exhibit_count'],
      dm_hearing: ['hearing_id','congress','chamber','title','ingest_date','defense_related'],
      dm_raw_source: ['source_key','group_label','label','file_format','file_path','sample_path',
        'sheet_name','total_rows','file_count','column_count','columns_json','preamble_json','note','sort_order'],
      dm_raw_row: ['source_key','row_no','values_json'],
    };

    // The schema is applied every load, but CREATE TABLE IF NOT EXISTS cannot add
    // a column to a table that already exists -- that is what the upgrades
    // section of the schema is for. This check is the backstop: it compares what
    // the loader is about to insert against what the database actually has, and
    // names EVERY missing column at once with the statement that fixes it,
    // rather than failing on the first INSERT that hits one after seven tables
    // of work have already been done.
    const present = new Map();
    for (const r of (await client.query(
      `SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = ANY($1)`,
      [Object.keys(COLS)])).rows) {
      if (!present.has(r.table_name)) present.set(r.table_name, new Set());
      present.get(r.table_name).add(r.column_name);
    }
    const missing = [];
    for (const [table, cols] of Object.entries(COLS)) {
      const have = present.get(table);
      if (!have) continue;   // table absent entirely is a schema problem, not a drift one
      for (const c of ['load_id', ...cols]) if (!have.has(c)) missing.push(`${table}.${c}`);
    }
    if (missing.length) {
      console.error('\nThis database is missing columns the loader writes:');
      missing.forEach((m) => console.error(`   ${m}`));
      console.error('\nAdd an idempotent ALTER for each to the upgrades section of');
      console.error('database/schema.analytics.sql, then re-run. Nothing has been changed.');
      await client.query('ROLLBACK');
      process.exit(3);
    }

    for (const [file, key, script] of FILES) {
      const p = path.join(STAGING, file);
      if (!fs.existsSync(p)) { console.log(`· ${file}: absent, skipped`); continue; }
      const pay = JSON.parse(fs.readFileSync(p, 'utf-8'));
      const loadId = await openLoad(client, key, pay, script);
      for (const [table, rows] of Object.entries(pay.rows)) {
        await client.query(`DELETE FROM ${table} WHERE load_id <> $1`, [loadId]);
        const n = await bulk(client, table, COLS[table], rows, { load_id: loadId });
        console.log(`· ${table.padEnd(26)} ${String(n).padStart(6)} rows   vintage ${pay.vintage}`);
      }
    }

    // Curated audit posture
    const ap = seed.audit_posture;
    const apLoad = await openLoad(client, 'curated_audit',
      { vintage: ap.vintage, extracted_at: new Date().toISOString(), etl_version: 'seed',
        rows: { dm_audit_posture: ap.rows }, source_path: 'database/seed_analytics.json' },
      'database/seed_analytics.json');
    await client.query('DELETE FROM dm_audit_posture WHERE load_id <> $1', [apLoad]);
    await bulk(client, 'dm_audit_posture',
      ['fiscal_year','metric_key','metric_label','metric_value','value_kind','value_text','citation','note','sort_order'],
      ap.rows, { load_id: apLoad });
    console.log(`· dm_audit_posture           ${String(ap.rows.length).padStart(6)} rows   vintage ${ap.vintage}`);

    const mwc = seed.audit_mw_categories;
    if (mwc && mwc.rows && mwc.rows.length) {
      await client.query('DELETE FROM dm_audit_mw_category WHERE load_id <> $1', [apLoad]);
      await bulk(client, 'dm_audit_mw_category',
        ['fiscal_year','rank_in_report','category','citation'],
        mwc.rows, { load_id: apLoad });
      console.log(`· dm_audit_mw_category        ${String(mwc.rows.length).padStart(6)} rows   vintage ${mwc.vintage}`);
    }

    // The SFIS/SLOA element library is curated reference with a citation, so it
    // belongs beside the controls rather than in an extract. Coverage against it
    // is COMPUTED from dm_source_field, never asserted here.
    if (seed.sfis_elements) {
      const load = await client.query(
        `SELECT id FROM dm_load WHERE dataset_key = 'source_catalog' AND is_current LIMIT 1`);
      for (const e of seed.sfis_elements) {
        await client.query(
          `INSERT INTO dm_sfis_element (load_id, sort_order, element_name, field_length, definition,
                                        is_sloa, candidate_fields, authority)
           SELECT l.id, $1,$2,$3,$4,$5,$6,$7 FROM dm_load l
            WHERE l.dataset_key = 'source_catalog' AND l.is_current
           ON CONFLICT (load_id, element_name) DO UPDATE SET
             sort_order = EXCLUDED.sort_order, field_length = EXCLUDED.field_length,
             definition = EXCLUDED.definition, candidate_fields = EXCLUDED.candidate_fields,
             authority = EXCLUDED.authority`,
          [e.sort_order, e.element_name, e.field_length, e.definition,
           e.is_sloa !== false, e.candidate_fields ?? [], e.authority]);
      }
      if (load.rowCount) console.log(`· seed: ${seed.sfis_elements.length} SFIS/SLOA elements`);
    }

    // The forbidden-phrase lexicon is USER-OWNED, with one carefully drawn
    // exception. A row the user added, or a seed row they have edited or
    // deactivated, is never touched: added_by stops being 'seed' the moment a
    // person changes it. An untouched seed row IS refreshed, because a seed that
    // can only ever be inserted can never correct itself -- and the first cut of
    // this list shipped with double-escaped patterns that silently matched
    // nothing. is_active is never overwritten either way, so deactivating a seed
    // phrase sticks.
    if (seed.jbook_lexicon) {
      let added = 0;
      for (const e of seed.jbook_lexicon) {
        const r = await client.query(
          `INSERT INTO dm_jbook_lexicon (phrase, pattern, severity, category, rationale,
                                         authority, suggestion, is_seed, added_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,true,'seed')
           ON CONFLICT (lower(phrase)) DO UPDATE SET
             pattern    = EXCLUDED.pattern,
             severity   = EXCLUDED.severity,
             category   = EXCLUDED.category,
             rationale  = EXCLUDED.rationale,
             authority  = EXCLUDED.authority,
             suggestion = EXCLUDED.suggestion
           WHERE dm_jbook_lexicon.is_seed AND dm_jbook_lexicon.added_by = 'seed'`,
          [e.phrase, e.pattern ?? null, e.severity, e.category, e.rationale,
           e.authority ?? null, e.suggestion ?? null]);
        added += r.rowCount;
      }
      console.log(`· seed: jbook lexicon (${added} new, ${seed.jbook_lexicon.length - added} already present and left untouched)`);
    }

    // ------------------------------------------------------------ controls --
    console.log('\n· control suite');
    await client.query('DELETE FROM dm_control_result');
    let failures = [];
    const severity = Object.fromEntries(seed.controls.map((c) => [c.code, c.severity]));
    for (const [code, fn] of Object.entries(CONTROLS)) {
      let results = [];
      // Each control runs inside a savepoint. A control that raises a database
      // error -- a typo in its SQL, a column it assumed -- aborts the enclosing
      // transaction, and every control after it then fails with "current
      // transaction is aborted" until the load itself dies. Catching the
      // JavaScript exception is not enough, because the damage is on the
      // connection rather than in the caller. Rolling back to the savepoint
      // restores it, so a broken control is one recorded failure instead of a
      // refused load of every measure on the site.
      await client.query(`SAVEPOINT ctl_${code.replace(/[^A-Za-z0-9]/g, '_')}`);
      try {
        results = await fn(client);
        await client.query(`RELEASE SAVEPOINT ctl_${code.replace(/[^A-Za-z0-9]/g, '_')}`);
      } catch (e) {
        await client.query(`ROLLBACK TO SAVEPOINT ctl_${code.replace(/[^A-Za-z0-9]/g, '_')}`);
        results = [{ status: 'fail', message: `control errored: ${e.message}` }];
      }
      if (!results.length) results = [{ status: 'not_applicable', message: 'No rows in scope.' }];
      for (const r of results) {
        await client.query(
          `INSERT INTO dm_control_result (control_code, fiscal_year, status, observed, expected, tolerance, variance_pct, message)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [code, r.fiscal_year ?? null, r.status, r.observed ?? null, r.expected ?? null,
           r.tolerance ?? null, r.variance_pct ?? null, r.message]);
        if (r.status === 'fail') failures.push({ code, sev: severity[code], msg: r.message });
      }
      const bad = results.filter((r) => r.status === 'fail').length;
      console.log(`   ${code.padEnd(9)} ${results.length - bad}/${results.length} pass${bad ? `  <-- ${bad} FAIL` : ''}`);
    }

    const blocking = failures.filter((f) => f.sev === 'critical');
    if (blocking.length) {
      console.error('\nCRITICAL control failures — rolling back; previous load stays current:');
      blocking.forEach((f) => console.error(`   ${f.code}: ${f.msg}`));
      await client.query('ROLLBACK');
      process.exit(2);
    }
    if (DRY) { await client.query('ROLLBACK'); console.log('\n--dry-run: rolled back.'); }
    else { await client.query('COMMIT'); console.log(`\ncommitted in ${((Date.now()-t0)/1000).toFixed(1)}s`); }
    if (failures.length) console.log(`${failures.length} non-blocking control failure(s) recorded and published.`);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('load failed:', e.message);
    process.exit(1);
  } finally { client.release(); await pool.end(); }
})();

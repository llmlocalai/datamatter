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
  'TIE-01': async (c) => (await c.query(`
    SELECT a.fiscal_year, a.obligations_incurred AS expected, b.obligations_incurred AS observed
      FROM dm_sbr_fy a
      JOIN dm_load la ON la.id=a.load_id AND la.is_current
      JOIN dm_obligation_stage b ON b.fiscal_year=a.fiscal_year AND b.scope=a.scope
      JOIN dm_load lb ON lb.id=b.load_id AND lb.is_current
     WHERE a.scope='DOW' ORDER BY a.fiscal_year`)).rows.map((r) => {
    const v = Math.abs(r.observed - r.expected) / Math.max(1, Math.abs(r.expected)) * 100;
    return { fiscal_year: r.fiscal_year, observed: r.observed, expected: r.expected,
      tolerance: 0.5, variance_pct: v, status: v <= 0.5 ? 'pass' : 'fail',
      message: `FY${r.fiscal_year}: File B obligations are ${(r.observed>r.expected?'above':'below')} File A by ${v.toFixed(3)}% `
        + `(File A ${(r.expected/1e9).toFixed(1)}B, File B ${(r.observed/1e9).toFixed(1)}B, same submission period).` };
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
      ['program.json',    'program_execution',     'scripts/etl_analytics.py --step program'],
      ['crosswalk.json',  'budget_execution_crosswalk', 'scripts/etl_analytics.py --step crosswalk'],
      ['knowledge.json',  'knowledge_bank',        'scripts/etl_analytics.py --step knowledge'],
      ['catalog.json',    'source_catalog',        'scripts/etl_analytics.py --step catalog'],
    ];
    const COLS = {
      dm_sbr_fy: ['fiscal_year','scope','scope_label','submission_period','is_partial_year','tas_count',
        'ba_appropriated','unobligated_bf','adjustments_to_unob_bf','borrowing_authority','contract_authority',
        'spending_auth_offsetting','other_budgetary_resources','total_budgetary_resources','obligations_incurred',
        'deobligations','unobligated_balance','gross_outlays'],
      dm_sbr_dim: ['fiscal_year','scope','dimension','dim_key','dim_label','total_budgetary_resources',
        'obligations_incurred','unobligated_balance','gross_outlays','rank_in_dim'],
      dm_obligation_stage: ['fiscal_year','scope','obligations_incurred','undelivered_orders_unpaid',
        'delivered_orders_unpaid','gross_outlays','deobligations'],
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
      dm_exhibit_tieout: ['pb_year','measure','exhibit','published_b','citation'],
      dm_exhibit_program_link: ['exhibit','account','bli','treasury_account','bli_title',
        'program_code','program_name','is_featured','match_method','match_evidence'],
      dm_exhibit_weapon_link: ['account','exhibit','bli','pb_year','weapon_program','weapon_category',
        'weapon_page','match_method','match_evidence'],
      dm_source_field: ['source_key','source_label','fiscal_year','field_name','field_kind',
        'rows_scanned','populated_pct','distinct_count','sample_values','is_read','note'],
      dm_join_sample: ['seam_key','fiscal_year','verdict','why','record'],
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

    // ------------------------------------------------------------ controls --
    console.log('\n· control suite');
    await client.query('DELETE FROM dm_control_result');
    let failures = [];
    const severity = Object.fromEntries(seed.controls.map((c) => [c.code, c.severity]));
    for (const [code, fn] of Object.entries(CONTROLS)) {
      let results = [];
      try { results = await fn(client); }
      catch (e) { results = [{ status: 'fail', message: `control errored: ${e.message}` }]; }
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

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
  'REC-01': async (c) => (await c.query(`
    SELECT fiscal_year, filec_obligation AS observed, award_obligation AS expected, linkage_pct
      FROM dm_reconciliation r JOIN dm_load l ON l.id=r.load_id AND l.is_current
     ORDER BY fiscal_year`)).rows.map((r) => ({
    fiscal_year: r.fiscal_year, observed: r.observed, expected: r.expected,
    variance_pct: r.linkage_pct,
    status: Number(r.observed) <= Number(r.expected) ? 'pass' : 'fail',
    message: `FY${r.fiscal_year}: File C covers ${Number(r.linkage_pct).toFixed(1)}% of award-file obligations.` })),
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
};

// -------------------------------------------------------------------- main --
(async () => {
  const pool = new Pool({ connectionString: databaseUrl(), max: 4,
    connectionTimeoutMillis: 20000, ssl: { rejectUnauthorized: true } });
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
      ['knowledge.json',  'knowledge_bank',        'scripts/etl_analytics.py --step knowledge'],
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
        'filec_awards','linkage_pct','unlinked_obligation','is_partial_year'],
      dm_definition: ['slug','term','definition','why_it_matters','key_rules','authorities','related',
        'source_file','last_verified','topic'],
      dm_kb_inventory: ['collection','folder','label','doc_count','authority_tier','note','sort_order'],
      dm_justification_exhibit: ['fiscal_year','activity','exhibit_count'],
      dm_hearing: ['hearing_id','congress','chamber','title','ingest_date','defense_related'],
    };

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

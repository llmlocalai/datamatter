#!/usr/bin/env node
/**
 * Load real data into Neon (the source of truth for the datamatter app).
 *
 * Reads the baked JSON artifacts (produced by the Python ETLs from the USASpending
 * warehouse + the DoD-FM knowledge bank) and loads them into the Neon tables with
 * a TRUNCATE-then-INSERT pattern, so re-running refreshes the DB cleanly.
 *
 * Everything inserted is REAL data:
 *   - contract_* / budget_* / funds_control_*  <- USASpending warehouse (agency 097)
 *   - ppbe_* / gao_* / congressional_*         <- DoD-FM knowledge bank
 *   - knowledge_page (tsvector)                <- Wiki/DOD-FM (RAG corpus)
 *
 * Usage:  node scripts/load_neon.js
 */
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const DATA = path.join('app', 'api', 'data');
const read = (name) => JSON.parse(fs.readFileSync(path.join(DATA, name), 'utf-8'));

function resolveDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  for (const file of ['.env.local', '.env']) {
    const p = path.join(process.cwd(), file);
    if (fs.existsSync(p)) {
      for (const line of fs.readFileSync(p, 'utf-8').split('\n')) {
        const m = line.match(/^\s*DATABASE_URL\s*=\s*(.+?)\s*$/);
        if (m) return m[1].replace(/^["']|["']$/g, '');
       }
     }
   }
  throw new Error('DATABASE_URL not set (env or .env.local)');
}

// Multi-row parameterized insert. `cols` is the comma-joined column list,
// `rows` is an array of arrays (one per row). Batches to keep the query small.
async function insert(client, table, cols, rows, batch = 500) {
  if (!rows.length) return 0;
  let total = 0;
  for (let i = 0; i < rows.length; i += batch) {
    const slice = rows.slice(i, i + batch);
    const values = [];
    const colList = [];
    slice.forEach((row, r) => {
      colList.push('(' + row.map((_, c) => '$' + (r * row.length + c + 1)).join(',') + ')');
      values.push(...row);
       });
    const sql = `INSERT INTO ${table} (${cols}) VALUES ${colList.join(',')}`;
    const res = await client.query(sql, values);
    total += res.rowCount;
     }
  return total;
}

async function main() {
  const pool = new Pool({
    connectionString: resolveDatabaseUrl(),
    max: 5,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
   });
  const client = await pool.connect();
  const log = [];
  const truncate = async (t) => client.query(`TRUNCATE ${t} RESTART IDENTITY`);

  try {
    // ---------------------------------------------------------------- BUDGET
    const b = read('budget.json');
    await truncate('budget_function');
    await insert(
      client, 'budget_function',
      'fiscal_year, function_name, obligations, outlays, pct_of_total, source',
      b.by_function.map((f) => [
          b.fiscal_year_focus, f.function_name, f.obligations, 0, f.percentage, b.source,
         ])
     );
    await truncate('budget_agency');
    await insert(
      client, 'budget_agency',
      'fiscal_year, agency_name, obligations, pct_of_total, source',
      b.by_agency.map((a) => [b.fiscal_year_focus, a.agency_name, a.obligations, a.percentage, b.source])
     );
    await truncate('budget_fy_trend');
    await insert(
      client, 'budget_fy_trend',
      'fiscal_year, total_budgetary_resources, obligations_incurred, gross_outlays, source',
      b.fiscal_year_trend.map((t) => [
          t.fiscal_year, t.total_budgetary_resources, t.obligations_incurred, t.gross_outlays, b.source,
         ])
     );
    log.push(`budget: ${b.by_function.length} functions, ${b.by_agency.length} agencies, ${b.fiscal_year_trend.length} FYs`);

    // ----------------------------------------------------------- CONTRACTING
    const c = read('contracting_intelligence.json');
    const tables = [
      'contract_component','contract_prime','contract_metrics','contract_set_aside',
      'contract_competition','contract_naics','contract_state',
    ];
    for (const t of tables) await truncate(t);
    for (const r of c.records) {
      const fy = r.fiscal_year;
      const total = r.total_obligation || 1;
      // components
      await insert(client, 'contract_component',
          'fiscal_year, component, obligations, pct_of_total',
          r.by_sub_agency.map((s) => [fy, s.name, s.obligation, +((s.obligation / total) * 100).toFixed(2)]));
      // primes
      await insert(client, 'contract_prime',
          'fiscal_year, prime_name, obligations, pct_of_total',
          r.top_recipients.map((s) => [fy, s.name, s.obligation, +((s.obligation / total) * 100).toFixed(2)]));
      // set-aside
      await insert(client, 'contract_set_aside',
          'fiscal_year, set_aside, obligations',
          r.by_set_aside.map((s) => [fy, s.type, s.obligation]));
      // competition exceptions
      await insert(client, 'contract_competition',
          'fiscal_year, reason, obligations',
          (r.by_competition_exception || []).map((s) => [fy, s.reason, s.obligation]));
      // naics
      await insert(client, 'contract_naics',
          'fiscal_year, naics_code, description, obligations',
          (r.top_naics || []).map((s) => [fy, String(s.code), s.description || '', s.obligation]));
      // state
      await insert(client, 'contract_state',
          'fiscal_year, state_code, obligations',
          (r.by_recipient_state || []).map((s) => [fy, s.state, s.obligation]));
      // metrics (sole-source % and no-set-aside %)
      const sole = (r.by_competition_exception || [])
         .filter((x) => /SOLE|ONE SOURCE|UNIQUE|FOLLOW-ON|URGENCY|STATUTE|NATIONAL SECURITY/i.test(x.reason || ''))
         .reduce((s, x) => s + x.obligation, 0);
      const noSa = (r.by_set_aside || []).find((x) => (x.type || '').includes('NO SET ASIDE'))?.obligation || 0;
      await insert(client, 'contract_metrics',
          'fiscal_year, total_obligations, award_count, sole_source_pct, no_set_aside_pct, source',
          [[fy, r.total_obligation, r.award_count,
            +((sole / total) * 100).toFixed(1), +((noSa / total) * 100).toFixed(1), c.source]]);
     }
    log.push(`contracting: ${c.records.length} fiscal years loaded (components/primes/naics/set-aside/competition/state)`);

    // --------------------------------------------------------- FUNDS CONTROL
    const fc = read('funds_control.json');
    await truncate('funds_control');
    await truncate('funds_control_tas');
    for (const r of fc.records) {
      const lapse = (r.unobligated_pct_of_budget || 0) > 25;
      await insert(client, 'funds_control',
          'fiscal_year, total_budgetary_resources, obligations_incurred, gross_outlays, unobligated_balance, obligation_rate_pct, outlay_rate_pct, unobligated_pct, lapse_risk, source',
          [[r.fiscal_year, r.total_budgetary_resources, r.obligations_incurred, r.gross_outlays,
            r.unobligated_balance, r.obligation_rate_pct, r.outlay_rate_pct,
            r.unobligated_pct_of_budget, lapse, fc.source]]);
      await insert(client, 'funds_control_tas',
          'fiscal_year, agency, tas_name, obligations',
          (r.top_tas_accounts || []).map((t) => [r.fiscal_year, t.agency || t.tas, t.tas, t.obligation]));
     }
    log.push(`funds_control: ${fc.records.length} fiscal years + TAS accounts`);

    // ----------------------------------------------------------------- PPBE
    const p = read('ppbe.json');
    await truncate('ppbe_activity');
    await truncate('ppbe_summary');
    await insert(client, 'ppbe_activity',
         'activity, exhibits, quality, source',
         p.budget_activities.map((a) => {
           const q = a.exhibits >= 5 ? 'high' : a.exhibits >= 2 ? 'medium' : 'low';
           return [a.activity, a.exhibits, q, p.source];
          }));
    await insert(client, 'ppbe_summary',
         'total_programs, compliant_programs, non_compliant_programs, compliance_rate, omb30_submitted, omb30_approved, omb30_pending, omb30_rejected, quality_high, quality_medium, quality_low, source',
         [[p.total_budget_activities, p.justification_quality.high_quality + p.justification_quality.medium_quality,
           p.justification_quality.low_quality, p.compliance_rate,
           p.omb30_compliance.submitted, p.omb30_compliance.approved,
           p.omb30_compliance.pending, p.omb30_compliance.rejected,
           p.justification_quality.high_quality, p.justification_quality.medium_quality,
           p.justification_quality.low_quality, p.source]]);
    log.push(`ppbe: ${p.total_budget_activities} activities, compliance ${p.compliance_rate}%`);

    // ----------------------------------------------------------------- GAO
    const g = read('gao.json');
    await truncate('gao_finding_year');
    await truncate('gao_finding_type');
    await truncate('gao_report');
    await truncate('gao_summary');
    await insert(client, 'gao_finding_year',
         'year, findings, material_weaknesses',
         g.findings_by_year.map((y) => [y.year, y.findings, y.material_weaknesses]));
    await insert(client, 'gao_finding_type',
         'type, count',
         g.finding_types.map((t) => [t.type, t.count]));
    // Individual DoD-relevant reports (title only) for a browsable list.
    await insert(client, 'gao_report',
         'title, is_dod, topic, pub_date',
         (g.sample_dod_reports || []).map((t) => [t, true, null, null]));
    await insert(client, 'gao_summary',
         'total_gao_reports, dod_relevant_reports, afr_disclaimer_of_opinion, source',
         [[g.total_gao_reports, g.dod_relevant_reports, g.afr_disclaimer_of_opinion, g.source]]);
    log.push(`gao: ${g.total_gao_reports} reports, ${g.dod_relevant_reports} DoD-relevant`);

    // -------------------------------------------------------- CONGRESSIONAL
    const co = read('congressional.json');
    await truncate('congressional_committee');
    await truncate('congressional_hearing');
    await truncate('congressional_summary');
    await insert(client, 'congressional_committee',
         'committee, documents, kind',
         co.committees.map((c) => [c.committee, c.documents, c.kind]));
    await insert(client, 'congressional_hearing',
         'hearing_id, session, chamber, title, hearing_date',
         (co.recent_hearings || []).map((h) => [
             h.hearing_id, h.session, h.chamber, h.title, h.date || null,
            ]));
    const byC = co.by_chamber || {};
    await insert(client, 'congressional_summary',
         'total_hearings, total_documents, house, senate, joint, source',
         [[co.total_hearings, co.total_documents, byC.House || 0, byC.Senate || 0, byC.Joint || 0, co.source]]);
    log.push(`congressional: ${co.total_hearings} hearings, ${co.committees.length} committees`);

    // ---------------------------------------------------- KNOWLEDGE (RAG corpus)
    const k = read('knowledge_index.json');
    await truncate('knowledge_page');
    // Build tsvector in SQL via to_tsvector('english', body) for real full-text search.
    // Deduplicate by (page+section) so one row per chunk.
    const seen = new Set();
    const krows = [];
    for (const d of k.docs) {
      const slug = `${d.page}::${(d.section || '').slice(0, 40)}`;
      if (seen.has(slug)) continue;
      seen.add(slug);
      krows.push([
          slug,
          d.page,
          d.source || '',
          d.authority || 1.0,
          `${d.section ? d.section + ' — ' : ''}${d.text}`,
         ]);
     }
    // Insert with tsvector computed server-side.
    for (let i = 0; i < krows.length; i += 300) {
      const slice = krows.slice(i, i + 300);
      const cols = slice.map(() => '(slug, title, source, authority, body, to_tsvector(\'english\', body))').join(',');
      const vals = [];
      const placeholders = [];
      slice.forEach((row, r) => {
        placeholders.push('(' + row.map((_, c) => '$' + (r * row.length + c + 1)).join(',') + ')');
        vals.push(...row);
         });
      await client.query(
         `INSERT INTO knowledge_page (slug, title, source, authority, body, tsvector) VALUES ${placeholders.join(',')}`,
         vals
        );
     }
    log.push(`knowledge: ${krows.length} wiki chunks indexed with tsvector (RAG corpus)`);

    // ---------------------------------------------------- refresh log
    await insert(client, 'refresh_log',
         'pipeline, rows_loaded, status',
         [['load_neon.js', 1, 'ok']]);

    console.log('\n✓ Neon load complete:');
    for (const l of log) console.log('    -', l);
   } catch (e) {
    console.error('✗ Load failed:', e.message);
    process.exitCode = 1;
   } finally {
    client.release();
    await pool.end();
   }
}

main();

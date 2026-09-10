#!/usr/bin/env node
/**
 * Apply the schema to the database, and nothing else.
 *
 *   node scripts/apply_schema.js          # or: npm run migrate
 *
 * WHY THIS EXISTS SEPARATELY FROM THE LOAD. The site prerenders every page
 * against the live database at build time, so a page that reads a column the
 * database does not have yet fails the BUILD, not the request. That makes the
 * order of a release matter:
 *
 *     1. npm run migrate     schema only, safe on a live site, seconds
 *     2. npm run refresh     the ETL and the load, minutes
 *     3. git push            the deploy, which prerenders against 1 and 2
 *
 * Running the code deploy first is what broke the FY2026 frontier release:
 * `column y.frontier_day_of_fy does not exist`, three times, and the build
 * exited 1. The schema is idempotent — CREATE TABLE IF NOT EXISTS throughout and
 * ALTER ... ADD COLUMN IF NOT EXISTS in the upgrades section — so step 1 can be
 * run at any time, including against a database serving traffic, and run twice.
 *
 * This used to apply `schema.neon.sql`, which is the FY2027 war-budget schema
 * and not the analytics one, and it connected with `rejectUnauthorized: false`,
 * which encrypts the connection and authenticates nothing. Both are fixed: it
 * applies the analytics schema and the war-budget schema, and it verifies the
 * server certificate exactly as the loader does.
 */
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const ROOT = path.dirname(__dirname);
const FILES = ['database/schema.analytics.sql', 'database/war_budget_schema.sql'];

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

(async () => {
  const url = databaseUrl();
  // A local socket or localhost has no TLS to verify; anything else is verified.
  const isLocal = /host=\/|@(localhost|127\.0\.0\.1)[:/]/.test(url);
  const pool = new Pool({ connectionString: url, max: 2,
    connectionTimeoutMillis: 20000,
    ssl: isLocal ? false : { rejectUnauthorized: true } });
  const client = await pool.connect();
  try {
    const before = await client.query(
      `SELECT count(*)::int AS tables FROM information_schema.tables
        WHERE table_schema = current_schema()`);
    const colsBefore = await client.query(
      `SELECT count(*)::int AS cols FROM information_schema.columns
        WHERE table_schema = current_schema()`);

    for (const f of FILES) {
      const p = path.join(ROOT, f);
      if (!fs.existsSync(p)) { console.log(`· ${f}: absent, skipped`); continue; }
      await client.query(fs.readFileSync(p, 'utf-8'));
      console.log(`· ${f}: applied`);
    }

    const after = await client.query(
      `SELECT count(*)::int AS tables FROM information_schema.tables
        WHERE table_schema = current_schema()`);
    const colsAfter = await client.query(
      `SELECT count(*)::int AS cols FROM information_schema.columns
        WHERE table_schema = current_schema()`);
    const dt = after.rows[0].tables - before.rows[0].tables;
    const dc = colsAfter.rows[0].cols - colsBefore.rows[0].cols;
    console.log(`\n✓ ${after.rows[0].tables} tables, ${colsAfter.rows[0].cols} columns`
      + `${dt || dc ? `  (+${dt} table${dt === 1 ? '' : 's'}, +${dc} column${dc === 1 ? '' : 's'})`
                    : '  (no change — already current)'}`);
    console.log('\nNo data was written. Run `npm run refresh` to load it, then deploy.');
  } catch (e) {
    console.error('✗ schema apply failed:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();

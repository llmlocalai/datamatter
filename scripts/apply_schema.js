#!/usr/bin/env node
/**
 * Apply database/schema.neon.sql to Neon. Idempotent (CREATE TABLE IF NOT EXISTS).
 * Plain-node script — uses pg directly and resolves DATABASE_URL from env or .env.local.
 */
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

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

(async () => {
  const sql = fs.readFileSync(path.join('database', 'schema.neon.sql'), 'utf-8');
  const pool = new Pool({
    connectionString: resolveDatabaseUrl(),
    max: 5,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
  });
  try {
    const client = await pool.connect();
    await client.query(sql);
    const t = await client.query(
      "select tablename from pg_tables where schemaname='public' order by tablename"
    );
    console.log(`✓ Schema applied. ${t.rows.length} tables in public:`);
    for (const row of t.rows) console.log('   -', row.tablename);
    client.release();
  } catch (e) {
    console.error('✗ Schema apply failed:', e.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();

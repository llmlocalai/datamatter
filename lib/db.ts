/**
 * Shared Neon (serverless Postgres) client.
 *
 * TLS: the server certificate is verified. The previous build passed
 * `rejectUnauthorized: false`, which encrypts the connection but authenticates
 * nothing — the comment there claimed the opposite of what the option does.
 * Neon presents a publicly-trusted certificate, so verification just works;
 * local sockets (used by the schema-verification harness) have no TLS to verify.
 */
import { Pool, PoolClient, types } from 'pg';
import fs from 'fs';
import path from 'path';

// numeric/decimal (OID 1700) arrives as a string by default so that arbitrary
// precision survives. Every numeric column here is money we render at $B/$T
// scale, so parse to number once, centrally, rather than in every caller.
types.setTypeParser(1700, (v: string) => (v === null ? null : parseFloat(v)));
types.setTypeParser(20, (v: string) => (v === null ? null : parseInt(v, 10))); // int8

function resolveDatabaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  for (const file of ['.env.local', '.env']) {
    const p = path.join(process.cwd(), file);
    if (fs.existsSync(p)) {
      const m = fs.readFileSync(p, 'utf-8').match(/^\s*DATABASE_URL\s*=\s*(.+?)\s*$/m);
      if (m) return m[1].replace(/^["']|["']$/g, '');
    }
  }
  throw new Error('DATABASE_URL is not set. Put it in .env.local or the environment.');
}

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    const connectionString = resolveDatabaseUrl();
    const isLocal = /host=\/|@(localhost|127\.0\.0\.1)[:/]/.test(connectionString);
    pool = new Pool({
      connectionString,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 15_000,
      ssl: isLocal ? false : { rejectUnauthorized: true },
    });
  }
  return pool;
}

/** Parameterized query helper. Always pass values as params — never interpolate. */
export async function query<T = any>(text: string, params?: unknown[]): Promise<T[]> {
  const client: PoolClient = await getPool().connect();
  try {
    const res = await client.query(text, params);
    return res.rows as T[];
  } finally {
    client.release();
  }
}

export async function runSqlFile(filePath: string): Promise<void> {
  const sql = fs.readFileSync(filePath, 'utf-8');
  const client: PoolClient = await getPool().connect();
  try { await client.query(sql); } finally { client.release(); }
}

export async function endPool(): Promise<void> {
  if (pool) { await pool.end(); pool = null; }
}

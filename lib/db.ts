/**
 * Shared Neon (serverless Postgres) client for Datamatter.
 *
 * Neon's pooled endpoint (…-pooler… in the connection string) is designed for
 * serverless runtimes like Vercel: connections are pooled and the DB auto-scales.
 * We keep a single module-level Pool so every request reuses it, and expose a
 * small `query` helper so API routes never touch `pg` directly.
 *
 * DATABASE_URL resolution:
 *   1. process.env.DATABASE_URL  (Next.js auto-loads .env.local for routes)
 *   2. otherwise we parse .env.local / .env ourselves (for plain-node scripts
 *      like the loader that run outside Next.js)
 */
import { Pool, PoolClient } from 'pg';
import fs from 'fs';
import path from 'path';

function resolveDatabaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  // Fallback for scripts run outside Next.js.
  for (const file of ['.env.local', '.env']) {
    const p = path.join(process.cwd(), file);
    if (fs.existsSync(p)) {
      for (const line of fs.readFileSync(p, 'utf-8').split('\n')) {
        const m = line.match(/^\s*DATABASE_URL\s*=\s*(.+?)\s*$/);
        if (m) return m[1].replace(/^["']|["']$/g, '');
        }
      }
    }
  throw new Error(
     'DATABASE_URL is not set. Put it in .env.local or the environment.'
    );
}

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: resolveDatabaseUrl(),
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 15_000,
      // Neon requires SSL; pg treats sslmode=require as verify-full, which is fine.
      ssl: { rejectUnauthorized: false },
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

/** Run a whole SQL file (e.g. the schema) as a single simple-query batch. */
export async function runSqlFile(filePath: string): Promise<void> {
  const sql = fs.readFileSync(filePath, 'utf-8');
  const client: PoolClient = await getPool().connect();
  try {
    await client.query(sql);
   } finally {
    client.release();
   }
}

export async function endPool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
   }
}

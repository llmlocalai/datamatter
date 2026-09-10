/**
 * What the live database actually has.
 *
 * The site prerenders every page against the live database at build time, so a
 * query naming a column the database has not been migrated to yet does not fail
 * a request — it fails the BUILD, and the deploy with it. That happened on the
 * FY2026 frontier release: the code shipped before `npm run migrate` ran, and
 * `column y.frontier_day_of_fy does not exist` took the whole site's build down
 * over one section of one page.
 *
 * The ordering rule (migrate, refresh, deploy) is in CLAUDE.md and is the real
 * fix. This is the guard for when it is not followed: a page can ask whether the
 * columns it needs are present and withhold that section, rather than taking
 * everything else down with it.
 *
 * WHAT IT MUST NOT DO is fall back to the old column and carry on. On this
 * release the fallback for a missing reporting frontier would have been the
 * year's last action date, which is precisely the value the frontier exists to
 * replace — the guard would have quietly restored the bug it was added because
 * of. A missing column means the figures are not available, which is what the
 * page says.
 */
import { query } from './db';

const cache = new Map<string, Promise<Set<string>>>();

/** Column names present on `table`, cached for the life of the process. */
export function columnsOf(table: string): Promise<Set<string>> {
  let hit = cache.get(table);
  if (!hit) {
    hit = query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = $1`, [table])
      .then((rows) => new Set(rows.map((r) => r.column_name)))
      // A database that cannot be reached at all is a different failure, and one
      // the caller should see. An empty set here would read as "the table has no
      // columns", so the rejection is left to propagate.
      .catch((e) => { cache.delete(table); throw e; });
    cache.set(table, hit);
  }
  return hit;
}

/** The subset of `cols` the table does NOT have. Empty means it is current. */
export async function missingColumns(table: string, cols: string[]): Promise<string[]> {
  const have = await columnsOf(table);
  return cols.filter((c) => !have.has(c));
}

/**
 * The FY2027 source documents, and the bytes behind them.
 *
 * This file used to carry the whole FY2027 dashboard: an overview that summed
 * the seven "-1" exhibits and a paginated line-item query. Both are gone. They
 * read `war_budget_line` directly, with no memo rule of any kind, so the total
 * they published counted the P-1R exhibit -- Guard and Reserve equipment already
 * inside the P-1 lines -- alongside the P-1 advance-procurement subtotals and
 * every Non-Add row: $30.1B above what the exhibits themselves foot to in
 * FY2027. They also carried no vintage, which put the one page on this site with
 * no provenance on it beside six that have it.
 *
 * `lib/pb.ts` replaces them, on `dm_pb_line`, inside the control suite. What
 * stays here is the document catalog and the stored file bytes, which the
 * download route needs and which nothing else provides.
 */
import { query as rawQuery } from "./db";

// The FY2027 document tables may be absent in a database that has only had the
// analytics load applied. Treat undefined_table as an empty result so the page
// renders its own empty state instead of a 500.
async function query<T = any>(text: string, params?: unknown[]): Promise<T[]> {
  try { return await rawQuery<T>(text, params); }
  catch (e: any) { if (e?.code === "42P01") return []; throw e; }
}

export interface DocInfo {
  id: number;
  docCode: string;
  name: string;
  format: string;
  byteSize: number;
  hasBytes: boolean;
  sourceUrl: string;
}

// ---------------------------------------------------------------------------
// Document: fetch a stored source file's bytes from war_budget_file (bytea).
// ---------------------------------------------------------------------------
export interface StoredFile {
  filename: string;
  format: string;
  byteSize: number;
  data: Uint8Array;
}

export async function getDocument(
  id: number
): Promise<StoredFile | null> {
   // 1) resolve the document's filename from its catalog row
  const docRows = await query<any>(
     `SELECT source_url FROM war_budget_document WHERE id=$1`,
     [id]
   );
  const doc = docRows[0];
  if (!doc || !doc.source_url) return null;
  const filename = doc.source_url.split("/").pop();
  if (!filename) return null;

   // 2) fetch the stored bytes from the file table by filename (unique)
  const rows = await query<any>(
     `SELECT filename, format, byte_size, data
     FROM war_budget_file WHERE filename=$1`,
     [filename]
   );
  const r = rows[0];
  if (!r || r.data == null) return null;
  return {
    filename: r.filename,
    format: r.format,
    byteSize: Number(r.byte_size) || r.data.length,
    data: new Uint8Array(Buffer.isBuffer(r.data) ? r.data : Buffer.from(r.data)),
  };
}

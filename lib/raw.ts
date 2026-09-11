/**
 * RAW DATA.
 *
 * The first five records of every file the extract reads, every column, under
 * the file's own names and in the file's own order (dm_raw_source, dm_raw_row;
 * written by scripts/etl_analytics.py --step raw). Values are the text the file
 * holds. Nothing here is aggregated, renamed, scoped or rounded -- that is the
 * point of the page -- so nothing here may be used as a figure either.
 */
import { query as rawQuery } from './db';

async function query<T = any>(text: string, params?: unknown[]): Promise<T[]> {
  try {
    return await rawQuery<T>(text, params);
  } catch (e: any) {
    if (e?.code === '42P01') return [];   // tables not created yet: the page says so
    throw e;
  }
}

export interface RawColumn { name: string; type: string }
export interface RawSource {
  sourceKey: string; groupLabel: string; label: string; fileFormat: string;
  filePath: string; samplePath: string; sheetName: string | null;
  totalRows: number | null; fileCount: number | null; columnCount: number;
  columns: RawColumn[]; preamble: (string | null)[][]; note: string | null;
  records: (string | null)[][];
}

export async function getRawSources(): Promise<RawSource[]> {
  const [sources, rows] = await Promise.all([
    query<any>(
      `SELECT s.source_key, s.group_label, s.label, s.file_format, s.file_path, s.sample_path,
              s.sheet_name, s.total_rows, s.file_count, s.column_count, s.columns_json,
              s.preamble_json, s.note
         FROM dm_raw_source s JOIN dm_load l ON l.id = s.load_id AND l.is_current
        ORDER BY s.sort_order, s.source_key`),
    query<any>(
      `SELECT r.source_key, r.row_no, r.values_json
         FROM dm_raw_row r JOIN dm_load l ON l.id = r.load_id AND l.is_current
        ORDER BY r.source_key, r.row_no`),
  ]);
  const bySource = new Map<string, (string | null)[][]>();
  for (const r of rows) {
    if (!bySource.has(r.source_key)) bySource.set(r.source_key, []);
    bySource.get(r.source_key)!.push(JSON.parse(r.values_json));
  }
  return sources.map((s) => ({
    sourceKey: s.source_key, groupLabel: s.group_label, label: s.label, fileFormat: s.file_format,
    filePath: s.file_path, samplePath: s.sample_path, sheetName: s.sheet_name,
    totalRows: s.total_rows == null ? null : Number(s.total_rows),
    fileCount: s.file_count == null ? null : Number(s.file_count),
    columnCount: Number(s.column_count),
    columns: JSON.parse(s.columns_json),
    preamble: s.preamble_json ? JSON.parse(s.preamble_json) : [],
    note: s.note,
    records: bySource.get(s.source_key) ?? [],
  }));
}

export interface RawControl { status: string; message: string }
/** RAW-01's latest results: structure, coverage, currency. */
export async function getRawControl(): Promise<RawControl[]> {
  return query<RawControl>(
    `SELECT status, message FROM dm_control_result WHERE control_code = 'RAW-01' ORDER BY id`);
}

#!/usr/bin/env node
/**
 * Ingest FY2027 "-1" DoD Budget display tables into Neon (Postgres).
 *
 * Source: https://comptroller.war.gov/budgetmaterials/budget2027.aspx
 *
 * The FY2027 budget page lists, for each document type (C-1, M-1, O-1, P-1,
 * P-1r, R-1, RF-1), a machine-readable `_display.xlsx` and a presentation PDF.
 * This script:
 *   1. downloads every FY2027 document (XLSX + PDF) from the page,
 *   2. catalogs each document                -> war_budget_document,
 *   3. stores the raw file bytes            -> war_budget_file   (bytea),
 *   4. parses the 7 XLSX display tables into rows -> war_budget_line.
 *
 * It reuses the resolveDatabaseUrl() + batched insert() idiom from
 * scripts/load_neon.js so it drops into the existing pipeline. It is a
 * MANUALLY-RUN ingestion script — do NOT wire it into `next build`.
 *
 * XLSX layout (verified against the real files), consistent across all 7:
 *   - the row that contains the label "Total of Displayed Rows" is the sheet
 *     grand total (skipped as a data row);
 *   - the header row is the one whose first cell is "Account";
 *   - every row below the header is a data row; dollar amounts are in $K.
 * The header row is LOCATED by scanning for "Account" (not assumed to be row 2),
 * and each data row is built as a header->value map, so per-file column
 * reordering cannot corrupt the parse.
 *
 * Usage:  node scripts/ingest_war_budget.js
 */
const { Pool } = require('pg');
const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');

const PAGE_URL =
  'https://comptroller.war.gov/budgetmaterials/budget2027.aspx';
const FY = 2027;
const CACHE = path.join('database', 'war_budget_cache', `FY${FY}`);
const SCHEMA = path.join('database', 'war_budget_schema.sql');

// Document types we parse into war_budget_line. Everything else on the page
// (the PDFs, zips, extra xlsx) is still cataloged + byte-stored, just not
// parsed into rows.
const XLSX_TABLES = ['c1', 'm1', 'o1', 'p1', 'p1r', 'r1', 'rf1'];

// -----------------------------------------------------------------------------
// DB URL resolution — identical to scripts/load_neon.js.
// -----------------------------------------------------------------------------
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
async function insert(client, table, cols, rows, batch = 200) {
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

// -----------------------------------------------------------------------------
// HTTP: fetch a URL as text or as a Buffer.
// -----------------------------------------------------------------------------
async function fetchText(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (datamatter-ingest)' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

async function fetchBytes(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (datamatter-ingest)' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return { buf, type: res.headers.get('content-type') || '' };
}

// Extract absolute URL of every link on the budget page that points at a
// downloadable FY2027 document under .../defbudget/FY2027/.
function extractDocLinks(html) {
  const base = 'https://comptroller.war.gov';
   // new RegExp (not a regex literal) so ${FY} interpolates.
  const re = new RegExp(`href="([^"]+?)/defbudget/FY${FY}/([^"]+?)"`, 'g');
  const seen = new Set();
  const out = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    // m[1] = path prefix (…/Documents), m[2] = filename; re-insert the middle
    // segment the regex consumed as a literal.
    let href = `${m[1]}/defbudget/FY${FY}/${m[2]}`;
    // decode HTML entities like &amp;
    href = decodeHtml(href);
    if (href.startsWith('//')) href = 'https:' + href;
    if (!href.startsWith('http')) href = base + href;
    if (seen.has(href)) continue;
    seen.add(href);
    out.push(href);
  }
  return out;
}

function decodeHtml(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

// Map a filename to a normalized doc code + type, or null if it's not one of
// the 7 XLSX display tables or their matching PDF.
function classify(filename) {
  const base = filename.toLowerCase();
  // XLSX display tables: <code>_display.xlsx  (also p1r_display_ooc.xlsx variant)
  for (const code of XLSX_TABLES) {
    // match "<code>_display.xlsx" and the known p1r_ooc variant
    const reXlsx = new RegExp(`^${code.replace('.', '\\.')}(_display|_display_ooc)\\.xlsx$`);
    if (reXlsx.test(base)) return { doc_code: code, doc_type: 'display_xlsx', format: 'xlsx' };
  }
  // PDFs: FY2027_<code>.pdf  (e.g. FY2027_c1.pdf)
  const rePdf = new RegExp(`^fy2027_(${XLSX_TABLES.join('|')})\\.pdf$`);
  const pm = base.match(rePdf);
  if (pm) return { doc_code: pm[1], doc_type: 'presentation_pdf', format: 'pdf' };
  // Anything else in the FY2027 folder (zips, extra xlsx, json)
  const ext = base.split('.').pop();
  if (ext === 'xlsx') return { doc_code: 'other', doc_type: 'other', format: 'xlsx' };
  return { doc_code: 'other', doc_type: 'other', format: ext || 'bin' };
}

// -----------------------------------------------------------------------------
// Parse one XLSX file into rows for war_budget_line.
// Returns an array of { sheet_name, fiscal_year, account, account_title,
// organization, values (object header->value) }.
// -----------------------------------------------------------------------------
async function parseXlsx(filePath) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const rows = [];

  for (const sheet of wb.worksheets) {
    const all = [];
    // ExcelJS exposes rows via eachRow (sheet.rows is not iterable).
    sheet.eachRow((r) => all.push(r));
    if (!all.length) continue;

    // Locate the header row: the first row whose first non-empty cell === "Account"
    let headerIdx = -1;
    let header = null;
    for (let i = 0; i < all.length; i++) {
      const cells = cellValues(all[i]);
      const first = (cells.find((c) => c !== null && String(c).trim() !== '') || '').toString().trim();
      if (first.toLowerCase() === 'account') {
        headerIdx = i;
        header = cells.map((c, idx) => {
          const v = c === null || String(c).trim() === '' ? `col_${idx}` : String(c).replace(/\s+/g, ' ').trim();
          return v;
        });
        break;
      }
    }
    if (headerIdx === -1) continue; // no recognizable header — skip sheet

    // Data rows: everything below the header.
    for (let i = headerIdx + 1; i < all.length; i++) {
      const cells = cellValues(all[i]);
      if (!cells.some((c) => c !== null && String(c).trim() !== '')) continue; // blank row

      const values = {};
      header.forEach((h, idx) => {
        const raw = cells[idx];
        values[h] = raw === null || String(raw).trim() === '' ? null : raw;
      });

      // Promote the common identifying columns.
      const account = norm(cells[0]);
      const accountTitle = norm(cells[1]);
      const organization = norm(cells[2]);

      // Fiscal year for this sheet: take from a "Fiscal Year" cell if present,
      // else derive from the sheet name (e.g. "FY 2027 Total" -> 2027), else FY.
      let fy = FY;
      const fyCell = values['Fiscal Year'] ?? values['Fiscal Year\n'];
      if (fyCell != null) {
        const d = parseInt(String(fyCell).trim(), 10);
        if (!Number.isNaN(d) && d >= 2000 && d < 2100) fy = d;
      } else {
        const sm = sheet.name.match(/FY\s*20\d\d/i) || sheet.name.match(/20\d\d/);
        if (sm) fy = parseInt(sm[0].match(/20\d\d/)[0], 10);
      }

      rows.push({
        sheet_name: sheet.name,
        fiscal_year: fy,
        account,
        account_title: accountTitle,
        organization,
        values,
      });
    }
  }
  return rows;
}

// Convert an ExcelJS row into an array of cell values (numbers stay numbers).
function cellValues(row) {
  const out = [];
  const count = Math.max(row.cellCount || 0, 1);
  for (let i = 1; i <= count; i++) {
    const cell = row.getCell(i);
    out.push(cell === null || cell === undefined ? null : cell.value === undefined ? null : cell.value);
  }
  return out;
}

// Normalize a cell to a clean string or null.
function norm(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' || s === 'undefined' ? null : s;
}

// -----------------------------------------------------------------------------
// main
// -----------------------------------------------------------------------------
async function main() {
  const dbUrl = resolveDatabaseUrl();
  console.log('Connecting to Neon…');
  const pool = new Pool({
    connectionString: dbUrl,
    max: 5,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
  });
  const client = await pool.connect();

  try {

  // Ensure the schema exists.
  const schemaSql = fs.readFileSync(SCHEMA, 'utf-8');
  await client.query(schemaSql);
  console.log('✓ war_budget_* schema applied');

  // 1. Discover document links from the budget page.
  console.log(`Fetching page: ${PAGE_URL}`);
  const html = await fetchText(PAGE_URL);
  const links = extractDocLinks(html);
  console.log(`   found ${links.length} FY${FY} document links`);
  if (!links.length) {
    throw new Error('No FY2027 document links found on the page — did the page change?');
  }

  fs.mkdirSync(CACHE, { recursive: true });

  // 2 + 3. Download + catalog + byte-store each document.
  const catalog = [];       // rows for war_budget_document
  const parsedRows = [];    // rows for war_budget_line
  const failures = [];

  await client.query('TRUNCATE war_budget_document RESTART IDENTITY');
  await client.query('TRUNCATE war_budget_file RESTART IDENTITY');
  await client.query('TRUNCATE war_budget_line RESTART IDENTITY');

  for (const url of links) {
    const filename = decodeURIComponent(url.split('/').pop());
    const cls = classify(filename);
    let buf = null;
    try {
      const { buf: b } = await fetchBytes(url);
      buf = b;
      fs.writeFileSync(path.join(CACHE, filename), buf);
    } catch (e) {
      failures.push(`${filename}: ${e.message}`);
      // still catalog it, but without bytes
      catalog.push([
        FY, cls.doc_code, cls.doc_type, cls.format, filename, url, null, false,
      ]);
      continue;
    }

    // byte-store
    await client.query(
      'INSERT INTO war_budget_file (fiscal_year, doc_code, format, filename, byte_size, data) VALUES ($1,$2,$3,$4,$5,$6)',
      [FY, cls.doc_code, cls.format, filename, buf.length, buf]
    );

    catalog.push([
      FY, cls.doc_code, cls.doc_type, cls.format, filename, url, buf.length, true,
    ]);

    // parse the 7 XLSX display tables into war_budget_line
    if (cls.doc_type === 'display_xlsx' && cls.doc_code !== 'other') {
      try {
        const rows = await parseXlsx(path.join(CACHE, filename));
        for (const row of rows) row.doc_code = cls.doc_code;
        parsedRows.push(...rows);
        console.log(`   parsed ${cls.doc_code}: ${rows.length} rows`);
      } catch (e) {
        failures.push(`parse ${filename}: ${e.message}`);
      }
    }
  }

  // 4. Load the catalog.
  const catN = await insert(
    client, 'war_budget_document',
    'fiscal_year, doc_code, doc_type, format, title, source_url, byte_size, has_bytes',
    catalog
  );

  // 5. Load the parsed lines.
  const lineRows = parsedRows.map((r) => [
    r.fiscal_year,
    r.doc_code,
    r.sheet_name,
    r.account,
    r.account_title,
    r.organization,
    JSON.stringify(r.values),     // JSONB: pass a JSON string, not a raw object
  ]);
  const lineN = await insert(
    client, 'war_budget_line',
    'fiscal_year, doc_code, sheet_name, account, account_title, organization, values',
    lineRows
  );

  // 6. refresh_log entry (matches the existing observability table).
  await insert(client, 'refresh_log', 'pipeline, rows_loaded, status',
    [['ingest_war_budget.js', lineN, 'ok']]);

  console.log('\n✓ FY2027 budget ingest complete:');
  console.log(`   - documents cataloged : ${catN}`);
  console.log(`   - files byte-stored   : ${catalog.filter((c) => c[7]).length}`);
  console.log(`   - line rows parsed    : ${lineN}`);
  if (failures.length) {
    console.log(`   - warnings (${failures.length}):`);
    for (const f of failures) console.log(`       ! ${f}`);
  }

  } finally {
    client.release();
    await pool.end();
   }
}

main().catch((e) => {
  console.error('✗ Ingest failed:', e.message);
  process.exitCode = 1;
});

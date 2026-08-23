/**
 * Server-side data layer for the FY2027 "-1" budget dashboard.
 *
 * Reads ONLY the canonical sheet of each exhibit to avoid double-counting:
 * the ingestion loaded several sheets per file (e.g. "Exhibit P-1" AND
 * "FY 2027 Total" AND "FY 2027 Discretionary Request"), all tagged
 * fiscal_year=2027. Summing across them multiplies the true total. Each
 * multi-year exhibit has exactly ONE canonical sheet that already holds all
 * three years (2025/2026/2027) plus the discretionary/mandatory split in each
 * row; C-1 (construction) instead has one sheet per year.
 *
 * Amounts in the DB are in $ thousands ($K). Every function here multiplies by
 * 1000 so callers work in DOLLARS; the UI then formats /1e9 ($B), /1e12 ($T).
 *
 * All SQL is parameterized (values bound, never interpolated).
 */
import { query } from "./db";

// doc_codes for the 7 FY2027 exhibits (in display order).
export const EXHIBITS = ["c1", "m1", "o1", "p1", "p1r", "r1", "rf1"] as const;
export type ExhibitCode = (typeof EXHIBITS)[number];

// Human-readable names + the canonical sheet(s) that hold the de-duplicated data.
// Multi-year exhibits: one canonical sheet per code.
// c1 (construction): one sheet per fiscal year.
const SHEETS: Record<ExhibitCode, string[]> = {
  c1: ["FY 2025", "FY 2026", "FY 2027"],
  m1: ["Exhibit M-1"],
  o1: ["OM Title plus Indefinite"],
  p1: ["Exhibit P-1"],
  p1r: ["Exhibit P-1R"],
  r1: ["Exhibit R-1"],
  rf1: ["RF-1 Title"],
};

export const EXHIBIT_META: Record<
  ExhibitCode,
  { name: string; long: string; discMand: boolean }
> = {
  c1: { name: "C-1", long: "Military Construction", discMand: false },
  m1: { name: "M-1", long: "Military Personnel", discMand: true },
  o1: { name: "O-1", long: "Operation & Maintenance", discMand: true },
  p1: { name: "P-1", long: "Procurement", discMand: true },
  p1r: { name: "P-1R", long: "Procurement (RDT&E)", discMand: true },
  r1: { name: "R-1", long: "Research, Development & Testing", discMand: true },
  rf1: { name: "RF-1", long: "Research & Development Fund", discMand: true },
};

// Organization (service) code -> label, for the by-service breakdown.
export const ORG_LABELS: Record<string, string> = {
  A: "Army",
  N: "Navy",
  F: "Air Force",
  OSD: "OSD (DoD-Wide)",
  DHA: "DHA (Health)",
  SOCOM: "SOCOM (Special Ops)",
  MDA: "MDA (Space)",
  DISA: "DISA",
  DLA: "DLA (Logistics)",
  DARPA: "DARPA",
  CYBER: "CYBERCOM",
  DTRA: "DTRA",
  DSCA: "DSCA",
  DEFW: "DEFCOM (Force Mgmt)",
  DHRA: "DHRA",
  DCSA: "DCSA",
  DODEA: "DODEA (Education)",
  TJS: "TJS (Test & Eval)",
  DCAA: "DCAA",
  DCMA: "DCMA",
  IG: "DoD IG",
  OTE: "OTE",
};

// ---- COALESCE total expressions (dollar amounts in $K) ----------------------
// Column names differ per exhibit; COALESCE over the 3 known patterns is robust.
function totalExpr(year: number): string {
  return (
    `COALESCE(` +
    `(values->>'FY ${year} Total')::numeric,` +
    `(values->>'FY ${year} Total Amount')::numeric,` +
    `(values->>'FY${year} Total Obligation Authority')::numeric, 0)`
  );
}
function discExpr(): string {
  return (
    `COALESCE(` +
    `(values->>'FY 2027 Discretionary Request')::numeric,` +
    `(values->>'FY 2027 Discretionary Request Amount')::numeric, 0)`
  );
}
function mandExpr(): string {
  return (
    `COALESCE(` +
    `(values->>'FY 2027 Mandatory Request')::numeric,` +
    `(values->>'FY 2027 Mandatory Amount')::numeric, 0)`
  );
}

// Build a canonical-sheet WHERE clause for a set of codes, returning the SQL
// fragment plus the bound params (sheet names are bound, not interpolated).
function canonicalFilter(
  codes: ExhibitCode[]
): { sql: string; params: unknown[] } {
  const ors: string[] = [];
  const params: unknown[] = [];
  for (const code of codes) {
    const sheets = SHEETS[code];
    if (sheets.length === 1) {
      ors.push(`(doc_code=$${params.length + 1} AND sheet_name=$${params.length + 2})`);
      params.push(code, sheets[0]);
    } else {
      const ph: string[] = [];
      for (const s of sheets) {
        params.push(s);
        ph.push(`$${params.length}`);
      }
      ors.push(`(doc_code=$${params.length + 1} AND sheet_name IN (${ph.join(",")}))`);
      params.push(code);
    }
  }
  return { sql: ors.join(" OR "), params };
}

const K = 1000; // $K -> dollars

// ---------------------------------------------------------------------------
// Overview: totals, per-exhibit, by-service, by-activity, documents.
// ---------------------------------------------------------------------------
export interface ExhibitSummary {
  code: ExhibitCode;
  name: string;
  long: string;
  discMand: boolean;
  byYear: { fy2025: number; fy2026: number; fy2027: number };
  discretionary: number;
  mandatory: number;
  rowCount: number;
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

export interface Overview {
  fiscalYearFocus: number;
  totals: { fy2025: number; fy2026: number; fy2027: number };
  discretionaryTotal: number;
  mandatoryTotal: number;
  lineItemCount: number;
  exhibits: ExhibitSummary[];
  byOrganization: { org: string; label: string; total: number; pct: number }[];
  byActivity: { activity: string; total: number; pct: number }[];
  documents: DocInfo[];
}

export async function getOverview(): Promise<Overview> {
  const exhibits: ExhibitSummary[] = [];
  const totals = { fy2025: 0, fy2026: 0, fy2027: 0 };
  let discTotal = 0;
  let mandTotal = 0;
  let lineItemCount = 0;

  for (const code of EXHIBITS) {
    const { sql, params } = canonicalFilter([code]);
    const rows = await query<any>(
      `SELECT
        COALESCE(SUM(${totalExpr(2025)}),0) t25,
        COALESCE(SUM(${totalExpr(2026)}),0) t26,
        COALESCE(SUM(${totalExpr(2027)}),0) t27,
        COALESCE(SUM(${discExpr()}),0) disc,
        COALESCE(SUM(${mandExpr()}),0) mand,
        count(*) n
      FROM war_budget_line WHERE fiscal_year=2027 AND (${sql})`,
      params
    );
    const r = rows[0] || {};
    const t25 = Number(r.t25) * K;
    const t26 = Number(r.t26) * K;
    const t27 = Number(r.t27) * K;
    const disc = Number(r.disc) * K;
    const mand = Number(r.mand) * K;
    const meta = EXHIBIT_META[code];
    exhibits.push({
      code,
      name: meta.name,
      long: meta.long,
      discMand: meta.discMand,
      byYear: { fy2025: t25, fy2026: t26, fy2027: t27 },
      discretionary: disc,
      mandatory: mand,
      rowCount: Number(r.n) || 0,
    });
    totals.fy2025 += t25;
    totals.fy2026 += t26;
    totals.fy2027 += t27;
    discTotal += disc;
    mandTotal += mand;
    lineItemCount += Number(r.n) || 0;
  }

  // by-service (6 core exhibits, disc/mand-relevant) — de-duplicated.
  const core: ExhibitCode[] = ["m1", "o1", "p1", "p1r", "r1", "rf1"];
  const { sql: orgSql, params: orgParams } = canonicalFilter(core);
  const orgRows = await query<any>(
    `SELECT
       COALESCE((values->>'Organization'), '—') org,
       COALESCE(SUM(${totalExpr(2027)}),0) t
     FROM war_budget_line
     WHERE fiscal_year=2027 AND (${orgSql})
     GROUP BY org ORDER BY t DESC LIMIT 20`,
    orgParams
  );
  const orgGrand = orgRows.reduce((s, r) => s + Number(r.t), 0) * K || 1;
  const byOrganization = orgRows.map((r) => {
    const org = String(r.org || "—");
    return {
      org,
      label: ORG_LABELS[org] || org,
      total: Number(r.t) * K,
      pct: ((Number(r.t) * K) / orgGrand) * 100,
    };
  });

  // by budget activity (top 15), de-duplicated.
  const actRows = await query<any>(
    `SELECT
       COALESCE(NULLIF(values->>'Budget Activity Title', ''), 'Unspecified') activity,
       COALESCE(SUM(${totalExpr(2027)}),0) t
     FROM war_budget_line
     WHERE fiscal_year=2027 AND (${orgSql})
     GROUP BY activity ORDER BY t DESC LIMIT 15`,
    orgParams
  );
  const actGrand = actRows.reduce((s, r) => s + Number(r.t), 0) * K || 1;
  const byActivity = actRows.map((r) => ({
    activity: String(r.activity),
    total: Number(r.t) * K,
    pct: ((Number(r.t) * K) / actGrand) * 100,
  }));

  // documents (the 37 cataloged files).
  const docRows = await query<any>(
    `SELECT id, doc_code, title, format, byte_size, has_bytes, source_url
     FROM war_budget_document
     WHERE fiscal_year=2027
     ORDER BY has_bytes DESC, doc_code, format`
  );
  const documents: DocInfo[] = docRows.map((r) => ({
    id: Number(r.id),
    docCode: r.doc_code,
    name: r.title || (r.source_url ? r.source_url.split("/").pop() : "document"),
    format: r.format,
    byteSize: Number(r.byte_size) || 0,
    hasBytes: !!r.has_bytes,
    sourceUrl: r.source_url || "",
  }));

  return {
    fiscalYearFocus: 2027,
    totals,
    discretionaryTotal: discTotal,
    mandatoryTotal: mandTotal,
    lineItemCount,
    exhibits,
    byOrganization,
    byActivity,
    documents,
  };
}

// ---------------------------------------------------------------------------
// Detail: paginated, sortable, filterable rows for one exhibit (de-duplicated).
// ---------------------------------------------------------------------------
export interface DetailParams {
  exhibit: ExhibitCode;
  fy: number; // 2025 | 2026 | 2027
  org?: string;
  activity?: string;
  search?: string;
  sort: "fy2027" | "account" | "accountTitle" | "organization";
  order: "asc" | "desc";
  page: number;
  pageSize: number;
}

export interface DetailRow {
  account: string;
  accountTitle: string;
  organization: string;
  fy2025: number;
  fy2026: number;
  fy2027: number;
  discretionary: number;
  mandatory: number;
}

export interface DetailResult {
  rows: DetailRow[];
  total: number;
  page: number;
  pageSize: number;
  fiscalYear: number;
}

// Sort field -> a fixed SQL expression (never a raw column name from the client).
function sortExpr(field: DetailParams["sort"]): string {
  switch (field) {
    case "account":
      return "account";
    case "accountTitle":
      return "account_title";
    case "organization":
      return "COALESCE((values->>'Organization'),'')";
    case "fy2027":
    default:
      return totalExpr(2027);
  }
}

export async function getDetail(p: DetailParams): Promise<DetailResult> {
  const { sql, params } = canonicalFilter([p.exhibit]);
  const where = [`fiscal_year=2027`, `(${sql})`];
  const bound: unknown[] = [...params];

  if (p.org && p.org !== "all") {
    where.push(`(values->>'Organization') = $${bound.length + 1}`);
    bound.push(p.org);
  }
  if (p.activity && p.activity !== "all") {
    where.push(`COALESCE(NULLIF(values->>'Budget Activity Title',''),'Unspecified') ILIKE $${bound.length + 1}`);
    bound.push(`%${p.activity}%`);
  }
  if (p.search && p.search.trim()) {
    const like = `%${p.search.trim()}%`;
    where.push(`(account ILIKE $${bound.length + 1} OR account_title ILIKE $${bound.length + 2})`);
    bound.push(like, like);
  }

  const order = p.order === "asc" ? "ASC" : "DESC";
  const sortSql = sortExpr(p.sort);

  const page = Math.max(1, Math.floor(p.page) || 1);
  const pageSize = Math.min(200, Math.max(1, Math.floor(p.pageSize) || 50));
  const offset = (page - 1) * pageSize;

  const baseWhere = where.join(" AND ");

  const countRows = await query<any>(
    `SELECT count(*) c FROM war_budget_line WHERE ${baseWhere}`,
    bound
  );
  const total = Number(countRows[0]?.c) || 0;

  const rows = await query<any>(
    `SELECT
       COALESCE(account,'') account,
       COALESCE(account_title,'') account_title,
       COALESCE((values->>'Organization'),'—') organization,
       ${totalExpr(2025)} t25,
       ${totalExpr(2026)} t26,
       ${totalExpr(2027)} t27,
       ${discExpr()} disc,
       ${mandExpr()} mand
     FROM war_budget_line
     WHERE ${baseWhere}
     ORDER BY ${sortSql} ${order} NULLS LAST
     LIMIT $${bound.length + 1} OFFSET $${bound.length + 2}`,
    [...bound, pageSize, offset]
  );

  return {
    rows: rows.map((r) => ({
      account: r.account,
      accountTitle: r.account_title,
      organization: r.organization,
      fy2025: Number(r.t25) * K,
      fy2026: Number(r.t26) * K,
      fy2027: Number(r.t27) * K,
      discretionary: Number(r.disc) * K,
      mandatory: Number(r.mand) * K,
    })),
    total,
    page,
    pageSize,
    fiscalYear: 2027,
  };
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

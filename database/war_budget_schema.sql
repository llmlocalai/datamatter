-- ============================================================================
-- Datamatter — FY2027 "-1" DoD Budget Display tables (Neon / Postgres)
-- Source: https://comptroller.war.gov/budgetmaterials/budget2027.aspx
--
-- Loaded by scripts/ingest_war_budget.js, which:
--   1. downloads the 7 XLSX display tables + 7 presentation PDFs for FY2027
--   2. catalogs every document            -> war_budget_document
--   3. stores the raw file bytes          -> war_budget_file  (bytea)
--   4. parses the 7 XLSX tables into rows -> war_budget_line
--
-- Idempotent: safe to re-run (CREATE TABLE IF NOT EXISTS). The loader itself
-- TRUNCATEs the data tables before re-inserting, so a re-run refreshes cleanly.
--
-- Dollar amounts in the source XLSX are in THOUSANDS ($K) and are stored raw,
-- consistent with the existing budget_* tables (which also keep USASpending $K).
-- ============================================================================

-- ---- Catalog of every FY2027 "-1" document (XLSX display + PDF + others) ----
CREATE TABLE IF NOT EXISTS war_budget_document (
    id            SERIAL PRIMARY KEY,
    fiscal_year   INTEGER  NOT NULL,
    doc_code      TEXT     NOT NULL,           -- c1 | m1 | o1 | p1 | p1r | r1 | rf1 | ...
    doc_type      TEXT     NOT NULL,           -- display_xlsx | presentation_pdf | other
    format        TEXT     NOT NULL,           -- xlsx | pdf | zip | ...
    title         TEXT,
    source_url    TEXT     NOT NULL,
    byte_size     BIGINT,
    has_bytes     BOOLEAN  NOT NULL DEFAULT FALSE,   -- true if stored in war_budget_file
    ingested_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wbd_fy ON war_budget_document(fiscal_year);

-- ---- Raw file bytes (only for files we actually downloaded & stored) ---------
CREATE TABLE IF NOT EXISTS war_budget_file (
    id            SERIAL PRIMARY KEY,
    fiscal_year   INTEGER  NOT NULL,
    doc_code      TEXT     NOT NULL,
    format        TEXT     NOT NULL,
    filename      TEXT     NOT NULL,
    byte_size     BIGINT   NOT NULL,
    data          BYTEA    NOT NULL,           -- the raw file
    ingested_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wbf_doc ON war_budget_file(fiscal_year, doc_code);

-- ---- Parsed rows from the 7 XLSX display tables ----------------------------
-- The XLSX layout differs per file (C-1 has State/Country/Construction cols;
-- P-1 has BSA/PE/BLI), so the full row is kept in a flexible JSONB `values`
-- column keyed by that sheet's header names, with the common identifying
-- fields promoted to real columns for querying.
CREATE TABLE IF NOT EXISTS war_budget_line (
    id            SERIAL PRIMARY KEY,
    fiscal_year   INTEGER  NOT NULL,
    doc_code      TEXT     NOT NULL,           -- c1 | m1 | o1 | p1 | p1r | r1 | rf1
    sheet_name    TEXT     NOT NULL,           -- e.g. 'FY 2027 Total'
    account       TEXT,                         -- col 0 (Account)
    account_title TEXT,                         -- col 1 (Account Title)
    organization  TEXT,                         -- org / component code (A / N / ...)
    values        JSONB    NOT NULL DEFAULT '{}'::jsonb,   -- every header -> value
    ingested_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wbl_fy     ON war_budget_line(fiscal_year);
CREATE INDEX IF NOT EXISTS idx_wbl_doc    ON war_budget_line(doc_code);
CREATE INDEX IF NOT EXISTS idx_wbl_fy_doc ON war_budget_line(fiscal_year, doc_code);

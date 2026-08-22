-- ============================================================================
-- Datamatter (OUSD(C) AI Solutions) — Neon Postgres schema
-- Source of truth for all 7 use cases. Idempotent: safe to re-run.
-- Data is loaded from the knowledge bank + USASpending warehouse by
-- scripts/load_neon.js.  (SQLite schema.sql is the legacy local dev version.)
-- ============================================================================

-- ---- Budget (OMB functional classification, from USASpending file_a) --------
CREATE TABLE IF NOT EXISTS budget_function (
    id            SERIAL PRIMARY KEY,
    fiscal_year   INTEGER NOT NULL,
    function_name TEXT NOT NULL,
    obligations   NUMERIC(18,2) NOT NULL DEFAULT 0,
    outlays       NUMERIC(18,2) NOT NULL DEFAULT 0,
    pct_of_total  NUMERIC(6,2) NOT NULL DEFAULT 0,
    source        TEXT
);
CREATE INDEX IF NOT EXISTS idx_bfunc_fy ON budget_function(fiscal_year);

CREATE TABLE IF NOT EXISTS budget_agency (
    id            SERIAL PRIMARY KEY,
    fiscal_year   INTEGER NOT NULL,
    agency_name   TEXT NOT NULL,
    obligations   NUMERIC(18,2) NOT NULL DEFAULT 0,
    pct_of_total  NUMERIC(6,2) NOT NULL DEFAULT 0,
    source        TEXT
);
CREATE INDEX IF NOT EXISTS idx_bagency_fy ON budget_agency(fiscal_year);

CREATE TABLE IF NOT EXISTS budget_fy_trend (
    id                       SERIAL PRIMARY KEY,
    fiscal_year              INTEGER NOT NULL UNIQUE,
    total_budgetary_resources NUMERIC(18,2) NOT NULL DEFAULT 0,
    obligations_incurred     NUMERIC(18,2) NOT NULL DEFAULT 0,
    gross_outlays            NUMERIC(18,2) NOT NULL DEFAULT 0,
    source                   TEXT
);

-- ---- Contracting (USASpending contract warehouse, agency 097) ---------------
CREATE TABLE IF NOT EXISTS contract_component (
    id                 SERIAL PRIMARY KEY,
    fiscal_year        INTEGER NOT NULL,
    component          TEXT NOT NULL,          -- awarding sub-agency
    obligations        NUMERIC(18,2) NOT NULL DEFAULT 0,
    pct_of_total       NUMERIC(6,2) NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_ccomp_fy ON contract_component(fiscal_year);

CREATE TABLE IF NOT EXISTS contract_prime (
    id                 SERIAL PRIMARY KEY,
    fiscal_year        INTEGER NOT NULL,
    prime_name         TEXT NOT NULL,
    obligations        NUMERIC(18,2) NOT NULL DEFAULT 0,
    pct_of_total       NUMERIC(6,2) NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_cprime_fy ON contract_prime(fiscal_year);

CREATE TABLE IF NOT EXISTS contract_metrics (
    id                 SERIAL PRIMARY KEY,
    fiscal_year        INTEGER NOT NULL,
    total_obligations  NUMERIC(18,2) NOT NULL DEFAULT 0,
    award_count        BIGINT NOT NULL DEFAULT 0,
    sole_source_pct    NUMERIC(6,2) NOT NULL DEFAULT 0,
    no_set_aside_pct   NUMERIC(6,2) NOT NULL DEFAULT 0,
    source             TEXT
);
CREATE INDEX IF NOT EXISTS idx_cmet_fy ON contract_metrics(fiscal_year);

CREATE TABLE IF NOT EXISTS contract_set_aside (
    id          SERIAL PRIMARY KEY,
    fiscal_year INTEGER NOT NULL,
    set_aside   TEXT NOT NULL,
    obligations NUMERIC(18,2) NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS contract_competition (
    id          SERIAL PRIMARY KEY,
    fiscal_year INTEGER NOT NULL,
    reason      TEXT NOT NULL,
    obligations NUMERIC(18,2) NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS contract_naics (
    id          SERIAL PRIMARY KEY,
    fiscal_year INTEGER NOT NULL,
    naics_code  TEXT NOT NULL,
    description TEXT,
    obligations NUMERIC(18,2) NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS contract_state (
    id          SERIAL PRIMARY KEY,
    fiscal_year INTEGER NOT NULL,
    state_code  TEXT NOT NULL,
    obligations NUMERIC(18,2) NOT NULL DEFAULT 0
);

-- ---- Funds Control / Budget Execution (USASpending file_a, TAS level) ------
CREATE TABLE IF NOT EXISTS funds_control (
    id                        SERIAL PRIMARY KEY,
    fiscal_year               INTEGER NOT NULL UNIQUE,
    total_budgetary_resources NUMERIC(18,2) NOT NULL DEFAULT 0,
    obligations_incurred      NUMERIC(18,2) NOT NULL DEFAULT 0,
    gross_outlays             NUMERIC(18,2) NOT NULL DEFAULT 0,
    unobligated_balance       NUMERIC(18,2) NOT NULL DEFAULT 0,
    obligation_rate_pct       NUMERIC(6,2) NOT NULL DEFAULT 0,
    outlay_rate_pct           NUMERIC(6,2) NOT NULL DEFAULT 0,
    unobligated_pct           NUMERIC(6,2) NOT NULL DEFAULT 0,
    lapse_risk                BOOLEAN NOT NULL DEFAULT FALSE,
    source                    TEXT
);

CREATE TABLE IF NOT EXISTS funds_control_tas (
    id           SERIAL PRIMARY KEY,
    fiscal_year  INTEGER NOT NULL,
    agency       TEXT NOT NULL,
    tas_name     TEXT NOT NULL,
    obligations  NUMERIC(18,2) NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_fctas_fy ON funds_control_tas(fiscal_year);

-- ---- PPBE (J-books, 11-Budget-Justification) ------------------------------
CREATE TABLE IF NOT EXISTS ppbe_activity (
    id          SERIAL PRIMARY KEY,
    activity    TEXT NOT NULL,
    exhibits    INTEGER NOT NULL DEFAULT 0,
    quality     TEXT,                     -- high | medium | low
    source      TEXT
);

CREATE TABLE IF NOT EXISTS ppbe_summary (
    id                    SERIAL PRIMARY KEY,
    total_programs        INTEGER NOT NULL DEFAULT 0,
    compliant_programs    INTEGER NOT NULL DEFAULT 0,
    non_compliant_programs INTEGER NOT NULL DEFAULT 0,
    compliance_rate       NUMERIC(6,2) NOT NULL DEFAULT 0,
    omb30_submitted       INTEGER NOT NULL DEFAULT 0,
    omb30_approved        INTEGER NOT NULL DEFAULT 0,
    omb30_pending         INTEGER NOT NULL DEFAULT 0,
    omb30_rejected        INTEGER NOT NULL DEFAULT 0,
    quality_high          INTEGER NOT NULL DEFAULT 0,
    quality_medium        INTEGER NOT NULL DEFAULT 0,
    quality_low           INTEGER NOT NULL DEFAULT 0,
    source                TEXT
);

-- ---- GAO (12-Oversight/GAO-Reports + DoD AFR) -----------------------------
CREATE TABLE IF NOT EXISTS gao_finding_year (
    id                 SERIAL PRIMARY KEY,
    year               INTEGER NOT NULL,
    findings           INTEGER NOT NULL DEFAULT 0,
    material_weaknesses INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS gao_finding_type (
    id     SERIAL PRIMARY KEY,
    type   TEXT NOT NULL,
    count  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS gao_report (
    id          SERIAL PRIMARY KEY,
    title       TEXT NOT NULL,
    is_dod      BOOLEAN NOT NULL DEFAULT FALSE,
    topic       TEXT,
    pub_date    DATE
);
CREATE INDEX IF NOT EXISTS idx_gao_dod ON gao_report(is_dod);

CREATE TABLE IF NOT EXISTS gao_summary (
    id                       SERIAL PRIMARY KEY,
    total_gao_reports        INTEGER NOT NULL DEFAULT 0,
    dod_relevant_reports     INTEGER NOT NULL DEFAULT 0,
    afr_disclaimer_of_opinion BOOLEAN NOT NULL DEFAULT FALSE,
    source                   TEXT
);

-- ---- Congressional (10-Congressional-Direction) ----------------------------
CREATE TABLE IF NOT EXISTS congressional_committee (
    id          SERIAL PRIMARY KEY,
    committee   TEXT NOT NULL,
    documents   INTEGER NOT NULL DEFAULT 0,
    kind        TEXT
);

CREATE TABLE IF NOT EXISTS congressional_hearing (
    id          SERIAL PRIMARY KEY,
    hearing_id  TEXT NOT NULL,
    session     INTEGER NOT NULL,
    chamber     TEXT NOT NULL,
    title       TEXT NOT NULL,
    hearing_date DATE
);
CREATE INDEX IF NOT EXISTS idx_hear_chamber ON congressional_hearing(chamber);
CREATE INDEX IF NOT EXISTS idx_hear_date ON congressional_hearing(hearing_date);

CREATE TABLE IF NOT EXISTS congressional_summary (
    id              SERIAL PRIMARY KEY,
    total_hearings  INTEGER NOT NULL DEFAULT 0,
    total_documents INTEGER NOT NULL DEFAULT 0,
    house           INTEGER NOT NULL DEFAULT 0,
    senate          INTEGER NOT NULL DEFAULT 0,
    joint           INTEGER NOT NULL DEFAULT 0,
    source          TEXT
);

-- ---- Regulation / Knowledge (RAG corpus: Wiki/DOD-FM) ----------------------
CREATE TABLE IF NOT EXISTS knowledge_page (
    id          SERIAL PRIMARY KEY,
    slug        TEXT NOT NULL,
    title       TEXT NOT NULL,
    source      TEXT,
    authority   NUMERIC(3,2) NOT NULL DEFAULT 1.0,
    body        TEXT,
    tsvector    TSVECTOR,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_kpg_title ON knowledge_page(title);
CREATE INDEX IF NOT EXISTS idx_kpg_fts ON knowledge_page USING gin(tsvector);

-- ---- ETL observability ---------------------------------------------------
CREATE TABLE IF NOT EXISTS refresh_log (
    id          SERIAL PRIMARY KEY,
    pipeline    TEXT NOT NULL,
    rows_loaded INTEGER NOT NULL DEFAULT 0,
    status      TEXT NOT NULL DEFAULT 'ok',
    ran_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- datamatter analytics schema  (Neon Postgres)
-- ----------------------------------------------------------------------------
-- Provenance-first. Nothing lands in a measure table without a dm_load row,
-- and no dm_load is complete until its control tests have recorded a result.
-- Every measure table therefore carries load_id; every page renders vintage.
--
-- Money is stored in DOLLARS (numeric(20,2)), never thousands. The FY2027
-- exhibit tables (war_budget_*) remain in $K and are converted in lib/fy27-data.ts.
-- ============================================================================

-- ---------------------------------------------------------------- registry --
CREATE TABLE IF NOT EXISTS dm_dataset (
  key             text PRIMARY KEY,
  label           text NOT NULL,
  source_system   text NOT NULL,
  source_path     text NOT NULL,
  grain           text NOT NULL,
  description     text NOT NULL,
  refresh_cadence text NOT NULL DEFAULT 'daily',
  limitations     text NOT NULL,
  sort_order      int  NOT NULL DEFAULT 100
);

-- One row per (dataset, extraction). This is the vintage every page cites.
CREATE TABLE IF NOT EXISTS dm_load (
  id            bigserial PRIMARY KEY,
  dataset_key   text NOT NULL REFERENCES dm_dataset(key) ON DELETE CASCADE,
  vintage       date NOT NULL,
  extracted_at  timestamptz NOT NULL,
  loaded_at     timestamptz NOT NULL DEFAULT now(),
  row_count     bigint NOT NULL DEFAULT 0,
  etl_script    text NOT NULL,
  etl_version   text NOT NULL,
  is_current    boolean NOT NULL DEFAULT true,
  notes         text,
  UNIQUE (dataset_key, vintage, extracted_at)
);
CREATE INDEX IF NOT EXISTS dm_load_current_idx ON dm_load (dataset_key, is_current) WHERE is_current;

-- ------------------------------------------------------- control framework --
-- Validation rules expressed as internal control over reporting, not unit tests.
CREATE TABLE IF NOT EXISTS dm_control (
  code        text PRIMARY KEY,
  name        text NOT NULL,
  assertion   text NOT NULL,     -- what must be true
  rationale   text NOT NULL,     -- why a comptroller cares
  authority   text,              -- FMR / OMB / USSGL citation where one applies
  severity    text NOT NULL CHECK (severity IN ('critical','high','moderate')),
  sort_order  int NOT NULL DEFAULT 100
);

CREATE TABLE IF NOT EXISTS dm_control_result (
  id           bigserial PRIMARY KEY,
  control_code text NOT NULL REFERENCES dm_control(code) ON DELETE CASCADE,
  load_id      bigint REFERENCES dm_load(id) ON DELETE CASCADE,
  fiscal_year  int,
  status       text NOT NULL CHECK (status IN ('pass','fail','warn','not_applicable')),
  observed     numeric(24,4),
  expected     numeric(24,4),
  tolerance    numeric(24,4),
  variance_pct numeric(12,6),
  message      text NOT NULL,
  run_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dm_control_result_idx ON dm_control_result (control_code, fiscal_year, run_at DESC);

-- ------------------------------------------------------------- definitions --
-- Sourced from the curated DoD-FM wiki; every term carries its authority.
CREATE TABLE IF NOT EXISTS dm_definition (
  slug          text PRIMARY KEY,
  term          text NOT NULL,
  definition    text NOT NULL,
  why_it_matters text,
  key_rules     text,
  authorities   text[] NOT NULL DEFAULT '{}',
  related       text[] NOT NULL DEFAULT '{}',
  source_file   text NOT NULL,
  last_verified date,
  topic         text,
  load_id       bigint REFERENCES dm_load(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS dm_definition_term_idx ON dm_definition USING gin (to_tsvector('english', term || ' ' || definition));

-- --------------------------------------------------- execution chain (SBR) --
-- File A, Statement of Budgetary Resources, TAS grain, rolled to FY x scope.
-- scope: 'DOW' = agency codes 097/021/017/057; 'ALL' = every code in the file;
-- or a single agency code. The distinction is the point: the previous build
-- summed all five codes (including 011, Executive Office of the President)
-- and labelled the result "agency 097 = DoD".
CREATE TABLE IF NOT EXISTS dm_sbr_fy (
  id                        bigserial PRIMARY KEY,
  load_id                   bigint NOT NULL REFERENCES dm_load(id) ON DELETE CASCADE,
  fiscal_year               int  NOT NULL,
  scope                     text NOT NULL,
  scope_label               text NOT NULL,
  submission_period         text,
  is_partial_year           boolean NOT NULL DEFAULT false,
  tas_count                 int NOT NULL DEFAULT 0,
  ba_appropriated           numeric(20,2) NOT NULL DEFAULT 0,
  unobligated_bf            numeric(20,2) NOT NULL DEFAULT 0,
  adjustments_to_unob_bf    numeric(20,2) NOT NULL DEFAULT 0,
  borrowing_authority       numeric(20,2) NOT NULL DEFAULT 0,
  contract_authority        numeric(20,2) NOT NULL DEFAULT 0,
  spending_auth_offsetting  numeric(20,2) NOT NULL DEFAULT 0,
  other_budgetary_resources numeric(20,2) NOT NULL DEFAULT 0,
  total_budgetary_resources numeric(20,2) NOT NULL DEFAULT 0,
  obligations_incurred      numeric(20,2) NOT NULL DEFAULT 0,
  deobligations             numeric(20,2) NOT NULL DEFAULT 0,
  unobligated_balance       numeric(20,2) NOT NULL DEFAULT 0,
  gross_outlays             numeric(20,2) NOT NULL DEFAULT 0,
  UNIQUE (load_id, fiscal_year, scope)
);

-- Component / budget-function / account cuts of the same File A extract.
CREATE TABLE IF NOT EXISTS dm_sbr_dim (
  id           bigserial PRIMARY KEY,
  load_id      bigint NOT NULL REFERENCES dm_load(id) ON DELETE CASCADE,
  fiscal_year  int  NOT NULL,
  scope        text NOT NULL,
  dimension    text NOT NULL,   -- agency | budget_function | federal_account | tas
  dim_key      text NOT NULL,
  dim_label    text NOT NULL,
  total_budgetary_resources numeric(20,2) NOT NULL DEFAULT 0,
  obligations_incurred      numeric(20,2) NOT NULL DEFAULT 0,
  unobligated_balance       numeric(20,2) NOT NULL DEFAULT 0,
  gross_outlays             numeric(20,2) NOT NULL DEFAULT 0,
  rank_in_dim  int
);
CREATE INDEX IF NOT EXISTS dm_sbr_dim_idx ON dm_sbr_dim (load_id, fiscal_year, scope, dimension, rank_in_dim);

-- ------------------------------------------- obligation composition (File B) --
-- USSGL undelivered vs delivered orders, and object class. This is where the
-- obligation-to-outlay pipeline becomes visible.
CREATE TABLE IF NOT EXISTS dm_obligation_stage (
  id                 bigserial PRIMARY KEY,
  load_id            bigint NOT NULL REFERENCES dm_load(id) ON DELETE CASCADE,
  fiscal_year        int NOT NULL,
  scope              text NOT NULL,
  obligations_incurred        numeric(20,2) NOT NULL DEFAULT 0,
  undelivered_orders_unpaid   numeric(20,2) NOT NULL DEFAULT 0,
  delivered_orders_unpaid     numeric(20,2) NOT NULL DEFAULT 0,
  gross_outlays               numeric(20,2) NOT NULL DEFAULT 0,
  deobligations               numeric(20,2) NOT NULL DEFAULT 0,
  UNIQUE (load_id, fiscal_year, scope)
);

CREATE TABLE IF NOT EXISTS dm_object_class (
  id                bigserial PRIMARY KEY,
  load_id           bigint NOT NULL REFERENCES dm_load(id) ON DELETE CASCADE,
  fiscal_year       int NOT NULL,
  scope             text NOT NULL,
  object_class_code text NOT NULL,
  object_class_name text NOT NULL,
  major_class       text NOT NULL,   -- Personnel | Contractual services | Equipment | Grants/benefits | Other
  obligations       numeric(20,2) NOT NULL DEFAULT 0,
  rank_in_fy        int
);
CREATE INDEX IF NOT EXISTS dm_object_class_idx ON dm_object_class (load_id, fiscal_year, scope, rank_in_fy);

-- ------------------------------------------------------- contract awards ----
CREATE TABLE IF NOT EXISTS dm_award_fy (
  id            bigserial PRIMARY KEY,
  load_id       bigint NOT NULL REFERENCES dm_load(id) ON DELETE CASCADE,
  vintage       date NOT NULL,
  fiscal_year   int NOT NULL,
  obligation    numeric(20,2) NOT NULL DEFAULT 0,
  action_count  bigint NOT NULL DEFAULT 0,
  is_partial_year boolean NOT NULL DEFAULT false,
  UNIQUE (load_id, vintage, fiscal_year)
);

CREATE TABLE IF NOT EXISTS dm_award_dim (
  id           bigserial PRIMARY KEY,
  load_id      bigint NOT NULL REFERENCES dm_load(id) ON DELETE CASCADE,
  fiscal_year  int NOT NULL,
  dimension    text NOT NULL,  -- set_aside | extent_competed | pricing | naics | psc | recipient | sub_agency | state
  dim_key      text NOT NULL,
  dim_label    text NOT NULL,
  obligation   numeric(20,2) NOT NULL DEFAULT 0,
  action_count bigint NOT NULL DEFAULT 0,
  rank_in_dim  int
);
CREATE INDEX IF NOT EXISTS dm_award_dim_idx ON dm_award_dim (load_id, fiscal_year, dimension, rank_in_dim);

-- Vintage drift: the evidence that closed fiscal years still move.
CREATE TABLE IF NOT EXISTS dm_vintage_drift (
  id             bigserial PRIMARY KEY,
  load_id        bigint NOT NULL REFERENCES dm_load(id) ON DELETE CASCADE,
  fiscal_year    int NOT NULL,
  vintage_from   date NOT NULL,
  vintage_to     date NOT NULL,
  obligation_from numeric(20,2) NOT NULL,
  obligation_to   numeric(20,2) NOT NULL,
  obligation_delta numeric(20,2) NOT NULL,
  actions_from    bigint NOT NULL,
  actions_to      bigint NOT NULL,
  action_delta    bigint NOT NULL,
  year_closed     boolean NOT NULL,
  UNIQUE (load_id, fiscal_year, vintage_from, vintage_to)
);

-- --------------------------------------------------------- reconciliation ---
-- Award files (FPDS federal_action_obligation) vs File C (account-linked
-- transaction_obligated_amount). Two reporting chains, not two measurements of
-- one thing: the ratio is a LINKAGE indicator, never an error estimate.
CREATE TABLE IF NOT EXISTS dm_reconciliation (
  id                  bigserial PRIMARY KEY,
  load_id             bigint NOT NULL REFERENCES dm_load(id) ON DELETE CASCADE,
  fiscal_year         int NOT NULL,
  award_obligation    numeric(20,2) NOT NULL,
  award_actions       bigint NOT NULL,
  filec_obligation    numeric(20,2) NOT NULL,
  filec_rows          bigint NOT NULL,
  filec_awards        bigint NOT NULL DEFAULT 0,
  linkage_pct         numeric(9,4) NOT NULL,
  unlinked_obligation numeric(20,2) NOT NULL,
  is_partial_year     boolean NOT NULL DEFAULT false,
  UNIQUE (load_id, fiscal_year)
);

-- --------------------------------------------------- oversight & knowledge --
CREATE TABLE IF NOT EXISTS dm_audit_posture (
  id            bigserial PRIMARY KEY,
  load_id       bigint NOT NULL REFERENCES dm_load(id) ON DELETE CASCADE,
  fiscal_year   int NOT NULL,
  metric_key    text NOT NULL,
  metric_label  text NOT NULL,
  metric_value  numeric(20,2),
  value_kind    text NOT NULL DEFAULT 'count',  -- count | dollars | percent | text
  value_text    text,
  citation      text NOT NULL,
  note          text,
  sort_order    int NOT NULL DEFAULT 100,
  UNIQUE (load_id, fiscal_year, metric_key)
);

CREATE TABLE IF NOT EXISTS dm_kb_inventory (
  id           bigserial PRIMARY KEY,
  load_id      bigint NOT NULL REFERENCES dm_load(id) ON DELETE CASCADE,
  collection   text NOT NULL,     -- oversight | congressional | justification | regulation
  folder       text NOT NULL,
  label        text NOT NULL,
  doc_count    int NOT NULL DEFAULT 0,
  authority_tier int,
  note         text,
  sort_order   int NOT NULL DEFAULT 100
);
CREATE INDEX IF NOT EXISTS dm_kb_inventory_idx ON dm_kb_inventory (load_id, collection, sort_order);

CREATE TABLE IF NOT EXISTS dm_justification_exhibit (
  id           bigserial PRIMARY KEY,
  load_id      bigint NOT NULL REFERENCES dm_load(id) ON DELETE CASCADE,
  fiscal_year  int NOT NULL,
  activity     text NOT NULL,
  exhibit_count int NOT NULL DEFAULT 0,
  UNIQUE (load_id, fiscal_year, activity)
);

CREATE TABLE IF NOT EXISTS dm_hearing (
  id            bigserial PRIMARY KEY,
  load_id       bigint NOT NULL REFERENCES dm_load(id) ON DELETE CASCADE,
  hearing_id    text NOT NULL,
  congress      int  NOT NULL,
  chamber       text NOT NULL,
  title         text NOT NULL,
  ingest_date   date,
  defense_related boolean NOT NULL DEFAULT false,
  UNIQUE (load_id, hearing_id)
);
CREATE INDEX IF NOT EXISTS dm_hearing_idx ON dm_hearing (load_id, defense_related, congress DESC);

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

-- --------------------------------------------------------- assistance -------
-- DoD financial-assistance transactions (cooperative agreements, project
-- grants, direct payments). Separate warehouse tree from contracts; not
-- account-linked, not reconciled against anything. See dm_dataset for scope.
CREATE TABLE IF NOT EXISTS dm_assistance_fy (
  id            bigserial PRIMARY KEY,
  load_id       bigint NOT NULL REFERENCES dm_load(id) ON DELETE CASCADE,
  vintage       date NOT NULL,
  fiscal_year   int NOT NULL,
  obligation    numeric(20,2) NOT NULL DEFAULT 0,
  action_count  bigint NOT NULL DEFAULT 0,
  is_partial_year boolean NOT NULL DEFAULT false,
  UNIQUE (load_id, vintage, fiscal_year)
);

CREATE TABLE IF NOT EXISTS dm_assistance_dim (
  id           bigserial PRIMARY KEY,
  load_id      bigint NOT NULL REFERENCES dm_load(id) ON DELETE CASCADE,
  fiscal_year  int NOT NULL,
  dimension    text NOT NULL,  -- assistance_type | sub_agency | recipient | cfda | state
  dim_key      text NOT NULL,
  dim_label    text NOT NULL,
  obligation   numeric(20,2) NOT NULL DEFAULT 0,
  action_count bigint NOT NULL DEFAULT 0,
  rank_in_dim  int
);
CREATE INDEX IF NOT EXISTS dm_assistance_dim_idx ON dm_assistance_dim (load_id, fiscal_year, dimension, rank_in_dim);

CREATE TABLE IF NOT EXISTS dm_assistance_vintage_drift (
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
-- ------------------------------------------------------------------ program --
-- The only cut on this site keyed to a BUDGET LINE rather than to an account.
-- dm_program_fy carries traceable_obligation alongside obligation because a
-- program obligation total without its account-traceable share reads as
-- reconciled when it is not; PROG-03 asserts the two travel together.
CREATE TABLE IF NOT EXISTS dm_program_dim (
  id                 bigserial PRIMARY KEY,
  load_id            bigint NOT NULL REFERENCES dm_load(id) ON DELETE CASCADE,
  program_code       text NOT NULL,
  program_name       text NOT NULL,
  total_obligation   numeric(20,2) NOT NULL DEFAULT 0,
  first_fiscal_year  int NOT NULL,
  last_fiscal_year   int NOT NULL,
  is_featured        boolean NOT NULL DEFAULT false,
  rank_by_obligation int,
  UNIQUE (load_id, program_code)
);

-- Program-dimension coverage of the contract file as a whole. FPDS records
-- "no acquisition program" as code 000 / description NONE, not as a null, so
-- this is the honest denominator: how much of the file is program-attributable
-- at all. Roughly three quarters of DoD contract dollars are not.
CREATE TABLE IF NOT EXISTS dm_program_coverage (
  id                      bigserial PRIMARY KEY,
  load_id                 bigint NOT NULL REFERENCES dm_load(id) ON DELETE CASCADE,
  vintage                 date NOT NULL,
  fiscal_year             int NOT NULL,
  total_obligation        numeric(20,2) NOT NULL DEFAULT 0,
  total_actions           bigint NOT NULL DEFAULT 0,
  attributed_obligation   numeric(20,2) NOT NULL DEFAULT 0,
  attributed_actions      bigint NOT NULL DEFAULT 0,
  unattributed_obligation numeric(20,2) NOT NULL DEFAULT 0,
  unattributed_actions    bigint NOT NULL DEFAULT 0,
  attributed_pct          numeric(9,4) NOT NULL DEFAULT 0,
  program_count           int NOT NULL DEFAULT 0,
  is_partial_year         boolean NOT NULL DEFAULT false,
  UNIQUE (load_id, fiscal_year)
);

CREATE TABLE IF NOT EXISTS dm_program_fy (
  id                      bigserial PRIMARY KEY,
  load_id                 bigint NOT NULL REFERENCES dm_load(id) ON DELETE CASCADE,
  vintage                 date NOT NULL,
  program_code            text NOT NULL,
  fiscal_year             int NOT NULL,
  obligation              numeric(20,2) NOT NULL DEFAULT 0,
  traceable_obligation    numeric(20,2) NOT NULL DEFAULT 0,
  untraceable_obligation  numeric(20,2) NOT NULL DEFAULT 0,
  traceable_pct           numeric(9,4) NOT NULL DEFAULT 0,
  action_count            bigint NOT NULL DEFAULT 0,
  award_count             bigint NOT NULL DEFAULT 0,
  top5_obligation         numeric(20,2) NOT NULL DEFAULT 0,
  top5_pct                numeric(9,4) NOT NULL DEFAULT 0,
  late_quarter_obligation numeric(20,2) NOT NULL DEFAULT 0,
  late_quarter_pct        numeric(9,4) NOT NULL DEFAULT 0,
  is_partial_year         boolean NOT NULL DEFAULT false,
  UNIQUE (load_id, program_code, fiscal_year)
);
CREATE INDEX IF NOT EXISTS dm_program_fy_idx ON dm_program_fy (load_id, program_code, fiscal_year);

CREATE TABLE IF NOT EXISTS dm_program_dim_fy (
  id           bigserial PRIMARY KEY,
  load_id      bigint NOT NULL REFERENCES dm_load(id) ON DELETE CASCADE,
  program_code text NOT NULL,
  fiscal_year  int NOT NULL,
  dimension    text NOT NULL,  -- recipient | extent_competed | pricing | psc | awarding_office | sub_agency
  dim_key      text NOT NULL,
  dim_label    text NOT NULL,
  obligation   numeric(20,2) NOT NULL DEFAULT 0,
  action_count bigint NOT NULL DEFAULT 0,
  rank_in_dim  int
);
CREATE INDEX IF NOT EXISTS dm_program_dim_fy_idx
  ON dm_program_dim_fy (load_id, program_code, fiscal_year, dimension, rank_in_dim);

-- Contract-level concentration. Aggregated by PIID rather than by modification,
-- because the concentration this page reports lives at the contract level.
CREATE TABLE IF NOT EXISTS dm_program_award (
  id                 bigserial PRIMARY KEY,
  load_id            bigint NOT NULL REFERENCES dm_load(id) ON DELETE CASCADE,
  program_code       text NOT NULL,
  fiscal_year        int NOT NULL,
  award_id_piid      text NOT NULL,
  recipient_name     text NOT NULL,
  obligation         numeric(20,2) NOT NULL DEFAULT 0,
  action_count       bigint NOT NULL DEFAULT 0,
  share_of_fy_pct    numeric(9,4) NOT NULL DEFAULT 0,
  has_account_link   boolean NOT NULL DEFAULT false,
  largest_action_date date,
  description        text,
  rank_in_fy         int
);
CREATE INDEX IF NOT EXISTS dm_program_award_idx
  ON dm_program_award (load_id, program_code, fiscal_year, rank_in_fy);

-- The exact set of accounts NAMED on an action. The obligation is not split
-- across them and must never be summed by account -- PROG-02 asserts that.
CREATE TABLE IF NOT EXISTS dm_program_account (
  id                   bigserial PRIMARY KEY,
  load_id              bigint NOT NULL REFERENCES dm_load(id) ON DELETE CASCADE,
  program_code         text NOT NULL,
  fiscal_year          int NOT NULL,
  account_set          text NOT NULL,   -- ';'-separated federal account symbols
  account_count        int NOT NULL DEFAULT 0,
  obligation           numeric(20,2) NOT NULL DEFAULT 0,
  action_count         bigint NOT NULL DEFAULT 0,
  out_of_scope_accounts text[],         -- e.g. 011-8242, FMS trust -- disclosed, not dropped
  has_out_of_scope     boolean NOT NULL DEFAULT false,
  rank_in_fy           int
);
CREATE INDEX IF NOT EXISTS dm_program_account_idx
  ON dm_program_account (load_id, program_code, fiscal_year, rank_in_fy);

CREATE TABLE IF NOT EXISTS dm_program_filec (
  id                bigserial PRIMARY KEY,
  load_id           bigint NOT NULL REFERENCES dm_load(id) ON DELETE CASCADE,
  program_code      text NOT NULL,
  fiscal_year       int NOT NULL,
  filec_obligation  numeric(20,2) NOT NULL DEFAULT 0,
  filec_rows        bigint NOT NULL DEFAULT 0,
  filec_awards      bigint NOT NULL DEFAULT 0,
  award_obligation  numeric(20,2) NOT NULL DEFAULT 0,
  linkage_pct       numeric(12,4) NOT NULL DEFAULT 0,
  submission_period text,
  is_partial_year   boolean NOT NULL DEFAULT false,
  UNIQUE (load_id, program_code, fiscal_year)
);

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
  -- File C is a monthly CUMULATIVE snapshot. These three columns record which
  -- single snapshot the row was built from, how many we hold, and the row count
  -- of each — so a truncated period download is visible rather than summed in.
  submission_period   text,
  periods_available   int,
  period_row_counts   text,
  is_partial_year     boolean NOT NULL DEFAULT false,
  UNIQUE (load_id, fiscal_year)
);

-- ------------------------------------------------ budget exhibits (the -1s) --
-- The President's Budget P-1, P-1R and R-1 exhibits are the only source here
-- that is keyed on a BUDGET LINE rather than on a Treasury account, which makes
-- them the spine every other table hangs from: a line item is what Congress
-- appropriates against, what a program office executes, and what a contract is
-- eventually written for.
--
-- THE GRAIN IS (pb_year, fiscal_year) AND IT IS NEVER COLLAPSED. Each PB book
-- restates three fiscal years in three different roles -- FY(pb-2) actuals,
-- FY(pb-1) enacted, FY(pb) request -- so one fiscal year appears in three
-- successive books with three different numbers. Averaging or de-duplicating
-- those would destroy the restatement history, which is the single most useful
-- thing these exhibits carry: it is where a request becoming an enactment
-- becoming an actual can actually be watched. EXH-01 asserts the diagonal
-- survives the load; EXH-02 asserts the roles are assigned from the book year
-- and not guessed.
--
-- MEMO ROWS ARE KEPT AND FLAGGED, NEVER SUMMED. The whole P-1R exhibit is
-- National Guard and Reserve equipment already counted inside the P-1 lines,
-- and R-1 rows marked Include-in-TOA = N are outside total obligation
-- authority. Both are retained so their absence from a total is explainable,
-- and every query filters is_memo = false by default. EXH-03 asserts no
-- unflagged row carries a memo cost type.

CREATE TABLE IF NOT EXISTS dm_exhibit_line (
  id                    bigserial PRIMARY KEY,
  load_id               bigint NOT NULL REFERENCES dm_load(id) ON DELETE CASCADE,
  pb_year               int  NOT NULL,   -- which book this was read from
  exhibit               text NOT NULL,   -- p1 | p1r | r1
  account               text NOT NULL,   -- exhibit symbol, e.g. 1506N
  account_main          text,            -- 1506
  treasury_agency       text,            -- 017, derived from the organisation letter
  treasury_account      text,            -- 017-1506, the key the execution files use
  account_title         text,
  organization          text,
  budget_activity       text,
  budget_activity_title text,
  bsa                   text,
  bsa_title             text,
  line_number           text,
  bli                   text NOT NULL,   -- budget line item / program element
  bli_title             text NOT NULL,
  cost_type             text,            -- A | AP CY | Less: AP PY | ...
  cost_type_title       text,
  is_memo               boolean NOT NULL DEFAULT false,
  fiscal_year           int  NOT NULL,   -- which year this row describes
  fy_role               text NOT NULL,   -- prior_actual | enacted | request | other
  amount_k              numeric(20,3) NOT NULL DEFAULT 0,  -- thousands of dollars
  quantity              numeric(16,3) NOT NULL DEFAULT 0,
  total_column          text,            -- the exhibit column this figure came from
  total_basis           text NOT NULL,   -- total_column | sole_column | sum_of_components
  component_count       int  NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS dm_exhibit_line_idx
  ON dm_exhibit_line (load_id, exhibit, account, bli, pb_year, fiscal_year);

-- The same lines rolled up over cost type: one amount per budget line per book
-- per fiscal year. This is what the restatement matrix on /program reads.
CREATE TABLE IF NOT EXISTS dm_exhibit_program_fy (
  id                    bigserial PRIMARY KEY,
  load_id               bigint NOT NULL REFERENCES dm_load(id) ON DELETE CASCADE,
  account               text NOT NULL,
  treasury_account      text,
  exhibit               text NOT NULL,
  bli                   text NOT NULL,
  pb_year               int  NOT NULL,
  fiscal_year           int  NOT NULL,
  fy_role               text NOT NULL,
  bli_title             text NOT NULL,
  organization          text,
  account_title         text,
  budget_activity       text,
  budget_activity_title text,
  is_memo               boolean NOT NULL DEFAULT false,
  amount_k              numeric(20,3) NOT NULL DEFAULT 0,
  quantity              numeric(16,3) NOT NULL DEFAULT 0,
  cost_type_count       int  NOT NULL DEFAULT 0,
  total_basis           text NOT NULL,
  UNIQUE (load_id, exhibit, account, bli, pb_year, fiscal_year, is_memo)
);
CREATE INDEX IF NOT EXISTS dm_exhibit_program_fy_year_idx
  ON dm_exhibit_program_fy (load_id, fiscal_year, fy_role, is_memo);

-- One row per budget line across every book we hold: the roster.
CREATE TABLE IF NOT EXISTS dm_exhibit_program (
  id                    bigserial PRIMARY KEY,
  load_id               bigint NOT NULL REFERENCES dm_load(id) ON DELETE CASCADE,
  account               text NOT NULL,
  treasury_account      text,
  exhibit               text NOT NULL,
  bli                   text NOT NULL,
  component             text,            -- derived from the account symbol, not the drifting Organization column
  program_name          text NOT NULL,   -- the title as of the newest book
  latest_pb             int  NOT NULL,
  organization          text,
  account_title         text,
  budget_activity_title text,
  is_memo               boolean NOT NULL DEFAULT false,
  first_fiscal_year     int  NOT NULL,
  last_fiscal_year      int  NOT NULL,
  latest_request_k      numeric(20,3) NOT NULL DEFAULT 0,
  latest_request_pb     int,             -- the newest book that actually contains a request
  lifetime_amount_k     numeric(20,3) NOT NULL DEFAULT 0,
  pb_year_count         int  NOT NULL DEFAULT 0,
  slug                  text NOT NULL,
  in_weapons_book       boolean NOT NULL DEFAULT false,
  UNIQUE (load_id, exhibit, account, bli)
);
CREATE INDEX IF NOT EXISTS dm_exhibit_program_search_idx
  ON dm_exhibit_program (load_id, is_memo, latest_request_k DESC);

-- Program Acquisition Cost by Weapon System, one PDF per PB year. This is the
-- Department's own answer to "which of these lines is a major program", so it
-- is carried as its own roster rather than folded into a flag we invented.
CREATE TABLE IF NOT EXISTS dm_weapon_system (
  id            bigserial PRIMARY KEY,
  load_id       bigint NOT NULL REFERENCES dm_load(id) ON DELETE CASCADE,
  pb_year       int  NOT NULL,
  program_name  text NOT NULL,
  category      text,
  page_no       text,
  UNIQUE (load_id, pb_year, program_name, page_no)
);

-- The weapons book names systems; the exhibits name budget lines; nothing in
-- either source carries the other's key. Every link therefore records HOW it
-- was made and on WHAT evidence, so a reader can reject one match without
-- having to distrust the rest. match_method 'designator' means both names carry
-- the same type designator (F-35, DDG 51); 'phrase' means three or more shared
-- significant words with no designator on either side to contradict.
CREATE TABLE IF NOT EXISTS dm_exhibit_weapon_link (
  id              bigserial PRIMARY KEY,
  load_id         bigint NOT NULL REFERENCES dm_load(id) ON DELETE CASCADE,
  account         text NOT NULL,
  exhibit         text NOT NULL,
  bli             text NOT NULL,
  pb_year         int  NOT NULL,
  weapon_program  text NOT NULL,
  weapon_category text,
  weapon_page     text,
  match_method    text NOT NULL,   -- designator | phrase
  match_evidence  text NOT NULL,   -- the token or words the match rests on
  UNIQUE (load_id, exhibit, account, bli, pb_year, weapon_program)
);
CREATE INDEX IF NOT EXISTS dm_exhibit_weapon_link_idx
  ON dm_exhibit_weapon_link (load_id, exhibit, account, bli);

-- The one external check on the exhibit extract. The weapons book states the
-- same request the -1 books itemise, totalled by the Department itself, so a
-- disagreement means the extract is wrong rather than that the sources differ.
CREATE TABLE IF NOT EXISTS dm_exhibit_tieout (
  id           bigserial PRIMARY KEY,
  load_id      bigint NOT NULL REFERENCES dm_load(id) ON DELETE CASCADE,
  pb_year      int  NOT NULL,
  measure      text NOT NULL,          -- investment | procurement | rdte
  exhibit      text,                   -- p1 | r1, null for the combined figure
  published_b  numeric(12,3) NOT NULL, -- billions of dollars, as printed
  citation     text NOT NULL,
  UNIQUE (load_id, pb_year, measure)
);

-- Budget line -> FPDS acquisition program code. Derived, never published as a
-- Department mapping: every row records the evidence the link rests on, and an
-- ambiguous designator produces no row at all rather than a guess.
CREATE TABLE IF NOT EXISTS dm_exhibit_program_link (
  id               bigserial PRIMARY KEY,
  load_id          bigint NOT NULL REFERENCES dm_load(id) ON DELETE CASCADE,
  exhibit          text NOT NULL,
  account          text NOT NULL,
  bli              text NOT NULL,
  treasury_account text,
  bli_title        text NOT NULL,
  program_code     text NOT NULL,
  program_name     text NOT NULL,
  is_featured      boolean NOT NULL DEFAULT false,
  match_method     text NOT NULL,   -- designator | exact_name
  match_evidence   text NOT NULL,
  UNIQUE (load_id, exhibit, account, bli, program_code)
);
CREATE INDEX IF NOT EXISTS dm_exhibit_program_link_idx
  ON dm_exhibit_program_link (load_id, exhibit, account, bli);

-- ---------------------------------------------------------------- upgrades --
-- Everything above is CREATE TABLE IF NOT EXISTS, which is exactly right for a
-- fresh database and silently wrong for one that already holds the table: a
-- column added later never arrives, and nothing says so until the load fails on
-- an INSERT several tables in, having already done the work. Neon hit this on
-- dm_reconciliation the first time the File C correction reached it.
--
-- So every column added to a table that already shipped gets an idempotent
-- ALTER here, and they are KEPT rather than squashed once "everyone" has run
-- them -- a database that has not been loaded since before the change is
-- precisely the database that still needs them. New tables need no entry;
-- CREATE TABLE IF NOT EXISTS handles those on its own.
--
-- A column added this way must be nullable or carry a DEFAULT, because the
-- table it is being added to is not empty.

-- 2026-09-08 -- File C is a monthly CUMULATIVE snapshot, so a row has to record
-- which single submission period it was built from. Without these the published
-- linkage figure summed four overlapping restatements of the same year.
ALTER TABLE dm_reconciliation ADD COLUMN IF NOT EXISTS submission_period text;
ALTER TABLE dm_reconciliation ADD COLUMN IF NOT EXISTS periods_available int;
ALTER TABLE dm_reconciliation ADD COLUMN IF NOT EXISTS period_row_counts text;

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

CREATE TABLE IF NOT EXISTS dm_audit_mw_category (
  id            bigserial PRIMARY KEY,
  load_id       bigint NOT NULL REFERENCES dm_load(id) ON DELETE CASCADE,
  fiscal_year   int NOT NULL,
  rank_in_report int NOT NULL,
  category      text NOT NULL,
  citation      text NOT NULL,
  UNIQUE (load_id, fiscal_year, rank_in_report)
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

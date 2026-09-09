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


-- The weapons book's own cost table for each system: the SAME money the -1
-- exhibits itemise line by line, but totalled by the Department against the
-- system rather than against a budget line, split by appropriation and service
-- with quantities, for the three fiscal years each book restates.
--
-- This is the only source here that states what a whole programme costs, and it
-- is the only published answer to what that total covers: several pages carry a
-- footnote -- "Includes Modification Program and Spares" -- which is kept in
-- coverage_note beside every row it applies to, because a programme total whose
-- scope is unstated cannot be compared with anything.
--
-- The book changes shape between eras exactly as the -1 books do (Base/OCO in
-- PB2020-21, Discretionary/Mandatory in PB2026), so total_basis records which
-- of the two column rules produced the figure, the same way dm_exhibit_line
-- does. row_kind separates what may be added from what may not:
--   detail       -- one service under one appropriation
--   subtotal     -- the book's own subtotal for that appropriation
--   total        -- the book's own total for the system
--   block_check  -- NOT published by the book. The sum of the appropriation
--                   blocks as extracted, carried so WBC-01 can assert the page
--                   foots without the page's own total being compared to itself.
-- Summing across row_kind double counts. Every query names the one it wants.
CREATE TABLE IF NOT EXISTS dm_weapon_system_cost (
  id              bigserial PRIMARY KEY,
  load_id         bigint NOT NULL REFERENCES dm_load(id) ON DELETE CASCADE,
  pb_year         int  NOT NULL,
  program_name    text NOT NULL,
  page_no         text,
  appropriation   text,            -- RDT&E | Procurement | Mods | ... as printed
  service         text,            -- USN/USMC | USAF | SOCOM | ... as printed
  row_kind        text NOT NULL,   -- detail | subtotal | total | block_check
  fiscal_year     int  NOT NULL,
  fy_role         text NOT NULL,   -- prior_actual | enacted | request | other
  amount_m        numeric(16,3),   -- MILLIONS of dollars, as printed
  quantity        numeric(16,3),
  total_basis     text NOT NULL,
  component_count int  NOT NULL DEFAULT 0,
  coverage_note   text             -- the page's own footnote on what is included
);
CREATE INDEX IF NOT EXISTS dm_weapon_system_cost_idx
  ON dm_weapon_system_cost (load_id, program_name, pb_year, fiscal_year);
CREATE INDEX IF NOT EXISTS dm_weapon_system_cost_kind_idx
  ON dm_weapon_system_cost (load_id, row_kind, fy_role);

-- The abbreviations the weapons book expands into a system's own name, which is
-- the only published source for the shorthand people actually type: JSF, FLRAA,
-- JLTV, SDB. Every row carries the sentence the expansion was read from, so an
-- alias can be rejected one at a time. Nothing is matched on a bare acronym
-- appearing near a system: the expansion has to share two or more significant
-- words with the system's name, the same evidence test the weapon crosswalk
-- uses. This table is a SEARCH aid and nothing else -- no figure is ever
-- aggregated through it, and it is never presented as a Department mapping.
CREATE TABLE IF NOT EXISTS dm_weapon_alias (
  id              bigserial PRIMARY KEY,
  load_id         bigint NOT NULL REFERENCES dm_load(id) ON DELETE CASCADE,
  alias           text NOT NULL,
  alias_norm      text NOT NULL,   -- case, spacing and punctuation removed
  weapon_program  text NOT NULL,
  pb_year         int  NOT NULL,
  designator_norm text,            -- the type designators in the expanded name
  linked_lines    int  NOT NULL DEFAULT 0,
  match_method    text NOT NULL,   -- book_parenthetical | name_parenthetical
  match_evidence  text NOT NULL,
  UNIQUE (load_id, alias_norm, weapon_program)
);
CREATE INDEX IF NOT EXISTS dm_weapon_alias_idx ON dm_weapon_alias (load_id, alias_norm);

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


-- 2026-09-09 -- the roster carries the two published taxonomies over a budget
-- line and the class of appropriation it sits in, so /program can be filtered
-- and sorted by them. All five are restatements of columns the exhibits already
-- publish; the only derived one is `appropriation`, which picks a single
-- spelling per Treasury account because the books write the same account four
-- ways. search_norm is the same line with case, spacing and punctuation removed,
-- which is what makes "f35" find "F-35" without a fuzzy matcher guessing.
ALTER TABLE dm_exhibit_program ADD COLUMN IF NOT EXISTS budget_activity text;
ALTER TABLE dm_exhibit_program ADD COLUMN IF NOT EXISTS bsa text;
ALTER TABLE dm_exhibit_program ADD COLUMN IF NOT EXISTS bsa_title text;
ALTER TABLE dm_exhibit_program ADD COLUMN IF NOT EXISTS fund_type text;
ALTER TABLE dm_exhibit_program ADD COLUMN IF NOT EXISTS appropriation text;
ALTER TABLE dm_exhibit_program ADD COLUMN IF NOT EXISTS weapon_category text;
ALTER TABLE dm_exhibit_program ADD COLUMN IF NOT EXISTS weapon_program text;
ALTER TABLE dm_exhibit_program ADD COLUMN IF NOT EXISTS search_norm text;
-- A line item is not confined to one budget activity: PB2027 line ATA000 sits
-- under Tactical Forces for its airframes and under Aircraft Spares and Repair
-- Parts for its spares. The activity shown is the one carrying the most money
-- in the newest book; this says how many the line actually spans.
ALTER TABLE dm_exhibit_program ADD COLUMN IF NOT EXISTS activity_count int;
CREATE INDEX IF NOT EXISTS dm_exhibit_program_norm_idx
  ON dm_exhibit_program (load_id, search_norm text_pattern_ops);

-- 2026-09-09 -- the weapons book names a prime contractor on every system page
-- and, on some, states what the system's total covers.
ALTER TABLE dm_weapon_system ADD COLUMN IF NOT EXISTS prime_contractor text;
ALTER TABLE dm_weapon_system ADD COLUMN IF NOT EXISTS coverage_note text;


-- Every File C submission period held for a fiscal year, not only the one that
-- is published. This table exists because the published linkage figure is the
-- product of a CHOICE, and the choice moves the answer by a factor of eight.
--
-- File C is a per-submission snapshot of the award-to-account linkage. The
-- warehouse holds four of them per fiscal year -- periods 3, 6, 9 and 12; the
-- other seven carry fewer than thirty rows -- and the extract publishes the one
-- with the most rows, on the reasoning that it is the most complete copy held.
-- That is a defensible rule and it is still a rule: reading FY2022 at period 3
-- gives 1.4% linkage and at period 12 gives 11.6%, from the same warehouse, for
-- the same year. Neither is wrong. What is wrong is comparing one year's period
-- 6 with another's period 12 and calling the difference a trend.
--
-- So the whole series is loaded, the published row is flagged `is_chosen`, and
-- no page may render the headline figure without the alternatives beside it.
CREATE TABLE IF NOT EXISTS dm_filec_period (
  id                bigserial PRIMARY KEY,
  load_id           bigint NOT NULL REFERENCES dm_load(id) ON DELETE CASCADE,
  fiscal_year       int  NOT NULL,
  submission_period text NOT NULL,   -- FY2024P06 as the source writes it
  period_no         int,             -- 6
  obligation        numeric(20,2) NOT NULL DEFAULT 0,
  filec_rows        bigint NOT NULL DEFAULT 0,
  filec_awards      bigint NOT NULL DEFAULT 0,
  award_obligation  numeric(20,2) NOT NULL DEFAULT 0,  -- the FPDS full-year denominator
  is_chosen         boolean NOT NULL DEFAULT false,
  UNIQUE (load_id, fiscal_year, submission_period)
);
CREATE INDEX IF NOT EXISTS dm_filec_period_idx
  ON dm_filec_period (load_id, fiscal_year, period_no);


-- ------------------------------------------------ the field-level catalogue --
-- What each source actually carries, column by column, with real values.
--
-- A join can only be understood at the level of the columns it is made from, so
-- this table is the evidence behind every seam on /linkage. It also records
-- which columns the site READS: File C carries ninety-one columns and this site
-- reads five, and a reader is entitled to see what was available and not used
-- rather than only what was used.
--
-- populated_pct and the sample values are measured on the first batch of rows
-- rather than the whole file, and rows_scanned says how many. A parquet row
-- group in these files is the whole file, so a full profile of ninety columns
-- costs more memory than the extract host has.
CREATE TABLE IF NOT EXISTS dm_source_field (
  id              bigserial PRIMARY KEY,
  load_id         bigint NOT NULL REFERENCES dm_load(id) ON DELETE CASCADE,
  source_key      text NOT NULL,   -- file_a | file_b | file_c_contracts | contracts
  source_label    text NOT NULL,
  fiscal_year     int,
  field_name      text NOT NULL,
  field_kind      text,            -- text | integer | number | date | boolean
  rows_scanned    bigint NOT NULL DEFAULT 0,
  populated_pct   numeric(6,2),
  distinct_count  bigint,
  sample_values   text,            -- three real values, most common first
  is_read         boolean NOT NULL DEFAULT false,
  note            text,
  UNIQUE (load_id, source_key, fiscal_year, field_name)
);
CREATE INDEX IF NOT EXISTS dm_source_field_idx ON dm_source_field (load_id, source_key, field_name);

-- Real records that demonstrate a break. A gap asserted in prose is an opinion;
-- a gap shown as the record that fails to join is a fact. Every row here is
-- quoted from the source with no editing beyond selecting which columns to show.
CREATE TABLE IF NOT EXISTS dm_join_sample (
  id           bigserial PRIMARY KEY,
  load_id      bigint NOT NULL REFERENCES dm_load(id) ON DELETE CASCADE,
  seam_key     text NOT NULL,
  fiscal_year  int,
  verdict      text NOT NULL,      -- a short label for what this record shows
  why          text NOT NULL,
  record       text NOT NULL       -- the quoted record, as JSON
);
CREATE INDEX IF NOT EXISTS dm_join_sample_idx ON dm_join_sample (load_id, seam_key);

-- The Standard Line of Accounting: the minimum set of SFIS data elements the
-- Department requires to be exchanged for any business event with an accounting
-- impact, from the initial commitment through to disbursement.
--
-- It is carried here because it answers the question the seams raise. The joins
-- this site cannot make are, for the most part, joins these elements were
-- defined to make possible -- element 12 is Budget Line Item, which is exactly
-- the key missing between the budget books and the contract file. Publishing the
-- standard beside the coverage turns "these files do not join" into "these files
-- do not carry the elements that would join them", which is a different and more
-- actionable statement.
--
-- candidate_fields lists the column names in the published data that would
-- satisfy the element; coverage is computed against dm_source_field rather than
-- asserted here, so it moves when the sources move.
CREATE TABLE IF NOT EXISTS dm_sfis_element (
  id               bigserial PRIMARY KEY,
  load_id          bigint NOT NULL REFERENCES dm_load(id) ON DELETE CASCADE,
  sort_order       int NOT NULL DEFAULT 100,
  element_name     text NOT NULL,
  field_length     int,
  definition       text NOT NULL,
  is_sloa          boolean NOT NULL DEFAULT true,
  candidate_fields text[],
  authority        text NOT NULL,
  UNIQUE (load_id, element_name)
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

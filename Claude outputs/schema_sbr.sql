
-- =========================================================================
-- SBR assurance: the Budgetary Resources material weakness, worked end to end
--
-- /nfr scores this weakness `testable` because File A IS the Statement of
-- Budgetary Resources. These tables are what that score is worth: a test
-- catalogue with criteria, an exception population, a risk-scored case queue,
-- a remediation workflow, and the run history that shows whether a remediation
-- held. The tests run INSIDE the load transaction, so every `npm run refresh`
-- is a monitoring cycle rather than a one-off analysis.
--
-- Three rules govern this whole subsystem.
--
-- 1. A TEST IS NOT PUBLISHED UNLESS ITS EXCEPTIONS MEAN SOMETHING. Two obvious
--    tests were written, run against the real population, and DROPPED because
--    what they flag is a property of the published file rather than a control
--    failure: per-account component footing (File A does not publish the
--    deduction lines, so components exceed the total on 231 of 943 FY2025
--    accounts by $226.1B) and gross outlays against total resources (outlays
--    include payment against prior-year obligations, so a third of accounts
--    "fail" by design). Both are recorded as `not_testable` with the reason.
--    A queue of 300 false exceptions destroys a remediation programme faster
--    than no queue at all.
--
-- 2. NOTHING HERE CONCLUDES THAT A MISSTATEMENT EXISTS. Every test identifies
--    where a question has to be asked, names the criterion that makes it a
--    question, and stops. The auditor's conclusion is not this site's to make,
--    and the local model is instructed in the same terms.
--
-- 3. DERIVED AND USER-OWNED ARE SEPARATE TABLES. The load replaces everything
--    derived. A case's workflow state, owner, root cause and evidence are
--    entered by a person and must survive every subsequent load, so they live
--    in their own tables that the load never deletes from.
-- =========================================================================

-- The use case charter (WP0). One row per element, so the page renders the
-- charter from data and the copilot grounds on the same rows a reader sees.
CREATE TABLE IF NOT EXISTS dm_sbr_charter (
  id            bigserial PRIMARY KEY,
  load_id       bigint NOT NULL REFERENCES dm_load(id) ON DELETE CASCADE,
  sort_order    int NOT NULL,
  element       text NOT NULL,
  value         text NOT NULL,
  basis         text NOT NULL CHECK (basis IN ('reported','derived')),
  citation      text NOT NULL,
  UNIQUE (load_id, element)
);

-- The test catalogue. `kind` is the honest axis:
--   exception    -- runs, produces an exception population
--   assurance    -- runs, and passing IS the evidence (0 exceptions expected)
--   not_testable -- cannot be tested from these sources; the reason is the row
CREATE TABLE IF NOT EXISTS dm_sbr_test (
  code          text PRIMARY KEY,
  name          text NOT NULL,
  kind          text NOT NULL CHECK (kind IN ('exception','assurance','not_testable')),
  assertion     text NOT NULL,        -- completeness | existence | rights | valuation | presentation
  risk          text NOT NULL,        -- what could be materially wrong
  criterion     text NOT NULL,        -- the authority that makes it a question
  method        text NOT NULL,        -- what the SQL actually does, in words
  severity      text NOT NULL CHECK (severity IN ('critical','high','moderate','informational')),
  exposure_basis text NOT NULL,       -- what the dollar figure on an exception means
  limitation    text,                 -- required when kind = 'not_testable'
  sort_order    int NOT NULL DEFAULT 100
);

-- One row per (load, test, fiscal year). This is the control-performance
-- history: it is what makes "did the remediation hold" answerable, and it is
-- never deleted for prior loads -- the trend IS the evidence.
CREATE TABLE IF NOT EXISTS dm_sbr_run (
  id              bigserial PRIMARY KEY,
  load_id         bigint NOT NULL REFERENCES dm_load(id) ON DELETE CASCADE,
  test_code       text NOT NULL REFERENCES dm_sbr_test(code) ON DELETE CASCADE,
  fiscal_year     int NOT NULL,
  vintage         date NOT NULL,
  submission_period text,
  is_partial_year boolean NOT NULL DEFAULT false,
  population      int NOT NULL DEFAULT 0,   -- accounts in scope of the test
  exceptions      int NOT NULL DEFAULT 0,
  exposure        numeric(20,2) NOT NULL DEFAULT 0,
  population_amount numeric(20,2) NOT NULL DEFAULT 0,
  ran_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (load_id, test_code, fiscal_year)
);
CREATE INDEX IF NOT EXISTS dm_sbr_run_hist_idx ON dm_sbr_run (test_code, fiscal_year, ran_at DESC);

CREATE TABLE IF NOT EXISTS dm_sbr_exception (
  id              bigserial PRIMARY KEY,
  load_id         bigint NOT NULL REFERENCES dm_load(id) ON DELETE CASCADE,
  test_code       text NOT NULL REFERENCES dm_sbr_test(code) ON DELETE CASCADE,
  fiscal_year     int NOT NULL,
  case_key        text NOT NULL,
  treasury_account text NOT NULL,
  account_name    text,
  agency_code     text,
  fund_life       text,
  bpoa            int,
  epoa            int,
  exposure        numeric(20,2) NOT NULL DEFAULT 0,
  observed        numeric(20,2),
  expected        numeric(20,2),
  detail          text NOT NULL,       -- one sentence naming the figures
  evidence_json   text NOT NULL,       -- the source values the sentence rests on
  UNIQUE (load_id, test_code, fiscal_year, treasury_account)
);
CREATE INDEX IF NOT EXISTS dm_sbr_exception_case_idx ON dm_sbr_exception (load_id, case_key);

-- Population confidence (WP3). Computed before any test runs, because a test
-- over a population that cannot be shown complete proves nothing.
CREATE TABLE IF NOT EXISTS dm_sbr_confidence (
  id              bigserial PRIMARY KEY,
  load_id         bigint NOT NULL REFERENCES dm_load(id) ON DELETE CASCADE,
  fiscal_year     int NOT NULL,
  metric_key      text NOT NULL,
  metric_label    text NOT NULL,
  value_pct       numeric(9,4),
  numerator       numeric(20,2),
  denominator     numeric(20,2),
  detail          text NOT NULL,
  is_blocking     boolean NOT NULL DEFAULT false,
  sort_order      int NOT NULL DEFAULT 100,
  UNIQUE (load_id, fiscal_year, metric_key)
);

-- The risk-scored queue. DERIVED: replaced on every load.
CREATE TABLE IF NOT EXISTS dm_sbr_case (
  id              bigserial PRIMARY KEY,
  load_id         bigint NOT NULL REFERENCES dm_load(id) ON DELETE CASCADE,
  case_key        text NOT NULL,
  fiscal_year     int NOT NULL,
  treasury_account text NOT NULL,
  account_name    text,
  federal_account text,
  agency_code     text,
  agency_name     text,
  fund_life       text,
  bpoa            int,
  epoa            int,
  obligations     numeric(20,2) NOT NULL DEFAULT 0,
  total_resources numeric(20,2) NOT NULL DEFAULT 0,
  exception_count int NOT NULL DEFAULT 0,
  test_codes      text NOT NULL,
  max_severity    text NOT NULL,
  exposure        numeric(20,2) NOT NULL DEFAULT 0,
  risk_score      numeric(6,2) NOT NULL DEFAULT 0,
  tier            int NOT NULL,
  recurrence_years int NOT NULL DEFAULT 1,
  anomaly_z       numeric(9,3),
  UNIQUE (load_id, case_key)
);
CREATE INDEX IF NOT EXISTS dm_sbr_case_rank_idx ON dm_sbr_case (load_id, risk_score DESC);

-- Why a case scored what it scored. Without this the score is a number nobody
-- can defend in a conversation with the organisation being asked to act on it.
CREATE TABLE IF NOT EXISTS dm_sbr_case_factor (
  id              bigserial PRIMARY KEY,
  load_id         bigint NOT NULL REFERENCES dm_load(id) ON DELETE CASCADE,
  case_key        text NOT NULL,
  factor          text NOT NULL,
  points          numeric(6,2) NOT NULL,
  max_points      numeric(6,2) NOT NULL,
  detail          text NOT NULL,
  sort_order      int NOT NULL DEFAULT 100
);
CREATE INDEX IF NOT EXISTS dm_sbr_case_factor_idx ON dm_sbr_case_factor (load_id, case_key, sort_order);

-- ------------------------------------------------------------ user-owned --
-- The load NEVER deletes from the two tables below. A case's workflow state is
-- entered by a person; a load that replaced it would erase the remediation
-- record every time the warehouse refreshed.
CREATE TABLE IF NOT EXISTS dm_sbr_case_state (
  case_key        text PRIMARY KEY,
  state           text NOT NULL DEFAULT 'open'
                  CHECK (state IN ('open','investigating','root_cause_identified',
                                   'corrective_action','evidence_submitted',
                                   'validating','closed','accepted_risk')),
  owner_org       text,
  owner_role      text,
  root_cause      text,
  corrective_action text,
  due_date        date,
  remediated_at   timestamptz,
  closed_at       timestamptz,
  note            text,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      text NOT NULL DEFAULT 'unattributed'
);

CREATE TABLE IF NOT EXISTS dm_sbr_case_event (
  id              bigserial PRIMARY KEY,
  case_key        text NOT NULL,
  seq             int NOT NULL,
  kind            text NOT NULL,      -- state | action | evidence | note
  action_code     text,
  actor           text NOT NULL DEFAULT 'unattributed',
  model_link      text,               -- which model link drafted it, when one did
  summary         text NOT NULL,
  payload         text,               -- the artifact, as stored
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (case_key, seq)
);
CREATE INDEX IF NOT EXISTS dm_sbr_case_event_idx ON dm_sbr_case_event (case_key, seq DESC);

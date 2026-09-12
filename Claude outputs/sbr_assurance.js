/**
 * SBR assurance engine.
 *
 * Runs inside the load transaction, after the measures are loaded and before
 * the commit, so every `npm run refresh` re-tests the whole population and
 * writes a new run row. That run history is the control-performance evidence:
 * it is what makes "did the remediation actually hold" a question with an
 * answer rather than an assertion by the organisation that did the remediating.
 *
 * DEFINITION AND SQL LIVE TOGETHER. Each entry below carries both its metadata
 * (assertion, criterion, severity, what the exposure figure means) and the
 * query that produces its exceptions. A test cannot reach the page without a
 * criterion, and a criterion cannot be published without something that runs.
 *
 * WHAT IS DELIBERATELY NOT HERE. Two tests were written, run against the real
 * population, and dropped -- they are carried as `not_testable` rows so the
 * page can say why rather than leaving a reader to wonder. See NOT_TESTABLE.
 */

const SCOPE = 'DOW';

/** Treasury symbols carry slashes; a case key has to survive a URL path. */
const caseKey = (fy, account) => `FY${fy}-${String(account).replace(/[^A-Za-z0-9._-]/g, '_')}`;

// Common column list for an exception row. Every test selects this shape.
const EXC = `
  r.fiscal_year, r.treasury_account,
  COALESCE(r.treasury_account_name, r.federal_account_name) AS account_name,
  r.agency_code, r.fund_life, r.bpoa, r.epoa`;

// ---------------------------------------------------------------- tests ----
const TESTS = [
  {
    code: 'SBR-X01',
    name: 'Balance on an account whose availability has cancelled',
    kind: 'exception',
    assertion: 'Existence; rights and obligations',
    risk: 'Budgetary resources and unobligated balances are reported on accounts whose '
        + 'authority has cancelled, so the Statement of Budgetary Resources presents authority '
        + 'that no longer legally exists and cannot be obligated or disbursed.',
    criterion: '31 U.S.C. 1552(a) -- on 30 September of the fifth fiscal year after the period '
        + 'of availability ends, the account closes and any remaining balance is cancelled and '
        + 'is thereafter unavailable for any purpose.',
    method: 'Accounts whose end of period of availability is more than five fiscal years before '
        + 'the reporting year and that still report a non-zero resource, obligation or '
        + 'unobligated balance.',
    severity: 'critical',
    exposure_basis: 'The absolute sum of the resources, obligations and unobligated balance still '
        + 'reported on the cancelled account.',
    sort_order: 10,
    sql: `
      SELECT ${EXC},
        (abs(r.total_budgetary_resources) + abs(r.obligations_incurred)
         + abs(r.unobligated_balance)) AS exposure,
        r.unobligated_balance AS observed, 0::numeric AS expected,
        'Period of availability ended FY' || r.epoa || ', ' || (r.fiscal_year - r.epoa)
          || ' years before the reporting year, and the account still reports '
          || to_char(r.unobligated_balance, 'FM999,999,999,990.00')
          || ' unobligated against ' || to_char(r.total_budgetary_resources, 'FM999,999,999,990.00')
          || ' of budgetary resources.' AS detail,
        json_build_object('total_budgetary_resources', r.total_budgetary_resources,
          'obligations_incurred', r.obligations_incurred,
          'unobligated_balance', r.unobligated_balance,
          'gross_outlays', r.gross_outlays, 'bpoa', r.bpoa, 'epoa', r.epoa,
          'years_since_cancellation', r.fiscal_year - r.epoa - 5)::text AS evidence_json
        FROM dm_exec_resource r
       WHERE r.load_id = $1 AND r.scope = $2 AND r.fiscal_year = $3
         AND r.epoa IS NOT NULL AND r.epoa < r.fiscal_year - 5
         AND (abs(r.total_budgetary_resources) > 0 OR abs(r.obligations_incurred) > 0
              OR abs(r.unobligated_balance) > 0)`,
    populationSql: `
      SELECT count(*)::int AS population, COALESCE(sum(abs(total_budgetary_resources)),0) AS amount
        FROM dm_exec_resource
       WHERE load_id = $1 AND scope = $2 AND fiscal_year = $3 AND epoa IS NOT NULL`,
  },

  {
    code: 'SBR-X02',
    name: 'Negative unobligated balance',
    kind: 'exception',
    assertion: 'Rights and obligations (amount)',
    risk: 'Obligations recorded against an account exceed the budgetary resources available to '
        + 'it, which is the reported shape of an over-obligation. File A alone cannot establish '
        + 'a violation -- it establishes that the question has to be asked of the fund holder.',
    criterion: '31 U.S.C. 1341(a)(1)(A) -- an officer may not make or authorize an obligation '
        + 'exceeding the amount available in the appropriation or fund. DoD FMR Volume 14.',
    method: 'Accounts reporting an unobligated balance below zero.',
    severity: 'critical',
    exposure_basis: 'The amount by which obligations exceed the reported budgetary resources.',
    sort_order: 20,
    sql: `
      SELECT ${EXC},
        abs(r.unobligated_balance) AS exposure,
        r.unobligated_balance AS observed, 0::numeric AS expected,
        'Obligations of ' || to_char(r.obligations_incurred, 'FM999,999,999,990.00')
          || ' against budgetary resources of '
          || to_char(r.total_budgetary_resources, 'FM999,999,999,990.00')
          || ' leave the unobligated balance at '
          || to_char(r.unobligated_balance, 'FM999,999,999,990.00') || '.' AS detail,
        json_build_object('total_budgetary_resources', r.total_budgetary_resources,
          'obligations_incurred', r.obligations_incurred,
          'unobligated_balance', r.unobligated_balance,
          'ba_appropriated', r.ba_appropriated, 'unobligated_bf', r.unobligated_bf,
          'spending_auth_offsetting', r.spending_auth_offsetting)::text AS evidence_json
        FROM dm_exec_resource r
       WHERE r.load_id = $1 AND r.scope = $2 AND r.fiscal_year = $3
         AND r.unobligated_balance < 0`,
    populationSql: `
      SELECT count(*)::int AS population, COALESCE(sum(total_budgetary_resources),0) AS amount
        FROM dm_exec_resource WHERE load_id = $1 AND scope = $2 AND fiscal_year = $3`,
  },

  {
    code: 'SBR-X03',
    name: 'Negative budgetary resources or negative obligations',
    kind: 'exception',
    assertion: 'Valuation; presentation',
    risk: 'An account reports a negative total of budgetary resources or a net-negative '
        + 'obligation for the year. Net-negative obligations occur lawfully on an expiring '
        + 'account where downward adjustments exceed new obligations; a negative resource '
        + 'total does not have a comparable ordinary explanation.',
    criterion: 'OMB Circular A-136, Statement of Budgetary Resources presentation; USSGL '
        + 'budgetary account normal balances.',
    method: 'Accounts where total budgetary resources or obligations incurred is below zero.',
    severity: 'high',
    exposure_basis: 'The absolute value of the negative figure reported.',
    sort_order: 30,
    sql: `
      SELECT ${EXC},
        GREATEST(abs(LEAST(r.total_budgetary_resources, 0)),
                 abs(LEAST(r.obligations_incurred, 0))) AS exposure,
        LEAST(r.total_budgetary_resources, r.obligations_incurred) AS observed,
        0::numeric AS expected,
        'Reported total budgetary resources '
          || to_char(r.total_budgetary_resources, 'FM999,999,999,990.00')
          || ' and obligations incurred '
          || to_char(r.obligations_incurred, 'FM999,999,999,990.00')
          || '; at least one carries a negative balance.' AS detail,
        json_build_object('total_budgetary_resources', r.total_budgetary_resources,
          'obligations_incurred', r.obligations_incurred,
          'deobligations', r.deobligations,
          'unobligated_balance', r.unobligated_balance)::text AS evidence_json
        FROM dm_exec_resource r
       WHERE r.load_id = $1 AND r.scope = $2 AND r.fiscal_year = $3
         AND (r.total_budgetary_resources < 0 OR r.obligations_incurred < 0)`,
    populationSql: `
      SELECT count(*)::int AS population, COALESCE(sum(abs(total_budgetary_resources)),0) AS amount
        FROM dm_exec_resource WHERE load_id = $1 AND scope = $2 AND fiscal_year = $3`,
  },

  {
    code: 'SBR-X04',
    name: 'File A and File B disagree on an account’s obligations',
    kind: 'exception',
    assertion: 'Completeness; accuracy',
    risk: 'The same obligations are reported twice by the Department -- once on the Statement '
        + 'of Budgetary Resources extract and once in the object-class and program-activity '
        + 'extract -- and the two do not agree for this account. One of them is wrong, and '
        + 'neither file says which.',
    criterion: 'OMB Circular A-11 Section 130 and the DATA Act reporting submission standard: '
        + 'File A and File B are drawn from the same general ledger and are expected to '
        + 'reconcile at the Treasury Account Symbol.',
    method: 'Accounts present in both files whose obligation figures differ by more than one '
        + 'dollar. Both files are read at the same submission period.',
    severity: 'high',
    exposure_basis: 'The absolute difference between the two reported obligation figures.',
    sort_order: 40,
    sql: `
      SELECT ${EXC},
        abs(r.obligations_incurred - b.obligations) AS exposure,
        b.obligations AS observed, r.obligations_incurred AS expected,
        'File A reports ' || to_char(r.obligations_incurred, 'FM999,999,999,990.00')
          || ' of obligations and File B reports '
          || to_char(b.obligations, 'FM999,999,999,990.00') || ', a difference of '
          || to_char(abs(r.obligations_incurred - b.obligations), 'FM999,999,999,990.00')
          || ' on the same account and the same year.' AS detail,
        json_build_object('file_a_obligations', r.obligations_incurred,
          'file_b_obligations', b.obligations, 'file_b_detail_rows', b.detail_rows,
          'file_b_undelivered_unpaid', b.undelivered_unpaid,
          'file_b_delivered_unpaid', b.delivered_unpaid,
          'file_b_upward_adjustments', b.upward_adjustments)::text AS evidence_json
        FROM dm_exec_resource r
        JOIN dm_exec_account_fy b
          ON b.treasury_account = r.treasury_account AND b.fiscal_year = r.fiscal_year
         AND b.scope = r.scope
        JOIN dm_load lb ON lb.id = b.load_id AND lb.is_current
       WHERE r.load_id = $1 AND r.scope = $2 AND r.fiscal_year = $3
         AND abs(r.obligations_incurred - b.obligations) > 1`,
    populationSql: `
      SELECT count(*)::int AS population, COALESCE(sum(r.obligations_incurred),0) AS amount
        FROM dm_exec_resource r
        JOIN dm_exec_account_fy b ON b.treasury_account = r.treasury_account
         AND b.fiscal_year = r.fiscal_year AND b.scope = r.scope
        JOIN dm_load lb ON lb.id = b.load_id AND lb.is_current
       WHERE r.load_id = $1 AND r.scope = $2 AND r.fiscal_year = $3`,
  },

  {
    code: 'SBR-X05',
    name: 'Obligations reported with no object-class detail behind them',
    kind: 'exception',
    assertion: 'Completeness',
    risk: 'An account reports obligations on the Statement of Budgetary Resources extract and '
        + 'has no row at all in the object-class extract, so there is no detail supporting what '
        + 'the obligation was for. A balance with no detail beneath it cannot be tested.',
    criterion: 'OMB Circular A-11 Section 130; DoD FMR Volume 1 Chapter 4 -- reported balances '
        + 'must be supported by transaction detail.',
    method: 'Accounts with non-zero obligations in File A and no File B row for the same '
        + 'account and year.',
    severity: 'high',
    exposure_basis: 'The obligations reported in File A with no detail behind them.',
    sort_order: 50,
    sql: `
      SELECT ${EXC},
        abs(r.obligations_incurred) AS exposure,
        r.obligations_incurred AS observed, NULL::numeric AS expected,
        'File A reports ' || to_char(r.obligations_incurred, 'FM999,999,999,990.00')
          || ' of obligations for this account and File B carries no row for it, so no '
          || 'object class or program activity accounts for the amount.' AS detail,
        json_build_object('file_a_obligations', r.obligations_incurred,
          'file_a_total_budgetary_resources', r.total_budgetary_resources,
          'file_b_rows', 0)::text AS evidence_json
        FROM dm_exec_resource r
       WHERE r.load_id = $1 AND r.scope = $2 AND r.fiscal_year = $3
         AND r.obligations_incurred <> 0
         AND NOT EXISTS (
           SELECT 1 FROM dm_exec_account_fy b
             JOIN dm_load lb ON lb.id = b.load_id AND lb.is_current
            WHERE b.scope = r.scope AND b.fiscal_year = r.fiscal_year
              AND b.treasury_account = r.treasury_account)`,
    populationSql: `
      SELECT count(*)::int AS population, COALESCE(sum(obligations_incurred),0) AS amount
        FROM dm_exec_resource
       WHERE load_id = $1 AND scope = $2 AND fiscal_year = $3 AND obligations_incurred <> 0`,
  },

  {
    code: 'SBR-X06',
    name: 'Obligations against expired authority beyond the recorded upward adjustments',
    kind: 'exception',
    assertion: 'Rights and obligations (time)',
    risk: 'An account whose period of availability ended before the reporting year reports '
        + 'obligations incurred in that year larger than the upward adjustments to prior-year '
        + 'obligations that the detail file records for it. Upward adjustments to an expired '
        + 'account are lawful; NEW obligations against expired authority are not. These files '
        + 'cannot tell the two apart, which is precisely why the account has to be asked.',
    criterion: '31 U.S.C. 1502(a) -- the bona fide needs rule; 31 U.S.C. 1553(a) -- an expired '
        + 'account remains available to adjust obligations properly chargeable to it before '
        + 'expiry, and for no other purpose.',
    method: 'Accounts with an end of availability before the reporting year, present in both '
        + 'files, whose File A obligations exceed File B upward adjustments by more than five '
        + 'percent and one million dollars. Accounts absent from File B are excluded here '
        + 'because they are already reported by SBR-X05 and would otherwise be flagged twice '
        + 'for the same missing row.',
    severity: 'high',
    exposure_basis: 'The obligations reported on expired authority that the recorded upward '
        + 'adjustments do not account for.',
    sort_order: 60,
    sql: `
      SELECT ${EXC},
        (r.obligations_incurred - COALESCE(b.upward_adjustments, 0)) AS exposure,
        r.obligations_incurred AS observed, COALESCE(b.upward_adjustments, 0) AS expected,
        'Availability ended FY' || r.epoa || '. File A reports '
          || to_char(r.obligations_incurred, 'FM999,999,999,990.00')
          || ' of obligations incurred in FY' || r.fiscal_year
          || ' while File B records only '
          || to_char(COALESCE(b.upward_adjustments, 0), 'FM999,999,999,990.00')
          || ' of upward adjustments to prior-year obligations.' AS detail,
        json_build_object('file_a_obligations', r.obligations_incurred,
          'file_b_upward_adjustments', b.upward_adjustments,
          'file_b_downward_adjustments', b.downward_adjustments,
          'file_b_obligations', b.obligations,
          'bpoa', r.bpoa, 'epoa', r.epoa,
          'years_expired', r.fiscal_year - r.epoa)::text AS evidence_json
        FROM dm_exec_resource r
        JOIN dm_exec_account_fy b
          ON b.treasury_account = r.treasury_account AND b.fiscal_year = r.fiscal_year
         AND b.scope = r.scope
        JOIN dm_load lb ON lb.id = b.load_id AND lb.is_current
       WHERE r.load_id = $1 AND r.scope = $2 AND r.fiscal_year = $3
         AND r.epoa IS NOT NULL AND r.epoa < r.fiscal_year
         AND r.obligations_incurred > COALESCE(b.upward_adjustments, 0) * 1.05 + 1000000`,
    populationSql: `
      SELECT count(*)::int AS population, COALESCE(sum(r.obligations_incurred),0) AS amount
        FROM dm_exec_resource r
        JOIN dm_exec_account_fy b ON b.treasury_account = r.treasury_account
         AND b.fiscal_year = r.fiscal_year AND b.scope = r.scope
        JOIN dm_load lb ON lb.id = b.load_id AND lb.is_current
       WHERE r.load_id = $1 AND r.scope = $2 AND r.fiscal_year = $3
         AND r.epoa IS NOT NULL AND r.epoa < r.fiscal_year AND r.obligations_incurred <> 0`,
  },

  {
    code: 'SBR-X07',
    name: 'Obligations incurred with no outlay activity',
    kind: 'exception',
    assertion: 'Existence',
    risk: 'An account reports obligations for the year and no gross outlays at all. An '
        + 'obligation that never produces a payment is either a valid undelivered order or an '
        + 'obligation that should not have been recorded, and the distinction is the one the '
        + 'tri-annual review exists to make.',
    criterion: 'DoD FMR Volume 3 Chapter 8 -- tri-annual review of commitments and obligations; '
        + 'unliquidated obligations must be validated as representing bona fide needs.',
    method: 'Accounts with non-zero obligations and zero gross outlays in the detail file.',
    severity: 'moderate',
    exposure_basis: 'The obligations recorded with no corresponding outlay.',
    sort_order: 70,
    sql: `
      SELECT ${EXC},
        abs(b.obligations) AS exposure, b.gross_outlays AS observed, NULL::numeric AS expected,
        to_char(b.obligations, 'FM999,999,999,990.00')
          || ' of obligations recorded with no gross outlay in the year, against '
          || to_char(b.undelivered_unpaid, 'FM999,999,999,990.00')
          || ' of undelivered orders unpaid at year end.' AS detail,
        json_build_object('obligations', b.obligations, 'gross_outlays', b.gross_outlays,
          'undelivered_unpaid', b.undelivered_unpaid,
          'undelivered_unpaid_bf', b.undelivered_unpaid_bf,
          'delivered_unpaid', b.delivered_unpaid)::text AS evidence_json
        FROM dm_exec_resource r
        JOIN dm_exec_account_fy b
          ON b.treasury_account = r.treasury_account AND b.fiscal_year = r.fiscal_year
         AND b.scope = r.scope
        JOIN dm_load lb ON lb.id = b.load_id AND lb.is_current
       WHERE r.load_id = $1 AND r.scope = $2 AND r.fiscal_year = $3
         AND b.obligations <> 0 AND b.gross_outlays = 0`,
    populationSql: `
      SELECT count(*)::int AS population, COALESCE(sum(b.obligations),0) AS amount
        FROM dm_exec_account_fy b JOIN dm_load lb ON lb.id = b.load_id AND lb.is_current
       WHERE b.scope = $2 AND b.fiscal_year = $3 AND b.obligations <> 0 AND $1 = $1`,
  },

  {
    code: 'SBR-X08',
    name: 'Undelivered orders carried forward that did not move',
    kind: 'exception',
    assertion: 'Existence; valuation',
    risk: 'Undelivered orders brought forward from a prior year produced almost no outlay in '
        + 'this year. A stale undelivered order overstates the liability the Department expects '
        + 'to settle and understates the authority that could be put to other use.',
    criterion: 'DoD FMR Volume 3 Chapter 8 -- tri-annual review; undelivered orders must be '
        + 'reviewed and deobligated where the need no longer exists.',
    method: 'Accounts carrying undelivered orders forward whose gross outlays for the year are '
        + 'under one percent of the balance brought forward.',
    severity: 'moderate',
    exposure_basis: 'The undelivered orders brought forward that produced no material outlay.',
    sort_order: 80,
    sql: `
      SELECT ${EXC},
        b.undelivered_unpaid_bf AS exposure, b.gross_outlays AS observed,
        b.undelivered_unpaid_bf AS expected,
        to_char(b.undelivered_unpaid_bf, 'FM999,999,999,990.00')
          || ' of undelivered orders brought forward produced '
          || to_char(b.gross_outlays, 'FM999,999,999,990.00')
          || ' of gross outlays in FY' || r.fiscal_year || '.' AS detail,
        json_build_object('undelivered_unpaid_bf', b.undelivered_unpaid_bf,
          'undelivered_unpaid', b.undelivered_unpaid, 'gross_outlays', b.gross_outlays,
          'deobligations', b.deobligations, 'obligations', b.obligations)::text AS evidence_json
        FROM dm_exec_resource r
        JOIN dm_exec_account_fy b
          ON b.treasury_account = r.treasury_account AND b.fiscal_year = r.fiscal_year
         AND b.scope = r.scope
        JOIN dm_load lb ON lb.id = b.load_id AND lb.is_current
       WHERE r.load_id = $1 AND r.scope = $2 AND r.fiscal_year = $3
         AND b.undelivered_unpaid_bf > 0
         AND b.gross_outlays < b.undelivered_unpaid_bf * 0.01`,
    populationSql: `
      SELECT count(*)::int AS population, COALESCE(sum(b.undelivered_unpaid_bf),0) AS amount
        FROM dm_exec_account_fy b JOIN dm_load lb ON lb.id = b.load_id AND lb.is_current
       WHERE b.scope = $2 AND b.fiscal_year = $3 AND b.undelivered_unpaid_bf > 0 AND $1 = $1`,
  },
];

// ------------------------------------------------- assurance (0 expected) ---
// These run over the same population and PASSING is the point. An assurance
// test that starts producing exceptions is a finding about the extract, and it
// is reported in the same run history as everything else.
const ASSURANCE = [
  {
    code: 'SBR-P01',
    name: 'Status of budgetary resources equals resources, account by account',
    assertion: 'Presentation; completeness',
    risk: 'If obligations plus the unobligated balance did not equal total budgetary resources '
        + 'for an account, the Statement of Budgetary Resources would not articulate and no '
        + 'figure drawn from it could be relied on.',
    criterion: 'OMB Circular A-136 -- the status section of the SBR equals the resources '
        + 'section. DoD FMR Volume 6A.',
    method: 'Every account, every year: obligations incurred plus unobligated balance against '
        + 'total budgetary resources, to the dollar.',
    severity: 'critical',
    exposure_basis: 'The absolute articulation difference.',
    sort_order: 110,
    sql: `
      SELECT ${EXC},
        abs(r.obligations_incurred + r.unobligated_balance - r.total_budgetary_resources) AS exposure,
        (r.obligations_incurred + r.unobligated_balance) AS observed,
        r.total_budgetary_resources AS expected,
        'Obligations plus unobligated balance is '
          || to_char(r.obligations_incurred + r.unobligated_balance, 'FM999,999,999,990.00')
          || ' against total budgetary resources of '
          || to_char(r.total_budgetary_resources, 'FM999,999,999,990.00') || '.' AS detail,
        json_build_object('obligations_incurred', r.obligations_incurred,
          'unobligated_balance', r.unobligated_balance,
          'total_budgetary_resources', r.total_budgetary_resources)::text AS evidence_json
        FROM dm_exec_resource r
       WHERE r.load_id = $1 AND r.scope = $2 AND r.fiscal_year = $3
         AND abs(r.obligations_incurred + r.unobligated_balance
                 - r.total_budgetary_resources) > 1`,
    populationSql: `
      SELECT count(*)::int AS population, COALESCE(sum(total_budgetary_resources),0) AS amount
        FROM dm_exec_resource WHERE load_id = $1 AND scope = $2 AND fiscal_year = $3`,
  },
  {
    code: 'SBR-P02',
    name: 'Period of availability is well formed',
    assertion: 'Rights and obligations (time)',
    risk: 'A period of availability that ends before it begins, or that begins after the year '
        + 'being reported, would make every time-based test above meaningless.',
    criterion: '31 U.S.C. 1301(c); OMB Circular A-11 Appendix F, Treasury Account Symbol '
        + 'availability.',
    method: 'Every account carrying a period of availability: end not before begin, and begin '
        + 'not after the reporting year.',
    severity: 'critical',
    exposure_basis: 'The budgetary resources on an account with an impossible availability.',
    sort_order: 120,
    sql: `
      SELECT ${EXC}, abs(r.total_budgetary_resources) AS exposure,
        r.epoa::numeric AS observed, r.bpoa::numeric AS expected,
        'Period of availability runs FY' || r.bpoa || ' to FY' || r.epoa
          || ' against a reporting year of FY' || r.fiscal_year || '.' AS detail,
        json_build_object('bpoa', r.bpoa, 'epoa', r.epoa,
          'fiscal_year', r.fiscal_year)::text AS evidence_json
        FROM dm_exec_resource r
       WHERE r.load_id = $1 AND r.scope = $2 AND r.fiscal_year = $3
         AND r.bpoa IS NOT NULL AND r.epoa IS NOT NULL
         AND (r.epoa < r.bpoa OR r.bpoa > r.fiscal_year)`,
    populationSql: `
      SELECT count(*)::int AS population, COALESCE(sum(total_budgetary_resources),0) AS amount
        FROM dm_exec_resource
       WHERE load_id = $1 AND scope = $2 AND fiscal_year = $3 AND bpoa IS NOT NULL`,
  },
  {
    code: 'SBR-P03',
    name: 'A missing period of availability means no-year and nothing else',
    assertion: 'Completeness of the testing attribute',
    risk: 'Every time-based test above depends on the period of availability. If a dated '
        + 'account were missing one, that account would drop silently out of the expired and '
        + 'cancelled-authority tests and the queue would look cleaner than the data is.',
    criterion: 'Control POA-01 on this site re-derives the period from the Treasury Account '
        + 'Symbol; OMB Circular A-11 Appendix F.',
    method: 'Every account with no period of availability must be no-year. Any dated fund life '
        + 'without one is an exception.',
    severity: 'critical',
    exposure_basis: 'Obligations on a dated account that cannot be tested for time.',
    sort_order: 130,
    sql: `
      SELECT ${EXC}, abs(r.obligations_incurred) AS exposure,
        NULL::numeric AS observed, NULL::numeric AS expected,
        'Fund life is ' || COALESCE(r.fund_life, 'unrecorded')
          || ' but the account carries no period of availability, so no time-based test '
          || 'can reach it.' AS detail,
        json_build_object('fund_life', r.fund_life, 'bpoa', r.bpoa, 'epoa', r.epoa,
          'obligations_incurred', r.obligations_incurred)::text AS evidence_json
        FROM dm_exec_resource r
       WHERE r.load_id = $1 AND r.scope = $2 AND r.fiscal_year = $3
         AND (r.bpoa IS NULL OR r.epoa IS NULL)
         AND COALESCE(r.fund_life, '') <> 'no-year'`,
    populationSql: `
      SELECT count(*)::int AS population, COALESCE(sum(obligations_incurred),0) AS amount
        FROM dm_exec_resource WHERE load_id = $1 AND scope = $2 AND fiscal_year = $3`,
  },
];

// ------------------------------------------------------------ not testable --
// Written, run against the real population, and withdrawn. Carried as rows so
// the page states the limitation rather than leaving the absence unexplained.
const NOT_TESTABLE = [
  {
    code: 'SBR-N01',
    name: 'Resource components foot to the account total',
    assertion: 'Completeness',
    risk: 'If the published resource components did not sum to the reported total, some source '
        + 'of authority would be missing from the account.',
    criterion: 'OMB Circular A-136 -- the resources section of the SBR is the sum of its '
        + 'components.',
    method: 'Not run. The seven resource components File A publishes were summed against the '
        + 'reported total for every account.',
    severity: 'informational',
    exposure_basis: 'Not applicable.',
    limitation: 'The test runs and fails on 363 of 943 FY2025 accounts by $227.4B, and the '
        + 'failure is a property of the published file rather than of the Department’s '
        + 'accounting. File A publishes the seven positive sources of authority and none of the '
        + 'deductions -- rescissions, permanently-not-available, recoveries and transfers -- so '
        + 'the components exceed the total on 231 accounts and fall short on 132. At Department '
        + 'scope the deductions net out and control SBR-02 passes within 0.5%, which is exactly '
        + 'why this looked testable at account grain and is not. Testing it would require the '
        + 'deduction lines, which are in the general ledger and not in this extract.',
    sort_order: 210,
  },
  {
    code: 'SBR-N02',
    name: 'Gross outlays do not exceed budgetary resources',
    assertion: 'Existence',
    risk: 'An account paying out more than it was given would be a funds-control failure.',
    criterion: 'OMB Circular A-136; 31 U.S.C. 1341.',
    method: 'Not run. Gross outlays were compared with total budgetary resources per account.',
    severity: 'informational',
    exposure_basis: 'Not applicable.',
    limitation: 'Outlays include payment against obligations incurred in PRIOR years, so an '
        + 'account settling a large brought-forward undelivered order legitimately outlays more '
        + 'than the resources it received this year. The test flags roughly a third of all '
        + 'accounts -- 331 of 943 in FY2025 -- and every one of them would have to be cleared by '
        + 'hand. The comparison is meaningful at Department scope, where control SBR-03 runs it '
        + 'and passes; at account grain it answers nothing.',
    sort_order: 220,
  },
  {
    code: 'SBR-N03',
    name: 'Every recorded obligation traces to the document that created it',
    assertion: 'Existence; rights and obligations',
    risk: 'This is the root cause the material weakness actually turns on: the obligation is '
        + 'recorded in the accounting system while the instrument that created it lives in a '
        + 'contract writing system, so the tri-annual review validates balances rather than the '
        + 'documents behind them, and a balance reviewed against itself always passes.',
    criterion: '31 U.S.C. 1501(a) -- an amount shall be recorded as an obligation only when '
        + 'supported by documentary evidence.',
    method: 'Not run. No published file reached by this site carries an obligating document '
        + 'reference on a Statement of Budgetary Resources line.',
    severity: 'informational',
    exposure_basis: 'Not applicable.',
    limitation: 'File A carries no document reference at all. The nearest reachable relationship '
        + 'is the award-to-account link in File C, which is a different population and is 3.1% '
        + 'complete in FY2025 (see /linkage). This is the one test that would answer the '
        + 'material weakness rather than describe it, and it needs the obligating-document '
        + 'population from the contract writing and accounting systems. Naming it is worth more '
        + 'than approximating it: it is the data requirement any remediation system for this '
        + 'weakness has to be built against.',
    sort_order: 230,
  },
];

module.exports = { TESTS, ASSURANCE, NOT_TESTABLE, SCOPE, caseKey };

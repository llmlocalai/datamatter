#!/usr/bin/env python3
"""
Builds database/seed_nfr.json - the NFR / material-weakness spine.

This is curated DOCUMENTARY data, so the "extract" is this file: every figure
below is transcribed from a named DoD OIG or GAO report and carries that report
as its citation. Never hand-edit the JSON. Edit here and re-run:

    python3 scripts/build_nfr_seed.py

Why it is a script rather than a hand-kept JSON: the transcription has to be
CHECKED, not asserted. The reports publish both a per-entity table and a
Department total, and a published total that its own component rows do not foot
to means the transcription is wrong. This script refuses to emit a year's entity
rows unless they foot exactly, which is how the FY2018 table was caught (its
rows are 4 short of the published 2,410 and are therefore not published here)
and how a fabricated set of FY2019 sub-allotted rows was caught during the read.

WHAT THIS DATA IS NOT. Individual NFRs are not public documents. The DoD OIG
publishes NFR COUNTS and material-weakness NARRATIVES; it does not publish the
notices. Nothing here is an extracted NFR. The 10-element audit-risk object is
built at MATERIAL WEAKNESS grain, which is the finest grain the public record
supports, and every element records whether it is `reported` (stated in the
cited source) or `derived` (an analytic reading of it).
"""
import json, sys, datetime

VINTAGE = '2026-09-12'

SRC = {
  2018: ('DoD OIG, "Understanding the Results of the Audit of the DoD FY 2018 Financial Statements" (January 2019)',
         'https://media.defense.gov/2019/Jan/08/2002077454/-1/-1/1/UNDERSTANDING%20THE%20RESULTS%20OF%20THE%20AUDIT%20OF%20THE%20DOD%20FY%202018%20FINANCIAL%20STATEMENTS.PDF'),
  2019: ('DoD OIG, "Understanding the Results of the Audit of the DoD FY 2019 Financial Statements" (January 2020)',
         'https://www.oversight.gov/sites/default/files/documents/reports/2020-01/Understanding%20the%20Results%20of%20the%20Audit%20of%20the%20DoD%20FY%202019%20Financial%20Statement.pdf'),
  2020: ('DoD OIG, "Understanding the Results of the Audit of the FY 2020 DoD Financial Statements" (February 2021)',
         'https://media.defense.gov/2021/Feb/25/2002588406/-1/-1/1/UNDERSTANDING%20RESULTS%20OF%20AUDIT%20OF%20FY%202020%20FINANCIAL%20STATEMENTS.PDF'),
  2021: ('DoD OIG, "Understanding the Results of the FY 2021 Audit" (June 2022)',
         'https://media.defense.gov/2022/Jun/01/2003009509/-1/-1/1/UNDERSTANDING%20THE%20RESULTS%20OF%20THE%20FY%202021%20AUDIT_FINAL.PDF'),
  2022: ('DoD OIG report DODIG-2023-070, "Understanding the Results of the Audit of the FY 2022 DoD Financial Statements"',
         'https://media.defense.gov/2023/May/17/2003224388/-1/-1/1/DODIG-2023-070.PDF'),
  2023: ('DoD OIG report DODIG-2024-114, "Understanding the Results of the Audit of the FY 2023 DoD Financial Statements"',
         'https://media.defense.gov/2024/Aug/12/2003521744/-1/-1/1/DODIG-2024-114.PDF'),
  2024: ('DoD OIG report DODIG-2025-074, "Part 1. Understanding the Results of the Audit of the FY 2024 DoD Financial Statements"',
         'https://media.defense.gov/2025/Mar/07/2003662906/-1/-1/1/DODIG-2025-074_SECURE.PDF'),
  2025: ('DoD OIG report DODIG-2026-032, independent auditor’s report on the FY2025 financial statements',
         'https://media.defense.gov/2025/Dec/19/2003847587/-1/-1/1/DODIG-2026-032.PDF'),
}
SRC_2024P2 = ('DoD OIG report DODIG-2025-112, "Part 2. Understanding the Results of the Audit of the FY 2024 DoD Financial Statements"', None)
SRC_GAO26 = ('GAO-26-109115, DOD Financial Management: Questions Associated with New Financial Audit Approach', None)

# ----------------------------------------------------------- the year spine --
# issued = reissued + new, for every year the reports state the split.
# FY2018 was the first Department-wide audit, so every notice was new and there
# was nothing to reissue; the count is an as-of date, not a year-end figure.
# FY2025's independent auditor's report does not publish NFR counts at all --
# the figures for that year come from GAO's oversight of the same audit and are
# labelled with GAO's own words, not restated as new/reissued.
YEARS = [
  dict(fiscal_year=2018, nfrs_closed=None, nfrs_reissued=0,    nfrs_new=2410, nfrs_issued=2410,
       mw_total=129, noncompliance_total=37, mw_agency_wide=20,
       note='Count is as of 30 November 2018. The first Department-wide audit, so no prior-year notices existed to reissue.'),
  dict(fiscal_year=2019, nfrs_closed=698,  nfrs_reissued=1897, nfrs_new=1575, nfrs_issued=3472,
       mw_total=152, noncompliance_total=46, mw_agency_wide=25, note=None),
  dict(fiscal_year=2020, nfrs_closed=857,  nfrs_reissued=2641, nfrs_new=918,  nfrs_issued=3559,
       mw_total=144, noncompliance_total=49, mw_agency_wide=26, note=None),
  dict(fiscal_year=2021, nfrs_closed=808,  nfrs_reissued=2678, nfrs_new=690,  nfrs_issued=3368,
       mw_total=166, noncompliance_total=51, mw_agency_wide=28, note=None),
  dict(fiscal_year=2022, nfrs_closed=633,  nfrs_reissued=2505, nfrs_new=479,  nfrs_issued=2984,
       mw_total=167, noncompliance_total=46, mw_agency_wide=28, note=None),
  dict(fiscal_year=2023, nfrs_closed=1045, nfrs_reissued=2644, nfrs_new=569,  nfrs_issued=3213,
       mw_total=169, noncompliance_total=42, mw_agency_wide=28,
       note='The report states 28 Agency-Wide material weaknesses and refers the roster to an appendix that is not in the released text, so no FY2023 roster rows are published here.'),
  dict(fiscal_year=2024, nfrs_closed=930,  nfrs_reissued=2297, nfrs_new=551,  nfrs_issued=2848,
       mw_total=151, noncompliance_total=None, mw_agency_wide=28,
       note='Part 1 publishes no non-compliance column. U.S. Special Operations Command has no row in the FY2024 entity table; the rows that are there foot to the published total, so this is an absence in the source rather than a dropped row.'),
  dict(fiscal_year=2025, nfrs_closed=1004, nfrs_reissued=None, nfrs_new=None, nfrs_issued=2473,
       mw_total=None, noncompliance_total=None, mw_agency_wide=26,
       note='DODIG-2026-032 publishes no NFR counts. Issued and closed are GAO’s figures for the FY2025 audit; GAO separately reports 2,972 NFRs open, a cumulative balance that is not comparable with the issued count.'),
]
for y in YEARS:
    y['opinion'] = 'Disclaimer of opinion'
    y['citation'], y['source_url'] = SRC[y['fiscal_year']]
    if y['fiscal_year'] == 2025:
        y['citation'] = SRC[2025][0] + '; ' + SRC_GAO26[0]

# ------------------------------------------------------- entity-level rows --
# (entity, material weaknesses, instances of non-compliance, NFRs)
# None = the year's table has no such column. FY2019 and FY2020 merge the
# General Fund and Working Capital Fund reporting entities for the NFR count
# while splitting them for material weaknesses, so those two years carry NFR
# counts only - a merged NFR count cannot be attributed to one of the two.
ENTITIES = {
 2019: [('Department of the Army', None, None, 443), ('Department of the Navy', None, None, 1020),
        ('Department of the Air Force', None, None, 468), ('U.S. Marine Corps', None, None, 169),
        ('U.S. Army Corps of Engineers', None, None, 87), ('Defense Health Program', None, None, 174),
        ('Defense Information Systems Agency', None, None, 43), ('Defense Logistics Agency', None, None, 476),
        ('U.S. Special Operations Command', None, None, 112), ('U.S. Transportation Command', None, None, 151),
        ('Defense Health Agency – Contract Resource Management', None, None, 12),
        ('Medicare-Eligible Retiree Health Care Fund', None, None, 15),
        ('Military Retirement Fund', None, None, 15), ('Agency-Wide', None, None, 287)],
 2020: [('Department of the Army', None, None, 505), ('Department of the Navy', None, None, 1160),
        ('Department of the Air Force', None, None, 521), ('U.S. Marine Corps', None, None, 151),
        ('U.S. Army Corps of Engineers', None, None, 57), ('Defense Health Program', None, None, 155),
        ('Defense Information Systems Agency', None, None, 69), ('Defense Logistics Agency', None, None, 457),
        ('U.S. Special Operations Command', None, None, 101), ('U.S. Transportation Command', None, None, 161),
        ('Defense Health Agency – Contract Resource Management', None, None, 13),
        ('Medicare-Eligible Retiree Health Care Fund', None, None, 14),
        ('Military Retirement Fund', None, None, 10), ('Agency-Wide', None, None, 185)],
 2021: [('Department of the Army', 27, 4, 445), ('Department of the Navy', 27, 4, 1121),
        ('Department of the Air Force', 19, 4, 476), ('U.S. Marine Corps', 8, 2, 194),
        ('U.S. Army Corps of Engineers', 6, 10, 56), ('Defense Health Program', 11, 5, 111),
        ('Defense Information Systems Agency', 8, 4, 67), ('Defense Logistics Agency', 20, 6, 445),
        ('U.S. Special Operations Command', 5, 2, 130), ('U.S. Transportation Command', 6, 2, 138),
        ('Defense Health Agency – Contract Resource Management', 0, 0, 11),
        ('Medicare-Eligible Retiree Health Care Fund', 1, 1, 15),
        ('Military Retirement Fund', 0, 0, 11), ('Agency-Wide', 28, 7, 148)],
 2022: [('Department of the Army', 29, 4, 486), ('Department of the Navy', 26, 4, 956),
        ('Department of the Air Force', 18, 4, 452),
        ('U.S. Army Corps of Engineers', 6, 10, 42), ('Defense Health Program', 10, 3, 105),
        ('Defense Information Systems Agency', 8, 3, 54), ('Defense Logistics Agency', 20, 6, 421),
        ('U.S. Special Operations Command', 5, 2, 131), ('U.S. Transportation Command', 16, 2, 145),
        ('Defense Health Agency – Contract Resource Management', 0, 0, 11),
        ('Medicare-Eligible Retiree Health Care Fund', 1, 1, 16),
        ('Military Retirement Fund', 0, 0, 12), ('Agency-Wide', 28, 7, 153)],
 2023: [('Department of the Army', 31, 4, 679), ('Department of the Navy', 23, 4, 945),
        ('Department of the Air Force', 17, 4, 441), ('U.S. Marine Corps', 7, 2, 84),
        ('U.S. Army Corps of Engineers', 4, 4, 51), ('Defense Health Program', 10, 3, 86),
        ('Defense Information Systems Agency', 6, 3, 49), ('Defense Logistics Agency', 21, 6, 432),
        ('U.S. Special Operations Command', 6, 2, 121), ('U.S. Transportation Command', 15, 2, 140),
        ('Defense Health Agency – Contract Resource Management', 0, 0, 10),
        ('Medicare-Eligible Retiree Health Care Fund', 1, 1, 15),
        ('Military Retirement Fund', 0, 0, 9), ('Agency-Wide', 28, 7, 151)],
 2024: [('Department of the Army', 29, None, 640), ('Department of the Navy', 22, None, 820),
        ('Department of the Air Force', 15, None, 450), ('U.S. Marine Corps', 7, None, 33),
        ('U.S. Army Corps of Engineers', 3, None, 36), ('Defense Health Program', 7, None, 64),
        ('Defense Information Systems Agency', 4, None, 36), ('Defense Logistics Agency', 20, None, 379),
        ('U.S. Transportation Command', 15, None, 144),
        ('Defense Health Agency – Contract Resource Management', 0, None, 6),
        ('Medicare-Eligible Retiree Health Care Fund', 1, None, 13),
        ('Military Retirement Fund', 0, None, 6), ('Agency-Wide', 28, None, 221)],
}
# FY2018 is deliberately absent: its entity rows sum to 2,243 against a published
# 2,410. The gap is the merged GF/WCF presentation and a DISA row the report
# marks "Delayed". A table that does not foot is not published at entity grain.

# ------------------------------------------------- the material-weakness roster
# Each year's roster as the report prints it, paired with a canonical key. The
# key is what makes persistence measurable: the Department renamed the systems
# weakness three times between FY2018 and FY2022 ("Financial Management Systems
# and Information Technology" -> "Legacy Systems" -> "Financial Management
# Systems Modernization") without the underlying condition changing, and a
# roster keyed on the printed label would report that as closures and new
# findings. The key is a judgement and is published as one; the printed label is
# always kept beside it so a reader can reject the pairing without distrusting
# the counts.
ROSTER = {
 2018: [('fin_systems_it','Financial Management Systems and Information Technology'),
        ('uot','Universe of Transactions'), ('compilation','Financial Statement Compilation'),
        ('fbwt','Fund Balance with Treasury'), ('ar','Accounts Receivable'),
        ('oms','Operating Material & Supplies'), ('inventory','Inventory and Related Property'),
        ('gpppe','General Property, Plant & Equipment'),
        ('gfp','Government Property in Possession of Contractors'),
        ('ap','Accounts Payable'), ('env','Environmental and Disposals Liabilities'),
        ('legal','Legal Contingencies'), ('begbal','Beginning Balances'),
        ('unsupported_adj','Journal Vouchers'), ('intragov','Intragovernmental Eliminations'),
        ('gross_costs','Statement of Net Costs'),
        ('recon_outlays','Reconciliation of Net Cost of Operations to Budget'),
        ('budgetary','Budgetary Resources'), ('elc','Entity Level Controls'),
        ('oversight_dod','Oversight and Monitoring')],
 2019: [('fin_systems_it','Financial Management Systems and Information Technology'),
        ('uot','Universe of Transactions'), ('fbwt','Fund Balance With Treasury'),
        ('suspense','Suspense Accounts'), ('inventory','Inventory and Related Property'),
        ('oms','Operating Materials & Supplies'), ('gpppe','General Property, Plant & Equipment'),
        ('realprop','Real Property'), ('gfp','Government Property in Possession of Contractors'),
        ('jsf','Joint Strike Fighter Program'), ('mhpi','Military Housing Privatization Initiative'),
        ('ap','Accounts Payable'), ('env','Environmental and Disposal Liabilities'),
        ('legal','Legal Contingencies'), ('begbal','Beginning Balances'),
        ('unsupported_adj','Unsupported Accounting Adjustments'),
        ('intragov','Intradepartmental Eliminations and Intragovernmental Transactions'),
        ('gross_costs','Gross Costs'), ('earned_rev','Earned Revenue'),
        ('recon_outlays','Reconciliation of Net Cost to Outlays'),
        ('budgetary','Budgetary Resources'), ('service_org','Service Providers'),
        ('elc','Entity-Level Controls'), ('oversight_dod','DoD-Wide Oversight and Monitoring'),
        ('oversight_comp','Component-Level Oversight and Monitoring')],
 2020: [('fin_systems_it','Legacy Systems'),
        ('config_security','Configuration Management and Security Management'),
        ('access','Access Controls'), ('sod','Segregation of Duties'),
        ('uot','Universe of Transactions'), ('fbwt','Fund Balance with Treasury'),
        ('suspense','Suspense Accounts'), ('inventory','Inventory and Related Property'),
        ('oms','Operating Material & Supplies'), ('gpppe','General Property, Plant & Equipment'),
        ('realprop','Real Property'), ('gfp','Government Property in Possession of Contractors'),
        ('jsf','Joint Strike Fighter Program'), ('mhpi','Military Housing Privatization Initiative'),
        ('ap','Accounts Payable'), ('env','Environmental and Disposal Liabilities'),
        ('begbal','Beginning Balances'), ('unsupported_adj','Unsupported Accounting Adjustments'),
        ('intragov','Intradepartmental Eliminations and Intragovernmental Transactions'),
        ('gross_costs','Gross Costs'), ('earned_rev','Earned Revenue'),
        ('budgetary','Budgetary Resources'), ('service_org','Service Providers'),
        ('elc','Entity-Level Controls'), ('oversight_dod','DoD-Wide Oversight and Monitoring'),
        ('oversight_comp','Component-Level Oversight and Monitoring')],
 2021: [('fin_systems_it','Legacy Systems'),
        ('config_security','Configuration Management and Security Management'),
        ('access','Access Controls'), ('sod','Segregation of Duties'),
        ('uot','Universe of Transactions'), ('compilation','Financial Statement Compilation'),
        ('fbwt','Fund Balance With Treasury'), ('suspense','Suspense Accounts'),
        ('inventory','Inventory and Stockpile Materials'),
        ('oms','Operating Materials and Supplies'),
        ('gpppe','General Property, Plant, and Equipment'), ('realprop','Real Property'),
        ('gfp','Government Property in the Possession of Contractors'),
        ('jsf','Joint Strike Fighter Program'), ('legal','Contingent Legal Liabilities'),
        ('ap','Accounts Payable'), ('env','Environmental and Disposal Liabilities'),
        ('begbal','Beginning Balances'), ('unsupported_adj','Unsupported Accounting Adjustments'),
        ('intragov','Intragovernmental Transactions and Intradepartmental Eliminations'),
        ('gross_costs','Gross Costs'), ('earned_rev','Earned Revenue'),
        ('recon_outlays','Reconciliation of Net Cost of Operations to Outlays'),
        ('budgetary','Budgetary Resources'), ('service_org','Service Organizations'),
        ('elc','Entity-Level Controls'), ('oversight_dod','DoD-Wide Oversight and Monitoring'),
        ('oversight_comp','Component-Level Oversight and Monitoring')],
 2022: [('fin_systems_it','Financial Management Systems Modernization'),
        ('config_security','Configuration Management and Security Management'),
        ('access','Access Controls'), ('sod','Segregation of Duties'),
        ('interface','Interface Controls'), ('uot','Universe of Transactions'),
        ('reporting_entity','Reporting Entity'), ('component_accounts','DoD Component-level Accounts'),
        ('fbwt','Fund Balance with Treasury'), ('inventory','Inventory and Stockpile Materials'),
        ('oms','Operating Materials and Supplies'),
        ('gpppe','General Property, Plant, and Equipment'), ('realprop','Real Property'),
        ('gfp','Government Property in the Possession of Contractors'),
        ('jsf','Joint Strike Fighter Program'), ('ap','Accounts Payable'),
        ('env','Environmental and Disposal Liabilities'), ('legal','Contingent Legal Liabilities'),
        ('begbal','Beginning Balances'), ('unsupported_adj','Unsupported Accounting Adjustments'),
        ('intragov','Intragovernmental Transactions and Intradepartmental Eliminations'),
        ('gross_costs','Gross Costs'), ('earned_rev','Earned Revenue'),
        ('recon_outlays','Reconciliation of Net Cost of Operations to Outlays'),
        ('budgetary','Budgetary Resources'), ('service_org','Service Organizations'),
        ('elc','Component Entity-level Controls'),
        ('oversight_dod','DoD-Wide Oversight and Monitoring')],
 # FY2023 has no roster here by design. DODIG-2024-114 states 28 Agency-Wide
 # material weaknesses and refers the roster to an appendix that is not in the
 # released text. A count without its roster is published as a count.
 2024: [('service_org','Service Organizations'), ('elc','Component Entity-Level Controls'),
        ('oversight_dod','DoD-Wide Oversight and Monitoring'), ('leases','Leases'),
        ('inventory','Inventory and Stockpile Materials'),
        ('oms','Operating Materials and Supplies'),
        ('gpppe','General Property, Plant, and Equipment'), ('realprop','Real Property'),
        ('gfp','Government Property in the Possession of Contractors'),
        ('jsf','Joint Strike Fighter Program'),
        ('access','Access Controls'), ('sod','Segregation of Duties'),
        ('interface','Interface Controls'),
        ('fin_systems_it','Financial Management Systems Modernization'),
        ('config_mgmt','Configuration Management'), ('security_mgmt','Security Management'),
        ('begbal','Beginning Balances'), ('unsupported_adj','Unsupported Accounting Adjustments'),
        ('intragov','Intragovernmental Transactions and Intradepartmental Eliminations'),
        ('ap','Accounts Payable'), ('gross_costs','Gross Costs'),
        ('budgetary','Budgetary Resources'), ('earned_rev','Earned Revenue'),
        ('recon_outlays','Reconciliation of Net Cost of Operations to Outlays'),
        ('uot','Universe of Transactions'), ('security_assistance','Security Assistance Accounts'),
        ('fbwt','Fund Balance with Treasury'), ('env','Environmental and Disposal Liabilities')],
 2025: [('fin_systems_it','Financial Management Systems Modernization'),
        ('config_mgmt','Configuration Management'), ('security_mgmt','Security Management'),
        ('access','Access Controls'), ('sod','Segregation of Duties'),
        ('interface','Interface Controls'), ('uot','Universe of Transactions'),
        ('fbwt','Fund Balance with Treasury'), ('inventory','Inventory and Stockpile Materials'),
        ('oms','Operating Materials and Supplies'),
        ('gpppe','General Property, Plant, and Equipment'), ('realprop','Real Property'),
        ('gfp','Government Property in the Possession of Contractors'),
        ('jsf','Joint Strike Fighter Program'), ('ap','Accounts Payable'),
        ('env','Environmental and Disposal Liabilities'), ('leases','Leases'),
        ('unsupported_adj','Unsupported Accounting Adjustments'),
        ('intragov','Intragovernmental Transactions and Intradepartmental Eliminations'),
        ('gross_costs','Gross Costs'), ('earned_rev','Earned Revenue'),
        ('recon_outlays','Reconciliation of Net Cost of Operations to Outlays'),
        ('budgetary','Budgetary Resources'), ('service_org','Service Organizations'),
        ('elc','Component Entity-Level Controls'),
        ('oversight_dod','DoD-Wide Oversight and Monitoring')],
}
ROSTER_CITE = {y: SRC[y][0] for y in ROSTER}
# The FY2024 roster is printed in Part 2, not in the Part 1 report that carries
# the counts, so the roster rows cite Part 2 and the count rows cite Part 1.
ROSTER_CITE[2024] = SRC_2024P2[0]

# Grouping used by the FY2024 report, kept because it is the Department's own
# way of saying which weaknesses it considers one problem.
OBSTACLE = {
  'service_org':'Management responsibility and accountability','elc':'Management responsibility and accountability',
  'oversight_dod':'Management responsibility and accountability','leases':'Management responsibility and accountability',
  'inventory':'Management responsibility and accountability','oms':'Management responsibility and accountability',
  'gpppe':'Management responsibility and accountability','realprop':'Management responsibility and accountability',
  'gfp':'Management responsibility and accountability','jsf':'Management responsibility and accountability',
  'access':'Information technology','sod':'Information technology','interface':'Information technology',
  'fin_systems_it':'Information technology','config_mgmt':'Information technology',
  'security_mgmt':'Information technology','config_security':'Information technology',
  'begbal':'Accounting','unsupported_adj':'Accounting','intragov':'Accounting','ap':'Accounting',
  'gross_costs':'Accounting','budgetary':'Accounting','earned_rev':'Accounting',
  'recon_outlays':'Accounting','uot':'Accounting','security_assistance':'Accounting',
  'fbwt':'Accounting','env':'Accounting','compilation':'Accounting','ar':'Accounting',
  'legal':'Accounting','suspense':'Accounting','mhpi':'Management responsibility and accountability',
  'reporting_entity':'Accounting','component_accounts':'Accounting',
  'oversight_comp':'Management responsibility and accountability',
}

# ------------------------------------------- the ten-element audit-risk object
# WHAT IS REPORTED AND WHAT IS READ. The material-weakness LABEL and its
# presence in a year's roster are reported - they are printed in the cited
# report. The object built around each label is a structured READING of that
# report's narrative, and every element says which it is. Nothing here is an
# extracted NFR: the notices themselves are not public documents.
#
# Element 10 (outcome) is not written here at all. It is COMPUTED from the
# roster above - first year present, last year present, whether the label was
# carried into FY2025 - because an outcome asserted beside the evidence it is
# supposed to summarise is a restatement with a verdict printed on it.
#
# coverage: what the SOURCES ON THIS SITE could test, not what DoD could test.
#   testable - a control on this site already tests an assertion of this kind
#   partial  - the sources reach part of the relationship, with a named loss
#   absent   - no published file on this site carries either side of it
R, D = 'reported', 'derived'

OBJECT = {
 'fin_systems_it': dict(
  label='Financial Management Systems Modernization',
  account=('Pervasive. The systems environment underlies every line of both the balance sheet and the Statement of Budgetary Resources rather than one account.', D),
  assertion=('All assertions. A general-ledger system that cannot be relied on gives no assurance over existence, completeness, valuation or cutoff for anything posted through it.', D),
  risk=('Balances are produced by systems that cannot demonstrate the transactions behind them, so a misstatement of any size can arise anywhere and remain undetected.', D),
  control=('A compliant core financial system posting to the USSGL at transaction level, with the feeder systems retired or interfaced under control.', D),
  failure=('The Department continues to operate a large population of legacy and non-compliant systems, and modernisation programmes have not retired them on the schedules set.', D),
  root_cause=('Not "old software". The cause is that system retirement is funded and governed by the Component that owns the system while the audit consequence lands on the Department, so no single budget holder bears the cost of the break they are creating. A replacement system inherits the same feeders and the same weakness follows it.', D),
  exposure=('Not published at this grain. The FY2025 auditors report scope limitations touching 43% of total assets and 64% of budgetary resources, which bounds the systems environment rather than isolating it.', R),
  evidence=('Auditors tested system compliance and the completeness of the system inventory, and continued to report the weakness rather than accept modernisation plans as remediation.', D),
  remediation=('Modernisation programmes across the Components, tracked through corrective action plans; subsequent audits have not demonstrated the fix, since the weakness has been reissued every year since FY2018.', D),
  relationship='Every posted transaction should originate in a system that is in the audited inventory and posts to the USSGL.',
  data_required='System inventory, USSGL posting logic per system, transaction volume by system.',
  coverage='absent',
  coverage_note='No published execution file names the system a transaction came from. File A, File B and File C carry Treasury accounting elements, not source-system identifiers.'),

 'config_mgmt': dict(
  label='Configuration Management',
  account=('Pervasive, through the reliability of every system-generated balance and report.', D),
  assertion=('Existence and completeness of system-generated data; the integrity of automated controls relied on in testing.', D),
  risk=('An unauthorised or untested change alters posting logic or a report, and the balance changes without a transaction.', D),
  control=('Change control: documented request, test, approval and migration, with production access separated from development.', D),
  failure=('Changes reached production without documented testing or approval, and change populations could not always be produced for testing.', D),
  root_cause=('The change population itself is not reliably captured. Where the change log is generated by the same system being changed, and the log can be edited by those who make the changes, there is no evidence that survives the control failing.', D),
  exposure=('Not published at this grain.', D),
  evidence=('Auditors requested change populations and tested samples for approval and testing evidence; incomplete populations are reported as scope limitations rather than exceptions.', D),
  remediation=('Component-level change management corrective action plans. Reissued each year.', D),
  relationship='Every production change should have an approved, tested request that predates it.',
  data_required='Change request records, migration logs, production deployment timestamps.',
  coverage='absent',
  coverage_note='IT general control evidence is internal to the systems and appears in no published financial file.'),

 'security_mgmt': dict(
  label='Security Management',
  account=('Pervasive.', D),
  assertion=('The integrity of all system-generated financial data.', D),
  risk=('Weak security management allows undetected alteration of financial data or of the records that would evidence it.', D),
  control=('A managed security programme: risk assessment, monitoring, incident response, and accountability for remediation of known vulnerabilities.', D),
  failure=('Known vulnerabilities and security control deficiencies remained open past their remediation dates across financially relevant systems.', D),
  root_cause=('Security remediation is prioritised on operational risk, not on financial-reporting relevance, so a vulnerability in a system that feeds the general ledger competes for attention against one that does not and generally loses.', D),
  exposure=('Not published at this grain.', D),
  evidence=('Auditors tested security programme documentation and open vulnerability tracking against remediation commitments.', D),
  remediation=('Component security programmes; reissued each year and, in FY2025, separated from Configuration Management into its own weakness.', D),
  relationship='A financially relevant system should carry no vulnerability past its remediation date.',
  data_required='System inventory flagged for financial relevance, vulnerability register with dates.',
  coverage='absent',
  coverage_note='Not carried in any published financial file.'),

 'access': dict(
  label='Access Controls',
  account=('Pervasive, with the sharpest effect on disbursement and journal-entry activity.', D),
  assertion=('Existence and rights/obligations: whether a recorded transaction was authorised by someone entitled to record it.', D),
  risk=('An unauthorised user records or approves a transaction, so an obligation, payment or adjustment exists in the ledger without a valid business event behind it.', D),
  control=('Provisioning on documented approval, periodic recertification, prompt removal on separation, and privileged access restricted and monitored.', D),
  failure=('Users retained access after separation or role change, recertifications were incomplete or undocumented, and privileged accounts exceeded need.', D),
  root_cause=('Identity is not held once. The same person exists as several unreconciled identities across the personnel system, the access management system and each financial system, so "remove on separation" has no single list to act against and recertification is reviewing a population that is already wrong.', D),
  exposure=('Not published at this grain.', D),
  evidence=('Auditors reconciled user listings to personnel records and tested provisioning and removal samples; user listings that could not be shown complete were reported as scope limitations.', D),
  remediation=('Recertification campaigns and access management tooling; reissued every year since FY2020, when it was first separated out of the general systems weakness.', D),
  relationship='Every user with access to a financial system should have a current, approved need, and every separation should close every account within the policy window.',
  data_required='Personnel separation records, per-system user listings, provisioning approvals.',
  coverage='absent',
  coverage_note='Identity and access data are internal. No published execution file names who recorded a transaction.'),

 'sod': dict(
  label='Segregation of Duties',
  account=('Disbursements, accounts payable, journal entries, and the obligation approval chain.', D),
  assertion=('Existence and rights/obligations; in the fraud dimension, the completeness of what is recorded.', D),
  risk=('One person initiates and approves the same transaction, so a fictitious or improper obligation or payment can be created and concealed without a second party.', D),
  control=('Conflicting capabilities are not held by the same user, enforced in role design and monitored in the system.', D),
  failure=('Conflicting roles were assigned, and compensating detective controls over the conflicts were not consistently performed or evidenced.', D),
  root_cause=('Role design is inherited from the system implementation and never re-derived from the business process, so the conflict matrix describes roles as the vendor shipped them rather than duties as the Department performs them. Small Components then have fewer people than the matrix requires, and the conflict is granted rather than mitigated.', D),
  exposure=('Not published at this grain. GAO has separately reported that the Department has not assessed fraud risk across its financial activity to a standard that would size this.', D),
  evidence=('Auditors tested role assignments against conflict matrices and requested evidence of compensating review where conflicts were accepted.', D),
  remediation=('Role redesign and conflict remediation at Component level; reissued every year since FY2020.', D),
  relationship='No user should hold both sides of an initiate-and-approve pair; where one does, a documented compensating review should exist for every transaction they touched.',
  data_required='Role-to-capability mapping, user-to-role assignment, transaction-level actor and approver.',
  coverage='absent',
  coverage_note='No published file carries an actor or approver on a transaction.'),

 'interface': dict(
  label='Interface Controls',
  account=('Every account fed from a subsidiary system: accounts payable, inventory, property, payroll, and budgetary execution.', D),
  assertion=('Completeness above all, then valuation and cutoff. An interface that drops records understates; one that duplicates overstates.', D),
  risk=('Transactions are lost, duplicated or altered between a feeder system and the general ledger, so the ledger and the subsidiary record disagree and neither can be shown right.', D),
  control=('Automated reconciliation of record counts and values across each interface, with a suspense mechanism that is worked and cleared, and exception reporting that is reviewed.', D),
  failure=('Interface reconciliations were not performed, not evidenced, or not cleared, and error and suspense populations were not resolved within policy.', D),
  root_cause=('The interface is treated as a transport problem rather than an accounting one. Nobody owns the identity of a record across the boundary, so there is no key on which a reconciliation could be run, and the "reconciliation" that is performed compares totals that both sides derive from the same side of the interface.', D),
  exposure=('Not published at this grain.', D),
  evidence=('Auditors requested interface reconciliations and suspense ageing, and tested whether differences were identified and resolved.', D),
  remediation=('Interface reconciliation controls in Component corrective action plans; first named as its own weakness in FY2022 and reissued since.', D),
  relationship='Every record that leaves a feeder system should arrive in the ledger exactly once, at the same value, in the same period.',
  data_required='Record counts and control totals on both sides of each interface, keyed on a shared transaction identifier.',
  coverage='partial',
  coverage_note='This site cannot see an internal interface, but it measures the same failure shape between two published files: File A and File B are two reports of the same obligations and disagree in FY2022 and FY2026 (control TIE-01, deliberately non-blocking because the disagreement is real). And File C, the one file that joins an award to an account, holds no row at all for 95 of 171 accounts covering $430.3B. Those are interface losses in the published chain, not inside a Component system.'),

 'uot': dict(
  label='Universe of Transactions',
  account=('All. The universe is the population every other test is drawn from.', D),
  assertion=('Completeness, first and last. If the population cannot be shown complete, no sample drawn from it supports a conclusion about the balance.', D),
  risk=('Auditors cannot obtain a complete, reliable population of transactions supporting a reported balance, so the balance is unauditable regardless of whether it is right.', D),
  control=('A transaction-level record that reconciles to the reported balance and can be produced on demand, with the reconciliation between detail and balance performed and evidenced.', D),
  failure=('Components could not produce populations that reconciled to the reported balances, and the detail supporting reported figures was incomplete or unavailable.', D),
  root_cause=('The reported balance is compiled from summary-level submissions, not aggregated from detail. Once a balance is assembled by adding reported summaries, there is no detail to produce, and building the detail afterwards is reconstruction rather than support. This is why the weakness persists through system changes that were expected to close it.', D),
  exposure=('Not published at this grain. The FY2025 scope limitations touch 43% of total assets and 64% of budgetary resources.', R),
  evidence=('Auditors requested transaction-level populations and reconciliations to reported balances; failure to produce them is the scope limitation that drives the disclaimer.', D),
  remediation=('Universe-of-transactions initiatives in Component plans and in the Advana data environment; reissued every year since FY2018.', D),
  relationship='The sum of the transaction detail should equal the reported balance, for every balance, on demand.',
  data_required='Transaction-level detail keyed to the reported balance, with a reconciliation to it.',
  coverage='partial',
  coverage_note='This site measures a completeness ratio of exactly this shape and publishes it on /linkage: the share of obligations that can be traced from account to award through File C falls from 18.2% in FY2021 to 3.1% in FY2025. That is linkage completeness in the published files, not an error estimate - a dollar absent from File C is not a dollar that was not obligated.'),

 'fbwt': dict(
  label='Fund Balance with Treasury',
  account=('Fund Balance with Treasury - the Department’s largest asset and the account every disbursement passes through.', D),
  assertion=('Existence and completeness. FBwT is the government’s cash equivalent, so a difference against Treasury is either a missing transaction or a false one.', D),
  risk=('The Department’s recorded fund balance differs from Treasury’s record of it and the difference cannot be explained transaction by transaction.', D),
  control=('Monthly reconciliation of the Component’s FBwT to Treasury records at transaction level, with differences aged, researched and cleared, and suspense balances resolved.', D),
  failure=('Reconciliations were not performed at the required level, differences were cleared by adjustment rather than by research, and suspense and unmatched balances aged past policy.', D),
  root_cause=('The reconciliation is performed where the data is, not where the transaction is. Treasury reports by Treasury Account Symbol, the Component records by its own accounting classification, and no field survives both ends intact, so the reconciliation is done at summary level and the residual is written off to suspense. The adjustment that clears the difference is itself the unsupported accounting adjustment reported as a separate weakness.', D),
  exposure=('Not published at this grain. FBwT is the largest single balance on the Department’s balance sheet.', D),
  evidence=('Auditors tested reconciliations against Treasury data, aged suspense, and traced clearing adjustments to support.', D),
  remediation=('Reconciliation tooling and suspense clearance campaigns; reissued every year since FY2018.', D),
  relationship='For each Treasury Account Symbol and month, the Component’s recorded fund balance should equal Treasury’s, and every difference should resolve to a named transaction.',
  data_required='Treasury CARS/GTAS records and Component FBwT detail, keyed on TAS and period.',
  coverage='absent',
  coverage_note='File A carries Treasury account symbols and budgetary amounts but no fund-balance position and nothing from the Treasury side, so neither half of the reconciliation is present.'),

 'inventory': dict(
  label='Inventory and Stockpile Materials',
  account=('Inventory, and stockpile materials held for national defence.', D),
  assertion=('Existence, completeness and valuation. The item has to be there, all items have to be counted, and each has to be held at a supportable cost.', D),
  risk=('Recorded inventory does not exist, held inventory is unrecorded, or recorded quantities are valued on a basis that cannot be supported.', D),
  control=('Physical inventory counts on a cycle, reconciliation of counts to the accountable property record and to the general ledger, and a valuation method supported by source cost documents.', D),
  failure=('Counts were not performed or not reconciled, accountable records disagreed with the ledger, and valuation relied on estimates with no traceable acquisition cost.', D),
  root_cause=('The accountable property system was built to answer a logistics question - can the part be found and issued - and was never required to carry acquisition cost. Valuation is therefore derived after the fact from standard prices rather than from what was paid, and no amount of counting fixes a number whose cost basis was never captured at receipt.', D),
  exposure=('Not published at this grain; inventory and related property are among the balances covered by the FY2025 scope limitation over 43% of total assets.', R),
  evidence=('Auditors observed counts, traced items from floor to record and record to floor, and tested valuation to source documents.', D),
  remediation=('Count programmes and valuation remediation in Component plans; reissued every year since FY2018.', D),
  relationship='Every item on the floor should be in the record at a cost traceable to what was paid for it.',
  data_required='Accountable property records, count results, acquisition cost documents.',
  coverage='absent',
  coverage_note='This site holds budgetary execution, not proprietary balances. No published file here carries an inventory quantity or an item cost.'),

 'oms': dict(
  label='Operating Materials and Supplies',
  account=('Operating materials and supplies.', D),
  assertion=('Existence, completeness and valuation.', D),
  risk=('Consumable materiel held across a very large number of locations is recorded at quantities and values that cannot be substantiated.', D),
  control=('Counts reconciled to accountable records and the ledger, with a consumption method applied consistently and supported.', D),
  failure=('Records did not agree to counts, and the basis on which materiel was expensed on consumption could not be evidenced.', D),
  root_cause=('The same cause as inventory - cost was never captured at receipt - compounded by a population spread across thousands of custody points whose records are kept in systems that do not post to the ledger at all.', D),
  exposure=('Not published at this grain.', D),
  evidence=('Counts, record-to-floor and floor-to-record testing, and consumption method testing.', D),
  remediation=('Component count and record remediation; reissued every year since FY2018.', D),
  relationship='Materiel on hand should equal the record, and materiel consumed should have left the record in the period it was consumed.',
  data_required='Accountable records by custody point, count results, consumption postings.',
  coverage='absent',
  coverage_note='Proprietary balance; not carried in the execution files on this site.'),

 'gpppe': dict(
  label='General Property, Plant, and Equipment',
  account=('General property, plant and equipment, and the accumulated depreciation against it.', D),
  assertion=('Existence, completeness, valuation and rights.', D),
  risk=('Capital assets are recorded at values with no traceable acquisition cost, or exist without being recorded, so both the asset and the depreciation charged against it are wrong.', D),
  control=('A complete accountable property record reconciled to the ledger, with acquisition cost supported by contract and payment documents and depreciation computed from a supportable in-service date.', D),
  failure=('Acquisition cost documentation could not be produced for assets acquired in prior decades, and property records did not reconcile to the ledger.', D),
  root_cause=('The asset outlives the record of what was paid for it. A ship or a facility acquired thirty years ago was paid for through a contract file and a disbursement record whose retention period expired long before the balance had to be audited, so the cost basis is unrecoverable rather than merely missing. Remediation by estimate changes the basis; it does not produce the evidence.', D),
  exposure=('Not published at this grain; within the FY2025 scope limitation over 43% of total assets.', R),
  evidence=('Auditors traced assets to acquisition documents and to the ledger, and tested existence in both directions.', D),
  remediation=('Deemed-cost and estimation methodologies applied under SFFAS 50, plus record remediation; reissued every year since FY2018.', D),
  relationship='Every capitalised asset should trace to a contract and a disbursement that establishes its cost and its in-service date.',
  data_required='Accountable property records, acquisition contracts, disbursement records, in-service dates.',
  coverage='absent',
  coverage_note='FPDS on this site carries contract actions from FY2008 onward, which does not reach the acquisition of assets still on the books from earlier decades, and it carries no asset identifier to join on.'),

 'realprop': dict(
  label='Real Property',
  account=('Real property: land, buildings and structures.', D),
  assertion=('Existence, completeness, valuation and rights.', D),
  risk=('The real property record does not reflect what the Department holds, and recorded values rest on estimates rather than cost.', D),
  control=('A complete real property inventory reconciled to the ledger and to the installation record, with acquisition and improvement cost supported.', D),
  failure=('Assets were found that were not recorded and recorded assets could not be located; improvement costs were not consistently capitalised.', D),
  root_cause=('Two records serve two masters. The installation management record exists to manage space and the financial record exists to report a balance, they are maintained by different organisations on different keys, and neither is authoritative for the other. Nothing forces them to agree, so they do not.', D),
  exposure=('Not published at this grain.', D),
  evidence=('Site visits, existence and completeness testing in both directions, and cost tracing.', D),
  remediation=('Real property inventory reconciliation; reissued every year since FY2019.', D),
  relationship='Every structure on an installation should appear once in the financial record at a supportable cost.',
  data_required='Real property inventory, installation records, construction and improvement cost.',
  coverage='absent',
  coverage_note='Military construction appears on this site only as budget authority in the -1 exhibits and obligations in File A, never as an asset record.'),

 'gfp': dict(
  label='Government Property in the Possession of Contractors',
  account=('Inventory, operating materials and supplies, and general PP&E held by contractors rather than by the Department.', D),
  assertion=('Existence, completeness and rights. The Department owns property it does not hold.', D),
  risk=('Government property held by contractors is unrecorded or misstated, because the record depends on a party outside the Department’s systems.', D),
  control=('Contract terms requiring property reporting, a Department record of property furnished and acquired under contract, and reconciliation of contractor reports to that record.', D),
  failure=('The Department could not produce a complete population of government property held by contractors, and contractor reporting was incomplete and unreconciled.', D),
  root_cause=('The obligation to report sits in the contract, and the contract is administered by an acquisition organisation that has no reporting line into financial reporting. Nobody in the accounting chain is a party to the instrument that would compel the data, so the population cannot be assembled from inside the Department at all.', D),
  exposure=('Not published at this grain; among the balances behind the FY2025 scope limitation.', R),
  evidence=('Auditors attempted to establish the population from contract terms and contractor submissions and reported the inability to do so as a scope limitation.', D),
  remediation=('Property clause compliance and contractor reporting initiatives; reissued every year since FY2018.', D),
  relationship='Every contract with a property clause should have a current contractor property report, and those reports should reconcile to the recorded balance.',
  data_required='Contracts carrying property clauses, contractor property reports, the Department’s property record.',
  coverage='partial',
  coverage_note='FPDS on this site identifies contract actions and their values but carries no property clause indicator and no property report, so it can bound which contracts might carry the obligation and nothing further. That bound is a starting population, not a test.'),

 'jsf': dict(
  label='Joint Strike Fighter Program',
  account=('Operating materials and supplies, general PP&E, and accounts payable arising from the F-35 programme.', D),
  assertion=('Existence, completeness and valuation of programme property; cutoff on programme payables.', D),
  risk=('The Department cannot account for the property in a programme of this size, and the accountability gaps sit with the prime contractor as much as with the Department.', D),
  control=('Programme property accountability, a complete record of what was furnished and acquired, and reconciliation to the contractor’s record.', D),
  failure=('Programme property records were incomplete and did not reconcile; the weakness has been named separately from general contractor property since FY2019 precisely because its size made it individually material.', D),
  root_cause=('The programme was structured so that the contractor holds the authoritative record of the asset, and the Department’s financial record is a downstream copy. A copy cannot be audited to a source the auditor cannot reach, and the acquisition strategy that produced that arrangement predates the audit requirement by a decade.', D),
  exposure=('Not published at this grain. The Navy’s aircraft procurement account 017-1506, which carries the F-35C airframes, reports $11.93B of FY2025 obligations in File A on this site.', D),
  evidence=('Auditors tested programme property records against contractor records and reported the inability to establish the population. DoD OIG has separately reported recurring F-35 deficiencies across contract oversight, inventory management and financial reporting (DODIG-2026-061).', R),
  remediation=('Programme property accountability initiatives; reissued every year since FY2019.', D),
  relationship='Every asset acquired under the programme should be in a Department record that reconciles to the contractor’s.',
  data_required='Programme property records, contractor property reports, contract line detail.',
  coverage='partial',
  coverage_note='This site already follows this programme as far as the public chain goes, on /program and /traceability: P-1 line 0147 names the system, account 017-1506 carries $11.93B of obligations in File A, File B adds object class and activity, and File C - the only file that joins an award to an account - holds zero rows for this account. The chain breaks one step before the contract, which is one step before the property.'),

 'ap': dict(
  label='Accounts Payable',
  account=('Accounts payable, and the expense or asset recorded against it.', D),
  assertion=('Completeness and cutoff above all: an unrecorded payable understates liabilities and the cost of the period it belongs to. Then existence and valuation.', D),
  risk=('Goods and services received are not recorded as payable in the period of receipt, so liabilities and costs are understated and the balance cannot be reconciled to what was actually received.', D),
  control=('Three-way match at transaction level - obligation, receipt, invoice - with an accrual for receipts not yet invoiced, and reconciliation of the subsidiary payable record to the general ledger.', D),
  failure=('Payable balances did not reconcile to supporting detail; receipt data did not consistently reach the accounting system; and accruals were estimated at summary level rather than built from receipt records.', D),
  root_cause=('Receipt is recorded in an acceptance system and payable is recorded in an accounting system, and the two do not share a transaction identifier. The "reconciliation" is therefore an estimate built from the payable side alone, which cannot by construction detect a receipt that never arrived. The failure is the missing key, not the missing report.', D),
  exposure=('Not published at this grain.', D),
  evidence=('Auditors tested payables to supporting receipt and invoice documents, performed search-for-unrecorded-liabilities procedures over post-year-end disbursements, and tested the accrual methodology.', D),
  remediation=('Accrual methodology and receipt interface remediation in Component plans; reissued every year since FY2018.', D),
  relationship='Every valid receipt should have a corresponding accounts payable treatment within a defined window, and every payable should trace to a receipt.',
  data_required='Receiving and acceptance transactions, accounts payable subledger, disbursement records, all keyed on a shared transaction identifier.',
  coverage='absent',
  coverage_note='No published file on this site carries either side. The nearest public analogue is the obligation-to-award link in File C, which is one relationship upstream and is itself only 3.1% complete in FY2025. Naming the relationship is still worth doing: it is the data requirement a remediation system would have to be built against, and it is the reason an "AP anomaly detector" trained on the payable side alone would be detecting anomalies in the half of the relationship that is present.'),

 'env': dict(
  label='Environmental and Disposal Liabilities',
  account=('Environmental and disposal liabilities, and the expense recognised against them.', D),
  assertion=('Completeness and valuation. The estimate has to cover every site and rest on a supportable basis.', D),
  risk=('The liability for cleanup and disposal is estimated from an incomplete inventory of sites and assets, on assumptions that cannot be supported.', D),
  control=('A complete inventory of sites and assets requiring cleanup or disposal, with cost estimates built on a documented, reviewed methodology.', D),
  failure=('Site and asset inventories were incomplete and estimation methodologies and their inputs could not be evidenced.', D),
  root_cause=('The liability is a function of the property record, and the property record is the weakness reported separately. An estimate cannot be more complete than the population it is computed over, so this weakness cannot close before real property and general PP&E do.', D),
  exposure=('Not published at this grain; among the largest estimated liabilities on the Department’s balance sheet.', D),
  evidence=('Auditors tested the site inventory for completeness and the estimation model for support and consistent application.', D),
  remediation=('Estimation methodology and site inventory work; reissued every year since FY2018.', D),
  relationship='Every site or asset with a cleanup obligation should be in the inventory the estimate is computed over.',
  data_required='Site and asset inventory, cost estimation model and inputs.',
  coverage='absent',
  coverage_note='Environmental restoration appears on this site as appropriation and obligation, never as a liability estimate.'),

 'leases': dict(
  label='Leases',
  account=('Lease assets and lease liabilities under SFFAS 54.', D),
  assertion=('Completeness, valuation and classification.', D),
  risk=('Lease arrangements are not identified, so the right-of-use asset and the corresponding liability are omitted or misclassified.', D),
  control=('A complete population of arrangements assessed against the lease definition, with terms captured and measured under the standard.', D),
  failure=('The Department could not demonstrate a complete population of lease arrangements on adoption.', D),
  root_cause=('A lease is identified by the substance of an arrangement, not by a document type, and the arrangements live in contracting, real property and inter-service agreements rather than in one register. Adopting a new standard did not create the register the standard assumes.', D),
  exposure=('Not published at this grain.', D),
  evidence=('Auditors tested the completeness of the arrangement population and the measurement of identified leases.', D),
  remediation=('Lease population identification following SFFAS 54 adoption; first reported as a material weakness in FY2024.', D),
  relationship='Every arrangement conveying the right to control an asset for a period should be assessed and, where it qualifies, recognised.',
  data_required='Contracts, real property agreements, inter-service support agreements.',
  coverage='absent',
  coverage_note='FPDS on this site carries contract actions but no lease classification and no arrangement terms.'),

 'unsupported_adj': dict(
  label='Unsupported Accounting Adjustments',
  account=('All. An unsupported adjustment can be posted to any line.', D),
  assertion=('Existence and valuation, and rights/obligations for the balance the adjustment moves.', D),
  risk=('Reported balances are set by journal entries that have no transaction behind them, so the statement is compiled rather than accumulated.', D),
  control=('Every journal entry carries an approved, documented business reason and supporting evidence, with entries to force agreement prohibited and monitored.', D),
  failure=('Material adjustments were posted without support, including entries whose only purpose was to make a balance agree.', D),
  root_cause=('The adjustment is the outlet for every other weakness. When the interface drops records, the Treasury reconciliation will not clear or the subsidiary ledger does not agree, the statement still has to be produced by the deadline, and an unsupported entry is what makes it foot. Prohibiting the entry without repairing the upstream break moves the failure rather than removing it - which is why this weakness has been reissued every year since FY2018 under two different names.', D),
  exposure=('Not published at this grain.', D),
  evidence=('Auditors selected journal entries and traced them to support, and tested for entries with the characteristics of forcing adjustments.', D),
  remediation=('Journal entry controls and support requirements; reported as "Journal Vouchers" in FY2018 and under the current name since FY2019.', D),
  relationship='Every journal entry should trace to a transaction or an approved, evidenced accounting judgement.',
  data_required='Journal entry population with preparer, approver, support reference, and the balance affected.',
  coverage='absent',
  coverage_note='No published file carries journal entries.'),

 'intragov': dict(
  label='Intragovernmental Transactions and Intradepartmental Eliminations',
  account=('Intragovernmental receivables and payables, and the revenue and cost eliminated on consolidation.', D),
  assertion=('Completeness and valuation, and the accuracy of the elimination.', D),
  risk=('Two parties to the same transaction record it differently or one does not record it, so the difference survives consolidation and misstates the consolidated statements.', D),
  control=('Trading partner identification on every intragovernmental transaction, reciprocal confirmation between partners, and difference resolution before consolidation.', D),
  failure=('Trading partner data was missing or wrong, differences with partners went unresolved, and eliminations were made by adjustment rather than by matching.', D),
  root_cause=('The trading partner is captured, if at all, at the point where the money moves rather than where the agreement is made, so it is derived after the fact from a payment record that never needed it. A reciprocal match has to be run on a key both sides recorded at the same moment, and there is no such key.', D),
  exposure=('Not published at this grain.', D),
  evidence=('Auditors tested trading partner completeness and reciprocal balances and traced elimination entries to support.', D),
  remediation=('Trading partner data quality and reciprocal reconciliation; reissued every year since FY2018.', D),
  relationship='Each side of an intragovernmental transaction should record the same amount against the other as trading partner, in the same period.',
  data_required='Transactions carrying a trading partner identifier on both sides, keyed on a shared agreement identifier.',
  coverage='absent',
  coverage_note='Trading partner is one of the Standard Line of Accounting elements that does not reach the published files. Of 26 SLOA elements catalogued on /linkage, 9 reach the published files and none reach FPDS.'),

 'gross_costs': dict(
  label='Gross Costs',
  account=('Gross costs on the Statement of Net Cost.', D),
  assertion=('Completeness, valuation and cutoff; and the accuracy of the assignment of cost to a reporting segment.', D),
  risk=('Cost is reported without traceable transaction support and cannot be attributed to the programmes it belongs to.', D),
  control=('Cost accumulated from transaction detail and assigned to responsibility segments on a documented basis reconciled to the ledger.', D),
  failure=('Cost detail did not support reported amounts and segment assignment could not be evidenced.', D),
  root_cause=('Cost is derived from budgetary execution rather than accumulated as cost. Obligations and outlays answer a funds-control question and are not, and were never intended to be, a cost accounting system; deriving one from the other produces a figure that cannot be traced to the events that caused the cost.', D),
  exposure=('Not published at this grain.', D),
  evidence=('Auditors traced reported costs to detail and tested the segment assignment basis.', D),
  remediation=('Cost accounting initiatives; reissued every year since FY2019.', D),
  relationship='Reported cost should accumulate from transactions assigned to a responsibility segment on a documented basis.',
  data_required='Transaction-level cost postings with segment assignment.',
  coverage='absent',
  coverage_note='This site holds budgetary execution - obligations and outlays - which is the wrong basis for this assertion, as the root cause says.'),

 'earned_rev': dict(
  label='Earned Revenue',
  account=('Earned revenue, principally from reimbursable and working capital fund activity and from foreign military sales.', D),
  assertion=('Completeness, cutoff and valuation. Revenue has to be recognised when earned, against the cost that earned it.', D),
  risk=('Revenue is recognised on billing or collection rather than on performance, and cannot be matched to the cost incurred to earn it.', D),
  control=('Recognition on performance against a reimbursable agreement, with revenue matched to the cost of the work and reconciled to the customer order.', D),
  failure=('Revenue detail did not reconcile to agreements, and the basis for recognition could not be evidenced.', D),
  root_cause=('The reimbursable agreement and the work performed are tracked in separate systems from the revenue posting, so recognition falls back to the billing event, which is a cash-cycle trigger rather than a performance one.', D),
  exposure=('Not published at this grain.', D),
  evidence=('Auditors traced revenue to agreements and to the cost incurred, and tested cutoff.', D),
  remediation=('Reimbursable accounting remediation; reissued every year since FY2019.', D),
  relationship='Revenue recognised in a period should match performance under an agreement in that period.',
  data_required='Reimbursable agreements, performance records, revenue postings.',
  coverage='partial',
  coverage_note='File A on this site carries spending authority from offsetting collections at account level, which bounds the reimbursable population by account and by year and reaches nothing at agreement level. Execution on this site defaults to direct activity because File A carries no direct/reimbursable split.'),

 'recon_outlays': dict(
  label='Reconciliation of Net Cost of Operations to Outlays',
  account=('The statement that ties the proprietary and budgetary sets of books together.', D),
  assertion=('The completeness and accuracy of the articulation between two bases of accounting.', D),
  risk=('Net cost and net outlays do not reconcile, which means the proprietary and budgetary records are not two views of the same transactions.', D),
  control=('A reconciliation built from transaction-level postings that carry both a proprietary and a budgetary effect, with every reconciling item supported.', D),
  failure=('Reconciling items were unsupported or derived as residuals, and the reconciliation did not tie without adjustment.', D),
  root_cause=('The two sets of books are not posted from one event. A single transaction ought to generate both entries under the USSGL; where a feeder posts to one side only, the difference has nowhere to go but a reconciling item, and a reconciling item computed as a residual proves nothing.', D),
  exposure=('Not published at this grain.', D),
  evidence=('Auditors tested reconciling items to support and re-performed the reconciliation.', D),
  remediation=('USSGL posting logic remediation; reissued every year since FY2019.', D),
  relationship='One transaction should post both its proprietary and its budgetary entry, so the reconciliation is an identity rather than a calculation.',
  data_required='Transaction-level postings carrying both proprietary and budgetary USSGL accounts.',
  coverage='partial',
  coverage_note='File A on this site carries obligations and gross outlays for the same accounts and years, which is the outer shape of the articulation and nothing inside it. Control SBR-03 tests that gross outlays do not exceed total budgetary resources. Note that outlays include payment against prior-year obligations, so the two are not a within-year pair.'),

 'budgetary': dict(
  label='Budgetary Resources',
  account=('The Statement of Budgetary Resources: appropriations, obligations incurred, outlays and unobligated balances.', D),
  assertion=('Completeness, existence and valuation of recorded budgetary activity, and compliance with the purpose, time and amount of the appropriation.', D),
  risk=('Obligations are recorded in the wrong period, the wrong account or without a supporting commitment, so funds control is unreliable and an Antideficiency Act violation could occur undetected.', D),
  control=('Obligations recorded when incurred against a valid, documented commitment, reconciled to the undelivered order balance, with the SBR tied to the general ledger.', D),
  failure=('Obligation detail did not support reported balances, and undelivered order balances could not be validated to supporting documents.', D),
  root_cause=('The obligation is recorded in the accounting system and the document that creates it lives in a contract writing system, so the tri-annual review that is supposed to validate open obligations reviews balances rather than the instruments behind them. A balance reviewed against itself always passes.', D),
  exposure=('Not published at this grain. The FY2025 scope limitations touch 64% of budgetary resources.', R),
  evidence=('Auditors traced obligations to supporting documents, tested undelivered orders for validity, and reconciled the SBR to the ledger.', D),
  remediation=('Tri-annual review improvements and obligation validation; reissued every year since FY2018.', D),
  relationship='Every recorded obligation should trace to a document that created it, in the period and the account that document names.',
  data_required='Obligation postings keyed to the obligating document, and the document population itself.',
  coverage='testable',
  coverage_note='This is the one weakness on the roster whose assertion the sources here already test. File A is the Statement of Budgetary Resources at account level, and three controls run against it in the load transaction: SBR-01 (obligations plus unobligated balance equals total budgetary resources, within 0.1%), SBR-02 (the resource components foot) and SBR-03 (gross outlays do not exceed total resources). What they test is internal consistency of the published extract, not agreement with the audited statement, and File A carries no obligating document, so the root cause above stays out of reach.'),

 'service_org': dict(
  label='Service Organizations',
  account=('Every balance processed by a shared service provider - payroll, disbursing and accounting services performed on a Component’s behalf.', D),
  assertion=('All assertions, inherited. A Component relying on a provider inherits the provider’s control failures.', D),
  risk=('Controls at a service provider fail, and the user Component has neither assurance over them nor the complementary controls the provider’s report assumes.', D),
  control=('A SSAE 18 examination of the provider with an unmodified opinion, and performance by the user Component of the complementary user entity controls that report identifies.', D),
  failure=('Provider examinations carried modified opinions or did not cover the relevant period, and user Components did not perform or evidence the complementary controls.', D),
  root_cause=('The complementary user entity control is written by the provider and lands on a Component that was not party to the examination and often does not know the obligation exists. Assurance is contracted for; performing the other half of it is not.', D),
  exposure=('Not published at this grain. DFAS processes disbursing and accounting services for the great majority of the Department.', D),
  evidence=('Auditors read provider examination reports and tested whether user Components performed the complementary controls.', D),
  remediation=('Provider examination scope expansion and user control performance; reissued every year since FY2019.', D),
  relationship='Every complementary user entity control named in a provider’s report should be performed and evidenced by each user Component.',
  data_required='Provider examination reports, the complementary control inventory, and user Component performance evidence.',
  coverage='absent',
  coverage_note='Control-environment evidence; not carried in any published financial file.'),

 'elc': dict(
  label='Component Entity-Level Controls',
  account=('Pervasive. Entity-level controls set whether any process-level control can be relied on.', D),
  assertion=('All assertions, indirectly.', D),
  risk=('The control environment at Component level does not support reliable financial reporting, so process-level controls cannot be relied on even where they are designed well.', D),
  control=('Risk assessment, control documentation, monitoring and accountability under OMB Circular A-123, performed at Component level.', D),
  failure=('Risk assessments were incomplete, control documentation was not current, and monitoring did not reach the processes that produce the statements.', D),
  root_cause=('A-123 assurance is produced as an annual statement rather than as a year-round process, and it is prepared by the organisation being assured. The assurance statement can therefore be complete and the control environment still unreliable, which is what the auditor-identified count against the Department’s own count shows: 69 financial reporting and 39 operational weaknesses self-reported in the FY2025 assurance statement against 26 identified by the auditor.', D),
  exposure=('Not published at this grain.', R),
  evidence=('Auditors tested entity-level control documentation, risk assessments and monitoring evidence.', D),
  remediation=('A-123 programme improvements at Component level; reissued every year since FY2018.', D),
  relationship='Every process that produces a reported balance should be in the Component’s risk assessment and control documentation.',
  data_required='A-123 risk assessments, control documentation, monitoring results.',
  coverage='absent',
  coverage_note='Control-environment evidence; not carried in any published financial file.'),

 'oversight_dod': dict(
  label='DoD-Wide Oversight and Monitoring',
  account=('Pervasive.', D),
  assertion=('All assertions, through the Department’s ability to see and correct its own failures.', D),
  risk=('The Department cannot monitor remediation across Components, so corrective actions are reported as complete without the underlying condition changing.', D),
  control=('Departmental oversight of Component corrective action plans, with validation that a remediated control actually operates before the finding is closed.', D),
  failure=('Corrective actions were closed without validation and findings recurred; remediation progress was tracked by plan status rather than by control performance.', D),
  root_cause=('Closure is reported by the organisation that owns the corrective action, against milestones it set. A plan can complete on schedule while the control it was meant to install never operates, and nothing in the reporting chain distinguishes the two. This is the weakness that makes the others durable, and it is why an NFR count falling is not evidence that anything was fixed.', D),
  exposure=('Not published at this grain. 2,473 NFRs were issued and 1,004 closed in FY2025, against 2,972 open.', R),
  evidence=('Auditors tested closed corrective actions for evidence that the control operates, and reissued findings whose remediation had been reported complete.', D),
  remediation=('Departmental remediation governance, including the joint task force established for the FY2028 target; reissued every year since FY2018.', D),
  relationship='A finding should close only when the control it concerns is shown to operate, in a period after the remediation.',
  data_required='NFR population with status history, corrective action milestones, and control performance evidence after closure.',
  coverage='partial',
  coverage_note='This site holds the published counts on this page and nothing at notice level, which is the whole of the problem: closure cannot be distinguished from downgrade or from reissue under a new number without the notice population, and that population is not public.'),
}

# --------------------------------------------------------------- assembly ---
ELEMENTS = [
  (1,  'Financial statement / account', 'account'),
  (2,  'Assertion',                     'assertion'),
  (3,  'Audit risk',                    'risk'),
  (4,  'Control',                       'control'),
  (5,  'Control failure',               'failure'),
  (6,  'Root cause',                    'root_cause'),
  (7,  'Population / exposure',         'exposure'),
  (8,  'Historical audit evidence',     'evidence'),
  (9,  'Remediation',                   'remediation'),
  (10, 'Outcome',                       None),   # computed, never written above
]

# A handful of reported elements cite a document other than the FY2025 auditor's
# report they were read alongside. Named here rather than inline so the citation
# is a fact about the row and not a string buried in prose.
CITE_OVERRIDE = {
  ('elc', 'exposure'): 'DoD FY2025 Agency Financial Report, FMFIA assurance statement; ' + SRC[2025][0],
  ('oversight_dod', 'exposure'): SRC_GAO26[0],
  ('jsf', 'evidence'): SRC[2025][0] + '; DoD OIG report DODIG-2026-061',
}

ROSTER_YEARS = sorted(ROSTER)          # years for which a roster is published
CURRENT_FY = 2025

def fail(msg):
    print('FAIL  ' + msg, file=sys.stderr)
    fail.n += 1
fail.n = 0

# --- checks that run before anything is emitted ------------------------------
# These are not decoration. The FY2018 entity table was dropped because check 1
# caught it 4 short of its own published total, and a set of FY2019 sub-allotted
# rows was discarded because adding them overshot by 56. A transcription that is
# not footed against the source's own total is a guess with a citation on it.
for y in YEARS:
    fy = y['fiscal_year']
    if y['nfrs_new'] is not None and y['nfrs_reissued'] is not None:
        if y['nfrs_new'] + y['nfrs_reissued'] != y['nfrs_issued']:
            fail(f'FY{fy}: new + reissued ({y["nfrs_new"]}+{y["nfrs_reissued"]}) '
                 f'does not equal issued ({y["nfrs_issued"]}).')
    rows = ENTITIES.get(fy)
    if rows:
        s = sum(r[3] for r in rows)
        if s != y['nfrs_issued']:
            fail(f'FY{fy}: entity NFR rows sum to {s}, published total is {y["nfrs_issued"]}. '
                 f'Do not publish this year at entity grain until it foots.')
        mws = [r[1] for r in rows if r[1] is not None]
        if mws and y['mw_total'] is not None and sum(mws) != y['mw_total']:
            fail(f'FY{fy}: entity material weaknesses sum to {sum(mws)}, published total '
                 f'is {y["mw_total"]}.')
        ncs = [r[2] for r in rows if r[2] is not None]
        if ncs and y['noncompliance_total'] is not None and sum(ncs) != y['noncompliance_total']:
            fail(f'FY{fy}: entity non-compliance sums to {sum(ncs)}, published total '
                 f'is {y["noncompliance_total"]}.')
    r = ROSTER.get(fy)
    if r is not None and y['mw_agency_wide'] is not None and len(r) != y['mw_agency_wide']:
        fail(f'FY{fy}: roster holds {len(r)} entries, the report states '
             f'{y["mw_agency_wide"]} Agency-Wide material weaknesses.')
    if r is not None and len({k for k, _ in r}) != len(r):
        fail(f'FY{fy}: roster repeats a canonical key, so persistence would double-count it.')

roster_keys = {k for y in ROSTER for k, _ in ROSTER[y]}
for k in roster_keys:
    if k not in OBSTACLE:
        fail(f'{k}: no obstacle grouping.')
for k in {k for k, _ in ROSTER[CURRENT_FY]}:
    if k not in OBJECT:
        fail(f'{k}: on the FY{CURRENT_FY} roster with no audit-risk object.')
for k in OBJECT:
    if k not in {kk for kk, _ in ROSTER[CURRENT_FY]}:
        fail(f'{k}: has an audit-risk object but is not on the FY{CURRENT_FY} roster.')
    if OBJECT[k]['coverage'] not in ('testable', 'partial', 'absent'):
        fail(f'{k}: coverage "{OBJECT[k]["coverage"]}" is not one of testable/partial/absent.')
    for _, _, field in ELEMENTS:
        if field and field not in OBJECT[k]:
            fail(f'{k}: element field {field} is missing.')

if fail.n:
    print(f'\n{fail.n} check(s) failed. Nothing written.', file=sys.stderr)
    sys.exit(2)

# --- rows --------------------------------------------------------------------
year_rows = [dict(fiscal_year=y['fiscal_year'], opinion=y['opinion'],
                  nfrs_issued=y['nfrs_issued'], nfrs_new=y['nfrs_new'],
                  nfrs_reissued=y['nfrs_reissued'], nfrs_closed=y['nfrs_closed'],
                  mw_total=y['mw_total'], noncompliance_total=y['noncompliance_total'],
                  mw_agency_wide=y['mw_agency_wide'],
                  entity_rows_published=bool(ENTITIES.get(y['fiscal_year'])),
                  roster_published=y['fiscal_year'] in ROSTER,
                  citation=y['citation'], source_url=y['source_url'], note=y['note'])
             for y in YEARS]

entity_rows = []
for fy, rows in sorted(ENTITIES.items()):
    for i, (name, mw, nc, nfr) in enumerate(rows):
        entity_rows.append(dict(fiscal_year=fy, sort_order=(i + 1) * 10, entity=name,
                                mw_count=mw, noncompliance_count=nc, nfr_count=nfr,
                                citation=SRC[fy][0]))

mw_rows = []
for fy in ROSTER_YEARS:
    for i, (key, label) in enumerate(ROSTER[fy]):
        mw_rows.append(dict(fiscal_year=fy, rank_in_report=i + 1, mw_key=key,
                            printed_label=label, obstacle=OBSTACLE[key],
                            citation=ROSTER_CITE[fy]))

# Element 10 is computed here, from the roster rows above, and is the only
# element whose text this file does not contain. An outcome asserted beside the
# roster it is meant to summarise would be a restatement with a verdict on it.
def outcome_for(key):
    present = [fy for fy in ROSTER_YEARS if key in {k for k, _ in ROSTER[fy]}]
    first, last, n = present[0], present[-1], len(present)
    labels = {ROSTER[fy][[k for k, _ in ROSTER[fy]].index(key)][1] for fy in present}
    gap = [fy for fy in ROSTER_YEARS if fy not in present and first < fy < last]
    if last == CURRENT_FY:
        state = 'open'
        txt = (f'Open. On the roster in {n} of the {len(ROSTER_YEARS)} years a roster is '
               f'published, first in FY{first}, and carried into FY{CURRENT_FY}.')
    else:
        state = 'off the current roster'
        txt = (f'Not on the FY{CURRENT_FY} roster. Last published FY{last}, first FY{first}, '
               f'{n} of {len(ROSTER_YEARS)} roster years.')
    if gap:
        txt += (' Absent from the roster in ' + ', '.join(f'FY{g}' for g in gap)
                + ', which is a gap in the roster rather than evidence of a closure and a '
                  'reissue - FY2023 publishes no roster at all.')
    if len(labels) > 1:
        txt += (' Printed under ' + str(len(labels)) + ' different titles over that period; '
                'the pairing is this site’s, not the Department’s.')
    return state, txt, first, last, n

object_rows, element_rows = [], []
for key, o in OBJECT.items():
    state, otxt, first, last, n = outcome_for(key)
    object_rows.append(dict(
        mw_key=key, label=o['label'], obstacle=OBSTACLE[key],
        first_roster_year=first, last_roster_year=last, roster_years_present=n,
        roster_years_available=len(ROSTER_YEARS), outcome_state=state,
        expected_relationship=o['relationship'], data_required=o['data_required'],
        coverage=o['coverage'], coverage_note=o['coverage_note'],
        sort_order=[k for k, _ in ROSTER[CURRENT_FY]].index(key) + 1))
    for no, name, field in ELEMENTS:
        if field is None:
            element_rows.append(dict(mw_key=key, element_no=no, element_name=name,
                                     element_text=otxt, basis='derived',
                                     citation='Computed from the published rosters, '
                                              + ', '.join(f'FY{y}' for y in ROSTER_YEARS)))
            continue
        text, basis = o[field]
        cite = CITE_OVERRIDE.get((key, field))
        if cite is None:
            cite = SRC[CURRENT_FY][0] if basis == 'reported' \
                   else 'Structured reading of ' + SRC[CURRENT_FY][0]
        element_rows.append(dict(mw_key=key, element_no=no, element_name=name,
                                 element_text=text, basis=basis, citation=cite))

out = dict(
    _note=('Built by scripts/build_nfr_seed.py from named DoD OIG and GAO reports. '
           'Do not hand-edit: edit the script and re-run. Individual NFRs are not '
           'public documents; nothing here is an extracted NFR.'),
    vintage=VINTAGE,
    generated_at=datetime.datetime.now(datetime.timezone.utc).isoformat(),
    current_fiscal_year=CURRENT_FY,
    roster_years=ROSTER_YEARS,
    rows=dict(dm_nfr_year=year_rows, dm_nfr_entity=entity_rows, dm_nfr_mw=mw_rows,
              dm_nfr_object=object_rows, dm_nfr_element=element_rows))

path = 'database/seed_nfr.json'
with open(path, 'w', encoding='utf-8') as f:
    json.dump(out, f, indent=1, ensure_ascii=False)
    f.write('\n')

print(f'wrote {path}')
for t, r in out['rows'].items():
    print(f'  {t:<18} {len(r):>5} rows')
print(f'  checks passed: {len(YEARS)} years, {len(ENTITIES)} entity tables footed, '
      f'{len(ROSTER_YEARS)} rosters, {len(OBJECT)} audit-risk objects x 10 elements')
cov = {}
for o in object_rows:
    cov[o['coverage']] = cov.get(o['coverage'], 0) + 1
print('  coverage against this site’s sources: '
      + ', '.join(f'{v} {k}' for k, v in sorted(cov.items())))

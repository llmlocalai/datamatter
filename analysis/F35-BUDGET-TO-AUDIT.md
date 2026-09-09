# F-35 as a budget-to-audit pilot

**Question:** can a single major program be followed from the budget request,
through obligation, into the account records, and out to the audit findings that
judge those records — using only the sources this site already publishes?

**Answer:** three of the four links hold. The one that fails is the one that
matters, and it fails for a reason the audit layer independently names.

---

## Provenance

Every figure below carries its source and vintage. Nothing here has been
hand-adjusted; every number is reproducible from the queries in
`analysis/f35_queries.py`.

| Layer | Source | Vintage / period |
|---|---|---|
| Budget | FY2027 President's Budget exhibits P-1 and R-1 (`database/war_budget_cache/FY2027/{p1,r1}_display.xlsx`) | published 2026-08-15 |
| Execution | USASpending contract award warehouse | `vintage=2026-08-06`, warehouse mtime 2026-08-21 |
| Accounts | USASpending File A, File C | File A mtime 2026-08-21; File C mtime 2026-08-15 |
| Audit | DoD OIG DODIG-2026-032; FY2025 AFR; HASC hearing records | seed vintage 2026-09-08 |

Fiscal years are complete (`P12`) through FY2025. **FY2026 is period-to-date**
— File A at `FY2026P09`, File C at `FY2026P09`, contracts through the August
vintage — and every FY2026 figure below is a partial year, not a shortfall.

Scope convention: agency identifier `011` (Executive Office of the President) is
outside Department scope, per `SCOPE-01`. That rule is about *budgetary* totals.
Section 3 shows it does not hold on the execution side, which is new.

---

## 1. Budget: what was asked for

F-35 appears in the FY2027 request as six procurement lines and four RDT&E
program elements. Totals are the `Add` rows only — Weapon System Cost, less
prior-year advance procurement, plus current-year advance procurement — so the
`Non-Add` advance-procurement detail rows are not double counted.

**Procurement (Exhibit P-1), $ thousands**

| Account | BLI | Title | FY2025 actual | FY2026 total | FY2027 total |
|---|---|---|---:|---:|---:|
| 1506N Aircraft Proc., Navy | 0147 | Joint Strike Fighter CV | 2,511,893 | 2,322,520 | 5,573,348 |
| 1506N | 0152 | JSF STOVL | 2,141,076 | 1,901,057 | 2,075,706 |
| 1506N | 0592 | F-35 STOVL Series (mods) | 229,843 | 241,051 | 509,881 |
| 1506N | 0593 | F-35 CV Series (mods) | 154,235 | 140,280 | 216,612 |
| 3010F Aircraft Proc., AF | ATA000 (BA 01) | F-35 | 4,972,514 | 4,444,718 | 5,469,884 |
| 3010F | F03500 | F-35 Modifications | 394,454 | 277,264 | 497,973 |
| 3010F | ATA000 (BA 06) | F-35, spares and repair parts | 0 | 1,000,000 | 0 |
| | | **Total procurement** | **10,404,015** | **10,326,890** | **14,343,404** |
| | | *aircraft quantity* | *70* | *47* | *85* |

The BA 06 spares row exists only in FY2026 and is entirely PL 119-21
reconciliation money — $1.000B of the FY2026 total is spares, not aircraft.

**RDT&E (Exhibit R-1), $ thousands**

| Account | PE | Title | FY2025 | FY2026 | FY2027 |
|---|---|---|---:|---:|---:|
| 1319N | 0604840M | F-35 C2D2 | 465,005 | 418,084 | 1,257,558 |
| 1319N | 0604840N | F-35 C2D2 | 451,143 | 401,262 | 1,117,464 |
| 3600F | 0604840F | F-35 C2D2 | 1,099,328 | 960,621 | 2,068,334 |
| 3600F | 0207142F | F-35 Squadrons | 45,444 | 32,203 | 47,388 |
| | | **Total RDT&E** | **2,060,920** | **1,812,170** | **4,490,744** |

**Combined: $12.465B (FY2025) → $12.139B (FY2026) → $18.834B (FY2027).**

### 1a. The FY2027 growth is entirely mandatory money

The P-1 and R-1 split the FY2027 request into a discretionary request and a
mandatory request, and the FY2026 columns separately identify the PL 119-21
spend plan. Read that way, the headline growth reverses:

| | FY2026 | FY2027 | change |
|---|---:|---:|---:|
| Discretionary | $11.139B | $7.894B | **−29.1%** |
| Mandatory / PL 119-21 | $1.000B | $10.940B | +994% |
| **Total** | **$12.139B** | **$18.834B** | **+55.2%** |

**58.1% of the FY2027 F-35 request is mandatory (reconciliation) funding.** The
discretionary base of the program falls by nearly a third while the total grows
by more than half. Any trend line drawn across F-35 totals without that split is
describing a different program in FY2027 than in FY2026.

### 1b. What the "-1" exhibits do not contain

A text scan of the FY2027 O-1 (396 lines) returns **no F-35 line**. Operation
and maintenance — where F-35 sustainment is funded, and which the curated wiki
page puts at roughly 85% of program lifecycle cost — has no program dimension at
the exhibit level at all. Section 2 shows F-35 contracts drawing on O&M Navy
(017-1804), O&M Air Force (057-3400) and O&M Air National Guard (057-3840).
Those dollars are real, they are being obligated against F-35 contracts, and no
"-1" exhibit attributes them to the program.

Unit cost is also outside this cut. The P-1 gives quantity and current-year
procurement dollars, but the appropriation for an aircraft is split across
advance-procurement years, so `amount ÷ quantity` from the table above is *not*
a unit cost. A defensible unit cost needs the P-5 / P-21 exhibits, which are not
in the FY2027 cache (it holds the defense-wide agency J-books, not the Navy and
Air Force service books).

---

## 2. Execution: what was obligated

FPDS tags F-35 transactions with `dod_acquisition_program_code = '198'`
(`dod_acquisition_program_description = 'F-35'`). The key is **precise where it
is present and absent for most of the file**, and the second half of that took a
correction to see — see the box below.

| FY | actions | distinct awards | obligations |
|---|---:|---:|---:|
| 2021 | 991 | 346 | $9.80B |
| 2022 | 901 | 329 | $20.75B |
| 2023 | 875 | 342 | $36.45B |
| 2024 | 867 | 336 | $12.44B |
| 2025 | 850 | 320 | $36.28B |
| 2026 *(PTD)* | 430 | 196 | $10.36B |

> **Correction, 2026-09-08.** An earlier version of this memo said "tagging is
> dense — DoD-wide, untagged actions carry a net $0.0B in FY2025 — so this is a
> usable key." That was wrong, and wrong in the way this memo is otherwise about.
> FPDS records "no acquisition program" as the **explicit code `000` with
> description `NONE`**, not as a null. Testing for null finds ~90k actions worth
> approximately nothing; testing for the sentinel finds the real picture:
>
> | FY | Contract obligations | Carrying a program code | Share | Actions carrying one |
> |---|---:|---:|---:|---:|
> | 2021 | $387.0B | $71.2B | 18.4% | 25,290 of 4,339,370 (0.58%) |
> | 2022 | $414.4B | $79.7B | 19.2% | 24,421 of 4,351,900 (0.56%) |
> | 2023 | $456.8B | $113.5B | 24.8% | 23,465 of 4,404,726 (0.53%) |
> | 2024 | $446.0B | $88.7B | 19.9% | 23,726 of 4,420,732 (0.54%) |
> | 2025 | $491.7B | $124.4B | 25.3% | 22,936 of 4,489,792 (0.51%) |
> | 2026 *(PTD)* | $282.2B | $69.8B | 24.7% | 10,923 of 2,529,673 (0.43%) |
>
> **Roughly three quarters of DoD contract dollars, and 99.5% of actions, carry
> no acquisition program at all.** This strengthens the memo's thesis rather than
> weakening it — the program dimension is thinner than claimed — but the original
> sentence was false and is corrected here rather than quietly edited away. It is
> now published as control `PROG-06` and as the closing section of `/program`,
> so the coverage denominator travels with the program figures.
>
> The error is instructive: it is the same failure mode as the FPDS
> single-letter-code problem this repo already documents. A sentinel value in a
> code field is not a null, and testing for the null is testing for the wrong
> thing.


Action counts are flat within ±8%. Dollars vary by a factor of three. Obligation
volume on this program is not an activity measure — it is a definitization
calendar.

**FY2025 concentration.** Five actions carry $26.39B, **72.7% of the year**. One
contract, `N0001923C0003`, carries $21.56B across five modifications — **59.4%
of all FY2025 F-35 obligations on a single PIID**. The two largest are
`P00015` (2025-09-29, $14.15B, "THIS MODIFICATION DEFINITIZES LOT 18 & 19
AIRCRAFT CLINS") and `P00011` (2024-12-20, $7.38B, Lot 18 aircraft).

**Timing.** 53.1% of FY2025 F-35 obligations landed in August–September, against
27.5% DoD-wide. The program's year-end concentration is roughly double the
department's, and it is driven by one September definitization, not by a spending
push.

**FY2025 composition** (of $36.276B):

- Recipients: Lockheed Martin $31.16B (85.9%), RTX $4.83B (13.3%). Two firms,
  99.2%.
- Awarding office: Naval Air Systems Command $36.30B (100.1%; other offices net
  slightly negative). **The Air Force appropriations in the budget table above
  are executed through a Navy contracting office.** Any agency-level view of
  where F-35 money is spent attributes all of it to the Navy.
- Extent competed: `C` Not competed, $35.68B (98.4%).
- Pricing: `L` Fixed price incentive $25.17B (69.4%); `V` Cost plus incentive fee
  $7.70B (21.2%); `U` Cost plus fixed fee $1.99B (5.5%); `J` Firm fixed price
  $1.39B (3.8%).

None of these are defects — a sole-source program of record awarding incentive
contracts through the lead service is the expected shape. They are stated so the
next section's failure is not mistaken for one of them.

---

## 3. The account bridge: where the chain breaks

To connect a $36.28B obligation to a $12.465B appropriation you need to know
which Treasury account each obligation drew on. Two fields could answer that.
Neither does.

### 3a. The award file's account field is mostly empty, and getting emptier

`treasury_accounts_funding_this_award` on program-198 transactions:

| FY | obligations | with no account named | share of $ |
|---|---:|---:|---:|
| 2021 | $9.80B | $1.39B | 14.2% |
| 2022 | $20.75B | $3.18B | 15.3% |
| 2023 | $36.45B | $8.33B | 22.8% |
| 2024 | $12.44B | $8.14B | 65.4% |
| 2025 | $36.28B | **$33.53B** | **92.4%** |
| 2026 *(PTD)* | $10.36B | $9.47B | 91.3% |

Both Lot 18/19 definitizations — $21.53B between them — name no Treasury account.

This is not F-35-specific. DoD-wide the same share runs 26.5% (FY2021) → 59.8%
(FY2025) → 68.3% (FY2026 PTD). F-35 is a severe case of a department-wide decay.

**It is also not submission lag.** Between the `2026-07-06` and `2026-08-06`
warehouse vintages, FY2021–FY2025 program-198 figures are identical to the
dollar and to the action: same obligations, same action counts, same untraced
share. A month of further submissions repaired nothing. Only FY2026 moved, and
it moved by *adding* actions (354 → 430), not by repairing linkage (92.8% →
91.3%). *Caveat: a one-month step cannot rule out slow multi-year backfill, and
the age gradient is consistent with it. What it does rule out is the ordinary
"the data is just late" explanation for FY2025.*

### 3b. Even where the field is populated, it cannot apportion

Where accounts are named, they are usually named in combination, and the
obligation is not split across them. FY2022–23 program-198 obligations by exact
account set:

| accounts | obligations | actions |
|---|---:|---:|
| 017-1506 + 057-3010 (Aircraft Proc. Navy + AF) | $34.47B | 246 |
| 017-1804 + 057-3400 + 057-3840 (O&M Navy + AF + ANG) | $4.58B | 73 |
| 017-1319 + 057-3600 (RDT&E Navy + AF) | $1.79B | 116 |
| **011-8242** + five DoD accounts | $0.89B | 22 |
| 097-0400 (RDT&E Defense-Wide) | $0.61B | 31 |

The $34.47B row is the production lot buys: one contract action, funded by two
services' appropriations, with no field stating the split. **The award file
cannot answer "how much of this came from Aircraft Procurement, Navy."** Only
File C can.

`011-8242` is *Advances, Foreign Military Sales, Funds Appropriated to the
President* — the FMS trust account. It appears commingled with Department
appropriations on F-35 contract actions. `SCOPE-01` correctly excludes agency
011 from Department budgetary scope; on the execution side, agency-011 dollars
sit on the same transactions as Department dollars and the file does not separate
them. **This is a second, independent reason the $36.28B is not comparable to
the $12.465B appropriation:** an unknown part of it is partner and FMS money.


> ## ⚠ CORRECTION, 2026-09-09 — the linkage collapse was my error
>
> §3c and §3d of this memo reported File C linkage falling from **18.2% (FY2021)
> to 3.1% (FY2025)**, and presented it as reproducing the figure already published
> on `/reconciliation`. **Both were wrong, and wrong the same way.**
>
> File C is a **monthly cumulative snapshot**: each submission period restates the
> fiscal year to date. P03, P06, P09 and P12 are four overlapping copies of the
> same year, not four slices of it. Both the ETL and my ad-hoc queries summed
> every period, so a year for which more period files happened to be retained
> looked larger. The "collapse" tracked how many snapshots we hold per year, not
> how DoD reported.
>
> Corrected — one snapshot per year, the most complete one held:
>
> | FY | snapshot used | rows | File C | award files | linkage |
> |---|---|---:|---:|---:|---:|
> | 2021 | FY2021P06 | 1,006,565 | $22.8B | $387B | 5.9% |
> | 2022 | FY2022P06 | 984,135 | $8.1B | $414B | 2.0% |
> | 2023 | FY2023P12 | 1,060,922 | $36.0B | $457B | 7.9% |
> | 2024 | FY2024P06 | 1,012,088 | $8.0B | $446B | 1.8% |
> | 2025 | FY2025P09 | 999,491 | $13.0B | $492B | 2.6% |
> | 2026 *(PTD)* | FY2026P03 | 36,764 | $3.1B | $282B | 1.1% |
>
> **There is no collapse. Linkage has been low and roughly flat since FY2021**,
> and the remaining variation is driven by which monthly snapshot survives in the
> warehouse, not by reporting behaviour. Several period files are visibly
> truncated — FY2025P12 holds 43,286 rows against P09's 999,491 — so even the
> corrected series is a floor, not a measurement.
>
> **What survives.** The identifier space is sound: **100% of File C PIIDs match
> an FPDS PIID** in every year tested, so the join was never the problem. What
> File C actually does is cover about a quarter of contract *awards* in every
> size band while disproportionately missing the largest — in FY2025, **5 of the
> 37 awards of $1B or more**. Because those 37 awards carry 21% of all contract
> dollars, dollar coverage lands in the low single digits. That is why F-35, whose
> year is 59% one contract, has no File C rows at all: not a program-specific
> failure, a size-selection effect.
>
> §3d (the sub-agency decomposition) was computed the same summed way and is
> **withdrawn** pending recomputation on the snapshot basis.
>
> The ETL, the schema and control `REC-01` were changed on 2026-09-09 so a
> reconciliation row must name the single submission period it was built from.

### 3c. File C, the file that would settle it, is empty for these accounts

File C is the account-linked contract obligation file — the only artifact that
ties a contract to a Treasury account with a dollar amount.

Rows and obligations in the warehouse cut, F-35 appropriation accounts:

| Account | FY2021 | FY2025 |
|---|---|---|
| 017-1506 Aircraft Procurement, Navy | 1,858 rows / $0.86B | **0 rows** |
| 057-3010 Aircraft Procurement, Air Force | 3,871 rows / $1.53B | 2 rows / ~$0.00B |
| 017-1319 RDT&E, Navy | 7,826 rows / $2.40B | 821 rows / $0.03B |
| 057-3600 RDT&E, Air Force | 19,759 rows / $0.96B | 723 rows / $0.01B |

Searched by PIID rather than by account, the answer is the same: the five
largest F-35 contracts of FY2025 — `N0001923C0003`, `N0001924C0039`,
`N0001925C0070`, `N0001923C0030` — return **zero File C rows** in this cut.
(`N0001920C0032` returns six rows, all FY2021, netting −$0.038B.)

FY2025 File C is at submission period `FY2025P12`. **The year is closed.** This
is not a partial-period artifact.

The collapse is department-wide and reproduces this site's published
reconciliation figure exactly:

| FY | File C obligations | award-file obligations | linkage |
|---|---:|---:|---:|
| 2021 | $70.6B | $387.0B | 18.2% |
| 2022 | $71.1B | $414.4B | 17.2% |
| 2023 | $74.9B | $456.8B | 16.4% |
| 2024 | $40.6B | $446.0B | 9.1% |
| 2025 | $15.3B | $491.7B | 3.1% |
| 2026 *(PTD)* | $3.1B | $282.2B | 1.1% |

**This independently reproduces the 18.2% → 3.1% figure already on
`/reconciliation`, from a separate query path.** That is a verification of the
existing published finding, not a new one.

### 3d. Closing an open tracker item: it is not one component

`TRACKER.md` lists decomposing File C linkage by awarding sub-agency as open.
Doing it here:

| Sub-agency | FY2021 | FY2025 | change |
|---|---:|---:|---:|
| Dept of the Navy | $17.61B | $1.21B | **−93%** |
| Dept of the Army | $24.51B | $4.37B | −82% |
| Dept of the Air Force | $11.17B | $2.02B | −82% |
| Defense Logistics Agency | $15.74B | $4.87B | −69% |
| USTRANSCOM | $0.36B | $0.96B | **+166%** |
| USSOCOM | $0.09B | $0.30B | **+245%** |

The decline is broad across the four largest reporters, but it is **not
uniform** — two components increased. A uniform extract or pipeline fault would
not produce that pattern. This is consistent with reporting behaviour changing
at the large components, not with the warehouse cut being broken.

*This does not separate submission lag from completeness failure by itself; §3a
does that, and only for F-35, and only against a one-month vintage step.*

### 3e. File A cannot substitute

File A carries the F-35 appropriation accounts but has **no program dimension**:

| Account | FY2025 budgetary resources | obligations | outlays |
|---|---:|---:|---:|
| 017-1506 Aircraft Proc., Navy | $29.03B | $21.34B | $17.16B |
| 057-3010 Aircraft Proc., AF | $47.25B | $20.32B | $18.20B |
| 017-1319 RDT&E, Navy | $36.81B | $27.89B | $26.25B |
| 057-3600 RDT&E, AF | $65.78B | $55.87B | $52.64B |
| 017-1804 O&M, Navy | $91.59B | $87.42B | $78.57B |
| 057-3400 O&M, AF | $79.76B | $72.56B | $67.39B |
| 057-3840 O&M, Air National Guard | $8.90B | $8.26B | $7.76B |

017-1506 and 057-3010 together obligate 54.6% of their $76.28B FY2025 resources.
That is an account-level fact. Nothing in File A says which part of it is F-35.
File B has the same limitation. **The program dimension exists only in the award
files; the account dimension exists only in File A and File B; File C is the
sole bridge, and for these accounts it is empty.**

---

## 4. Audit: the layer that names the same failure

The FY2025 independent auditor's report (DODIG-2026-032, seed vintage
2026-09-08) records the eighth consecutive disclaimer of opinion (FY2018–FY2025),
11 standalone reporting entities disclaimed, 26 auditor-identified material
weaknesses, 2 significant deficiencies, and scope limitations touching 43% of
total assets and 64% of budgetary resources.

**Material weakness #14 of 26 is "Joint Strike Fighter Program."**

The program traced in this memo is not merely affected by the department's audit
condition — it is a named material weakness in its own right. The curated wiki
page on the disclaimer records the specific content as *"unquantified Joint
Strike Fighter Global Spares Pool omissions,"* alongside the quantified $18.9B
Building Partner Capacity funding error.

Four other weaknesses on the same list bear directly on the break documented in
§3, and one is close to a description of it:

| # | Category | Relation to the F-35 chain |
|---|---|---|
| 7 | Universe of Transactions | Whether the population of transactions is complete and traceable — §3a/§3c is a program-level instance |
| 13 | Government Property in the Possession of Contractors | 99.2% of FY2025 F-35 obligations go to two contractors |
| 14 | **Joint Strike Fighter Program** | The program itself |
| 19 | Intragovernmental Transactions | Navy-executed Air Force appropriations, §2 |
| 23 | Budgetary Resources | The File A / File C break, §3e |

Remediation posture: 2,473 NFRs issued in FY2025, 2,972 open at year-end, 1,004
closed. A Joint Task Force Audit was established March 2026 targeting a clean
opinion on the Consolidated Defense Working Capital Fund in FY2027 and DoD-wide
in FY2028, at a projected FY2027 remediation cost of $1.7B. GAO
(GAO-26-109115) has five open concerns about that approach, including that 16 of
17 scope-limiting weaknesses remain unaddressed.

**Congressional record.** Two F-35 hearings are in the corpus. Reading the
hearing date off page 1 rather than the filename:

- *F-35 Acquisition Program Update*, HASC No. 118-49, Subcommittee on Tactical
  Air and Land Forces, held **December 12, 2023**.
- *F-35 Sustainment*, HASC No. 117-83, Subcommittee on Readiness, held
  **April 28, 2022**.

Both are past hearings. Neither is upcoming.

---

## 5. What this pilot does not support

- **The $36.28B and the $12.465B cannot be reconciled with these sources.** Three
  independent reasons: FY2025 obligations draw on prior-year balances that this
  cut cannot age; an unknown share is FMS/partner money (011-8242); and 92.4% of
  the dollars name no account at all. Publishing a "budget vs execution"
  variance for F-35 would be asserting a comparison the data cannot bear.
- **The empty File C rows are an absence in this warehouse cut**, and are stated
  as such. They are not evidence that the Department made no such report.
- **File C's shortfall is not an error estimate for the award files.** Two
  reporting chains, as `/reconciliation` already says. The ratio measures linkage
  completeness.
- **No F-35-specific GAO report is in the corpus.** GAO's annual F-35 assessment
  is not among the 161 reports in `12-Oversight/GAO-Reports`. The audit layer
  above rests on DODIG-2026-032, the AFR, and the two hearings.
- **The one-month vintage test is a floor, not a proof.** It shows no repair over
  a month. It cannot show that no repair ever occurs.
- **No unit cost is claimed.** See §1b.

---

## 6. What this changes

1. **A program dimension is reachable and worth publishing — with its
   denominator.** `dod_acquisition_program_code` gives the first cut on this site
   that ties to a budget line rather than to an account. It is also sparse: about
   a quarter of contract dollars and half a percent of actions carry one (see the
   correction in §2). Both halves are true, and only one of them is visible from
   a program page, so the coverage measure is published beside it.
2. **Account traceability of award obligations is a publishable measure in its
   own right**, DoD-wide and by program. The 26.5% → 68.3% series in §3a is a
   new finding, and F-35's 14.2% → 92.4% shows it is far worse for concentrated
   programs than the department average implies.
3. **The lag hypothesis has its first direct test** (§3a) and failed it over a
   one-month step, for this program.
4. **The sub-agency decomposition is done** (§3d) and closes a tracker item: the
   collapse is broad but not uniform, which argues against an extract fault.
5. **`SCOPE-01` has an execution-side blind spot** (§3b): agency 011 is excluded
   from budgetary scope but appears commingled on program obligations.
6. **Hearing dates are extractable from page 1** of the CHRG PDFs, so the
   standing rule against printing hearing dates can be narrowed from "never" to
   "never from the filename."

### Proposed controls, if this becomes a page

| ID | Severity | Assertion |
|---|---|---|
| `PROG-01` | critical | Every program-level measure row names a program code and a vintage |
| `PROG-02` | critical | No program measure sums a `federal_accounts_funding_this_award` list as if apportioned |
| `PROG-03` | high | Account-traceable share is published beside every program obligation total |
| `PROG-04` | high | Any account named on a program obligation that is outside DOW scope (e.g. 011-8242) is disclosed, not dropped |
| `PROG-05` | moderate | Program totals are labelled period-to-date when the submission period does not end `P12` |

`PROG-03` is the one that matters. A program obligation total published without
its traceable share is a figure that looks reconciled and is not.

---

## 7. A gap in the build guarantee, found while shipping this

`README` and `CLAUDE.md` state that `next build` prerenders every page against
the database, "so a broken query or a non-serialisable prop fails the build
rather than the deploy." **That does not hold for any page that reads
`searchParams`** — `/contracting`, `/funds-control`, `/assistance` and now
`/program`. Reading `searchParams` opts a route out of static generation, so its
queries are never executed at build time.

This is not theoretical. The first working version of `lib/analytics.ts` for
this page contained `to_char(vintage,…)` against a query joining `dm_program_fy`
to `dm_load`, both of which have a `vintage` column. Postgres rejects it as
`column reference "vintage" is ambiguous`. `tsc --noEmit` passed. `next build`
passed and reported 20/20 pages generated. The page 500s at request time. It was
caught only by starting the built app against a loaded database and fetching the
route.

Those four pages appear as `○ (Static)` in a build run against an *empty*
database, because they return their not-loaded branch before touching
`searchParams`. Against a loaded database they become `ƒ (Dynamic)` and their
queries stop being build-tested — the guarantee is weakest exactly when there is
data to get wrong.

Worth adding to `npm run verify`: start the built app and fetch each route,
failing on any non-200. That is the check that would have caught this.

## 8. Next

- Extend the traceability series (§3a) to the ten largest acquisition program
  codes, to see whether F-35's 92.4% is typical of large programs or specific to
  the joint-service lot structure.
- Test §3a's lag question properly by re-running FY2024 and FY2025 at each
  successive vintage as they accumulate, rather than at a one-month step.
- Locate the Navy and Air Force P-5/P-21 exhibits if unit cost is wanted; they
  are not in the FY2027 cache.
- Decide whether the O&M sustainment accounts (017-1804, 057-3400, 057-3840)
  should be shown as F-35-bearing. They carry real program obligations and no
  budget-exhibit attribution, which is a finding, not an omission to fix.

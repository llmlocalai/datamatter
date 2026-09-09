# datamatter — Work Tracker

- **Last updated:** 2026-09-09 (/linkage becomes the reference: field catalogue, SFIS coverage, quoted failing records)
- **Live site:** https://datamatter.vercel.app
- **Build status (2026-09-09):** `tsc --noEmit` clean and `next build` green,
  21/21 routes, run against a full local Postgres load of every staged extract.
  Every `/program` route was requested against that build and returned 200 with
  no server error. **Not yet loaded to Neon** — the ETL reads
  `/Volumes/AI_DATA` and Neon is not reachable from the sandbox this session
  used, so `npm run refresh` still has to be run on the Mac before the live site
  shows any of it.
- **Control status (2026-09-09):** 303 of 306 assertions pass. The three
  failures are pre-existing and non-blocking: `TIE-01` (File A vs File B
  obligations, FY2022 and FY2026) and one `ASSIST-01` bucket, all published as
  findings. The nine new `EXH-*` assertions all pass, including `EXH-08`, which
  ties the P-1 and R-1 request totals to the figures the Department publishes in
  Program Acquisition Cost by Weapon System for all seven books that state them.

---

## Done — 2026-09-09 (third pass) — programme cost, search and the roster table

- [x] **The weapons book's per-system cost tables are now extracted.** Every system
  page in Program Acquisition Cost by Weapon System carries a table of the same
  money the -1 exhibits itemise, totalled by the Department against the SYSTEM:
  RDT&E and procurement by service, with quantities, for three fiscal years.
  **7,167 rows across seven books** in `dm_weapon_system_cost`. This is the only
  source here that states what a whole programme costs.
- [x] **It changes shape between eras exactly as the -1 books do** — Base/OCO in
  PB2020-21, Discretionary/Mandatory in PB2026 — so the fiscal-year figure is
  picked by the same two rules as `EXH-05` (right-most column labelled *Total*,
  else the sum of that year's components) and `total_basis` records which fired.
  A right-most-column rule alone publishes the PB2026 mandatory add as the year.
- [x] **`WBC-01`: 1,599 of 1,613 system-years (99.1%) foot to the total printed
  on their own page.** The 14 that do not are pages typeset so tightly a figure
  cannot be assigned to a column; they are named rather than absorbed. Four
  parser rules were each worth several hundred rows: numbers are right-aligned so
  the right-most token in a column band is the aligned one; a dash is an absent
  figure and must not occupy the slot; a label can carry digits ("AH-64E New
  Build") and can wrap onto the line above its figures; and a valued row at or
  left of its heading is a sibling of it ("Mods"), not a member.
- [x] **`WBC-02` caught a real defect in the existing weapon crosswalk.** `_STOP`
  drops roman numerals, so "Small Diameter Bomb (SDB) I" phrase-matched
  "SMALL DIAMETER BOMB II" and filed $195M of SDB II under SDB I. Fixed two ways,
  both justified on their own terms rather than to make a number fit: a variant
  marker (I/II/III, Block n, Increment n) is never evidence FOR a match but a
  disagreement between two is decisive against one; and a line that fits two
  systems equally well now gets **no** row — 8 lines, previously broken by
  iteration order. Links 191 → 183.
- [x] **`WBC-02` is deliberately non-blocking in both directions.** 45 of 57
  system-years reach LESS than the book publishes (the crosswalk cannot tie back
  spares and modification lines whose titles name no system) and 6 reach MORE (a
  budget line can be broader than one programme — the NGSW ammunition line, one
  R-1 element funding several systems). The control states the gap on the page;
  it must never be satisfied by dropping links until the figures agree.
- [x] **Search that does not guess**, three explainable layers: normalised text
  (`f35` = `F-35` = `F 35`), the **117 abbreviations the weapons book itself
  expands** into a system's own name (`JSF`, `FLRAA`, `JLTV`, `SDB`) carried in
  `dm_weapon_alias` with the sentence they were read from, and all-terms-present
  for multi-word queries. No similarity score anywhere, and every row says how it
  was reached. `WBC-03` refuses an alias that names no evidence.
- [x] **The roster carries both published taxonomies and neither is blended.**
  The weapons book's own category (authoritative, sparse — an empty cell is a
  fact about the book) and the J-book's own budget sub-activity (covers every
  procurement line: "Combat Aircraft", "Rotary", "Aircraft Spares and Repair
  Parts"). Plus fund type from the exhibit, service/agency, and one canonical
  spelling per Treasury account because the books write the same account four ways.
- [x] **A budget line item is not confined to one budget activity.** PB2027 line
  `ATA000` sits under BA 03 Tactical Forces for $16.6B **and** BA 10 Aircraft
  Spares and Repair Parts for $1.0B. Taking whichever row was read last labelled
  the F-35 procurement line "Aircraft Spares and Repair Parts". The activity shown
  is now the one carrying the most money in the newest book, and `activity_count`
  says how many the line spans — 43 lines span more than one.
- [x] **Sort and filter run in Postgres over the whole roster**, in the query
  string, so a sorted or filtered view is a link and ordering by newest request
  shows the largest line in the roster rather than the largest on page one.
- [x] **New `/program?system=<name>`**: the published system cost table beside the
  roll-up of every budget line tied to it, the gap between them stated as a
  property of the crosswalk, then the accounts those lines execute in.
- [x] **Verified end to end against a local Postgres**: load committed, `WBC-01`
  and `WBC-03` pass and `WBC-02` publishes its finding; each new control was
  deliberately broken and confirmed to fail (corrupted totals → WBC-01 fails;
  blanked alias evidence → WBC-03 fails; removed the over-reaching links →
  WBC-02 passes), then the database was reset before any render was trusted.
  `tsc --noEmit` clean, `next build` green 21/21, and **42 routes requested
  against a running production build, all 200** — including every new filter,
  sort and system view.

## Done — 2026-09-09 (fourth pass) — `/linkage`, and a correction to `/reconciliation`

- [x] **New page `/linkage`** — every join the site depends on, measured in one
  query, with the direction of loss named. Seven seams: budget line → Treasury
  account (100%, exact), account → File A (32 of 34 accounts), contract action →
  federal account (35.0% of dollars), contract action → acquisition program
  (25.3% of dollars, 0.5% of actions), budget line → program code (58 of 2,725),
  weapons system → budget line (71 of 161), award files → File C (4.0%). Each
  seam names BOTH datasets it spans, so the page prints two vintages rather than
  implying one.
- [x] **The File C finding, and it is a real one.** The warehouse holds **four**
  File C snapshots per fiscal year — periods 3, 6, 9 and 12; the other seven
  periods carry fewer than thirty rows — and File C states a year *as of* a
  submission period. The extract publishes the snapshot with the most rows, which
  is defensible and is still a choice. **Reading FY2022 at period 3 gives 1.4%
  linkage and at period 12 gives 11.6% — the same warehouse, the same year, an
  8.3× difference.** Spread exceeds 2× in three of the four years that hold more
  than one snapshot.
- [x] **So the linkage trend was not a trend.** `/reconciliation` headlined
  "Linkage completeness is falling, not holding" and drew a line through figures
  read at period 6, period 6, period 12, period 6 and period 9 in successive
  years. That line measured which copy was opened. The section is replaced by
  "Whether linkage is falling cannot be read from these files", showing every
  year at every snapshot; the lede, the change tile and the File C row-count
  caption are corrected with it, and the LineTrend is gone.
- [x] **New table `dm_filec_period`** (63 rows) carries every snapshot with the
  linkage each would produce, and **`step_filec` now measures every period**
  rather than only the published one.
- [x] **`FILEC-01` is a shape, not a check**, in the sense PROG-03 is: it asserts
  a page cannot render the published figure without the snapshots it was chosen
  over. **`FILEC-02` is the finding** — it measures how far the answer moves
  between snapshots of the same year and reports a spread wider than 2× as a
  finding. It must never be satisfied by narrowing the series until the spread
  closes. 3 of 6 years fail, as they should.
- [x] **The traps section** collects every mistake this site made or nearly made,
  each with its measured cost and the control that now stops it: the FPDS
  sentinel `000`/`NONE` (74.7% of obligations carry no program, and a null test
  reports full coverage), agency 011 inside File A ($108.7B), memo rows ($28.7B
  restated across 208 lines in PB2027), the advance-procurement double count
  ($14.4B, perfectly self-consistent), the File C snapshot choice (8.3×), and the
  open fiscal year ($56.0B of movement between two vintages a month apart).
- [x] **Restatement and the text layer.** Closed years drift by at most 0.011%
  between vintages while the open year moved $56.0B; the budget books restate on
  purpose and the execution files restate by correction, and the two look
  identical in a table. The document corpus section states what a file count is
  not: not quality, not a finding, and a filename is not a hearing date.
- [x] **Verified**: `tsc --noEmit` clean, `next build` green **22/22**, load
  committed against a local Postgres with `FILEC-01` passing and `FILEC-02`
  publishing its findings, and 43 routes requested against a running production
  build, all 200.

## Done — 2026-09-09 (fifth pass) — the field catalogue, SFIS, and the records themselves

- [x] **New ETL step `catalog`** profiles every column of every source: 250 field
  profiles across File A (34 columns), File B (61), File C (91) and FPDS (64),
  each with type, populated share, distinct count, three real values, and whether
  this site reads it. **File C carries 91 columns and the site reads 5.**
- [x] **It also pulls the records that fail.** Six real rows, quoted from source
  with no editing beyond column selection. The headline one:
  `N0001923C0003` — Lockheed Martin, **$14.1B**, the largest single contract
  action of FY2025, product "AIRCRAFT, FIXED WING", acquisition programme 198
  (F-35) — and `treasury_accounts_funding_this_award` is **null**. The Department
  knows what the money bought and the published file cannot say which
  appropriation paid for it. A second row, `N0001920C0032` at $1.95B, names three
  Treasury accounts and appears nowhere in the File C snapshot for the same year.
- [x] **SFIS / SLOA is now the frame for every seam.** The 26 Standard Line of
  Accounting elements are loaded as reference (`dm_sfis_element`) from the OUSD(C)
  SLOA memorandum of 14 September 2012 as enumerated in DLMS ADC 1043, and
  coverage is **computed** from the field catalogue rather than asserted:
  **9 of 26 elements reach the published files, and 0 reach the contract file.**
  Element 12 is **Budget Line Item** — precisely the key that would tie an
  obligation to the budget line it was appropriated under, and it is in no
  published file. This turns "these files do not join" into "these files do not
  carry the elements that would join them, and the Department has required those
  elements since 2012".
- [x] **The discrete-versus-string distinction is the mechanism.** File A, B and C
  carry the Treasury Account Symbol properly decomposed — department regular and
  transfer codes, main and sub account, both periods of availability, availability
  type — as separate typed fields. FPDS carries accounts only as a
  semicolon-separated display string, which is why every seam involving a contract
  action is inferred rather than joined.
- [x] **`/linkage` is now the one-stop reference** with a contents index and eleven
  anchored sections: the seams, File C in depth, the narrowing seam, **the flow and
  hierarchy read out of the load record**, **the SFIS standard and coverage**,
  **the quoted failing records**, **the field catalogue per source**, the traps,
  restatement, the document corpus, and **an action register** naming each gap,
  what it costs, what would close it and whose move it is.
- [x] **SFIS ingested into the knowledge bank.** The wiki entry was a 15-line
  definition; it now carries all 26 SLOA element names, the Budget Line Item
  finding, and eight authorities including the SLOA memorandum, the SFIS matrix,
  TFM Vol 1 Part 2 Ch 6000 and OMB M-20-21. It flows through `step_knowledge` into
  `dm_definition`, so it is searchable on `/definitions` and in `/regulation`.
- [x] **Verified**: `tsc --noEmit` clean, `next build` green 22/22, load committed
  with the new tables (`dm_source_field` 250, `dm_join_sample` 6,
  `dm_sfis_element` 26), 43 routes requested against a running production build,
  all 200.

### Open, and named on the page rather than hidden

- The full SFIS matrix is an OUSD(C) spreadsheet this build does not hold, so
  coverage is measured against the mandatory SLOA subset only.
- Field profiles are measured on the first batch of one partition (10,000 rows,
  1,087 for File A) because a parquet row group in these files is the whole file
  and a complete profile costs more memory than the extract host has.
- File C's object class and programme activity columns are carried and unread;
  extending the extract past its five columns would let an obligation be followed
  from an award to what it bought.

## Architecture

ETL (Mac only, pyarrow) → staged JSON → transactional load → **Neon** → pages (ISR 900s).
No baked snapshots. A daily refresh reaches the live site without a redeploy.

## Shipped

| # | Page | Source | Status |
|---|------|--------|--------|
| 1 | `/execution` — budget-to-execution chain | File A + File B | ✅ |
| 2 | `/reconciliation` — award vs File C, vintage drift | award files + File C | ✅ |
| 3 | `/funds-control` — TAS execution rates | File A | ✅ |
| 4 | `/contracting` — set-aside, competition, recipients | award files | ✅ |
| 5 | `/budget` — FY2027 "-1" exhibits | Neon `war_budget_*` | ✅ |
| 6 | `/audit` — opinion, material weaknesses | AFR / DODIG (curated) | ✅ |
| 7 | `/ppbe` — justification inventory | knowledge bank | ✅ |
| 8 | `/congressional` — direction corpus, hearings | knowledge bank | ✅ |
| 9 | `/sources` — data register | `dm_dataset` / `dm_load` | ✅ |
| 10 | `/definitions` — 75 cited FM terms | curated wiki | ✅ |
| 11 | `/controls` — control results | `dm_control_result` | ✅ |
| 12 | `/regulation` — authority-ranked retrieval | BM25 index | ✅ |
| 13 | `/assistance` — grants, cooperative agreements, direct payments | financial-assistance warehouse | 🆕 code shipped, unverified — needs `npm run refresh` |
| 14 | `/program` — execution by acquisition program, account traceability | contracts + File C | 🆕 code shipped; ETL, load and controls verified against a local Postgres, **not yet loaded to Neon** |
| 15 | `/traceability` — the F-35 budget → execution → accounts → audit chain | program tables + File C + audit register + `war_budget_line` | 🆕 code shipped, prerendered against a local Postgres, **not yet loaded to Neon** |
| 16 | `/program` — the budget-line roster, one line's restatement history, and the chain into execution and contracts | `dm_exhibit_*` (P-1/P-1R/R-1, PB2020–PB2027) + weapons book + File A + contracts | 🆕 code shipped; ETL, load, all controls and every route verified against a local Postgres, **not yet loaded to Neon** |
| 17 | `/linkage` — every join in the corpus measured, the File C snapshot finding, and the traps that make a naive read wrong | all datasets; `dm_filec_period` + `dm_seam` measures computed in `lib/analytics.ts` | 🆕 code shipped; ETL, load, controls and every route verified against a local Postgres, **not yet loaded to Neon** |

### What `/program` is now

| URL | What it shows |
|---|---|
| `/program` | the roster: 2,725 money budget lines (memo lines reachable by filter), searchable, filtered by component, exhibit and weapons-book presence; the department-wide restatement table; the `EXH-08` tie-out |
| `/program?bli=p1:3010F:ATA000` | one budget line: the full `pb_year × fiscal_year` restatement matrix with the book beside every figure, the cost types behind it and which exhibit column each came from, the weapons-book entry, File A for its Treasury account, and the contract account sets that named it |
| `/program?code=198` | the execution view for one FPDS acquisition program code — unchanged, plus the budget lines that reach it |
| `/program?system=F-35 Joint Strike Fighter` | one weapon system: what the Department publishes it costs, the budget lines that money is spread across, and how much of the published total those lines actually reach |

The spine holds **eight President's Budget books** (PB2020–PB2027) describing
**ten fiscal years** (FY2018–FY2027), each restated up to three times:
50,619 exhibit rows, 46,195 line-years rolled up over cost type, 3,063 budget
lines (2,725 of them money rather than memo), 542 weapons-book system-years and
191 evidence-bearing links.

## Done — 2026-09-08 (second pass) — `/program` and the F-35 pilot

- [x] **F-35 budget-to-audit pilot analysis.** `analysis/F35-BUDGET-TO-AUDIT.md`
  (the findings) and `analysis/f35_queries.py` (re-derives every figure from the
  warehouse). Traces the FY2027 P-1/R-1 lines → FPDS program-198 obligations →
  File A/File C accounts → DODIG-2026-032, and locates where the chain breaks.
- [x] **Shipped `/program`** end to end: `etl_analytics.py --step program`, six
  tables (`dm_program_dim`, `dm_program_coverage`, `dm_program_fy`,
  `dm_program_dim_fy`, `dm_program_award`, `dm_program_account`,
  `dm_program_filec`), loader wiring, controls **PROG-01…PROG-06**, query
  functions in `lib/analytics.ts`, the page, and a nav entry. 12 featured
  programs, F-35 pinned.
- [x] **PROG-03 is the design, not a check.** `dm_program_fy` carries
  `traceable_obligation` beside `obligation` and `ProgramYear` returns them on
  one row, so a page cannot render a program obligation total without the share
  of it that names a funding Treasury account. F-35 FY2025: 7.6%.
- [x] **Corrected a real error in the pilot memo.** It claimed FPDS program
  tagging was dense because a null test found nothing. FPDS records "no
  acquisition program" as the explicit code `000` / description `NONE`: about
  **three quarters of DoD contract dollars and 99.5% of actions carry no
  program at all**. Now published as `dm_program_coverage` and `PROG-06`, and
  the correction is recorded in the memo rather than edited away.
- [x] **Verified without Neon.** The sandbox has no network route to Neon, so
  the schema, loader and full control suite were run against a local Postgres
  loaded from the real staged extract; each PROG control was then confirmed to
  **fail** on deliberately corrupted rows. `next build` passes and the page was
  fetched from a running production build (four program/FY combinations, 200,
  zero errors).

## Done — 2026-09-08 (third pass) — `/traceability` and the theme repaint

- [x] **Shipped `/traceability`** as its own Oversight tab: the F-35 chain from the
  FY2027 exhibits through obligation into the account records and out to
  DODIG-2026-032. **Every figure is queried live**, not transcribed from the memo —
  `war_budget_line` for the P-1/R-1 lines, `dm_program_*` for execution and
  traceability, `dm_reconciliation` for File C, `dm_audit_*` for the audit layer.
  Hardcoding the memo's numbers would have violated the provenance rule, so the
  page withholds the budget layer entirely when the exhibit tables are not loaded.
- [x] **The budget layer's provenance exception is stated on the page.**
  `war_budget_line` predates `dm_load` and carries only `ingested_at`; the page
  shows that vintage explicitly rather than letting those figures look like the
  rest of the site's measures.
- [x] **Repainted the whole app.** Gold replaces the cyan accent
  (`accent-400 #e8b54a`, `500 #d9a227`, `600 #c08a10`); the text tiers were raised
  to a bright set. The codebase uses `navy-50..500` for text only and `600..950`
  for surfaces only, so every text tier could be brightened without touching a
  single background. Charts keep their CVD-validated series colours — gold would
  collide with the existing yellow series.
- [x] **Contrast floor raised to 7:1 for text.** Previously `navy-400` was 6.1:1
  and `navy-500` 4.1:1 (the latter failing AA outright). Now 11.8:1 and 11.0:1.
  `--status-critical` was **3.69:1** while carrying the most important number on
  a page; it is now 7.0:1. Every status step clears 7:1.
- [x] **No type below 12px.** All 36 uses of `text-[10px]`/`text-[11px]` raised to
  `text-[12px]`, plus the three raw SVG `fontSize="10"` axis labels in
  `charts.tsx` and the hardcoded dim hexes they used (`#627d98`, `#829ab1`) that
  bypassed the palette entirely.
- [x] **Fixed a silent Tailwind failure.** `bg-[color:var(--status-critical)]/5`
  and `border-…/60` render *nothing* — the opacity modifier needs a colour channel
  it can compute and is dropped on an arbitrary `var()`. The broken-link panel had
  no tint at all. Replaced with real `.alert-critical` / `.alert-warning` classes.

## Done — 2026-09-08 (fourth pass) — `/traceability` at full depth

- [x] **Rebuilt `/traceability` to the depth of the analysis memo**, section by
  section: the chain drawn as an SVG (three intact links, the third drawn broken),
  01 Budget with a discretionary/mandatory chart, a quantity chart and the O-1
  callout; 02 Execution with an obligations chart split by the five largest
  actions, an action-count chart beside it, the one-contract callout, the FY
  composition (recipient / extent competed / pricing) and the program-coverage
  correction; 03 the traceability trend, the closed-year evidence, the account
  sets, the SCOPE-01 blind spot, File C and the department-wide collapse; 04 the
  audit layer with the named material weakness and remediation posture; 05 what
  the pilot does not support; 06 the PROG controls with their live results.
  **Every figure still queried live** — nothing transcribed.
- [x] **Fixed a pre-existing bug in `StackedFY`** (`components/charts.tsx`). Each
  column was `flex-1 flex flex-col` inside an `items-end` container, so it had no
  definite height and the bars' percentage heights resolved against an auto-height
  parent — **every bar collapsed to zero and only the labels rendered**. The column
  now carries `h-full` with the bar in a `flex-1` track. This also repairs the
  chart on `/execution`, where it had been silently broken.
- [x] **Removed duplicate legends.** `StackedFY` already renders its own `<Legend>`;
  `/traceability` and `/program` were each rendering a second copy underneath.

## Done — 2026-09-09 — File C snapshot correction + fiscal-year links

- [x] **Fixed the fiscal-year picker.** `FyPicker` hardcoded `?fy=`, so with
  `base=/program?code=198` it emitted `/program?code=198?fy=2024` — a single
  literal `code` value, so the year never applied and every program page fell
  back to its default year. Now picks `&` when the base already has a query.
- [x] **Corrected the File C linkage series — a published figure was wrong.**
  File C is a monthly *cumulative* snapshot; `step_filec` summed all periods, so
  P03+P06+P09+P12 counted the same year up to four times. The published
  "18.2% → 3.1% collapse" was an artefact of how many period files each year
  retained. Corrected (one snapshot per year): **5.9 / 2.0 / 7.9 / 1.8 / 2.6 /
  1.1%** — low and roughly flat, **no collapse**. `dm_reconciliation` now carries
  `submission_period`, `periods_available` and `period_row_counts`, and `REC-01`
  fails a row that does not name its snapshot.
- [x] **Established the join was never broken.** 100% of File C PIIDs match an
  FPDS PIID in FY2021, FY2023 and FY2025. File C covers ~23% of awards in every
  size band but only **5 of 37 awards ≥ $1B** in FY2025, and those 37 carry 21%
  of all contract dollars — a size-selection effect, not a linkage failure.
- [x] **Found the prior-year budget exhibits.** `11-Budget-Justification/_Archive`
  holds **all seven "-1" exhibits as xlsx for FY2020–FY2027**, plus the weapons
  book as PDF per year. Each PB carries three fiscal years of columns, so the
  same fiscal year appears in several PBs — a restatement axis that does not
  exist anywhere else in these sources.

## Done — 2026-09-09 (second pass) — the exhibit spine

- [x] **New ETL step `exhibits`** reads all 24 "-1" books we hold — p1, p1r and r1
  for **PB2020 through PB2027** — into `dm_exhibit_line` (50,431 line-years) and
  `dm_exhibit_program` (**3,061 distinct program lines**: 1,223 P-1, 308 P-1R,
  1,530 R-1), covering **FY2018–FY2027**.
- [x] **The three-year structure is now modelled, not flattened.** Every book
  carries FY(pb−2) actuals, FY(pb−1) enacted and FY(pb) request, so a fiscal year
  appears in three successive books in three different roles. Each row carries
  both `pb_year` and `fiscal_year` plus `fy_role`, and the restatement reads as a
  diagonal: F-35 (3010F ATA000) FY2020 was **requested $5.59B, enacted $6.87B,
  actual $6.56B**; COLUMBIA FY2026 was **requested $17.91B, enacted $14.63B**.
  Nothing else in these sources shows a request becoming an enactment becoming an
  actual.
- [x] **Column shapes resolved by alias, not by exact string.** The books drift
  across eras — Base/OCO (PB2020–21), a single column per year (PB2022–23),
  Supplementals (PB2024), Discretionary/Reconciliation (PB2026–27) — and rename
  "Line Item" to "Budget Line Item", "PE / BLI" to "PE/BLI", "Add/ Non-Add" to
  "Add/Non-Add". The fiscal-year figure is taken as the **right-most amount column
  bearing that year** (the exhibits' own convention: "Total OCO" precedes
  "Total (Base + OCO)"; "Discretionary" and "Mandatory" precede "Total"), with the
  columns to its left retained as components rather than summed.
- [x] **The roster problem is solved at source.** The old 12-program list came from
  FPDS `dod_acquisition_program_code`, which most major programs do not carry.
  From the exhibits: F-47 (r1 3600F 0207110F), Golden Dome (9 R-1 PEs), COLUMBIA,
  Virginia, DDG-51, CVN-81, F-16, F/A-18E/F, M1 Abrams, AH-64 Apache, CH-47,
  UH-60 Black Hawk, B-21 Raider, Patriot, LCS, FFG-Frigate — all present.

## Open — the exhibit spine is not wired yet

- [ ] `dm_exhibit_line` / `dm_exhibit_program` need schema, loader wiring and
  controls; the step runs and stages 21MB of JSON but nothing loads it.
- [ ] Crosswalk exhibit program lines to execution: `Account` (e.g. `1506N`) to
  the File A federal account (`017-1506`), and BLI/PE title to FPDS program code
  where one exists. That is the join that carries the roster into execution.
- [ ] Cross-check the roster against the weapons book (PDF, one per year) to mark
  which lines are major defense acquisition programs.
- [ ] `/program` should be driven by the exhibit roster, not the FPDS code list.

## Open — found while shipping `/program`

- [ ] **`npm run verify` does not cover any page that reads `searchParams`.**
  Reading `searchParams` opts a route out of static generation, so `/contracting`,
  `/funds-control`, `/assistance` and `/program` never execute their queries at
  build time. This is not theoretical: `lib/analytics.ts` shipped a
  `to_char(vintage,…)` against a `dm_program_fy`/`dm_load` join where both carry
  `vintage`. `tsc --noEmit` passed, `next build` reported 20/20 pages generated,
  and the page 500s at request time. Caught only by starting the built app and
  fetching the route. Those pages show as `○ (Static)` in a build against an
  **empty** database because they return the not-loaded branch before touching
  `searchParams` — the guarantee is weakest exactly when there is data to get
  wrong. Fix: add a route smoke check (start the build, fetch every route, fail
  on non-200) to `npm run verify`.
- [ ] Extend the traceability series to the other 11 featured programs on the
  page and see whether F-35's collapse from 85.8% (FY2021) to 7.6% (FY2025) is
  typical of large joint programs or specific to its lot structure.
- [ ] `/program` is server-rendered on demand. Consider `/program/[code]` with
  `generateStaticParams` if per-program ISR is wanted.

## Done — 2026-09-08 knowledge refresh + new offering

- [x] **Pulled the FY2025 independent auditor's results.** DoD OIG Report
  DODIG-2026-032 (Dec 18, 2025) and its explainer DOWIG-2026-081 (May 12,
  2026): 26 material weaknesses (down from 28 in FY2024, a separate framework
  from the FMFIA-reported 69/39 already on the page — the two are now shown
  side by side, not conflated), 2 significant deficiencies, 11 reporting
  entities disclaimed, the 8th consecutive disclaimer of opinion (FY2018–25),
  and the auditor's 26 named material-weakness categories. New
  `/audit` sections; new `dm_audit_mw_category` table; `database/seed_analytics.json`
  carries the citations.
- [x] **Captured the FY2027/FY2028 audit strategy shift.** The Department's
  March 2026 Joint Task Force Audit (substantive testing, centralized,
  targeting a clean opinion on the Consolidated Working Capital Fund in FY2027
  and DoD-wide in FY2028) and GAO's five open concerns about it (GAO-26-109115):
  transparency from fewer standalone statements, 16 of 17 scope-limiting
  weaknesses still unaddressed, fraud-risk management, and scaling the Marine
  Corps' substantive-testing approach to the larger services. NFR figures
  (2,473 issued FY2025, 2,972 open, 1,004 closed) on the same page.
- [x] **Shipped `/assistance`** — a new page and full pipeline (ETL step,
  `dm_assistance_fy`/`dm_assistance_dim`/`dm_assistance_vintage_drift`, loader
  wiring, `ASSIST-01` control) for DoD financial-assistance transactions
  (cooperative agreements, grants, direct payments) from a warehouse tree
  confirmed present but previously unused. Verified against the real parquet
  schema before writing extraction code — the awarding-agency column is 100%
  "Department of Defense" in the sampled FY2025 vintage, but the ETL still
  filters on it explicitly rather than trusting the cut is pre-scoped. Explicitly
  documented as **not** a credit-programs page: no loan/loan-guarantee type
  codes appear in this warehouse cut.
- [x] **Added 3 new knowledge-bank wiki pages** (DODIG-2026-032, the Joint Task
  Force Audit, and GAO's concerns) plus dated addenda to the existing
  `DoD-Audit-Results-and-Opinions` and `DoD-FY2025-Agency-Financial-Report`
  pages. All cited to primary DoD OIG / GAO reports.
- [x] **Rebuilt the `/regulation` BM25 index** (78 wiki pages → 392 chunks,
  2,710 terms) so the new pages are searchable now; **closed a real gap** —
  `scripts/etl_knowledge_index.py` was never wired into `npm run refresh`, so
  `/regulation` could go stale even after a "daily refresh." `refresh` now
  runs `etl && load && knowledge-index`.
- [x] **`/api/regulation`: module-scope index cache + basic per-instance rate
  limit** (30 req/min), closing the two Open items below. Documented plainly
  that the rate limit is per-serverless-instance, not distributed.

**Not done this pass** (left for a future session with warehouse/pyarrow access
to actually run and verify against real numbers):
- Everything above needs `npm run refresh` run on the Mac, then `npm run verify`,
  before it is live. Nothing was loaded into Neon this session.
- Decomposing File C linkage by awarding sub-agency (still open — see below).
  Verified the columns exist (`awarding_subagency_code`/`_name` in `file_c_contracts`)
  but did not write the extraction, to keep this pass's unverified surface area
  bounded.
- `/budget` is still a client component (see below) — untouched this pass.

## Done — 2026-08-27 rebuild

- [x] **Removed the fabricated-data pipeline.** `/api/budget` (publicly serving
  $800B/$850B/$900B round numbers), four invented JSON files, the three-row
  PPBE and congressional placeholder datasets, and the five SQLite-era scripts
  that generated them.
- [x] **Found and corrected a $108.7B scope error.** `file_a` carries five agency
  codes; the previous total included the Executive Office of the President and
  was labelled "agency 097 = DoD". `SCOPE-01` now blocks it.
- [x] **Built the execution chain** from File A resources through File B USSGL
  undelivered/delivered orders to outlay, with footing controls at each step.
- [x] **Built the reconciliation.** Award files vs File C: linkage falls from
  18.2% (FY2021) to 3.1% (FY2025) while contract action counts hold near 4.4M.
- [x] **Published vintage drift.** FY2025 lost $48.9M and FY2023 lost $29.4M and
  27 actions between the July and August warehouse vintages.
- [x] **Replaced "Material Weaknesses: 0"** with the AFR's reported 69 financial
  reporting and 39 operational material weaknesses, each cited.
- [x] **Removed "OMB Circular A-30"** (does not exist) and the folder-count
  "justification quality" score.
- [x] **Fixed "Upcoming Testimonies"** — 12 past, mostly non-defense hearings all
  sharing an ingest date, with a hardcoded witness count.
- [x] **Security.** `next@14.2.35`, TLS verification restored, image-optimizer
  wildcard removed, `exceljs` moved to devDependencies, security headers added.
- [x] **Provenance made structural.** `ProvenanceBar` on every page; the data
  layer cannot return a figure without its load row.
- [x] **Control suite** of 10 controls running inside the load transaction.
- [x] **Definitions registry** — 75 terms, every one carrying an authority.
- [x] **Corrected FPDS code handling.** Extent competed and pricing arrive as
  single-letter codes; page-level matching on spelled-out text silently returned
  zero. Code books moved into the ETL.
- [x] **IA re-cut** around the budget lifecycle; portfolio furniture removed.
- [x] ESLint config, CI workflow, error/404/loading boundaries, robots, sitemap.

## Open

- [ ] Decompose File C linkage by awarding sub-agency to separate submission lag
  from completeness failure (the reconciliation page names this as next work).
  Columns confirmed present and ready: `awarding_subagency_code` /
  `awarding_subagency_name` on `accounts/file_c_contracts` (verified 2026-09-08
  against the live parquet schema).
- [ ] Re-run linkage at successive vintages for the same FY to test the lag
  hypothesis directly.
- [ ] `/budget` is still a client component fetching its own API; convert to a
  server component like the rest.
- [ ] Investigate the File A / File B FY2026 divergence (34.9%) now that
  submission periods are confirmed identical.
- [x] ~~Assistance (grants/loans) and `file_c_unlinked` as additional use cases.~~
  Assistance shipped 2026-09-08 (see above; not loans — see its dataset
  limitations). `file_c_unlinked` decomposition remains open, folded into the
  sub-agency item above.
- [x] ~~Rate limiting on `/api/regulation`; module-scope cache for the BM25 index.~~
  Both shipped 2026-09-08.
- [ ] Run `npm run refresh` for the 2026-09-08 changes and verify: new control
  `ASSIST-01`, the `/assistance` page against real loaded figures, and the
  `/audit` page's new sections against the actual Neon data (all currently
  verified only by `tsc --noEmit` and by reading the live parquet schema, not
  by a real load).

## Changelog

- **2026-09-09 (second pass)** — Added the `exhibits` ETL step: 24 PB books,
  3,061 program lines, FY2018–FY2027, with the request/enacted/actual restatement
  modelled explicitly. Not yet loaded.
- **2026-09-09** — Fixed the FY picker; corrected the File C linkage series (the
  published collapse was a cumulative-snapshot summing error); confirmed the
  PIID join is sound; inventoried FY2020–FY2027 machine-readable exhibits.
- **2026-09-08 (fourth pass)** — `/traceability` rebuilt at memo depth (6 sections,
  chain diagram, 6 charts). Fixed `StackedFY` bar-height collapse, which also
  affected `/execution`, and removed duplicate legends.
- **2026-09-08 (third pass)** — `/traceability` tab, live-queried; app-wide repaint
  to a gold accent with bright text tiers (7:1 floor) and a 12px type floor.
  Verified by build + render against a local Postgres; **not yet loaded to Neon**.
- **2026-09-08 (second pass)** — F-35 pilot analysis and `/program`. New ETL step,
  six tables, PROG-01…PROG-06, page and nav entry. Corrected the memo's claim that
  FPDS program tagging is dense (code 000 = NONE is a sentinel, not a null).
  Verified against a local Postgres and a running production build; **not yet
  loaded to Neon** — run `npm run refresh && npm run verify` on the Mac.
- **2026-09-08** — Knowledge refresh + `/assistance`. Pulled DODIG-2026-032,
  DOWIG-2026-081, and GAO-26-109115; added the independent-auditor and
  audit-strategy sections to `/audit`; added 3 wiki pages + 2 addenda and
  rebuilt the BM25 index; shipped `/assistance` end to end; added
  `/api/regulation` caching and rate limiting. Not yet run through
  `npm run refresh` / `next build` — see Open.
- **2026-08-27** — Full rebuild against the live warehouse and knowledge bank.
  Moved from baked JSON snapshots to Neon with transactional loads and in-band
  control testing; added `/execution`, `/reconciliation`, `/sources`,
  `/definitions`, `/controls`; rebuilt `/audit` (was `/gao`), `/ppbe`,
  `/congressional`, `/funds-control`, `/contracting` on real data; removed the
  fabricated-data pipeline entirely.
- **2026-08-23** — Tracker created; OUSD(C)→DoD rebrand finished in docs.

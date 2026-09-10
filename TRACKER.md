# datamatter — Work Tracker

- **Last updated:** 2026-09-10 (release order: migrate, refresh, deploy)
- **Live site:** https://datamatter.vercel.app
- **Build status (2026-09-10):** `tsc --noEmit` clean and `next build` green, 27 routes,
  run against a full local Postgres load of every staged extract. All 18 pages and
  all four new API endpoints requested against that build and returned 200.
  **Not yet loaded to Neon** — the ETL reads `/Volumes/AI_DATA` and Neon is not
  reachable from the sandbox, so `npm run refresh` still has to be run on the Mac.
- **Control status (2026-09-10):** 438 of 445 assertions pass across 44 controls.
  The seven failures are all pre-existing published findings: `TIE-01` (File A vs
  File B, FY2026), `FILEB-01` (FY2026 PARK replication), one `ASSIST-01` bucket,
  three `FILEC-02` spreads and `WBC-02`. **All eleven new controls pass, and all
  eleven were proved able to fail** — each was run against a deliberately
  corrupted extract and each caught it (see the notes below on PB-01 and
  TIME-04, neither of which did until it was rewritten).

---

## Done — 2026-09-10 (thirteenth pass) — the deploy that broke on a column

The FY2026 frontier release was pushed before the schema reached Neon.
`next build` on Vercel: `column y.frontier_day_of_fy does not exist`, three
times, then `Export encountered errors on following paths: /execution/page` and
exit 1. **The whole site failed to deploy over one section of one page**, because
the build prerenders every page against the live database.

- [x] **`npm run migrate`**, and `scripts/apply_schema.js` rewritten to deserve
  it. It was applying `database/schema.neon.sql` — the FY2027 war-budget schema,
  not the analytics one — so it had never once applied the table definitions this
  site actually reads. It also connected with `rejectUnauthorized: false`, which
  CLAUDE.md forbids by name. It now applies both schema files, verifies the
  certificate as the loader does, and reports the table and column delta. Schema
  only: no data is written, so it is safe to run against a live site.
- [x] **The release order is written down**: `npm run migrate` → `npm run refresh`
  → `git push`. `npm run verify` before pushing catches this class of failure on
  the machine rather than in CI, because it runs the same prerender.
- [x] **`lib/schema.ts` — the read-side guard.** A page can ask whether the
  columns it needs exist and withhold that section, rather than failing the
  build for every other page. Cached per process, one `information_schema` query.
- [x] **The guard does not fall back, on purpose.** The only candidate fallback
  for a missing reporting frontier is the year's last action date — precisely the
  value the frontier was introduced to replace. A fallback would have silently
  restored the three-empty-months bug on a page built to support a decision. So
  `/execution` withholds the timing sections and prints why, with the two
  commands that fix it. The account-file sections above are current and stay.

Verified both directions on a local Postgres: dropped the six frontier columns
and rebuilt — **build green**, timing withheld with the notice, the two contract
tiles reading "—", the Department-wide sections intact. Then `npm run migrate`
(+33 columns), reload, rebuild — **build green**, timing restored, all 18 pages
200.


## Done — 2026-09-10 (twelfth pass) — the timing view says what it covers

Raised on reading the chart: *the chart should reflect File B execution, which is
the overall Department position — contract execution is only a subportion.*
Correct, and the framing was wrong in two ways.

- [x] **The share was understated in the copy.** Every note said contract
  obligations are "about a fifth" of Department obligations. Measured: **33.8%,
  34.3%, 34.3%, 32.0%, 33.9%** for FY2021–25. About a **third**, not a fifth.
  Corrected in the ETL header, the schema comment, the dataset limitations and
  the page.
- [x] **The share is now measured, not asserted.** `getContractCoverage` divides
  the two totals the site already publishes, and the page prints the table:
  Department obligations, contract obligations, share carrying a date, per year.
  Copy cannot drift away from it.
- [x] **The Department-wide position now leads the page.** The File A chain moved
  above the timing section and is titled *The Department-wide position* — "the
  whole of execution, not a subset — every appropriation, every account". The
  contract curve follows it, retitled **"When contract money moves"**, opening
  with its own coverage figure.
- [x] **Why there is no Department-wide curve, stated where the question arises.**
  Checked directly: `file_a` and `file_b` each hold **exactly one submission per
  fiscal year** in this warehouse — FY2021–25 at P12, FY2026 at P09. There is no
  month-by-month Department series in these sources to draw, and none can be
  constructed from them. (File C *does* carry 11 periods a year, but it is
  account-linked award data whose linkage falls to 3.1% by FY2025 — a far smaller
  subset than FPDS, not a better one.) The caveat under the waterfall says this
  plainly rather than leaving the contract curve to be read as the whole.
- [x] **What the curve does not cover, named.** Personnel compensation and
  benefits is **$586.2B, 40.4% of FY2025** — paid on a schedule, with no year-end
  timing question in it. The timing view covers the part of execution where the
  question is real; that is the argument for it, and it is now on the page
  instead of implied.


## Done — 2026-09-10 (eleventh pass) — the reporting frontier, and the default year

Two defects, reported off the live site.

### The FY2026 line on the pace chart ran flat for three months

- [x] **The contract file's extent is not its latest action date.** The FY2026
  extract runs to **2026-08-04** and is substantially complete only to
  **30 April**. October through April carry 280,000 to 400,000 actions a month;
  May carries 75,000, and June, July and August carry **180 between them**.
  Taking the maximum date as the extent was wrong in three ways at once:
  - the cumulative curve ran flat from May to August, which reads as spending
    having stopped — the exact misreading the chart exists to prevent, produced
    by the chart itself;
  - the year reported **ten** whole months observed when it had **seven**;
  - every pace comparison and September projection measured seven real months of
    FY2026 against ten of every prior year.
- [x] **That last one reversed the answer.** Sub-agency pace read **68–99%** of
  each organisation's own norm — every one of them behind. The true figures are
  **104–127%** — every one of them ahead. The projected September total went from
  $53.7B to **$76.1B**. This was a wrong conclusion on a page built to support a
  decision, not a cosmetic error.
- [x] **`_reporting_frontier` derives the extent from where the file is.** A
  fiscal month counts as observed when it carries at least half the median
  month's action count; the frontier is the end of the last observed month
  counting **consecutively** from October — consecutively, because a gap in the
  middle is a hole in the data rather than the end of it, and treating it as the
  end would hide the hole. `dm_fpds_year` now publishes the frontier, what falls
  after it, and how much that tail is worth (75,264 actions, $9.0B, 2.98% of the
  year's actions).
- [x] The pace chart clips the live year's line at the frontier and labels the
  marker "reporting frontier"; the page states the frontier, the last dated
  action, and what was excluded.

### `TIME-04` did not catch it either, at first

Written first as a bounds check — frontier non-zero, no later than the last
action, small tail — it **passed a frontier taken straight from the maximum
action date**, which is the only thing it existed to catch. Rewritten to
**recompute the month rule in SQL against `dm_fpds_day`** and compare, it now
fails that corruption with the numbers in the message: *"the published frontier
is 2026-08-04 (day 308, 10 whole months) but the daily rows put it at day 212
(7 whole months)"*.

Second time in two passes that a control was checking a published summary rather
than the rows behind it — the same shape as PB-01. The rule is now in CLAUDE.md:
**a control must recompute, not read back.**

### Every execution page opens on the year being executed

- [x] **`lib/fiscal.ts`** holds the rule once: `fiscalYearOf`, `dayOfFiscalYear`,
  `daysToFiscalYearEnd`, `pickFiscalYear`. The last of those returns the year the
  reader asked for, else the current fiscal year, else the newest the extract
  holds — replacing four copies of `closed[closed.length - 1]`, which on
  10 September 2026 opened the site on FY2025.
- [x] Applied to `/funds-control`, `/contracting`, `/assistance` and
  `/program`'s execution view; all four now open on FY2026 with the in-progress
  marker.
- [x] **The front page's four figures** now lead with FY2026 period-to-date for
  the two File A tiles, and keep the two contract tiles on the last closed year
  **with the year named on each tile** — a linkage share read off a part-year
  snapshot is the one figure on this site that moves by a factor of eight
  depending on which snapshot is picked (FILEC-02).
- [x] `/traceability` deliberately still reads closed years: it is an analysis of
  the F-35 break built on complete-year figures, not a status page.


## Done — 2026-09-10 (tenth pass) — the display spine, execution detail, year-end signals

Three asks, one pass. Ordered here as they were built, because each one depended
on the extract underneath it.

### 1. `/budget` was publishing a total that was $30.1B too high

- [x] **The FY2027 page bypassed the whole provenance and control system.** It read
  `war_budget_line` directly through `lib/fy27-data.ts`, with no memo rule of any
  kind and no vintage on the page. Its grand total summed all seven display
  tables, including the **P-1R** — Guard and Reserve equipment already inside the
  P-1 lines — alongside the P-1 advance-procurement subtotals, the `(MEMO NON
  ADD)` cost types and every `Include in TOA = N` row. Against what the exhibits
  themselves foot to, that is **$30.1B of double counting in FY2027 alone**.
- [x] **New `step_pb_display` reads all seven exhibits for the latest two books**
  into `dm_pb_line` and `dm_pb_tieout`, keeping the hierarchy the exhibit is
  printed in: appropriation, budget activity, sub-activity or activity group,
  budget line item. Separate tables from `dm_exhibit_line` on purpose — that one
  is the program spine for p1/p1r/r1 across eight books and `/program`, the
  weapons-book crosswalk and EXH-01..09 all depend on its grain.
- [x] **The memo rules are per exhibit, and one of them runs the other way.**
  `Include in TOA = N` means outside total obligation authority on the R-1;
  identifies the Indefinite Accounts block on the O-1, where the workbook settles
  it by publishing "OM Title" and "OM Title plus Indefinite" as two sheets whose
  difference is exactly those rows; and on the **M-1 marks five negative "Less
  Reimbursables" offsets that the published total INCLUDES**. Applying one rule
  across the seven is wrong in two directions at once and nothing in the column
  says so.
- [x] **The C-1 Mandatory Reconciliation sheets are a breakout, not money beside
  the year.** Measured: all 25 FY2027 projects appear in the FY 2027 sheet, 19 at
  the identical amount and 6 as part of a larger project total. Adding the sheet
  would have counted $2.68B twice in FY2027 and $4.90B in FY2026. `PB-04` asserts
  it and fails the moment a future book stops behaving that way.
- [x] **Every sheet prints its own footer, so the extract is checkable against the
  Department rather than against itself.** `PB-01` compares the published lines
  with the "Total of Displayed Rows" line each sheet carries. **All 21 sheet-years
  in the PB2027 book, and all 28 across both books, tie exactly.**
- [x] **Discretionary is derived by subtraction, not by adding the columns that
  look discretionary.** C-1 publishes Authorization, Authorization of
  Appropriation, Appropriation and Total Obligation Authority for one project —
  four measures, not four components. Adding them put every construction
  project's discretionary figure at three times its own total. `PB-02` is the
  control that stops that class of error returning.
- [x] **The table is now a six-level drill-down**, server-side, with all three of
  the book's fiscal years on every row and a level the exhibit does not use
  skipped rather than drawn empty (the R-1 has no sub-activity, the C-1 no
  activity group). Opening a budget line shows the rows behind it cost type by
  cost type, memo rows visible and struck through rather than hidden.
- [x] **`components/budget/Charts.tsx` had its own `fmtT`** which tested only the
  positive branches, so a negative figure fell through every case and printed as
  `$-549000000` — the raw number, unscaled. That was the long strings of zeros.
  It now re-exports the site's formatter.
- [x] Deleted `app/api/budget-fy27/route.ts`, `.../detail/route.ts` and
  `components/budget/DetailTable.tsx`; `lib/fy27-data.ts` keeps only the document
  catalog and the stored bytes the download route needs.

### 2. `/execution` is centred on the year that is running

- [x] **The page opened on the last CLOSED year.** It now opens on the fiscal year
  the calendar is in, and the whole difficulty of that is saying "period-to-date"
  on every figure rather than once: File A and File B are one submission per
  fiscal year (FY2026 at P09), the contract files run to 2026-08-04, and neither
  is a closed year. Where a prior-year comparison is possible at the same point
  it is made at the same point; where it is not, the page says so instead of
  drawing the line anyway.
- [x] **New `step_execution` publishes File B at the grain it is reported at** —
  76,119 rows over the three most recent years, plus account and object-class
  rollups over the whole window. Object class, program activity, direct or
  reimbursable, emergency fund code, and the USSGL expenditure stages: undelivered
  and delivered orders unpaid, prepaid and paid outlays, deobligations, and the
  upward and downward adjustments to prior-year orders.
- [x] **`fund_life` is derived from the period of availability** and it is the
  single most decision-relevant attribute in the file in September:
  **$631.9B of FY2026 obligations, 51.4%, are on annual authority that expires on
  30 September.** An obligation rate that mixes annual with no-year answers no
  question at all.
- [x] The PARK replication is handled at detail grain too, and it matters more
  there: without it a drill-down would show the same money under four keys.

### 3. Year-end timing and the signals

- [x] **File B cannot answer "when".** One submission per fiscal year means no
  within-year series exists in it. Timing is answered from contract action dates
  and labelled as what it is — contract obligations, about a fifth of Department
  obligations.
- [x] **New `step_timing`** builds the day-by-day cumulative curve for each year,
  monthly totals by sub-agency, contracting office, product or service code,
  supply group, recipient, pricing type and extent of competition, and the
  September, Q4 and final-five-day concentration of each.
- [x] **1,236 signals, each computed against its own category's prior years** —
  never against a Department-wide average, because these categories differ by
  three orders of magnitude and a shared threshold would only ever select the
  largest. Six kinds: year-end share out of pattern, month out of pattern, pace
  against the same whole months, new activity, September projection, and the
  descriptive concentration the others are read against.
- [x] **Robust statistics, with a floor and a cap, and the reason on the page.**
  Median and scaled median absolute deviation rather than mean and standard
  deviation: with four or five observations one unusual year drags a mean far
  enough to hide the year after it, and FY2021–22 carry supplemental money that
  lands in months the base budget does not use. The scale is floored at 5% of the
  median — an unfloored MAD produced a z of **416**, a number that says nothing
  except that the denominator was small — and capped at 99.
- [x] **A key must be present in every complete year to produce a comparative
  signal.** A key tracked in four of five years is a five-year history with the
  SMALL year missing, and leaving it out makes the rest look more alike than they
  are and inflates every deviation measured against them.
- [x] **The supply groups exist so the small classes are visible.** Furniture, food
  and office supplies are far too small to reach the eighty largest four-digit
  codes in a $490B year, so a threshold would quietly decide they do not exist.
  They get their own dimension at supply-group grain and their own exemplar
  bucket down to $250K. The page says plainly that buying supplies in September is
  not itself a finding.
- [x] **Exemplar actions carry the description the contracting officer wrote**, so
  the next question — which action — has an answer on the page. FY2025's largest
  September action is $14.1B on the day before the year ended, and its description
  says what it is: "THIS MODIFICATION DEFINITIZES LOT 18 & 19 AIRCRAFT CLINS".
  That is the point of showing them.
- [x] **Executor scorecard** by sub-agency: year to date against that
  organisation's own norm for the same whole months, its own September and
  final-five-day dependence, and a September projection with the observed range.

### The verification, and what it caught

Ran the ETL on the Mac, loaded every staged extract into a throwaway Postgres in
the sandbox, ran the control suite, then **corrupted the extract eleven times, once
per new control, and re-ran the load each time.** Ten were caught immediately.

**`PB-01` was not.** As first written it compared `dm_pb_tieout.counted_k +
memo_k` against `published_k` — but all three come from the same in-memory sums
in the ETL, so the control was checking the extract's bookkeeping against itself
and passed however wrong the rows reaching the page were. Moving a single O-1
line by $1M did not fail it. Rewritten to re-sum `dm_pb_line` in SQL, it catches
that corruption to the dollar. **A control that reads the extract's own summary
is not a control.**

Also caught, by rendering rather than by a control:

- the action table opened on a bucket and year combination that has no rows (the
  live year has no September), which read as "no data" rather than "not yet";
- both explorers rendered "Nothing matches that search" on the server, before the
  first client fetch had been asked for;
- the fund-life list printed outlay rates of 12,330,403,700% on periods of
  availability carrying $0;
- the signal board's filter counts were counts of what had been shipped to the
  browser, not of what the load holds, and the descriptive kind sorted first
  alphabetically and became the default tab.


## Done — 2026-09-09 (ninth pass) — the site's mark

- [x] **The site had no favicon at all.** Browsers were drawing the default blank
  page icon, and links shared into Slack or iMessage previewed with nothing.
- [x] **`scripts/make_icons.py` builds the whole set from one construction.** The
  mark is the nav's gold tile with `dm` in navy, but drawn as paths on a 64-unit
  grid rather than set in type: a favicon is rendered by the browser chrome and
  cannot use a webfont, and the site declares Inter while shipping no font file,
  so type here would render differently on every machine and never match.
- [x] **Two optical cuts off the same geometry.** The display cut matches the nav.
  The small cut is for the 16px slot, where the display cut's counters fall below
  one device pixel and `dm` reads as a single blob — it opens the counters and
  widens the tracking rather than simply thickening, because at 16px it is the
  white space inside a letter that carries its identity. Five candidates were
  rendered at 16px and compared before this one was chosen.
- [x] **Strokes overlap rather than abut.** Two butt caps meeting at a point leave
  an antialiasing seam — invisible at 16px, obvious at the 512px the home-screen
  icon is rendered from. Each of the m's shoulders redraws the stem it springs
  from, so no join is ever left to the rasteriser.
- [x] **`components/Nav.tsx` now inlines the same paths** instead of setting `dm`
  in whatever the visitor's system font happens to be. The header and the tab
  icon are one mark, not two things that resemble each other.
- [x] **Four files, picked up by filename.** `app/icon.svg` (small cut, the tab),
  `app/favicon.ico` (16/32/48, each rasterised at its own size rather than
  downsampled from one big render), `app/apple-icon.png` (180, display cut),
  `app/opengraph-image.png` (1200×630). Next emits the `<link>` and `<meta>` tags
  itself; nothing in `layout.tsx` names them.
- [x] **`viewport.themeColor` set to navy-950**, so a mobile address bar does not
  sit in white above a navy page.
- [x] **The link card is a flat PNG, not `@vercel/og`.** The site is statically
  prerendered and its identity does not vary by page, so a rendered-once image
  costs nothing at request time and cannot fail in production.

Verified with `tsc --noEmit` and a full `next build` — 27 static routes, up from
23, the four new ones being the icons.

## Done — 2026-09-09 (eighth pass) — the FY2026 File B key change

Prompted by a control run showing `TIE-01 4/6`. Three of the four failing controls
were accounted for (FILEC-02 and WBC-02 fail by design as published findings;
ASSIST-01 was pre-existing). TIE-01's second failure was not, and turned out to be
a break in the source rather than in the extract.

- [x] **File B changed the column that identifies a program activity in FY2026.**
  Through FY2025 every row carries `program_activity_code`. In the FY2026 P09
  submission that column is **null on all 27,813 Department rows** and the Program
  Activity Reporting Key carries the identity instead. Measured, not assumed:
  0% null in FY2021–24, 5 rows with a PARK in FY2025, 100% in FY2026.
- [x] **The first submission under the new key does not split the money across it.**
  Where an account holds several PARKs, the file repeats the account's
  object-class figure verbatim against each one. Account `017-2026/2030-1612-000`
  publishes the same **$7,384,996,196.00** against object class 31.0 under four
  different keys. **3,216 of 27,813 rows** repeat a figure already published, across
  **1,742** account-and-object-class groups.
- [x] **That is what TIE-01 was failing on.** Summed as published, Department-wide
  FY2026 obligations come to **$1,652.9B against File A's $1,225.0B — 34.9% high**,
  and above the whole of FY2025 on nine months of data. It would have read as a
  surge in spending.
- [x] **`step_obligations` now aggregates File B at its real grain** — Treasury
  account, object class, direct or reimbursable, emergency fund code — and a group
  whose rows differ only by PARK and repeat one figure counts once (modal value per
  measure; the FY2026 outlay column is not even self-consistent across the copies).
  FY2026 obligations land at **$1,228.4B, 0.28% from File A**.
- [x] **The rule is confined to the break.** It requires `program_activity_code` to
  be null across the whole group, which is true only of FY2026. Measured: **zero
  rows collapsed in FY2021–FY2025**, and the published figures for those years are
  unchanged to the cent. Two program activities in those years may legitimately
  report equal amounts, and there the code still tells them apart.
- [x] **New control `FILEB-01`** (high, non-blocking) counts the repeated rows and
  fails while any remain, so the repair stays visible rather than becoming an
  assumption. It is not satisfied by the extract having handled it — only by a
  submission that splits the money across its keys. New table `dm_fileb_grain`
  holds the count on both sides.
- [x] **TIE-01 now reads the submission period instead of asserting it.** Its
  message has always said "same submission period"; nothing on
  `dm_obligation_stage` could verify that. The table now carries
  `submission_period`, `periods_available`, and the row and grain counts, and a
  period mismatch fails the control on its own terms. Verified: File A and File B
  do hold exactly one period per fiscal year and they do match — the old claim was
  true by luck.
- [x] **New `/linkage#fileb` section** — the key change, the four-key example, File
  A beside File B as published and at grain for all six years, and rows against
  distinct rows of data. Sits beside the File C section: one seam is a choice
  between copies, the other is a source that changed its key.
- [x] **`/execution`'s reconciliation note is now counted, not asserted** ("in 1 of
  6 years they do not"), with a caveat naming the repair and linking to it.
- [x] **Result: `TIE-01 5/6`**, FY2022 the only remaining failure at 1.63% — a
  genuine cross-system variance and a finding worth publishing. `FILEB-01 5/6`,
  FY2026 failing by design.

**What this does not fix.** The money is counted once but it is not attributed: the
FY2026 file does not say how an account's obligations divide between its reporting
keys, so File B answers "how much" for that year and no longer answers "on what
activity". Object class survives; program activity does not. The gross outlay column
is only partly repaired — copies of the same row disagree with each other — and
remains about 3% above File A after the collapse.

Verified with `tsc --noEmit` and a full `next build`, and the loader run end to end
against a throwaway local Postgres. **Not yet loaded to Neon** — `npm run refresh`
on the Mac, then deploy.

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

## Done — 2026-09-09 (sixth pass) — the actual records, and the element graph

Three things were asked for repeatedly and were not there: sample rows from each
source, the data elements as a linked graph and a list, and a demonstration of
*why* the linkage breaks. The field catalogue was column profiles hidden behind
collapsed blocks, which is not the same thing.

- [x] **`/linkage#trace` — one account followed through every file.** Federal
  account `017-1506`, Aircraft Procurement Navy, where the F-35 airframes sit.
  Six steps, every record real and quoted whole:
  1. the P-1 line `0147` "Joint Strike Fighter CV", BSA Combat Aircraft — the last
     record in the chain that can name a system;
  2. File A `017-2025/2027-1506-000`, every SLOA element discrete, **$11.93B
     obligations**, no budget line;
  3. File B, object class 31.0 Equipment, activity 0001 COMBAT AIRCRAFT, still no
     budget line;
  4. **File C — nothing.** Every row of the file was read: 76 distinct accounts
     appear in it and this is not one of them;
  5. FPDS reached only by *text search inside a display column* — `N0001920C0032`,
     Lockheed Martin, $1.95B, programme 198;
  6. the whole population: **95 of 171 Department accounts in File A are absent
     from File C entirely — $430.3B of obligations, 29.7%.**
- [x] **`/linkage#graph` — the sources as a graph.** Six nodes, edges only where
  two sources share a field name, solid where both carry it as a discrete element
  and dashed where the site must infer. Computed, not asserted: the contract file
  shares **23** field names with File C, **0** with File A or File B, and **0** of
  the 23 is a SLOA accounting element. Connected to the award side, severed from
  the accounting side.
- [x] **The complete candidate-key list**: 57 of 173 distinct field names appear in
  more than one execution source, and they split into two clusters that barely
  touch — account identifiers across A/B/C, award descriptors across C and FPDS.
  File C is the only member of both, which is why the whole chain rests on it.
- [x] **`/linkage#rows` — a complete record from every source**, quoted whole and
  expanded by default rather than collapsed.
- [x] **Quoted records print verbatim.** A fiscal year is `2025`, not `2,025`; a
  field published in thousands is not rendered as dollars. Amounts get a grey
  gloss only where the field name says it is an amount.

## Done — 2026-09-09 (seventh pass) — `/jbook`, the first write feature

- [x] **New ETL step `jbook`** parses the published books rather than a template:
  19 Defense-Wide RDT&E justification books → **540 exhibits, 1,615 sections,
  9 skeleton rows, 37 style profiles**. The skeleton is *observed*, and it caught
  what a hand-written template gets wrong: a project-level **R-2A carries no
  Program Change Summary**, so Acquisition Strategy is section **D** there and
  section **E** on a program-element R-2.
- [x] **House voice, measured.** Median words, range and mean sentence length per
  component × section. OSD writes a Mission Description at a median of **263
  words**; DARPA at **356**. A draft is compared against that rather than against
  an impression of it.
- [x] **The forbidden lexicon.** 19 seeded phrases — `per issue paper`, `program
  budget decision`, `PBD`, `PDM`, `predecisional`, `FOUO`, `TBD`, `we believe` —
  each with a rationale, a suggested replacement, and an authority **where one
  exists**. The regulatory nuance is stated rather than glossed: the FMR *requires*
  a PBD/PDM number in the internal SNaP submission and the same reference must not
  reach the published narrative, so most entries are labelled a component
  editorial standard, not a regulation.
- [x] **Screening runs server-side** on every pause in typing and again on save,
  so the browser and the save can never disagree. Word-boundary matching, optional
  per-entry regex. Nothing is stripped silently: a blocking hit **refuses the save
  with HTTP 409**, and an override is recorded on the version with the hit count.
- [x] **User-owned tables are outside the load transaction.** `dm_jbook_lexicon`,
  `dm_jbook_doc`, `dm_jbook_version`, `dm_jbook_upload` carry no `load_id` and
  appear in no loader COLS map. A refresh replaces the corpus and cannot touch a
  phrase you added or a draft you wrote.
- [x] **One carefully drawn exception to that**: an *untouched* seed row is
  refreshed, because a seed that can only ever be inserted can never correct
  itself — the first cut shipped double-escaped patterns (`\\bPBD\\b`) that
  silently matched nothing. `added_by` stops being `'seed'` the moment a person
  edits a row, and `is_active` is never overwritten, so a deactivation sticks.
- [x] **`/api/jbook`** is the first write endpoint on the site, gated on
  `JBOOK_TOKEN`. Screening is open (it writes nothing); everything touching
  user tables is not. **`/api/jbook/export`** produces DOCX via the `docx`
  package — UNCLASSIFIED banners in header and footer, the two-column
  identification block, the cost table, lettered sections in corpus order, and a
  `Component / Page n of m / R-1 Line #196` footer. Section headings carry their
  letters so the import round trip can find them.
- [x] **Verified end to end against a live server**: screen finds 5 blocking and 3
  warnings in a test paragraph; an unauthenticated write is refused **401**; a
  rule-breaking save is refused **409**; a clean save is v1; a forced save is v2
  with `flagged=1` recorded; the DOCX opens as `Microsoft Word 2007+` with the
  banners present. `tsc` clean, build green **23/23**, 44 routes all 200.

### Open on this feature

- Import currently accepts structured JSON back through the `import` action; a
  DOCX *parser* that reads an edited file and re-splits it by section heading is
  not built yet.
- The corpus covers Defense-Wide RDT&E only. Military department books, and P-40
  and O-1 exhibits, are not parsed.
- Cost-table editing in the UI is free text; a typed table editor with the R-2
  column set would be the next real improvement.
- `JBOOK_TOKEN` must be set in Vercel or authoring stays closed — the page says so.

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

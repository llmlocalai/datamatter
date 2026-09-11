# CLAUDE.md — datamatter

Loads on top of `/Volumes/AI_DATA/CLAUDE.md`, which carries the DoD rules that
apply everywhere on this machine. Everything here is what is true *only* of this
app. Read that file's rules as still in force.

Next.js 14 + React 18 on Vercel (**datamatter.vercel.app**), **Neon serverless
Postgres as the single source of truth** via `lib/db.ts` + `lib/analytics.ts`.
Repo: `github.com/llmlocalai/datamatter`.

## The rule that matters most here

**Every figure that reaches a page names its source and its vintage**, and the
data layer enforces it: `lib/analytics.ts` only returns measure rows joined to
the `dm_load` row that produced them. If you add a query that returns a figure
without provenance, you have introduced a defect, not a shortcut.

There are no baked JSON snapshots any more. `app/api/data/` holds one file —
`knowledge_index.json`, the BM25 index that ships to the browser for
`/regulation`. Everything else lives in Neon and is replaced by a transactional
load. **Never hand-edit data to correct a number.** Fix the extract and re-run:

```bash
npm run refresh   # python3 scripts/etl_analytics.py --step all && node scripts/load_analytics.js
```

The ETL needs `pyarrow` for the warehouse, `openpyxl` for the -1 exhibit
workbooks and `pdftotext` (`brew install poppler`) for the weapons book, and it
reads `/Volumes/AI_DATA` directly, so it runs only on this Mac, never on Vercel.
A missing `pdftotext` does not fail the run — it produces a load with no
weapons-book roster and no `EXH-08`, which is the only control here that checks
these totals against a published figure, so the exhibit step warns loudly rather
than letting that pass unnoticed. Because the app reads Neon, a refresh reaches the live
site without a redeploy.

## Scope: the mistake that is easiest to make here

`file_a` carries **five** agency identifier codes, not one:

| Code | Entity | In Department scope? |
|---|---|---|
| 097 | Defense-wide | yes |
| 021 | Army | yes |
| 017 | Navy | yes |
| 057 | Air Force | yes |
| 011 | Executive Office of the President | **no** |

Summing all five and calling it "DoD" overstates FY2025 obligations by
**$108.7B (7.0%)**. The earlier build did exactly that while labelling the total
"agency 097 = DoD". Control `SCOPE-01` now asserts no Department-scope figure
includes 011, and it blocks the load.

Use `scope = 'DOW'` everywhere. `'ALL'`, `'NON_DOW'` and `'AGENCY:<code>'` exist
so the difference can be *shown*, not so it can be summed by accident.

## Controls run inside the load transaction

`scripts/load_analytics.js` applies the schema, loads the seed and the measures,
then runs the control suite **before committing**. A `critical` failure rolls the
whole load back and the previous vintage stays published. Severity is a real
decision, not a label:

- **critical** — the extract is unusable (footing breaks, wrong scope, no vintage).
  Refuse the load.
- **high / moderate** — a genuine finding about the source data. Publish it
  alongside the data it concerns. `TIE-01` (File A vs File B obligations) is
  deliberately non-blocking for this reason: those two files really do disagree
  in FY2022 and FY2026, and that is a reconciliation finding, not a bug.

Controls and their rationale live in `database/seed_analytics.json`, the
implementations in the `CONTROLS` map in the loader. Add both halves or neither.

## The exhibit spine: rules that will silently produce wrong numbers if broken

The President's Budget "-1" exhibits (`dm_exhibit_*`) are the only source here
keyed to a **budget line** rather than to a Treasury account, which is why
`/program` is built on them. Four things about them are not stylistic choices.

**The grain is `(pb_year, fiscal_year)` and it is never collapsed.** Each book
restates three fiscal years — FY(pb−2) actuals, FY(pb−1) enacted, FY(pb) request
— so one fiscal year appears in three successive books with three different
numbers. That spread is the restatement history and it exists in no other source
here. A `GROUP BY fiscal_year` that drops `pb_year` destroys it and will look
like a tidy-up. `EXH-01` and `EXH-02` block a load where it has happened.

**Memo rows are kept, flagged, and never summed.** Four kinds restate money
already counted elsewhere in the same book:

| What | Where it hides |
|---|---|
| the whole **P-1R** exhibit | National Guard and Reserve equipment already inside the P-1 lines |
| `Include in TOA = N` | R-1 lines outside total obligation authority |
| `(MEMO NON ADD)` cost types | inside P-1 lines that are otherwise flagged `Add` — PB2021 line 5300 restates its own $369.1M by ship class |
| `Advance Procurement (CY)` | the subtotal of that line's own `C (FY x for FY y) (M)` rows |

They are flagged `is_memo` rather than dropped, because a total that silently
omits a whole exhibit cannot be explained on the page. Every query filters
`is_memo = false` by default, and `EXH-03` asserts nothing unflagged carries a
memo cost type.

**The fiscal-year figure is not always in the same column.** The exhibits change
shape between eras (Base/OCO, Less Supplementals, Discretionary/Reconciliation).
Two rules pick it, in order: the right-most column labelled *Total*, or — when
the year has no total column — the sum of that year's components. The PB2026
P-1R book stops at "FY 2026 Request" and "FY 2026 Reconciliation" with no total,
so a right-most-column rule alone publishes the reconciliation add as the whole
year. Which rule fired is recorded per row in `total_basis` (`EXH-05`).

**`EXH-08` is the only control on this site that checks whether the extract is
*right* rather than *self-consistent*.** The weapons book states the same request
these exhibits itemise, totalled by the Department: for all seven books that
state it, the non-memo P-1 and R-1 request lines equal the published procurement
and RDT&E figures exactly. It is what caught the advance-procurement subtotal
being counted alongside its own detail — $14.4B in PB2026 alone, in an extract
that passed every internal check. Do not weaken its tolerance to make a load
pass; a difference there means money has been gained or lost.

### The display spine is a second set of tables, and that is deliberate

`dm_exhibit_*` is the PROGRAM spine: p1/p1r/r1 across eight books, so a weapon
system's budget line can be followed through its restatements. `/program`, the
weapons-book crosswalk and `EXH-01`..`EXH-09` all depend on its grain.

`dm_pb_line` / `dm_pb_tieout` are the DISPLAY spine: all seven exhibits, the
latest two books, carrying the hierarchy the exhibit is printed in —
appropriation, budget activity, sub-activity or activity group, budget line item.
`/budget` is built on it. Do not merge the two; adding O&M sub-activity groups to
the program roster would flood it, and widening the program spine's account regex
would move `treasury_account` on rows the program pages join on.

**The memo rule is per exhibit and one of them runs the other way.**
`Include in TOA = N` means three different things:

| Exhibit | What the flag marks | Counted? |
|---|---|---|
| R-1 | rows outside total obligation authority | no |
| O-1 | the Indefinite Accounts block — the workbook publishes "OM Title" and "OM Title plus Indefinite" as two sheets whose difference is exactly these rows | no |
| M-1 | five negative **"Less Reimbursables"** offsets that the published M-1 total INCLUDES | **yes**, flagged `is_offset` |

Applying one rule across the seven exhibits is wrong in two directions at once
and nothing in the column itself says so. Likewise the **C-1 Mandatory
Reconciliation sheets are a breakout of projects already in that year's sheet**,
not money beside it: all 25 FY2027 projects appear in the FY 2027 sheet, 19 at
the identical amount. Adding them counts $2.68B twice.

**Discretionary is the year's total minus its mandatory columns, never the sum of
the columns that look discretionary.** C-1 prints Authorization, Authorization of
Appropriation, Appropriation and Total Obligation Authority for one project —
four measures of the same money, not four components — and adding them put every
construction project at three times its own total. `PB-02` blocks that.

**Every "-1" sheet prints its own column totals** on a "Total of Displayed Rows"
line above the header. `PB-01` re-sums `dm_pb_line` in SQL and compares. All 28
sheet-years across the PB2026 and PB2027 books tie exactly. **`PB-01` must read
the LINES, not `dm_pb_tieout`'s own counted and memo columns** — those come from
the same in-memory sums as the footer figure, so a control reading them checks
the extract against itself and passed a deliberate $1M corruption of an O-1 line.

### Execution detail and execution timing answer different questions

- **File B (`dm_exec_*`) cannot answer "when".** The warehouse holds **one
  submission per fiscal year** — FY2026 at P09 — so there is no within-year series
  in it at all. Never draw one.
- **Timing comes from contract action dates (`dm_fpds_*`)** and is labelled as
  contract obligations, about a fifth of Department obligations, never the whole.
- **`fund_life` is derived from the period of availability**, not published as a
  field, and it is the attribute that matters at a year end: annual authority
  expires on 30 September, multi-year and no-year does not. $631.9B of FY2026
  obligations, 51.4%, are annual. A year-end obligation rate that mixes the two
  answers no question.
- **From FY2026 the program activity NAME is null on every File B row.** The key
  identifies an activity; nothing reads it. Do not borrow a name from another
  year's row that happens to share a key.

### Execution by program year — the period of availability, not the fiscal year

A fiscal year's File B holds **every program year still executing in it**. FY2026
obligations at P10 are $1,363.3B, of which **$864.4B is FY2026 money**, $186.8B
FY2025, $22.8B FY2024, $16.1B FY2023, and $264.5B no-year. A rate that mixes them
answers nothing a program office asks, so `/execution` opens its File B section
with a program-year view (`lib/program-year.ts`, `/api/exec/program-year`,
`components/execution/ProgramYearExplorer.tsx`).

- **Program year = `beginning_period_of_availability`.** Carried as `bpoa`/`epoa`
  on `dm_exec_account` (File B) and `dm_exec_resource` (File A, every Department
  account — `dm_sbr_dim` keeps only forty TAS and must not be used as a
  denominator). Null means no-year, and nothing else: `POA-01` asserts it.
- **`POA-01` re-derives the years from the Treasury account symbol**
  (`017-2025/2027-1506-000`), which writes them independently of the column. Do
  not parse the symbol in page code as a fallback — that is a second, unchecked
  implementation of what the control checks. A database without the columns
  withholds the section.
- **`POA-02` (critical) foots the split**: File A accounts to the SBR total, and
  no File B account without the dimension row that carries its program year.
- **The rate is File A over File A** (obligations incurred / total budgetary
  resources), so it foots to the SBR; the amounts are File B's. Mixing File B's
  numerator with File A's denominator passes 100% wherever TIE-01 disagrees.
- **A later year's "available" is carried-in balance plus recoveries, not new
  money**, so a program year's rows across fiscal years never add up to a
  lifetime total. Show obligated-in-year and unobligated-at-end; never a
  cumulative percentage of the first year's resources — recoveries push it past
  100%.
- Still a position per submission, not a curve. What moves across the chart is
  a program year's life, FY by FY.

### Direct or reimbursable — execution is DIRECT unless it says otherwise

File B marks every row `direct_or_reimbursable_funding_source` (D/R). A
reimbursable obligation is work an account performs for a paying customer; when
the customer is another Department account, the same work is **also** that
account's direct obligation (O&M orders parts, the Working Capital Fund buys
them). A direct-plus-reimbursable total counts it twice. FY2025: **$212.9B of
$1,451.1B (14.7%)** reimbursable, $152.0B of it in the DWCF; FY2026 P10: $187.3B of
$1,363.3B (13.7%). The direct obligation rate is 73.4% in FY2025 where the
D+R rate reads 80.0%.

- **File A has no D/R column** (see `/raw-data`). Direct AMOUNTS always come from
  File B (`lib/funding.ts`). The direct RATE is File B direct obligations ÷ (File
  A total budgetary resources − spending authority from offsetting collections).
  Brought-forward balances cannot be split in File A, so for prior-year and
  revolving money the denominator still carries some reimbursable carry-in; the
  page says so. Never divide File B direct by raw File A TBR.
- **D+R survives only where it is the thing reported**: the Statement of
  Budgetary Resources, the TIE-01 File A/File B tie-out, and File C vs FPDS
  linkage (FPDS carries no D/R, so both sides stay D+R). Anywhere else a total
  is labelled direct, or shows direct and reimbursable side by side.
- Rollups carry `*_direct` / `*_reimbursable` beside the total
  (`dm_exec_account_fy`, `dm_exec_object_class_fy`, `dm_obligation_stage`,
  `dm_exec_fy`); detail filters on `dm_exec_detail.funding_source`. APIs take
  `side=direct|reimbursable|all`, default direct, and return 503 on a database
  that has the columns but not the load (`splitReady()`) — NULL is not zero.
- **`DR-01` (critical)** recomputes the split from the stage totals and, account
  by account, from the detail rows. **`DR-02`** (high) publishes the reimbursable
  share and fails if more than 0.1% carries no funding source. Both were proved
  able to fail (a $5B misstated direct figure, a nulled split, a $3B unresolved
  gap).

### Raw data — the files before anything is done to them

`/raw-data` (Method) shows the first five records of every file the ETL reads,
every column, file order, file names: File A, File B, the three File C files,
FPDS contracts, assistance, all 32 PB exhibit workbooks, and the submission
calendar (`step_raw` → `raw.json` → `dm_raw_source` / `dm_raw_row`).

- Values are stored as the text the file holds. Workbooks are read with the
  standard library (zipfile + ElementTree), not openpyxl, so a cell is shown as
  stored; null and `""` are different and are rendered differently.
- Parquet samples: the newest `fiscal_year=` partition; award files the newest
  `vintage=` and `fy=`. `total_rows` is the whole dataset from parquet footers.
- The submission-calendar sample rides in `currency.json` as `raw_sample`
  (outside `rows`, so the loader ignores it); `raw` runs last in `--step all`.
- **`RAW-01` (critical)**: every record has one value per column; every file a
  current load's figures come from has a sample (including each (PB year,
  exhibit) with lines loaded); File A/B sample periods equal the published SBR /
  stage periods; the contract sample's vintage equals the contract load's.
- Nothing on this page is a figure. Do not compute from `dm_raw_row`.

### The warehouse does not know how old it is — CUR-01 does

The account files carry the submission period they were extracted at, and a
period number means nothing on its own. Beside the published calendar it means
everything. Measured on 2026-09-10: the warehouse held **FY2026 P09** (June,
revealed 2026-07-31) while **FY2026 P10** (July) had been revealed on
**2026-09-01** and was not in it — because the warehouse snapshot was taken on
**21 August**. Nothing on the site could say so, so it showed June as current.

`step_currency` fetches the USASpending submission calendar into
`dm_submission_period`; `CUR-01` reports how many periods behind the load is;
`/execution` opens with a currency banner naming the period held, the warehouse
snapshot date, and the newer period that exists. **This is the only step that
touches the network and it is allowed to fail** — the sandboxes cannot reach the
API, so a failure writes nothing, warns, and leaves the previous calendar with
its own fetch date rather than pretending.

Note what this is NOT: nothing in the ETL can make the warehouse newer. The fix
for staleness is rebuilding the warehouse snapshot, which happens outside this
repo. The site's job is to say how old it is.

**The FPDS lag is separate, real, and reproducible.** Contract data trails by
about three months and moves forward exactly one month per warehouse vintage:
vintage 2026-07-06 is dense through March, vintage 2026-08-06 through April. A
closed year is dense in every month (FY2025 September: 468,426 actions). So the
reporting frontier is a property of the source, not of the extract — do not
"fix" it by widening the window.

### One bad control must not take the load down

Each control runs inside a `SAVEPOINT`. A control that raises a database error
aborts the enclosing transaction, and every control after it then fails with
"current transaction is aborted" until the load itself dies — catching the
JavaScript exception is not enough, because the damage is on the connection.
CUR-01 shipped with `ORDER BY ... LIMIT` inside a `UNION` branch and killed a
whole load of real measures over its own typo. Rolling back to the savepoint
makes a broken control one recorded failure instead of a refused load.

### The account chain gives a position; only contracts give a curve

`file_a` and `file_b` each hold **exactly one submission per fiscal year** in this
warehouse — FY2021–25 at P12, FY2026 at P09. **There is no month-by-month
Department-wide series in these sources and none can be built from them.** Do not
try; do not imply one exists. The Statement of Budgetary Resources chain answers
*where the year stands*, never *when the money moved*.

Timing therefore comes from contract action dates, and that is a **third** of
Department obligations — 33.8%, 34.3%, 34.3%, 32.0%, 33.9% for FY2021–25 — not a
fifth, and not the whole. `getContractCoverage` measures the share from the two
totals the site already publishes so the figure cannot drift away from the data;
the page prints it beside the chart. The largest block the curve does not cover
is personnel compensation and benefits, $586.2B or 40.4% of FY2025, which is paid
on a schedule and has no year-end timing question in it — which is the honest
argument for the curve, and it belongs on the page rather than in a defence of it.

File C carries 11 submission periods a fiscal year and looks like a way round
this. It is not: it is account-linked award data whose linkage falls to 3.1% by
FY2025 (`FILEC-01`, `FILEC-02`), a far smaller subset than FPDS rather than a
broader one.

### The extent of a file is not its latest date

The FY2026 contract extract runs to **2026-08-04** and is substantially complete
only to **30 April**: October–April carry 280,000–400,000 actions a month, May
carries 75,000, and June–August carry 180 between them. Reading the maximum
action date as the extent of the file drew the cumulative curve flat for three
months, reported ten whole months observed where there were seven, and compared
seven real months of the live year against ten of every prior year — which put
every sub-agency's pace at **68–99%** of its own norm when the true figures are
**104–127%**.

`_reporting_frontier` derives it instead: a fiscal month is observed when it
carries at least half the median month's action count, and the frontier is the
end of the last observed month counting **consecutively** from October. A gap in
the middle of a year is a hole in the data, not the end of it, and stopping at
the first gap surfaces the hole rather than hiding it. `TIME-04` recomputes the
rule in SQL and blocks a load that publishes a different one. **Every pace,
projection and same-point comparison is measured to the frontier.**

### The default fiscal year is the one being executed

`lib/fiscal.ts` holds it: `pickFiscalYear` returns the year the reader asked for,
else the current fiscal year, else the newest the extract holds. Do not
reintroduce `closed[closed.length - 1]` as a page default — it opened the whole
site on the last year that closed, which in September is the wrong year to be
looking at. The cost of the current year is that every figure on it is
period-to-date and has to say so, on the tile rather than once at the top.

The exception is a figure whose meaning depends on the year being complete: a
File C linkage share read off a part-year snapshot measures the snapshot, not the
Department (`FILEC-02`), so the front page keeps those two tiles on the last
closed year and names the year on the tile.

### Signals are questions, and the statistics have to be robust

Every signal compares a category with **its own prior years**, never with a
Department-wide average: these categories differ by three orders of magnitude and
a shared threshold only ever selects the largest of them.

- **Median and scaled MAD, not mean and standard deviation.** With four or five
  observations one unusual year drags a mean far enough to hide the year after
  it, and FY2021–22 carry supplemental money landing in months the base budget
  does not use.
- **Floor the scale and cap the result.** An unfloored MAD on a nearly flat
  history produced a z of **416** — a number that says nothing except that the
  denominator was small. Floored at 5% of the median, capped at 99, and the page
  says a capped value means "far outside its own history" rather than a
  measurement.
- **A key must be present in every complete year to produce a comparative
  signal.** A key kept in four of five years is a five-year history with the
  *small* year missing, and dropping it inflates every deviation measured against
  the rest.
- **Concentration at a year end is the shape of an annual appropriation, not a
  finding.** Publish it as the baseline the deviations are read against. Nothing
  here observes impropriety; the page says "worth asking about" and prints the
  evidence and the method beside every signal. Several of the largest signals are
  certainly ordinary — a multiyear definitisation or an exercised option lands as
  one very large action with nothing unusual in it beyond its size.
- **Small categories need their own level.** Furniture, food and office supplies
  cannot reach the eighty largest four-digit product codes in a $490B year, so a
  dollar threshold quietly decides they do not exist. They get a supply-group
  dimension and an exemplar bucket down to $250K.

### The justification books: two grains, and the book grain is the one that drifts

`/jbook` is built on every justification book in `11-Budget-Justification` —
**2,058 book identities over 4,555 editions, PB1998 to PB2027**, across O&M,
procurement, RDT&E, MILCON, BRAC, family housing, the working capital fund, the
health program and the rest. Two grains, and they answer different questions:

- **Book grain** (`dm_jbook_book`, `_book_year`, `_book_section`, `_book_skeleton`,
  `_book_exemplar`) — structure and measurement for every book, every year.
- **Exhibit grain** (`dm_jbook_exhibit`, `dm_jbook_section`, `dm_jbook_skeleton`,
  `dm_jbook_style`) — R-2 and R-2A exhibits inside the CURRENT Defense-Wide
  RDT&E books, with bodies. Do not merge them; do not widen the exhibit parser
  over the archive, which would put 4,600 books' prose into Neon.

**The grain is `(book_key, pb_year)` and it is never collapsed.** A book identity
persists across editions and each edition restates its own format: DISA's OP-5
printed "C. Reconciliation of Increases and Decreases" from PB2012 to PB2021 and
has not since. That drift exists in no single book, and a `GROUP BY` that drops
`pb_year` turns twenty-nine years of format history into a book nobody
published. `JB-01` (critical) re-counts every header against its own editions and
every edition against its own section rows, and blocks the load.

**The skeleton is weighted, and the weighting is the point.** Each book's
skeleton is measured across its OWN editions on a three-year half-life, so what
a book does now outranks what it did in PB2011. `JB-02` re-derives every
weighted share from the section rows and the edition weights — the independent
path — and fails on a 0.15-point disagreement. Sections a book has stopped
printing are shown as drift, never scaffolded into a new draft.

**Bodies are held for current books only** — a book's own two most recent
editions, capped per section. The archive is several gigabytes of prose and none
of it belongs in a page database. A historical book therefore contributes
structure and word bands and no text, and the page says so. `JB-03` fails an
exemplar from outside that window or one that does not name its file and page.

**Time-sensitivity is measured, not asserted.** 23% of all sections carry dated,
scheduled or milestone language; the share is recorded per section so a drafter
is shown where a book goes stale first. A draft whose section carries none where
the published versions carry one in half their editions is warned, not blocked.

**A book states its own PB year on its cover and the folder states another.**
Where they differ the DOCUMENT wins (`pb_basis = 'document'`), because a book
filed under FY2010 that says FY2009 on page one is a FY2009 book filed late, and
the folder's word puts it in the wrong year of its own history.

**Nothing drafts a figure.** The scaffold is bracketed placeholders; the local
model is instructed to write a placeholder rather than a number it was not
given; and the readiness check BLOCKS a save on a placeholder left behind. A
blank is obviously unfinished, a fabricated figure survives review.

### The chat, and the model chain behind it

The landing page carries a chat. Behind it is a **chain of three models, tried in
order and never upward**: the big local model on the Mac Studio, the smaller one
beside it, then a commercial model over the public internet. `lib/llm.ts` is the
only module that knows how any of them speak (Ollama's `/api/chat`, or an
OpenAI-compatible `/chat/completions` for the third). `docs/LOCAL-LLM-SETUP.md`
is the runbook for the machine end.

- **Every answer names the model that produced it.** An answer from the
  commercial fallback is not the same artifact as one from the tuned local model
  — it has not read the justification books — and a reader who cannot tell them
  apart is being misled about where the sentence came from. The page prints the
  link that answered, and the reason for every fallback, as they happen.
- **Fallback happens before the first token, never after it.** Once a link has
  emitted text the reader is already reading it; restarting on a second model
  would rewrite a paragraph under their eyes. A failure after the first token is
  reported as a truncated answer, which is what it is.
- **A local model is used only if the server says it holds the tag.** Ollama
  accepts a tag it does not have and starts pulling gigabytes over somebody's
  home connection, so `/api/tags` is checked first and a missing tag moves the
  chain down rather than starting a download.
- **Nothing is logged** — not a prompt, not a completion, not a key, by the site
  or by the proxy. The footer says no controlled unclassified information
  transits this site; a `console.log` of a question in a Vercel function would
  make that false. Errors report the STATUS, never the body, and neither the
  funnel hostname nor any key reaches the browser.
- **The perimeter is `scripts/llm_funnel_proxy.js`.** Tailscale Funnel puts the
  port on the public internet and Ollama has no authentication, so the funnel
  points at the proxy, which checks the shared secret, allows tag-listing and
  chat, and answers 404 to everything else — `/api/pull` on an open endpoint is
  a stranger filling the disk. Never funnel straight to 11434.
- **What the model writes is screened.** A model trained on the books has read
  every PBD reference in them; `/api/jbook` action `compose` runs the forbidden
  lexicon over the model's own output before it reaches the composer.
- **Offline is a normal state.** The Mac sleeps. The page says which link is
  down and why, and keeps working; `/regulation` is the retrieval half and needs
  no model at all.
- **Retrieval is shared.** `lib/knowledge-index.ts` holds the BM25 scoring that
  `/regulation` and the chat both call — two implementations would drift, and
  the day they disagreed the two would cite different passages for one question.
  `lib/ask.ts` adds the corpus: definitions, books, and skeleton rows, so "what
  must a Program Change Summary carry" is answered from 295 books rather than
  from whatever shares its words in the wiki.

### The crosswalks are derived, and say so

Two joins leave the exhibits, and neither source carries the other's key:

- **budget line → weapons-book system** (`dm_exhibit_weapon_link`)
- **budget line → FPDS acquisition program code** (`dm_exhibit_program_link`)

Every row records `match_method` and `match_evidence` so a reader can reject one
match without distrusting the rest, and an ambiguous designator produces **no
row** rather than a guess. A designator written as a single run of characters is
not evidence on its own: "PATRIOT P3I" yields `P-3`, which is the Orion, and
matching on it files an air-defence missile's contracts under a maritime patrol
aircraft's budget line. It needs a shared significant word to corroborate it.
`EXH-09` blocks a load where a link names no evidence. Never present either
crosswalk as a Department-published mapping.

### Where the chain narrows

`/program` follows a budget line as far as these sources go, and the page says so
at each step, because the loss happens in the sources rather than in the extract:

1. **budget line → Treasury account** — exact. The exhibit symbol `1506N` and the
   Treasury symbol `017-1506` differ only by the organisation letter.
2. **account → File A execution** — exact, but no longer line-specific. File A
   carries no budget line at all, and several lines share an account. Nothing may
   attribute an account obligation to one of the lines inside it.
3. **account → contract** — a window onto the quarter of the contract file that
   carries an acquisition program code, and the obligation on an action is never
   split across the accounts named on it.

`/traceability` is the page about that break. Do not write copy on `/program`
that implies the chain is tighter than this.

### The release order: migrate, refresh, deploy

**The build prerenders every page against the live database.** A query naming a
column the database has not been migrated to yet does not fail a request — it
fails the BUILD, and the deploy with it. Three steps, in this order:

```bash
npm run migrate    # schema only. Idempotent, safe on a live site, seconds.
npm run refresh    # ETL + load + knowledge index. Minutes.
git push           # the deploy, which prerenders against the two above.
```

Pushing first is what broke the FY2026 frontier release:
`column y.frontier_day_of_fy does not exist`, and `next build` exited 1 over one
section of one page. `npm run verify` before pushing catches it, because it runs
the same prerender against the same database.

`scripts/apply_schema.js` used to apply `schema.neon.sql` — the FY2027
war-budget schema, not the analytics one — and connected with
`rejectUnauthorized: false`. It now applies both schema files and verifies the
certificate like the loader.

**The read-side guard, and what it must never do.** `lib/schema.ts` lets a page
ask whether the columns it needs exist, so a code deploy that lands ahead of a
migration withholds one section instead of taking the site's build down.
It must not fall back to the old column. On this release the only candidate
fallback for a missing reporting frontier was the year's last action date —
exactly the value the frontier replaced — so a fallback would have quietly
restored the bug the frontier was added to fix. A missing column means the
figures are unavailable, and the page says so.

### Schema changes on an already-loaded database

`schema.analytics.sql` runs on every load and is `CREATE TABLE IF NOT EXISTS`
throughout, which does nothing to a table that already exists. **A new column on
an existing table therefore needs an idempotent `ALTER` in the upgrades section
at the foot of that file**, or the load fails on an INSERT several tables in,
after doing the work — which is how the File C submission-period columns reached
Neon a load late. New tables need no entry. Keep the ALTERs rather than squashing
them: a database that has not been loaded since before the change is exactly the
one that still needs them, and a column added this way must be nullable or carry
a default because the table is not empty.

The loader compares its `COLS` map against `information_schema` before it writes
anything and names every missing column at once, so drift is reported up front
rather than discovered mid-load.

## Things the data will not support — do not assert them

- **File C vs award files is not an error estimate.** They are two reporting
  chains. The ratio measures *linkage completeness* (18.2% in FY2021 → 3.1% in
  FY2025). A dollar absent from File C is not a dollar that was not obligated.
- **Hearing filenames carry the acquisition date, not the hearing date.** Never
  label a hearing "upcoming" or print a hearing date from this corpus.
- **Counting files is not measuring findings or quality.** A GAO report is not a
  finding; a folder with five PDFs is not a "high quality" justification.
- **Never write copy asserting the data does not contain something.** An empty
  result means the filter matched nothing.
- Obligations are not outlays, and outlays are not a subset of the current year's
  obligations — they include payment against prior-year obligations.
- Set-aside and extent competed are different FAR fields answering different
  questions. FPDS reports extent competed and pricing as single-letter codes;
  the code books are in the ETL, not in page-level string matching.
- Mark in-progress fiscal years. The source says so itself in
  `submission_period` — anything not ending `P12` is period-to-date.

## Naming

The FY2025 AFR presents the Department as **Department of War** per Executive
Order 14347, and framing on this site follows that. Anything naming an actual
field, code, or source system keeps the source's own name (**DoD**, agency 097,
USASpending, FPDS). The convention is stated on `/sources`; do not mix the two
silently in either direction.

## Practical

- `DATABASE_URL` lives in `.env.local`, gitignored. **Never** read it into a
  response, paste it into a file, or commit it. TLS certificates are verified —
  do not reintroduce `rejectUnauthorized: false`.
- `npm run verify` = `tsc --noEmit && next build`. The build prerenders every
  page against the database, so a bad query or a non-serialisable prop fails the
  build instead of the deploy. Run it before pushing. **It is not enough on its
  own.** Route handlers under `app/api/` are never executed by a build, and a
  page that reads `searchParams` opts out of static generation, so both can 500
  at request time against a build that was green. Start the server and request
  every page and every endpoint. An ambiguous column is the recurring shape of
  this bug: `vintage` exists on `dm_program_fy` and `dm_load`, `row_count` on
  `dm_pb_tieout` and `dm_load`. **Qualify every column in a query that joins
  `dm_load`.**
- **A new control is not finished until it has been made to fail.** Corrupt the
  staged extract, re-run the load, and confirm the control catches it. Bump
  `extracted_at` on every payload first — `dm_load` is unique on
  `(dataset_key, vintage, extracted_at)` and a rerun otherwise dies on the insert
  before a single control has run.
- **A control must RECOMPUTE, not read back.** Both controls that failed this
  test read a summary the ETL had already written: `PB-01` compared
  `dm_pb_tieout`'s counted and memo columns with its own published column, all
  three from the same in-memory sums; `TIME-04` bounds-checked a frontier instead
  of re-deriving it. Each passed the exact corruption it existed to catch. A
  control that reads the extract's own answer is a restatement with a pass/fail
  printed on it.
- Formatting crosses the server/client boundary as a **key** (`format="int"`),
  never as a function prop.
- Vercel functions cannot scan the parquet warehouse. Do not "improve" a route by
  making it read `/Volumes/AI_DATA` at request time; it will work here and fail
  in production.

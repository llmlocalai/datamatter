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
  build instead of the deploy. Run it before pushing.
- Formatting crosses the server/client boundary as a **key** (`format="int"`),
  never as a function prop.
- Vercel functions cannot scan the parquet warehouse. Do not "improve" a route by
  making it read `/Volumes/AI_DATA` at request time; it will work here and fail
  in production.

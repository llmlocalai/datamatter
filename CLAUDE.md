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

The ETL needs `pyarrow` and reads `/Volumes/AI_DATA` directly, so it runs only on
this Mac, never on Vercel. Because the app reads Neon, a refresh reaches the live
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

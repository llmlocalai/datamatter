# Data issues for the local collection framework

Findings from the F-35 pilot and the `/program` build, 2026-09-08. Every figure
is FY2025 unless stated, from `contracts vintage=2026-08-06` and the knowledge
bank as mounted that day.

Two kinds of problem are mixed together below and must not be confused:
**things the framework is doing wrong and can fix**, and **things the source
data does that the framework can only measure and disclose**. Trying to "fix"
the second kind is how fabricated numbers get published.

---

## A. Collector bugs — fix these

### A1. Sentinel values are being treated as data (critical)

FPDS encodes "not applicable" as a **code**, not a null. A null test finds
nothing and the field looks complete. It is not:

| Field | Sentinel / empty | Share of $ | Share of actions |
|---|---|---:|---:|
| `program_acronym` | null/empty | **100.0%** | 99.7% |
| `major_program` | null/empty | **97.2%** | 99.5% |
| `dod_claimant_program_code` | null/empty | 78.0% | 96.1% |
| `dod_acquisition_program_code` | **`000` = `NONE`** | 74.7% | 97.5% |
| `program_activities_funding_this_award` | null/empty | 62.1% | 72.5% |
| `treasury_accounts_funding_this_award` | null/empty | 59.8% | 72.3% |
| `object_classes_funding_this_award` | null/empty | 59.8% | 72.3% |
| `type_of_set_aside` | null/empty | 48.2% | 82.7% |
| `naics_code`, `recipient_uei`, `extent_competed`, `transaction_description` | — | ~0% | ~0% |

**Work:** build a sentinel registry per coded field (`000`/`NONE`, `Z`/`ZZ`,
`999990`, `MULTIPLE RECIPIENTS`, `UNKNOWN`, `REDACTED`) and apply it at ingest,
so "unattributed" is a first-class category rather than something each analysis
rediscovers. I published a wrong sentence in the F-35 memo for exactly this
reason — a null test on the program field, which found ~90k actions worth $0.

**`program_acronym` is 100% empty and `major_program` 97.2% empty.** Neither
should back any page or answer. Only `dod_acquisition_program_code` is usable,
and only for the quarter of the file that carries one.

### A2. Column profiling at ingest (high)

There is no per-vintage profile, so none of the table above was visible until
someone went looking. **Work:** emit a profile row per column per vintage — null
rate, sentinel rate, distinct count, min/max, and the delta against the previous
vintage. Alert on a rate that moves more than a few points. That single artifact
would have surfaced A1, the account-linkage collapse, and any schema drift.

### A3. The account-enrichment block is all-or-nothing (high — diagnostic)

`treasury_accounts_funding_this_award` and `object_classes_funding_this_award`
have **identical** null counts ($293.8B / 3,244,388 actions). They are not
independently missing: the whole account block is either present or absent for
an action, because it is derived from the File C join.

**This means "account traceability" in the award file and "File C linkage" are
the same failure seen from two sides**, not two corroborating measurements.
Anything that reports them as independent evidence is double-counting.

### A4. Document dates are taken from filenames (high)

Hearing PDFs are named with the **acquisition** date, not the hearing date, so
the whole corpus has to be treated as undated. The real date is on page 1 and is
trivially extractable:

- `CHRG-118hhrg56026_..._2026-08-16.pdf` → "HEARING HELD **DECEMBER 12, 2023**"
- `CHRG-117hhrg48447_..._2026-08-16.pdf` → "HEARING HELD **APRIL 28, 2022**"

**Work:** extract and store `document_date`, `congress`, `session`, `committee`
at ingest. Then the standing rule can narrow from "never print a hearing date"
to "never print one from the filename."

---

## B. Corpus hygiene — the knowledge bank is mostly unreachable

### B1. 594 wiki drafts are stranded (critical)

`Wiki/_drafts/DOD-FM` holds **619 markdown pages**. `Wiki/DOD-FM` holds **78**.
25 drafts duplicate a published page; **594 have no published counterpart and
are not in the BM25 index**, so `/regulation` cannot see them. The three F-35
pages written for this corpus are among them.

**Work:** a promotion path from `_drafts` to published, with whatever review gate
you want, and an index build that reports what it skipped. A generated page that
never reaches the index is cost with no benefit.

### B2. LLM failure output is being written into the corpus (high)

`Wiki/_drafts/DOD-FM/_failed-response.txt` and `Wiki/_drafts/K12/_failed-response.txt`
are generation failures sitting in the content tree, one directory away from the
indexer. **Work:** failures go to a log, never to the corpus.

### B3. 37 backup files inside the content tree (moderate)

`source_authority.json.bak-*`, `*.bak-preshellswap-*`, `usaspending_collect.py.bak-*`,
`test-questions-results-*.md`, `__pycache__/`. **Work:** backups and scratch go
outside the tree the indexer walks, or the indexer gets an explicit allowlist.

### B4. Collections that were created and never filled (high)

| Collection | Files |
|---|---:|
| `12-Oversight/DoD-IG` | **0** |
| `12-Oversight/CBO` | **0** |
| `12-Oversight/Service-and-Agency-IG` | **0** |
| `07-Analysis` | **0** |
| `15-Media-and-Trade` | **0** |
| `03-SOPs-Internal` | 1 |
| `05-Examples` | 1 |
| `16-Analysis` | 1 |
| `07-Financial-Statements-and-Audit-Reports` | **4** |

Two consequences worth naming:

- **DODIG-2026-032 is not in the bank.** The `/audit` page rests on it and the
  seed honestly records the citation as a *secondary read via the curated wiki
  page*. The primary document was never collected, and `12-Oversight/DoD-IG` —
  where it belongs — is empty.
- **The GAO collector is topic-blind.** 161 GAO reports, none about the F-35,
  though GAO publishes an annual F-35 assessment. It appears to have taken
  what was recent rather than what was on subject.

`07-Analysis` and `16-Analysis` are duplicate taxonomy, both empty.

**Work:** collectors should fail loudly on an empty collection, and subject
collection should be driven by a watchlist (program, agency, report series) not
by recency.

---

## C. Warehouse structure — pipeline design gaps

### C1. Account files have no vintage partitioning (high)

| Tree | Vintages | FY partitions |
|---|---:|---:|
| `contracts` | 2 | — |
| `assistance` | 2 | — |
| `accounts/file_a` | **0** | 6 |
| `accounts/file_b` | **0** | 6 |
| `accounts/file_c_contracts` | **0** | 6 |
| `accounts/file_c_assistance` | **0** | 6 |
| `accounts/file_c_unlinked` | **0** | 6 |

Award data is versioned; account data is overwritten. So **the question that
matters most — does File C ever backfill, or is the linkage permanently lost? —
cannot be answered**, because there is no history to compare. The lag-vs-
completeness test in the F-35 memo had to run on the contracts side, and could
only span one month.

**Work:** partition the account trees by vintage like the award trees. This is
the single highest-value change on this list.

### C2. Only two contract vintages retained (moderate)

`vintage=2026-07-06` and `vintage=2026-08-06`. A one-month step is too short to
separate slow backfill from permanent loss. **Work:** keep every monthly
vintage, or at minimum keep a small per-vintage summary table forever even when
the raw parquet is pruned.

---

## D. Source-data facts — measure and disclose, never "fix"

These are properties of DoD reporting, not defects in the collection. The
framework's job is to carry them, not to repair them.

1. **75% of contract dollars and 97.5% of actions carry no acquisition program.**
   Any program-level answer covers a quarter of the file at most.
2. **Account traceability decays: 26.5% (FY2021) → 59.8% (FY2025) → 68.3%
   (FY2026 PTD) of dollars name no Treasury account.** For F-35, 14.2% → 92.4%.
3. **File C linkage: 18.2% → 3.1%**, at `FY2025P12` — a closed year, so not lag.
   `017-1506` (Aircraft Procurement, Navy) has no rows after FY2021.
4. **`federal_accounts_funding_this_award` lists every account and apportions
   nothing.** Summing an obligation by account fabricates a split.
5. **FMS trust dollars (`011-8242`) sit on the same contract actions as
   Department appropriations** and cannot be separated. A program obligation
   total is therefore not a US-appropriation total.
6. **File A and File B have no program dimension at all.**

---

## E. Rules to add to `learned-rules.md`

The existing rules are about interpretation. These are about evidence:

- **A null test is not an emptiness test.** Coded federal fields encode "none"
  as a value. Check the sentinel before claiming coverage.
- **Never write that the data does not contain something.** An empty result
  means the filter matched nothing in the named vintage. Say that instead.
- **Publish the denominator with the measure.** A program figure without its
  coverage share, an obligation without its traceable share, reads as
  reconciled when it is not.
- **A field that is 97-100% empty is not a field.** `program_acronym` and
  `major_program` should be treated as unavailable, not as sparse.
- **Verify by running, not by type-checking.** `tsc` and `next build` both
  passed on a query Postgres rejects at runtime.

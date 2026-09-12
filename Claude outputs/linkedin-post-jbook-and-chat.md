# LinkedIn post — the justification archive + the local model chain

_Every figure below is from the live build; the source for each is in the notes at the
bottom. Public data only._

---

## Version A — the full post

**A justification book is not a genre. It is a specific document with a specific history.**

Two months in, datamatter now reads every Department of War justification book I can
get — 4,618 PDFs, FY1998 through FY2027 — and keeps each one as itself instead of
averaging them into a template. Then it puts a locally-run model on top that answers
from those books rather than from memory.

**WHAT GOES IN**
• 36.9M source records across the 40 public files the extract reads — 24.5M FPDS
contract actions, 12.0M File C award-to-account rows, File A and File B account
submissions, assistance transactions
• 4,618 justification-book PDFs (7.3 GB) → **2,058 distinct books over 4,555 editions**,
PB1998–PB2027, across O&M, procurement, RDT&E, MILCON, BRAC, family housing, the
working capital fund and the health program
• 8 President's Budget books of P-1/P-1R/R-1 exhibits (50,619 lines), 3,063 programme
lines, 542 weapon systems
• An 8,042-document DoD financial-management knowledge bank: FMR, appropriations
acts and NDAAs, committee reports, JES, 1,105 hearings, GAO and IG audits, CRS

**WHAT COMES OUT**
• 304,846 published rows across 17 datasets, 20 pages and 9 APIs
• **53 validation controls, 489 of 496 assertions passing** — and the seven that fail
are published as findings next to the data they concern, because a disagreement
between two federal files is a fact about the files, not a bug to hide
• Every figure names its source and its vintage

**WHAT THE ARCHIVE CAN TELL YOU THAT ONE BOOK CANNOT**
Each book restates its own format every year. DISA's OP-5 printed "Reconciliation of
Increases and Decreases" from PB2012 to PB2021 and has not since. That fact exists in
no single book — only in the fifteen editions held side by side. So the grain is
(book, President's Budget year) and nothing collapses it:

• each book's own section skeleton, weighted to recent editions on a three-year
half-life, so what it does now outranks what it did in PB2011
• the word band each section actually runs to — DISA's Description of Operations
Financed: median 284 words, 226–6,985 across its editions
• **23% of all sections carry dated or scheduled language** — measured, not asserted.
That is where a book goes stale first, and a drafter is shown exactly where

**THE AI PART, AND ITS RULES**
Two Qwen models run on a Mac Studio in my office — fine-tuned on this corpus — with a
commercial model behind them as a fallback. Not a wrapper around somebody's API:

• every question is retrieved against the site's own corpus first — the books' own
passages with book, PB year and page number, the measures, the controls, the defined
terms — then handed to the model
• every answer names the model that wrote it. An answer from the commercial fallback
has not read the justification books, and you should not have to guess which one you
are reading
• the chain falls back only *before* the first token. Once a model has started writing,
a failure is reported as a truncated answer, never silently rewritten by another model
• no prompt, completion or key is ever logged

**AND IT WRITES ONE**
Pick a book, give it one line about the subject, and it scaffolds the next edition in
that book's own section order with that book's own word bands — every body a bracketed
placeholder, because a blank is obviously unfinished and a fabricated figure survives
review. Draft a section on the local model, edit in place, upload a revised .docx and
it matches your headings back to their sections. Before it goes: a readiness check that
blocks on a missing required section, a placeholder left behind, or a phrase that must
not reach Congress — the FMR requires a PBD number in the internal submission and
forbids it in the narrative, and that distinction is enforced rather than explained.

**WHY THIS MATTERS FOR FM**
Formulation, execution, funds control, contracting, reconciliation, audit posture —
the questions are the same every year, and the work is mostly proving a number is
allowed to be on the page. This build does that proving in the load transaction: a
critical control failure rolls the whole load back and the previous vintage stays
published. It also says how old the data is, which nothing else did: the warehouse held
FY2026 P09 while P10 had been public for ten days, and the site now says so on the page
instead of showing June as current.

Public data only. No CUI.

#FederalFinance #PPBE #BudgetExecution #DoD #DataEngineering #LocalLLM #OpenData

---

## Version B — the short post

**2,058 justification books. 4,555 editions. FY1998 to FY2027.**

datamatter now reads the whole Department of War justification archive — 4,618 public
PDFs — and keeps every book as itself instead of averaging them into a template.

Why that matters: each book restates its own format every year. DISA's OP-5 printed
"Reconciliation of Increases and Decreases" from PB2012 to PB2021 and has not since.
That fact exists in no single book.

So you get, per book: its own section skeleton weighted to recent editions, the word
band each section actually runs to, and the 23% of sections carrying dated or scheduled
language — the part that goes stale first.

On top of it: two Qwen models on a Mac Studio, fine-tuned on the corpus, with a
commercial fallback behind them. Every question is retrieved against the books' own
passages first — book, PB year, page number — and every answer names the model that
wrote it, because an answer from the fallback has not read these books.

And it drafts the next edition in that book's own shape, with a screen that will not
let a predecisional reference reach a page bound for Congress.

304,846 published rows, 53 controls, 489 of 496 assertions passing — and the seven
failures published as findings, because two federal files disagreeing is a fact about
the files.

Public data only. No CUI.

#FederalFinance #PPBE #BudgetExecution #LocalLLM #OpenData

---

## Notes — where each figure comes from

| Figure | Source |
|---|---|
| 36.9M source records, 40 files | `dm_raw_source.total_rows`, parquet footers + workbook row counts |
| 24.5M FPDS actions / 12.0M File C rows | same table, per file |
| 4,618 PDFs, 7.3 GB | `11-Budget-Justification` inventory, FY1998–FY2027 |
| 2,058 books / 4,555 editions | `dm_jbook_book`, `dm_jbook_book_year` (grain: book × PB year) |
| 23% of sections time-sensitive | `dm_jbook_book_section.time_hits > 0` over all section rows |
| DISA OP-5 band and dropped section | `dm_jbook_book_skeleton` for `om/disaop5`, 15 editions |
| 50,619 exhibit lines / 3,063 programme lines / 542 weapon systems | `dm_exhibit_line`, `dm_exhibit_program`, `dm_weapon_system` |
| 8,042 knowledge-bank documents | `dm_kb_inventory`, nine collections |
| 304,846 rows / 17 datasets | `sum(dm_load.row_count) where is_current` |
| 53 controls, 489 of 496 assertions | `dm_control`, `dm_control_result` |
| 20 pages, 9 APIs | repo route count |
| P09 vs P10 currency finding | `CUR-01` against the USAspending submission calendar |

**Public sources used:** USAspending.gov (File A, File B, File C, FPDS prime award
transactions, financial assistance, submission-period API) · comptroller.defense.gov
(President's Budget justification books FY1998–FY2027, the "-1" exhibits, the weapons
book) · DoD Agency Financial Report · DoD OIG and GAO reports · CRS · congressional
committee reports, joint explanatory statements and hearings · Treasury USSGL · OMB
Circulars A-11 and A-136 · DoD FMR 7000.14-R.

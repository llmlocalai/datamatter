
## E. The budget-justification archive — what the exhibit spine needs next

Added 2026-09-09, after wiring the P-1/P-1R/R-1 books into `dm_exhibit_*`. Eight
books parsed cleanly (PB2020–PB2027) and their totals tie exactly to the
Department's own weapons book, so these are extensions rather than repairs.

### E1. The archive holds PB1998 onwards; only PB2020+ is parsed (moderate)

`11-Budget-Justification/_Archive` has a directory per fiscal year back to
FY1998. `PB_YEARS` stops at 2020 because that is where the `_Year-Level`
spreadsheet exhibits begin in a shape the resolver handles. Two things the
collector could establish, and neither needs a guess:

- for each `FY####/_Year-Level/`, which of `p1`, `p1r`, `r1`, `c1`, `m1`, `o1`,
  `rf1` exist and in what format (`.xlsx`, `.xls`, PDF only);
- for the spreadsheet ones, the header row as published, so the alias table in
  `EXHIBIT_COLS` can be extended from evidence rather than by trying years until
  one parses.

Every extra book is another year of restatement history, which is the one thing
these exhibits carry that no other source here does.

### E2. No weapons book for PB2027 (moderate — verify, do not assume)

`Program-Acquisition-Costs-by-Weapons-System_*.pdf` is present for PB2020
through PB2026 and absent for PB2027. That absence is why `EXH-08` has fourteen
results rather than sixteen, and why the PB2027 request — $413.1B procurement,
$343.7B RDT&E, both far above any prior year — currently has no external check.
Establish whether the PB2027 book exists and was not collected, or has not been
published. **Do not write copy either way until that is known.**

### E3. The `_ooc` exhibit variants are excluded and unexamined (low)

`_exhibit_files` skips any filename containing `_ooc`. Nothing here knows what
that variant is. Profile one against its main counterpart: if it is a scope cut
(overseas contingency operations), it is another dimension the spine could carry;
if it is a restatement, it belongs behind `is_memo` like the others.

### E4. Contract obligations by federal account (high — this is the missing join)

The chain on `/program` runs budget line → Treasury account → File A → contract,
and the last step is the weak one: the contract file is cut by FPDS acquisition
program code, roughly three quarters of DoD contract dollars carry code `000`
(`NONE`), and only the programs this site features have an account cut at all. A
contract-obligation cut keyed on `federal_accounts_funding_this_award` would let
any of the 37 Treasury accounts the exhibits name reach the contract file
directly, instead of only through the acquisition programs that happen to be
featured.

Two constraints learned the hard way: the account field is a **list** and the
obligation is **not apportioned across it**, so the cut has to be by account
*set* exactly as `dm_program_account` does; and pass 2 of the program ETL hit
OOM on this warehouse at ~4.2M rows on a 3.9 GB box, so the aggregation has to
stream rather than materialise.

### E5. The Organization column is unusable as a grouping key (resolved, recorded)

The exhibits' own `Organization` column spells the same component four ways
across eight books — `NAVY` and `N`, `ARMY` and `A`, `AF` and `F`, plus `OSD`,
`DMACT`, `DEFW`, `MDA`, `DISA`, `DARPA`, `SOCOM`, `CYBER`. It is kept verbatim
and a stable `component` is derived from the account symbol's organisation
letter instead. If the collector ever normalises this column, keep the raw value:
the drift is itself a fact about the source.

### E6. Two exhibit accounts have no File A row (low)

35 of the 37 Treasury accounts the exhibits resolve to now join to File A, after
the account dimension was widened from the top forty to every account. The two
that do not are new or credit-program accounts (`097-0362` Defense Strategic
Capital Credit Program is one). Confirm whether they are absent from File A
itself or absent from the vintage held, and record which — the page currently
says only that the extract has no row, which is true and is as far as the
evidence goes.

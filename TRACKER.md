# datamatter — Work Tracker

- **Last updated:** 2026-09-08
- **Live site:** https://datamatter.vercel.app
- **Build status (as of 2026-08-27):** `tsc --noEmit` clean; `next build`
  prerenders all 18 routes against a loaded database. The 2026-09-08 changes
  below pass `tsc --noEmit` but have **not** been run through `next build` or
  `npm run refresh` — that needs Neon/warehouse access this session did not
  use. Run `npm run refresh && npm run verify` before treating them as shipped.
- **Control status (as of 2026-08-27):** 85 of 87 assertions pass. The two
  failures are `TIE-01` (File A vs File B obligations, FY2022 and FY2026) and
  are published as findings. `ASSIST-01` (new, 2026-09-08) has not run yet.

---

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

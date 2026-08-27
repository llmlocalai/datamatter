# datamatter — Work Tracker

- **Last updated:** 2026-08-27
- **Live site:** https://datamatter.vercel.app
- **Build status:** `tsc --noEmit` clean; `next build` prerenders all 18 routes
  against a loaded database (verified 2026-08-27).
- **Control status:** 85 of 87 assertions pass. The two failures are `TIE-01`
  (File A vs File B obligations, FY2022 and FY2026) and are published as findings.

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
- [ ] Re-run linkage at successive vintages for the same FY to test the lag
  hypothesis directly.
- [ ] `/budget` is still a client component fetching its own API; convert to a
  server component like the rest.
- [ ] Investigate the File A / File B FY2026 divergence (34.9%) now that
  submission periods are confirmed identical.
- [ ] Assistance (grants/loans) and `file_c_unlinked` as additional use cases.
- [ ] Rate limiting on `/api/regulation`; module-scope cache for the BM25 index.

## Changelog

- **2026-08-27** — Full rebuild against the live warehouse and knowledge bank.
  Moved from baked JSON snapshots to Neon with transactional loads and in-band
  control testing; added `/execution`, `/reconciliation`, `/sources`,
  `/definitions`, `/controls`; rebuilt `/audit` (was `/gao`), `/ppbe`,
  `/congressional`, `/funds-control`, `/contracting` on real data; removed the
  fabricated-data pipeline entirely.
- **2026-08-23** — Tracker created; OUSD(C)→DoD rebrand finished in docs.

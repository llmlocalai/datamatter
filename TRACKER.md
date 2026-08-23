# datamatter — Work Tracker

Living tracker for the **datamatter** (DoD AI Solutions) Next.js 14 / Vercel app.
This is the single source of truth for "what's left in this repo." Update it on
every review.

- **Last updated:** 2026-08-23
- **Branch / head:** `main` @ `39a9c1b`
- **Live site:** https://datamatter.vercel.app
- **Build status:** `npx tsc --noEmit` passes (2026-08-23).

---

## How to use this file (the convention)

- **Open** — work still to do. Add new requirements here as `- [ ] …`.
- **Done** — completed work, checked off with `- [x] …`. Do not delete; it is the record.
- **Changelog** — append one line per change: `YYYY-MM-DD — <what changed, why>`.
- When a feature moves Open → Done, move its bullet and log it in the Changelog.
- Keep the **Shipped features** table current — if a page/route/data source is added,
  add a row; if one is removed, strike it out and log it.

---

## Shipped features (verified 2026-08-23)

| # | Feature | Page | API route(s) | Data source | Status |
|---|---------|------|--------------|-------------|--------|
| 1 | **FY2027 Budget dashboard** | `/budget` | `/api/budget-fy27`, `/detail`, `/document` | Neon Postgres (`war_budget_line` / `war_budget_file` / `war_budget_document`) | ✅ Done |
| 2 | **Contracting & Procurement Intelligence** | `/contracting` | `/api/contracting` | `contracting_intelligence.json` (USASpending 097, FY21–26) | ✅ Done |
| 3 | **Funds Control / budget execution** | `/funds-control` | `/api/funds-control` | `funds_control.json` (file_a, TAS level) | ✅ Done |
| 4 | **Regulatory Q&A (RAG, BM25 + authority)** | `/regulation` | `/api/regulation` | `knowledge_index.json` (DoD-FM wiki, 75 pages) | ✅ Done |
| 5 | **PPBE Compliance** | `/ppbe` | `/api/ppbe` | `ppbe.json` + `ppbe_compliance.json` | ✅ Done |
| 6 | **GAO Audit Findings** | `/gao` | `/api/gao` | `gao.json` | ✅ Done |
| 7 | **Congressional Oversight** | `/congressional` | `/api/congressional` | `congressional.json` + `congressional_tracking.json` | ✅ Done |
| 8 | **Showcase landing** | `/showcase` | — | — | ✅ Done |
| 9 | **Home / marketing** | `/` | — | — | ✅ Done |

**Data pipeline (ETL → baked JSON → thin API → UI):**
`scripts/etl_contracting.py` · `etl_funds_control.py` · `etl_kb_scan.py` ·
`etl_knowledge_index.py` · `ingest_war_budget.js` (loads FY2027 exhibits into Neon).
ETLs run only on this Mac (need pyarrow + `/Volumes/AI_DATA`); never on Vercel.
See `CLAUDE.md` for the "frozen snapshot vs live tool" rule.

---

## Open — incomplete / to finish

- [ ] **Remove orphaned legacy budget path** (superseded by the FY2027 `/budget`
  dashboard; **no page or route calls it**):
  - `app/api/budget/route.ts`
  - `lib/data-service.ts` (unused — grep finds no importers)
  - `app/api/data/budget_by_function.json`, `budget_by_agency.json`,
    `budget_by_fiscal_year.json`, `budget_by_subfunction.json`
  - `scripts/export_to_json.py`, `scripts/explore_data.py` feed only these.
  **Needs a decision** (removing code). Tracked here, not auto-deleted.
- [ ] *(roadmap)* Auth / RBAC in front of the API routes (Vercel Middleware).
- [ ] *(roadmap)* Cron refresh of the ETL JSON snapshots so they stay current.
- [ ] *(roadmap)* Semantic (vector) retrieval for `/regulation` if an embedder is provisioned on the runtime.
- [ ] *(roadmap)* Assistance + `file_c` (grants/loans, unlinked contract detail) as additional use cases.

---

## Done (record)

- [x] **2026-08-23** — FY2027 "-1" budget dashboard: 7 exhibits, by-service / by-activity,
  paginated/sortable line-item explorer (`components/budget/DetailTable.tsx`), and
  document download streaming from Neon bytea (`components/budget/DocumentPanel.tsx` +
  `/api/budget-fy27/document`).
- [x] **2026-08-23** — OUSD(C) → DoD rebrand across the **UI** (Navbar, Footer,
  Showcase, About, Hero, layout).
- [x] **2026-08-23** — OUSD(C) → DoD rebrand across the **markdown docs** (the half
  of the rebrand left unfinished by commit `39a9c1b`). Rewrote `SHOWCASE_README.md`,
   `IMPLEMENTATION_SUMMARY.md`, `DATA_SOURCES.md` (SQLite → Neon Postgres; 4 → 9
  showcases; real API table + pipeline) and fixed `USE_CASES.md` (2× "OUSD(C)" →
  "DoD"). Verified: no "OUSD"/"SQLite" left in any doc.
- [x] **2026-08-23** — `/congressional` fixed to assemble `oversight_requests`
  (per-quarter request/response counts) + `testimony_scheduled` from the two source files.
- [x] **2026-08-23** — GAO, PPBE, contracting, funds-control, regulation pages wired to baked JSON.
- [x] **2026-08-23** — Full-repo audit: all 9 pages + 12 API routes reviewed; `tsc --noEmit` clean.

---

## Changelog

- **2026-08-23** — Tracker created. Audited all 9 pages, 12 API routes, and 6 ETL
  scripts. Confirmed `tsc --noEmit` passes. **Finished the incomplete OUSD(C)→DoD
  rebrand** — the last commit rebranded the UI but left the docs stale (OUSD(C),
  SQLite, only 4 showcases); rewrote 3 docs + fixed 1, verified none remain. Added
  `tsconfig.tsbuildinfo` to `.gitignore`.

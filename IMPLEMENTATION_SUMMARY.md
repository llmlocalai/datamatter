# DoD Budget & Audit Showcases — Implementation Summary

## Overview

Production-ready, data-driven showcases for senior budget analysts at the
Department of Defense (DoD). Unlike the original demo dashboards — which returned
3–4 hardcoded placeholder rows — every use case below is **wired to live data**
(the USASpending warehouse and the DoD-FM knowledge bank), behind a proper
**ETL → baked JSON / Neon Postgres → thin API → UI** pipeline.

## Shipped pages (9)

| Page | Path | Purpose |
|------|------|---------|
| FY2027 Budget dashboard | `/budget` | 7 "-1" exhibits, by-service/by-activity, line-item explorer, doc download |
| Contracting & Procurement Intelligence | `/contracting` | Obligations, prime contractors, set-asides, sole-source exposure |
| Funds Control / budget execution | `/funds-control` | Obligation/outlay rates, unobligated (lapse) exposure, TAS accounts |
| Regulatory Q&A (RAG) | `/regulation` | Cited, authority-ranked retrieval over the DoD-FM wiki |
| PPBE Compliance | `/ppbe` | Program compliance, OMB A-30, justification quality |
| GAO Audit Findings | `/gao` | Findings & material-weakness trends, finding-type distribution |
| Congressional Oversight | `/congressional` | Requests by quarter, response rate, testimony schedule |
| Showcase landing | `/showcase` | All showcases in one grid |
| Home / marketing | `/` | Landing page |

## API endpoints (12)

| Endpoint | Purpose | Data source |
|----------|---------|-------------|
| `/api/budget-fy27` | FY2027 overview | Neon Postgres (`war_budget_*`) |
| `/api/budget-fy27/detail` | Paginated/sortable line items | Neon Postgres |
| `/api/budget-fy27/document?id=` | Stream a stored source doc | Neon `war_budget_file` (bytea) |
| `/api/contracting` | Contracting & procurement | `contracting_intelligence.json` |
| `/api/funds-control` | Funds control / execution | `funds_control.json` |
| `/api/regulation?q=` | Regulatory Q&A (RAG) | `knowledge_index.json` |
| `/api/ppbe` | PPBE compliance | `ppbe.json` + `ppbe_compliance.json` |
| `/api/gao` | GAO findings | `gao.json` |
| `/api/congressional` | Congressional oversight | `congressional.json` + `congressional_tracking.json` |
| `/api/budget` | *(orphaned — legacy, superseded by budget-fy27)* | `budget_by_*.json` |

## Data infrastructure

- **Database:** **Neon (serverless Postgres)** via `lib/db.ts` — the FY2027 budget
  tables (`war_budget_line`, `war_budget_file`, `war_budget_document`).
- **Baked JSON snapshots:** `app/api/data/*.json`, produced by the ETLs. These are
  a **frozen copy** of the warehouse the brainbank tools read live — see `CLAUDE.md`
  for the "tool is the authority; JSON is the last ETL vintage" rule.
- **ETL / processing:** Python (Pandas, PyArrow) in `scripts/`; the FY2027 ingest
  is `scripts/ingest_war_budget.js`.
- **Schemas:** `database/schema.neon.sql`, `database/war_budget_schema.sql`.

> ETL scripts read `/Volumes/AI_DATA` directly and need pyarrow, so they **only run
> on this Mac**, never on Vercel. Vercel functions cannot scan the parquet warehouse
> — that is the whole reason the baked JSON / Neon tables exist.

## Technology stack

**Frontend**
- Next.js 14 + React 18, TypeScript, Tailwind CSS, glass-morphism components.

**Data processing**
- Python with Pandas + PyArrow (streaming parquet); Node.js ingest for FY2027.
- Neon serverless Postgres for the FY2027 budget data.

**Data sources**
- USASpending (agency 097 — DoD)
- DoD Financial Management Regulation (FMR)
- OMB Circulars
- Congressional Research Service reports
- GAO audit reports

## Data flow

```
USASpending (parquet)   DoD-FM knowledge bank
        │ 15–24M awards          │ 75 curated pages
        ▼                        ▼
 scripts/etl_*.py          scripts/etl_knowledge_index.py
        │ compact JSON              │ knowledge_index.json
        └───────────┬──────────────┘
                    ▼
         app/api/data/*.json  (baked, < 500 KB)
                    ▼
         app/api/* route.ts  (thin, stateless)
                    ▼
         app/*/page.tsx      (React UI)

FY2027: scripts/ingest_war_budget.js  →  Neon Postgres  →  /api/budget-fy27
```

## Key features

### FY2027 Budget dashboard
- 7 "-1" exhibits (C-1, M-1, O-1, P-1, P-1R, R-1, RF-1), de-duplicated to each
  exhibit's canonical sheet.
- 3-year totals, discretionary vs mandatory, by-service / by-activity.
- Interactive, paginated, sortable, filterable line-item explorer.
- Source-document download streamed from the Neon bytea store.

### Contracting & Procurement Intelligence
- Obligation by awarding component; top prime contractors.
- Small-business / set-aside participation; FAR 6.302 sole-source exposure.
- FY selector (FY2021–FY2026).

### Funds Control
- Obligation & outlay rates; unobligated (lapse) balance with a >25% risk flag.
- Top obligating Treasury accounts; FY-over-FY execution trend.

### Regulatory Q&A
- Cited, authority-ranked answers; primary regulation/statute outranks summaries.

## Next steps (roadmap — not yet built)

1. **Auth / RBAC** in front of the API routes (Vercel Middleware / identity provider).
2. **Cron refresh** so the baked JSON / Neon data stay current.
3. **Semantic (vector) retrieval** for `/regulation` if an embedder is provisioned.
4. **Assistance + file_c** (grants/loans, unlinked contract detail) as new use cases.
5. **Remove the orphaned legacy budget path** (`/api/budget`, `lib/data-service.ts`,
   `budget_by_*.json`) — superseded by the FY2027 dashboard. Tracked in `TRACKER.md`.

## Usage

### Development
```bash
cd /Volumes/AI_DATA/git/datamatter
npm install
npm run dev
```

### Production build (what Vercel runs)
```bash
npm run build
npm run start
```

### Data refresh (runs on this Mac only)
```bash
python3 scripts/etl_contracting.py       # contracting_intelligence.json
python3 scripts/etl_funds_control.py      # funds_control.json
python3 scripts/etl_kb_scan.py            # gao / ppbe / congressional / budget
python3 scripts/etl_knowledge_index.py    # knowledge_index.json
node scripts/ingest_war_budget.js         # FY2027 → Neon Postgres
```

## Contact

For questions or issues, contact the DoD AI Solutions team.

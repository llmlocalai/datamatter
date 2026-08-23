# Data Sources for the DoD Budget & Audit Showcases

## Overview

This document describes the data sources behind the datamatter showcases: the
USASpending warehouse, the DoD-FM knowledge bank, the baked JSON snapshots, and
the FY2027 budget data in Neon Postgres.

## Data sources

### 1. USASpending warehouse (live source of truth)

**Location:** `/Volumes/AI_DATA/data/usaspending/`

Comprehensive USASpending data for Department of Defense (DoD) agency code **097**.

**Data types:**
- Account-level budget data (Parquet files)
- Contract awards
- Assistance transactions
- Reference data (agency codes, CFDA, NAICS, etc.)

**File structure:**
```
warehouse/
├── accounts/
│    ├── file_a/ (account-level / budget-execution data)
│    │    └── fiscal_year=*/data_0.parquet
│    ├── file_b/ (assistance data)
│    └── file_c_contracts/ (contract data)
├── assistance/ (assistance vintage data)
└── contracts/ (contract vintage data)
```

> The ETL scripts read these parquet files **directly, on this Mac only** (they
> need pyarrow). Vercel functions cannot scan them — which is why the app serves
> baked JSON / Neon tables instead.

### 2. DoD Financial Management knowledge bank

**Location:** `/Volumes/AI_DATA/knowledge-bank/DOD-FM-Knowledge-Bank/`

Curated DoD financial-management regulations, guidance, and documents.

**Key folders:**
- `01-Regulations/` — FMR DoD 7000.14-R, OMB Circulars, Treasury USSGL TFM
- `02-DoD-Guidance/` — DFAS, Army, Navy, Air Force FM Regulations
- `08-CRS-Congressional-Research-Service/` — CRS reports on the defense budget
- `11-Budget-Justification/` — Budget-justification documents and exhibits
- `12-Oversight/` — GAO reports, DoD IG reports
- `04-Reference-Data/` — Master data files

The curated wiki subset used by `/regulation` is `knowledge-bank/Wiki/DOD-FM`
(75 pages), indexed by `scripts/etl_knowledge_index.py` into `knowledge_index.json`.

### 3. Baked JSON snapshots (what the API serves)

**Location:** `/Volumes/AI_DATA/git/datamatter/app/api/data/`

Pre-aggregated JSON produced by the ETLs and read at request time. This is a
**frozen snapshot** of the warehouse — see `CLAUDE.md`: when a figure here and the
live brainbank tool disagree, that is a **vintage difference**, and the fix is to
re-run the ETL, never to hand-edit the JSON.

**Files:**
- `contracting_intelligence.json` — contracting & procurement (USASpending 097)
- `funds_control.json` — budget execution / unobligated balance (file_a)
- `gao.json` — GAO findings (aggregated)
- `ppbe.json` + `ppbe_compliance.json` — PPBE compliance
- `congressional.json` + `congressional_tracking.json` — congressional oversight
- `knowledge_index.json` — BM25 index over the DoD-FM wiki (for `/regulation`)
- `budget_by_*.json` — **orphaned legacy** (superseded by the FY2027 dashboard;
  still emitted by `scripts/export_to_json.py`). Tracked in `TRACKER.md`.

### 4. FY2027 budget data — Neon (serverless Postgres)

**Connection:** via `lib/db.ts` (`DATABASE_URL` in `.env.local`, gitignored).

**Tables:**
- `war_budget_line` — line items for the 7 exhibits (C-1, M-1, O-1, P-1, P-1R, R-1, RF-1), with a `values` JSONB per row and `fiscal_year`.
- `war_budget_file` — stored source-document bytes (bytea), streamed by `/api/budget-fy27/document`.
- `war_budget_document` — catalog of the 37 FY2027 source files.

Loaded by `scripts/ingest_war_budget.js` from `comptroller.war.gov`.

### 5. Regulatory reference documents

**DoD Financial Management Regulation (FMR)**
- Version: DoD 7000.14-R (2026)
- Key volumes: Vol 1 (General FM Information Systems), Vol 2A/B (Budget
  Formulation & Presentation), Vol 3 (Budget Execution), Vol 6A/B (Reporting &
  Audited Financial Statements).

**OMB Circulars**
- A-11: Budget Preparation and Execution
- A-123: Internal Controls
- A-136: Financial Report Requirements

## Data processing pipeline

```
USASpending API  →  Parquet warehouse  →  Python ETL (pyarrow)  →  baked JSON  →  Next.js API  →  UI
FY2027 exhibits  →  comptroller.war.gov  →  ingest_war_budget.js  →  Neon Postgres  →  /api/budget-fy27
```

All SQL in the FY2027 path is parameterized (values bound, never interpolated).

## Data dictionary

### Budget Functions (legacy `budget_by_function.json`)
| Field | Type | Description |
|-------|------|-------------|
| function_name | string | Name of the budget function |
| amount | float | Total budget amount in USD |
| fiscal_year | int | Fiscal year |

### PPBE Compliance (`ppbe_compliance.json`)
| Field | Type | Description |
|-------|------|-------------|
| program_name | string | Name of the program |
| status | string | Compliance status |
| review_date | string | Date of last review |

### GAO Findings (`gao.json`)
| Field | Type | Description |
|-------|------|-------------|
| year | int | Year of the finding |
| findings | int | Count of findings |
| material_weaknesses | int | Count of material weaknesses |

### Congressional Requests (`congressional_tracking.json`)
| Field | Type | Description |
|-------|------|-------------|
| committee | string | Congressional committee |
| request_date | string | Date of request (YYYY-MM-DD) |
| response_date | string \| null | Date of response (null = not yet responded) |
| status | string | Request status |

## Usage examples

```bash
# FY2027 budget overview
curl http://localhost:3000/api/budget-fy27

# FY2027 line items for one exhibit (e.g. O-1), page 1
curl "http://localhost:3000/api/budget-fy27/detail?exhibit=o1&sort=fy2027&order=desc&page=1"

# Contracting intelligence (default = most complete fiscal year)
curl http://localhost:3000/api/contracting

# Regulatory Q&A
curl "http://localhost:3000/api/regulation?q=antideficiency+act+violation&top=8"

# PPBE / GAO / congressional
curl http://localhost:3000/api/ppbe
curl http://localhost:3000/api/gao
curl http://localhost:3000/api/congressional
```

## Data refresh

ETLs run **on this Mac only** (pyarrow + `/Volumes/AI_DATA`). The Python
interpreter with pyarrow is
`/Volumes/AI_DATA/apps/agent-server/venv/bin/python3`.

```bash
python3 scripts/etl_contracting.py        # contracting_intelligence.json
python3 scripts/etl_funds_control.py       # funds_control.json
python3 scripts/etl_kb_scan.py             # gao / ppbe / congressional
python3 scripts/etl_knowledge_index.py     # knowledge_index.json
node scripts/ingest_war_budget.js          # FY2027 exhibits → Neon Postgres
```

Then rebuild and redeploy: `npm run build && vercel --prod`. The web app needs
no code change to pick up refreshed data — it only reads the baked JSON / Neon.

## Compliance notes

- All data handling complies with DoD data governance policies.
- No classified or PII data is stored in this system.
- Data is for internal DoD use only.

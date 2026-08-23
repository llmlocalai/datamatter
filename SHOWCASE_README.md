# DoD Budget & Audit Showcases

Enterprise-grade, production-ready showcases for senior budget analysts at the
Department of Defense (DoD). Every showcase is wired to **live data** — the
USASpending warehouse and the DoD-FM knowledge bank — not hardcoded rows.

## Overview

This showcase set demonstrates AI and data-engineering solutions for:

- **FY2027 budget analysis** (the seven "-1" display tables, de-duplicated)
- **PPBE Process** (Planning, Programming, Budgeting, Execution)
- **OMB A-30 / 130** compliance tracking
- **GAO audit findings** management
- **Congressional oversight** coordination
- **Contracting & procurement intelligence** and **funds control / lapse risk**

## Available showcases

### 1. FY2027 Budget dashboard (`/budget`)
**Purpose:** Interactive analysis of the seven DoD budget "-1" display tables
(C-1, M-1, O-1, P-1, P-1R, R-1, RF-1), sourced from the official exhibits.
- 3-year (FY25→FY27) totals, discretionary vs mandatory split
- By-service / by-budget-activity breakdowns
- Paginated, sortable, filterable **line-item explorer** per exhibit
- Source-document download (streamed from the Neon bytea store)
**Data source:** Neon Postgres (`war_budget_line`, `war_budget_file`,
`war_budget_document`), loaded by `scripts/ingest_war_budget.js`.

### 2. Contracting & Procurement Intelligence (`/contracting`)
**Purpose:** Where DoD procurement money goes, to whom, and how much is
non-competitive.
- Obligation by awarding component; top prime contractors
- Small-business / set-aside participation (8(a), SDVOSB, WOSB, HUBZone)
- Non-competitive / sole-source exposure (FAR 6.302 authorities)
- FY selector across FY2021–FY2026
**Data source:** `contracting_intelligence.json` — USASpending agency 097,
~15–24M contract awards (ETL: `scripts/etl_contracting.py`).

### 3. Budget Execution & Funds Control (`/funds-control`)
**Purpose:** How much of the appropriated budget is obligated, how much is at
risk of lapse, and which Treasury accounts consume the most.
- Obligation rate & outlay rate per fiscal year
- Unobligated balance = lapse / antideficiency exposure, with a **>25% lapse-risk flag**
- Top obligating Treasury accounts; FY-over-FY trend
**Data source:** `funds_control.json` — USASpending file_a at TAS granularity
(ETL: `scripts/etl_funds_control.py`).

### 4. Regulatory Q&A (RAG) (`/regulation`)
**Purpose:** Cited, authority-ranked answers to "what does the FMR / OMB Circular
/ GAO Red Book say about X?"
- Best answer + supporting sources, each with a **primary-source citation**
- Source-authority re-ranking: regulation/statute outrank secondary summaries
**Data source:** `knowledge_index.json` — BM25 over the curated, authority-tagged
DoD-FM knowledge wiki (75 pages; ETL: `scripts/etl_knowledge_index.py`).

### 5. PPBE Compliance (`/ppbe`)
**Purpose:** Program compliance with the Planning, Programming, Budgeting System.
- Overall compliance rate; non-compliant programs
- OMB Circular A-30 submitted/approved/pending/rejected
- Budget-justification quality buckets
**Data source:** `ppbe.json` + `ppbe_compliance.json`.

### 6. GAO Audit Findings (`/gao`)
**Purpose:** GAO findings and material weaknesses across DoD financial statements.
- Year-over-year findings & material-weakness trend
- Finding-type distribution
**Data source:** `gao.json`.

### 7. Congressional Oversight (`/congressional`)
**Purpose:** Congressional requests, testimony schedules, and response rates.
- Oversight requests by quarter (requests vs responses, per-quarter rate)
- Upcoming testimony schedule by committee
**Data source:** `congressional.json` + `congressional_tracking.json`.

## Technology stack

### Data engineering
- **Data sources:** USASpending, FMR, OMB Circulars, CRS Reports, GAO Reports
- **Storage:** Parquet warehouse + **Neon (serverless Postgres)**
- **Processing:** Python (Pandas, PyArrow) ETL scripts in `scripts/`
- **Pattern:** pre-aggregate in ETL → bake compact JSON → thin serverless route → UI

### Machine learning & AI
- **Retrieval:** BM25 lexical search with source-authority re-ranking (regulation RAG)
- **Use cases:** budget analysis, justification analysis, compliance scoring

### Visualization
- **Libraries:** custom React + SVG chart components (Tailwind CSS)
- **Dashboards:** glass-morphism Next.js client components

### Infrastructure
- **Frontend:** Next.js 14, React 18, TypeScript
- **Styling:** Tailwind CSS
- **Deployment:** Vercel (https://datamatter.vercel.app)
- **Database:** Neon (serverless Postgres)

## API endpoints

| Endpoint | Purpose |
|---|---|
| `GET /api/budget-fy27` | FY2027 overview (totals, exhibits, by-service, by-activity, documents) |
| `GET /api/budget-fy27/detail` | Paginated/sortable/filterable line items for one exhibit |
| `GET /api/budget-fy27/document?id=` | Stream a stored source document from the Neon bytea store |
| `GET /api/contracting[?fiscal-year=]` | Contracting & procurement intelligence |
| `GET /api/funds-control[?fiscal-year=]` | Funds control / budget execution (file_a) |
| `GET /api/regulation?q=&top=` | Regulatory Q&A (BM25 + authority) |
| `GET /api/ppbe` | PPBE compliance + OMB A-30 + justification quality |
| `GET /api/gao` | GAO audit findings |
| `GET /api/congressional` | Congressional oversight requests + testimony |

## Data flow

```
USASpending warehouse (parquet)   DoD-FM knowledge bank (markdown/PDF)
        │ 15–24M award rows              │ 75 curated wiki pages
        ▼                                ▼
  scripts/etl_*.py (pyarrow)      scripts/etl_knowledge_index.py (BM25+auth)
        │  compact JSON artifacts         │ knowledge_index.json
        └──────────────┬──────────────────┘
                       ▼
            app/api/data/*.json   (baked, < 500 KB each)
                       ▼
           app/api/* route.ts    (thin, stateless)
                       ▼
            app/*/page.tsx        (React UI)

  FY2027 budget: scripts/ingest_war_budget.js  →  Neon Postgres  →  /api/budget-fy27
```

**Key property:** the web app needs **no code change** to pick up refreshed data —
it only reads the baked JSON / Neon tables.

## Getting started

```bash
git clone <repo-url>
cd datamatter
npm install
npm run dev            # http://localhost:3000
```

Production build (what Vercel runs):

```bash
npm run build
npm run start
```

## Project structure

```
datamatter/
├── app/
│   ├── budget/            # FY2027 "-1" budget dashboard
│   ├── contracting/       # Contracting & procurement intelligence
│   ├── funds-control/     # Budget execution / lapse risk
│   ├── regulation/        # Regulatory Q&A (RAG)
│   ├── ppbe/              # PPBE compliance
│   ├── gao/               # GAO audit findings
│   ├── congressional/     # Congressional oversight
│   ├── showcase/          # Showcase landing page
│   ├── api/
│   │   ├── budget-fy27/  # / , /detail, /document
│   │   ├── contracting/  # /
│   │   ├── funds-control/
│   │   ├── regulation/
│   │   ├── ppbe/
│   │   ├── gao/
│   │   ├── congressional/
│   │   └── data/         # baked JSON snapshots
│   └── page.tsx          # Home / marketing
├── components/            # React components (+ components/budget/*)
├── lib/                   # db.ts (Neon), fy27-data.ts, data-service.ts
├── database/              # schema + war-budget source cache
├── scripts/              # ETL + ingest scripts (run on this Mac only)
└── TRACKER.md           # living work tracker
```

## Data sources reference

### USASpending
- URL: https://www.usaspending.gov
- Agency Code: 097 (DoD)
- Data types: Awards, Contracts, Assistance; file_a (budget execution)

### DoD Financial Management Regulation (FMR)
- Version: DoD 7000.14-R
- Volumes: Budget Execution, Accounting Policy, Disbursing Policy, etc.

### OMB Circulars
- A-11: Budget Preparation and Execution
- A-123: Internal Controls
- A-136: Financial Report Requirements

### Congressional Research Service / GAO
- CRS reports on the defense budget and appropriations
- GAO audit reports and findings; Red Book standards for financial statements

## License

This project is for internal DoD use only.

## Contact

For questions or issues, contact the DoD AI Solutions team.

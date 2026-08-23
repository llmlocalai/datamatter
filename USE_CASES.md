# Datamatter — Enterprise Use Cases (Live Data)

This document describes the **production-ready, data-driven use cases** built into the
`datamatter` (DoD AI Solutions) Next.js/Vercel application. Unlike the original
demo dashboards — which returned 3–4 hardcoded placeholder rows — each use case below is
**wired to the real USASpending warehouse and the DoD-FM knowledge bank**, with a proper
ETL → API → UI pipeline.

---

## The core architectural decision (why this is production-ready)

A Vercel **serverless function cannot scan 15–24M parquet rows at request time.**
That would blow the timeout, the memory limit, and the cost model.

The production pattern used here is a **pre-aggregation ETL step**:

```
   USASpending warehouse (parquet)        DoD-FM knowledge bank (markdown / PDF)
          │ 15.5M contract rows                    │  75 curated wiki pages
          │ 6 years of account data                │  + 1.86M-embed ChromaDB (local)
          ▼                                          ▼
   ┌─────────────────────┐                ┌──────────────────────┐
   │ scripts/etl_*.py     │                │ scripts/etl_knowledge │
   │ (pyarrow, streaming) │                │ _index.py (BM25+auth) │
   └──────────┬──────────┘                └──────────┬───────────┘
              ▼  small JSON artifacts                 ▼
   app/api/data/*.json  ─────►  app/api/* route.ts  ─────►  app/*/page.tsx
   (baked, < 500 KB each)        (thin, stateless)            (React UI)
```

- **ETL** (`scripts/`) — runs on a schedule / CI / cron. Streams parquet in bounded
  batches (peak memory = one batch, not a fiscal year), aggregates, and writes compact
  JSON to `app/api/data/`.
- **API** (`app/api/*`) — a *thin* serverless route that reads the baked JSON. Fast,
  stateless, within every Vercel limit.
- **UI** (`app/*/page.tsx`) — the existing glass-morphism design, now fed by real numbers.

This is exactly the "build step + thin runtime" pattern used for any real data app on
Vercel / Cloudflare / serverless Postgres, and it is what makes the data **refreshable**
(re-run the ETL) without touching the app.

---

## Use Case 1 — Contracting & Procurement Intelligence  (`/contracting`)

**Question it answers:** *Where is DoD's procurement money going, who gets it, and how
much is non-competitive?*

**Data:** USASpending contract warehouse, agency 097 (DoD), FY2021–FY2026, **~15.5M
contract award rows**. Aggregated by `scripts/etl_contracting.py`.

**What it surfaces (all real):**
- **Obligation by awarding component** — Navy, Army, Air Force, DLA, etc.
- **Top prime contractors** — e.g. FY2025: Lockheed Martin $62.5B, Raytheon $22.1B,
  Electric Boat $21.4B.
- **Small-business / set-aside participation** — 8(a), SDVOSB, WOSB, HUBZone in dollars.
- **Non-competitive / sole-source exposure** — the FAR 6.302 authority breakdown
  (e.g. "Only one source", "Mobilization/essential R&D", "National security").
- **NAICS sector concentration** and **awardee-state distribution**.
- **FY selector** to compare any fiscal year.

**Live check (FY2025, most complete year):** total obligated **$491.7B** across
**4,489,792** awards; ~42% of dollars under a non-competitive / sole-source authority.

**Files:** `scripts/etl_contracting.py`, `app/api/data/contracting_intelligence.json`,
`app/api/contracting/route.ts`, `app/contracting/page.tsx`.

---

## Use Case 2 — Budget Execution & Funds Control  (`/funds-control`)

**Question it answers:** *How much of the appropriated budget has been obligated, how much
is at risk of lapse, and which Treasury accounts are consuming the most?*

**Data:** USASpending **Budget-Execution Account Data (file_a)**, agency 097, FY2021–FY2026 —
the Statement of Budgetary Resources at **TAS (Treasury Account Symbol) granularity**.
Aggregated by `scripts/etl_funds_control.py`.

**What it surfaces (all real):**
- **Obligation rate** and **outlay rate** per fiscal year.
- **Unobligated balance = lapse / antideficiency exposure**, with a **>25% lapse-risk flag**.
- **Top obligating Treasury accounts** — e.g. "Payments to Military Retirement Fund, Defense",
  "Operation and Maintenance, Navy".
- **Obligation by agency** and **FY-over-FY trend** sparklines (obligation rate + unobligated $).

**Live check:** FY2026 (mid-year) shows **$2.58T** total budgetary resources at **49.9%
obligated**, **$1.29T** unobligated (50.1%) — correctly flagged as elevated lapse exposure
for a partial-year view. FY2025 closes near 70% obligated.

**Why it matters for DoD:** unobligated-balance monitoring is the frontline defense
against Antideficiency Act exposure and the raw input to apportionment decisions.

**Files:** `scripts/etl_funds_control.py`, `app/api/data/funds_control.json`,
`app/api/funds-control/route.ts`, `app/funds-control/page.tsx`.

---

## Use Case 3 — Regulatory Q&A (RAG over the DoD-FM knowledge bank)  (`/regulation`)

**Question it answers:** *"What does the FMR / OMB Circular / GAO Red Book say about X,
with a primary-source citation?"*

**Data:** the curated, **authority-tagged** DoD-FM knowledge wiki
(`knowledge-bank/Wiki/DOD-FM`, 75 pages) — e.g. *Antideficiency-Act-Violation-Process*,
*Apportionment-and-Reapportionment-Process*, *FIAR-Methodology-Waves*, *Defense-Working-Capital-Funds*.

**How it works:**
- `scripts/etl_knowledge_index.py` chunks every page into section-anchored passages,
  strips titles/HTML-comments/cross-link noise, and builds a **BM25 index** (IDF + length
  normalization) plus a **source-authority weight** per chunk.
- Authority weighting mirrors `knowledge-bank/source_authority.json`: primary regulation,
  statute, GAO Red Book, and antideficiency material rank **above** secondary CRS/trade
  summaries; pure "Related: [[...]]" cross-link chunks are demoted so the top hit is always
  a **substantive definition with a real source path**.
- `app/api/regulation/route.ts` scores the query at request time (O(query · top-k) — the
  heavy lifting is in the pre-built index) and returns a **best-answer + supporting
  sources, each with its primary-source citation**.

**Why BM25 + authority, not the vector index, in the web app:**
The 1.86M-embedding ChromaDB index powers the *local* Open WebUI agent (which has an
embedder). A Vercel function has no embedder and cannot load 1.86M vectors per request.
For regulatory lookups — dominated by exact statutory/technical terms (*Antideficiency Act*,
*FIAR Wave 3*, *A-123*, *U.S. Code 31*) — precise lexical matching with authority
re-ranking is both serverless-safe and often more accurate than semantic similarity.

**Live check:** `?q=antideficiency+act+violation` → answer "Antideficiency Act Violation
Process" cited to `FMR-Vol14_Administrative-Control-of-Funds-Antideficiency-Act.pdf`.

**Files:** `scripts/etl_knowledge_index.py`, `app/api/data/knowledge_index.json`,
`app/api/regulation/route.ts`, `app/regulation/page.tsx`.

---

## How to refresh (data pipeline)

```bash
# 1. Re-aggregate from the warehouse (run on schedule / CI / cron)
python3 scripts/etl_contracting.py        # Use Case 1
python3 scripts/etl_funds_control.py       # Use Case 2
python3 scripts/etl_knowledge_index.py     # Use Case 3

# 2. Rebuild + deploy
npm run build && vercel --prod
```

The web app needs **no code change** to pick up refreshed data — it only reads the baked
JSON. This is the key property that makes the three use cases genuinely **production-grade**
rather than demo stubs.

---

## Production hardening (roadmap, not yet built)

- **Auth + RBAC** in front of the API routes (Vercel Middleware / an identity provider).
- **Cron refresh** (Vercel Cron or an external scheduler) so the JSON is always current.
- **Semantic (vector) retrieval** for `/regulation` *if* an embedder is provisioned on the
  runtime (e.g. a dedicated function with a hosted embedding model) — the BM25 layer is the
  serverless-safe default and can be blended with vectors later.
- **Assistance + file_c** (grants/loans and the unlinked contract detail) as additional
  use cases, using the same ETL pattern.

# CLAUDE.md — datamatter

Loads on top of `/Volumes/AI_DATA/CLAUDE.md`, which carries the DoD rules
that apply everywhere on this machine. Everything here is what is true
*only* of this app. Read that file's rules as still in force.

Next.js 14 + React 18 on Vercel (**datamatter.vercel.app**), Neon serverless
Postgres via `lib/db.ts`, plus frozen JSON snapshots in `app/api/data/`.
Pages: `/budget` `/ppbe` `/gao` `/congressional` `/contracting`
`/funds-control` `/showcase`. Repo: `github.com/llmlocalai/datamatter`.

## The rule that matters most here

**datamatter does not have its own data. It has a frozen copy of the data the
brainbank tools query live.** The ETLs read the exact same paths:

| datamatter reads | brainbank tool over the same source |
|---|---|
| `data/usaspending/warehouse/contracts` | `query_spending`, `search_requirements` |
| `data/usaspending/warehouse/accounts/file_a` | `budget_execution` |
| `knowledge-bank/DOD-FM-Knowledge-Bank` | `search_knowledge_base` |
| `knowledge-bank/Wiki/DOD-FM` | (datamatter's own BM25 index) |

So when a figure in this repo needs to be checked, explained, defended, or
written into site copy: **call the brainbank tool.** It is the live read; the
JSON is whatever the last ETL run produced. Do not treat a number in
`app/api/data/*.json` as evidence of what the data currently says — it is
evidence of what it said at that file's vintage.

**When a tool answer and a JSON figure disagree, that is a vintage
difference until proven otherwise, not a bug.** Closed fiscal years still
move: FY2025 lost $48.9M between the July and August snapshots. Call
`compare_vintages` before calling anything broken.

**Never hand-edit a JSON file in `app/api/data/` to correct a number.** That
silently forks the site from its source and the next ETL run reverts it.
Re-run the ETL that produces it:

```bash
python3 scripts/etl_contracting.py      # contracting_intelligence.json
python3 scripts/etl_funds_control.py    # funds_control.json
python3 scripts/etl_kb_scan.py          # gao / ppbe / congressional / budget
python3 scripts/etl_knowledge_index.py  # knowledge_index.json
```

They need `pyarrow` and read from `/Volumes/AI_DATA` directly, so they only
run on this Mac, never on Vercel. There is no venv here — use a Python that
has pyarrow, e.g. `/Volumes/AI_DATA/apps/agent-server/venv/bin/python3`.
`etl_contracting.py` takes `--fiscal-year` and `--vintage`.

## Three retrieval paths exist. Do not confuse them.

| Path | What it is | Reached by |
|---|---|---|
| ChromaDB passages | 203K chunks, nomic-embed vectors, authority re-ranked | `search_knowledge_base` |
| Atoms | 127K validated claims, FTS5 | `recall_claims` |
| `knowledge_index.json` | **datamatter's own** BM25 over `Wiki/DOD-FM` | this repo's `/api/*` routes |

The third is this app's, is smaller, and is a different corpus. It is not a
substitute for the first two when you need a citation — it is what ships to
the browser. Use the tools to check what the site says.

## This output is public

The site is on the open internet under a DoD framing, which raises the cost
of every rule in the root CLAUDE.md rather than relaxing any of them:

- **Every figure that reaches a page or a caption names its source and its
  vintage.** "FY2025 contract obligations, USASpending agency 097, 2026-08
  vintage" — not a bare number.
- **The two obligation figures still disagree in public.** Award files say
  $491.65B for FY2025; File C says $15.34B. A page that shows one without
  naming which is a defect, not a simplification. That gap is a live DODIG
  material weakness and it is the most interesting thing this data says.
- **Never write copy asserting the data does not contain something.** An
  empty ETL result means the filter matched nothing. Same rule as the root
  file, with a wider audience.
- Obligations are not outlays. `/funds-control` reads File A, which has
  both — say which one a tile is showing.

## Practical

- `DATABASE_URL` lives in `.env.local`, gitignored. **Never** read it into a
  response, paste it into a file, or commit it. `lib/db.ts` resolves it from
  the environment first and falls back to parsing `.env.local` for scripts
  run outside Next.js.
- `npm run dev` to run locally; `next build` is what Vercel runs.
- Vercel functions cannot scan the parquet warehouse — that is the whole
  reason the JSON snapshots exist. Do not "improve" a route by making it
  read `/Volumes/AI_DATA` at request time; it will work here and fail in
  production.

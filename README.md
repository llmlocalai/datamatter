# datamatter

Budget formulation, execution, and audit analytics for the Department of War,
built directly on the USASpending account and award warehouse and a curated
financial-management knowledge bank.

**Live:** https://datamatter.vercel.app · Next.js 14 · Neon Postgres · Vercel

## The rule this repo is organised around

Every figure that reaches a page names its source and its vintage, and that is
enforced by shape rather than by discipline: the data layer only returns measure
rows joined to the `dm_load` that produced them, so a figure without provenance
cannot be rendered.

## Pipeline

```
parquet warehouse ─┐
                   ├─ scripts/etl_analytics.py ─→ .staging/*.json ─┐
knowledge bank ────┘                                              │
                                                                  ▼
                                             scripts/load_analytics.js
                                             (one transaction: schema →
                                              seed → measures → controls)
                                                                  │
                                                                  ▼
                                                          Neon Postgres
                                                                  │
                                                                  ▼
                                              lib/analytics.ts → pages (ISR)
```

The control suite runs **inside** the load transaction. A `critical` control
failure rolls the whole load back and the previous vintage stays published — a
bad extract can never become the live figures.

## Daily refresh

The ETL needs `pyarrow` and reads `/Volumes/AI_DATA` directly, so it runs on this
Mac, never on Vercel. Because the app reads Neon rather than files baked into the
build, a refresh reaches the site without a redeploy.

```bash
npm run refresh          # etl + load
./scripts/refresh.sh     # the same, with logging, for scheduled runs

cp scripts/com.datamatter.refresh.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.datamatter.refresh.plist   # daily 06:15
```

Individual steps, when a full run is not wanted:

```bash
python3 scripts/etl_analytics.py --step sbr|obligations|awards|filec|knowledge
python3 scripts/etl_analytics.py --step awards --fy 2025   # one year's cuts
node scripts/load_analytics.js --dry-run                   # load, test, roll back
```

## Verify

```bash
npm run verify   # tsc --noEmit && next build
npx next lint
```

`next build` prerenders every page against the database, so a broken query or a
non-serialisable prop fails the build rather than the deploy.

## Pages

| Route | What it is |
|---|---|
| `/execution` | Budgetary resources → obligation → undelivered/delivered orders → outlay |
| `/reconciliation` | Award files vs account-linked File C; vintage drift |
| `/funds-control` | TAS-level obligation and outlay rates, unobligated balance |
| `/contracting` | Contract obligations by set-aside, extent competed, recipient, industry |
| `/budget` | FY2027 "-1" exhibits, line-item explorer, source documents |
| `/audit` | Opinion, material weaknesses, scope limitations from the AFR |
| `/ppbe` | FY2027 justification exhibit inventory |
| `/congressional` | Congressional direction corpus and hearing record |
| `/sources` `/definitions` `/controls` `/regulation` | The method layer |

## Secrets

`DATABASE_URL` lives in `.env.local`, gitignored. Never read it into a response,
paste it into a file, or commit it. `lib/db.ts` resolves it from the environment
first and falls back to parsing `.env.local` for scripts run outside Next.js.
TLS certificates are verified.

#!/usr/bin/env python3
"""
ETL: Contracting / Procurement Intelligence
==========================================

Streams the USASpending contract warehouse (partitioned parquet, agency 097 = DoD)
in batches and pre-aggregates it into compact JSON that the Vercel/Next.js app
consumes at request time.

WHY AN ETL (production-critical):
  A serverless Vercel function cannot scan 15M+ parquet rows per request.
  The correct enterprise pattern is: expensive aggregation happens HERE (a
  scheduled build step / cron / CI), writing small JSON artifacts to
  app/api/data/. The web app only reads those pre-baked artifacts, so it stays
  fast, stateless, and within serverless limits.

Memory-safety:
  We use pyarrow's dataset scanner with a bounded batch_size and fold each batch
  into Python accumulators immediately, so peak memory is O(batch), not O(fy).

Run:
  python3 scripts/etl_contracting.py                 # all fiscal years
  python3 scripts/etl_contracting.py --fiscal-year 2026
  python3 scripts/etl_contracting.py --vintage 2026-08-06
"""
from __future__ import annotations

import argparse
import collections
import json
import os
import sys
import time

import pyarrow.dataset as ds

WAREHOUSE = "/Volumes/AI_DATA/data/usaspending/warehouse/contracts"
OUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                        "app", "api", "data")

# Only the columns we aggregate on — column pruning keeps the scan cheap.
COLS = [
    "federal_action_obligation",
    "action_date_fiscal_year",
    "awarding_sub_agency_name",
    "recipient_name",
    "recipient_state_code",
    "primary_place_of_performance_state_code",
    "naics_code",
    "naics_description",
    "type_of_set_aside",
    "other_than_full_and_open_competition",
    "extent_competed",
    "type_of_contract_pricing",
    "simplified_procedures_for_certain_commercial_items",
]

# Map USASpending code enums to human labels so the UI shows meaningful text.
EXTENT_COMPETED = {
    "A": "Full & Open Competition",
    "B": "Other Than Full & Open — Authorized by Statute",
    "C": "Simplified Acquisition ($250K threshold)",
    "D": "Simplified Acquisition / Other",
    "F": "Full & Open (Commercial)",
    "G": "Other",
}
CONTRACT_PRICING = {
    "J": "Firm Fixed Price",
    "U": "Cost Reimbursement",
    "L": "Fixed Price with Economic Price Adjustment",
    "V": "Cost Plus Fixed Fee",
    "R": "Time & Materials / Labor Hour",
    "K": "Cost Plus Incentive Fee",
    "S": "Cost Plus Award Fee",
    "Y": "Incentive Fixed Price",
    "B": "Fixed Price Incentive",
    "Z": "Not Applicable / IDV",
    "M": "Cost Plus Fixed Fee (variant)",
    "A": "Cost Reimbursement (variant)",
}
NAICS_DESC_FALLBACK = {}  # filled from data

BATCH = 200_000


class Agg:
    """Incremental accumulators; one per fiscal year."""

    def __init__(self):
        self.rows = 0
        self.total_obligation = 0.0
        self.by_sub = collections.defaultdict(float)
        self.by_recipient = collections.defaultdict(float)
        self.by_recip_state = collections.defaultdict(float)
        self.by_perf_state = collections.defaultdict(float)
        self.by_naics = collections.defaultdict(float)
        self.by_naics_desc = collections.defaultdict(str)
        self.by_set_aside = collections.defaultdict(float)
        self.by_competition_reason = collections.defaultdict(float)
        self.by_extent_competed = collections.defaultdict(float)
        self.by_contract_pricing = collections.defaultdict(float)
        self.simplified_commercial = 0


def _add(d, key, val):
    if val and key is not None and str(key) != "" and str(key).lower() != "nan":
        d[str(key)] += val


def fold(batch: dict, a: Agg):
    obl = batch["federal_action_obligation"]
    a.rows += len(obl)
    a.total_obligation += float(sum(x for x in obl if x is not None))
    sub = batch["awarding_sub_agency_name"]
    rec = batch["recipient_name"]
    rst = batch["recipient_state_code"]
    pst = batch["primary_place_of_performance_state_code"]
    nac = batch["naics_code"]
    nad = batch["naics_description"]
    sa = batch["type_of_set_aside"]
    crc = batch["other_than_full_and_open_competition"]
    ec = batch["extent_competed"]
    cp = batch["type_of_contract_pricing"]
    sp = batch["simplified_procedures_for_certain_commercial_items"]

    for i in range(len(obl)):
        v = obl[i]
        if v is None:
            continue
        _add(a.by_sub, sub[i], v)
        _add(a.by_recipient, rec[i], v)
        _add(a.by_recip_state, rst[i], v)
        _add(a.by_perf_state, pst[i], v)
        if nac[i] is not None and v:
            key = str(int(nac[i]))
            a.by_naics[key] += v
            if nad[i]:
                a.by_naics_desc[key] = str(nad[i])
        _add(a.by_set_aside, sa[i], v)
        _add(a.by_competition_reason, crc[i], v)
        _add(a.by_extent_competed, ec[i], v)
        _add(a.by_contract_pricing, cp[i], v)
        if sp[i] is True:
            a.simplified_commercial += 1


def _topn(d, n):
    return sorted(d.items(), key=lambda kv: -kv[1])[:n]


def summarize(a: Agg, fy: int):
    def money(x):
        return round(float(x), 2)

    return {
        "fiscal_year": fy,
        "total_obligation": money(a.total_obligation),
        "award_count": a.rows,
        "simplified_commercial_awards": a.simplified_commercial,
        "by_sub_agency": [
             {"name": k, "obligation": money(v)} for k, v in _topn(a.by_sub, 15)
        ],
        "top_recipients": [
             {"name": k, "obligation": money(v)} for k, v in _topn(a.by_recipient, 20)
        ],
        "by_recipient_state": [
             {"state": k, "obligation": money(v)} for k, v in _topn(a.by_recip_state, 15)
        ],
        "by_performance_state": [
             {"state": k, "obligation": money(v)} for k, v in _topn(a.by_perf_state, 15)
        ],
        "top_naics": [
             {"code": k, "description": a.by_naics_desc.get(k, ""), "obligation": money(v)}
             for k, v in _topn(a.by_naics, 15)
        ],
        "by_set_aside": [
             {"type": k, "obligation": money(v)} for k, v in _topn(a.by_set_aside, 12)
        ],
        "by_competition_exception": [
             {"reason": k, "obligation": money(v)}
             for k, v in _topn(a.by_competition_reason, 12)
        ],
        "by_extent_competed": [
             {"code": k, "label": EXTENT_COMPETED.get(k, k), "obligation": money(v)}
             for k, v in _topn(a.by_extent_competed, 12)
        ],
        "by_contract_pricing": [
             {"code": k, "label": CONTRACT_PRICING.get(k, k), "obligation": money(v)}
             for k, v in _topn(a.by_contract_pricing, 12)
        ],
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--fiscal-year", type=int, help="single FY; default = all present")
    ap.add_argument("--vintage", type=str, help="e.g. 2026-08-06; default = latest")
    ap.add_argument("--batch", type=int, default=BATCH)
    args = ap.parse_args()

    # Determine vintages
    vintages = sorted(
        p[len("vintage="):] for p in os.listdir(WAREHOUSE)
        if p.startswith("vintage=")
    )
    vintage = args.vintage or vintages[-1]
    vpath = os.path.join(WAREHOUSE, f"vintage={vintage}")
    fys = (
        [f"fy={args.fiscal_year}"]
        if args.fiscal_year
        else [p for p in sorted(os.listdir(vpath)) if p.startswith("fy=")]
    )
    print(f"vintage={vintage}  fiscal_years={[p[3:] for p in fys]}", flush=True)

    results = []
    for fy in fys:
        a = Agg()
        dpath = os.path.join(vpath, fy)
        if not os.path.isdir(dpath):
            continue
        t0 = time.time()
        scanner = ds.dataset(dpath, format="parquet").scanner(
             columns=COLS, batch_size=args.batch
        )
        for record_batch in scanner.to_batches():
            fold({c: record_batch.column(c).to_pylist() for c in COLS}, a)
        summary = summarize(a, int(fy[3:]))
        results.append(summary)
        print(
             f"  {fy[3:]}: ${summary['total_obligation']/1e9:7.2f}B  "
             f"{a.rows:,} awards  ({time.time()-t0:.1f}s)",
             flush=True,
        )

    os.makedirs(OUT_DIR, exist_ok=True)
    out = {
        "source": "USASpending agency 097 (DoD) — contract warehouse",
        "vintage": vintage,
        "fiscal_years": [r["fiscal_year"] for r in results],
        "generated_by": "scripts/etl_contracting.py",
        "records": results,
    }
    path = os.path.join(OUT_DIR, "contracting_intelligence.json")
    with open(path, "w") as f:
        json.dump(out, f, indent=1)
    print(f"\nWROTE {path}  ({len(results)} fiscal years)")


if __name__ == "__main__":
    main()

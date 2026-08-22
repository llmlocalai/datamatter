#!/usr/bin/env python3
"""
ETL: Budget Execution & Funds Control (Antideficiency / Lapse Risk)
==================================================================

Streams the USASpending *account* (TAS-level) warehouse (file_a, agency 097 = DoD)
and pre-aggregates it into JSON the web app consumes.

Funds-control metrics produced (all real, from the Statement of Budgetary
Resources data in file_a):
  * Obligation rate      = obligations_incurred / total_budgetary_resources
  * Unobligated balance  = dollars still unobligated at the end of the period
                           (lapse risk / antideficiency exposure)
  * Outlay rate          = gross_outlay / total_budgetary_resources
  * Top TAS accounts by obligations (where the money is actually going)
  * Obligation by budget function / subfunction
  * FY-over-FY execution trend
"""
from __future__ import annotations

import collections
import json
import os
import time

import pyarrow.dataset as ds

WAREHOUSE = "/Volumes/AI_DATA/data/usaspending/warehouse/accounts/file_a"
OUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                        "app", "api", "data")

COLS = [
    "fiscal_year",
    "treasury_account_name",
    "agency_identifier_name",
    "budget_function",
    "budget_subfunction",
    "total_budgetary_resources",
    "obligations_incurred",
    "unobligated_balance",
    "gross_outlay_amount",
    "status_of_budgetary_resources_total",
]


class Agg:
    def __init__(self, fy):
        self.fy = fy
        self.total_bud = 0.0
        self.oblig = 0.0
        self.unoblig = 0.0
        self.outlay = 0.0
        self.by_tas = collections.defaultdict(float)
        self.by_agency = collections.defaultdict(float)
        self.by_function = collections.defaultdict(float)
        self.by_subfunction = collections.defaultdict(float)
        self.tas_name = {}

    def fold_batch(self, b):
        fy = b["fiscal_year"]
        for i in range(len(fy)):
            if fy[i] != self.fy:
                continue
            tb = b["total_budgetary_resources"][i] or 0
            ob = b["obligations_incurred"][i] or 0
            ub = b["unobligated_balance"][i] or 0
            ol = b["gross_outlay_amount"][i] or 0
            self.total_bud += tb
            self.oblig += ob
            self.unoblig += ub
            self.outlay += ol
            tas = b["treasury_account_name"][i]
            ag = b["agency_identifier_name"][i]
            bf = b["budget_function"][i]
            bsf = b["budget_subfunction"][i]
            if tas and ob:
                self.by_tas[tas] += ob
                self.tas_name[tas] = ag
            if ag and ob:
                self.by_agency[ag] += ob
            if bf and ob:
                self.by_function[bf] += ob
            if bsf and ob:
                self.by_subfunction[bsf] += ob

    def summarize(self):
        def pct(a, b):
            return round((a / b * 100), 2) if b else 0.0

        def topn(d, n):
            return sorted(d.items(), key=lambda kv: -kv[1])[:n]

        return {
            "fiscal_year": self.fy,
            "total_budgetary_resources": round(self.total_bud, 2),
            "obligations_incurred": round(self.oblig, 2),
            "unobligated_balance": round(self.unoblig, 2),
            "gross_outlays": round(self.outlay, 2),
            "obligation_rate_pct": pct(self.oblig, self.total_bud),
            "outlay_rate_pct": pct(self.outlay, self.total_bud),
            "unobligated_pct_of_budget": pct(self.unoblig, self.total_bud),
            "top_tas_accounts": [
                {"tas": k, "agency": self.tas_name.get(k, ""), "obligation": round(v, 2)}
                for k, v in topn(self.by_tas, 15)
            ],
            "top_agencies": [
                {"agency": k, "obligation": round(v, 2)} for k, v in topn(self.by_agency, 12)
            ],
            "by_budget_function": [
                {"function": k, "obligation": round(v, 2)} for k, v in topn(self.by_function, 12)
            ],
            "by_budget_subfunction": [
                {"subfunction": k, "obligation": round(v, 2)} for k, v in topn(self.by_subfunction, 12)
            ],
        }


def main():
    fys = sorted(
        int(p.split("=")[1]) for p in os.listdir(WAREHOUSE) if p.startswith("fiscal_year=")
    )
    print(f"file_a fiscal years: {fys}", flush=True)

    results = []
    for fy in fys:
        a = Agg(fy)
        part = os.path.join(WAREHOUSE, f"fiscal_year={fy}")
        t0 = time.time()
        d = ds.dataset(part, format="parquet")
        scanner = d.scanner(columns=COLS, batch_size=50_000)
        for rb in scanner.to_batches():
            a.fold_batch({c: rb.column(c).to_pylist() for c in COLS})
        s = a.summarize()
        results.append(s)
        print(
            f"   FY{fy}: bud ${s['total_budgetary_resources']/1e9:8.2f}B  "
            f"oblig {s['obligation_rate_pct']:6.2f}%  "
            f"unoblig ${s['unobligated_balance']/1e9:8.2f}B  "
            f"({time.time()-t0:.1f}s)",
            flush=True,
        )

    os.makedirs(OUT_DIR, exist_ok=True)
    out = {
        "source": "USASpending Budget-Execution Account Data (file_a, agency 097 = DoD)",
        "granularity": "TAS (Treasury Account Symbol), Statement of Budgetary Resources",
        "generated_by": "scripts/etl_funds_control.py",
        "fiscal_years": [r["fiscal_year"] for r in results],
        "records": results,
    }
    path = os.path.join(OUT_DIR, "funds_control.json")
    with open(path, "w") as f:
        json.dump(out, f, indent=1)
    print(f"\nWROTE {path}")


if __name__ == "__main__":
    main()

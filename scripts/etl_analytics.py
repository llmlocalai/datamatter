#!/usr/bin/env python3
"""
datamatter analytics ETL  ->  staging JSON  ->  scripts/load_analytics.js  ->  Neon

Reads the USASpending parquet warehouse and the DoD-FM knowledge bank and emits
one JSON payload per step into --out (default: .staging/). Nothing here writes to
a page and nothing here writes to Neon; the loader does that in a transaction.

Every payload carries {dataset, vintage, extracted_at, etl_version, rows} so the
loader can create the dm_load row that each measure row hangs off. A measure with
no vintage is a bug, not a formatting choice.

Steps (run all with --step all):
  sbr         File A  -> Statement of Budgetary Resources, FY x scope + dimensions
  obligations File B  -> USSGL undelivered/delivered orders + object class
  awards      contracts warehouse -> FY totals, dimensions, vintage drift
  filec       File C  -> account-linked contract obligations + reconciliation
  assistance  DoD financial-assistance warehouse -> FY totals, dimensions, vintage drift
  exhibits    President's Budget -1 exhibits (FY2020-FY2027) -> the program spine
  program     contracts + File C -> program-level execution and account traceability
  knowledge   wiki + knowledge-bank folders -> definitions, inventory, hearings
  controls    control tests over everything already staged

Scope note: File A carries five agency identifier codes. 097/021/017/057 are the
Department (Defense-wide, Army, Navy, Air Force). 011 is the Executive Office of
the President and is NOT the Department -- it is excluded from every DOW scope
and reported separately. Summing all five and calling it "DoD" overstates FY2025
obligations by $108.7B.
"""
from __future__ import annotations
import argparse, collections, datetime as dt, json, os, re, sys

ETL_VERSION = "2.0.0"

def data_root() -> str:
    for c in (os.environ.get("DM_DATA_ROOT"), "/Volumes/AI_DATA",
              os.path.expanduser("~/mnt")):
        if c and os.path.isdir(c):
            return c
    raise SystemExit("Cannot locate AI_DATA root; set DM_DATA_ROOT")

ROOT = data_root()
# The mounted layout drops the AI_DATA level, so resolve each tree independently.
def _pick(*cands):
    for c in cands:
        if os.path.isdir(c): return c
    return cands[0]

WAREHOUSE = _pick(os.path.join(ROOT, "data/usaspending/warehouse"))
KB        = _pick(os.path.join(ROOT, "knowledge-bank/DOD-FM-Knowledge-Bank"))
WIKI      = _pick(os.path.join(ROOT, "knowledge-bank/Wiki/DOD-FM"))

DOW_CODES   = {"097", "021", "017", "057"}
AGENCY_NAME = {"097": "Defense-wide", "021": "Army", "017": "Navy",
               "057": "Air Force", "011": "Executive Office of the President"}
FY_RANGE = range(2021, 2027)

def now_iso(): return dt.datetime.now(dt.timezone.utc).isoformat()

def payload(dataset, vintage, rows, **extra):
    return {"dataset": dataset, "vintage": vintage, "extracted_at": now_iso(),
            "etl_version": ETL_VERSION, "rows": rows, **extra}

def write(out_dir, name, obj):
    os.makedirs(out_dir, exist_ok=True)
    p = os.path.join(out_dir, name)
    with open(p, "w") as f:
        json.dump(obj, f, separators=(",", ":"))
    n = sum(len(v) for v in obj.get("rows", {}).values()) if isinstance(obj.get("rows"), dict) else len(obj.get("rows", []))
    print(f"  wrote {name}  ({n:,} rows, {os.path.getsize(p)/1024:.0f} KB)")

def mtime_date(path) -> str:
    return dt.date.fromtimestamp(os.path.getmtime(path)).isoformat()

# ---------------------------------------------------------------- File A ----
FILE_A_COLS = ["agency_identifier_code","agency_identifier_name","submission_period",
  "budget_function","budget_subfunction","treasury_account_symbol","treasury_account_name",
  "federal_account_symbol","federal_account_name",
  "budget_authority_appropriated_amount","budget_authority_unobligated_balance_brought_forward",
  "adjustments_to_unobligated_balance_brought_forward_cpe","borrowing_authority_amount",
  "contract_authority_amount","spending_authority_from_offsetting_collections_amount",
  "total_other_budgetary_resources_amount","total_budgetary_resources","obligations_incurred",
  "deobligations_or_recoveries_or_refunds_from_prior_year","unobligated_balance","gross_outlay_amount"]

MEASURE_MAP = [
  ("ba_appropriated","budget_authority_appropriated_amount"),
  ("unobligated_bf","budget_authority_unobligated_balance_brought_forward"),
  ("adjustments_to_unob_bf","adjustments_to_unobligated_balance_brought_forward_cpe"),
  ("borrowing_authority","borrowing_authority_amount"),
  ("contract_authority","contract_authority_amount"),
  ("spending_auth_offsetting","spending_authority_from_offsetting_collections_amount"),
  ("other_budgetary_resources","total_other_budgetary_resources_amount"),
  ("total_budgetary_resources","total_budgetary_resources"),
  ("obligations_incurred","obligations_incurred"),
  ("deobligations","deobligations_or_recoveries_or_refunds_from_prior_year"),
  ("unobligated_balance","unobligated_balance"),
  ("gross_outlays","gross_outlay_amount"),
]

def step_sbr(out):
    import pyarrow.dataset as ds
    base = os.path.join(WAREHOUSE, "accounts/file_a")
    fy_rows, dim_rows = [], []
    vintage = mtime_date(base)
    for fy in FY_RANGE:
        p = os.path.join(base, f"fiscal_year={fy}")
        if not os.path.isdir(p): continue
        t = ds.dataset(p, format="parquet").to_table(columns=FILE_A_COLS)
        cols = {c: t[c].to_pylist() for c in FILE_A_COLS}
        n = t.num_rows
        subs = sorted({s for s in cols["submission_period"] if s})
        period = subs[-1] if subs else None
        partial = bool(period and not period.endswith("P12"))

        buckets = collections.defaultdict(lambda: collections.defaultdict(float))
        counts  = collections.Counter()
        dims    = collections.defaultdict(lambda: collections.defaultdict(lambda: collections.defaultdict(float)))
        labels  = {}
        for i in range(n):
            code = cols["agency_identifier_code"][i] or "???"
            scopes = ["ALL"] + ([("DOW")] if code in DOW_CODES else ["NON_DOW"]) + [f"AGENCY:{code}"]
            for sc in scopes:
                counts[sc] += 1
                for dest, src in MEASURE_MAP:
                    buckets[sc][dest] += (cols[src][i] or 0.0)
            if code not in DOW_CODES: continue
            for dimension, keycol, labcol in (
                ("agency","agency_identifier_code","agency_identifier_name"),
                ("budget_function","budget_function","budget_function"),
                ("federal_account","federal_account_symbol","federal_account_name"),
                ("tas","treasury_account_symbol","treasury_account_name")):
                k = cols[keycol][i]
                if not k: continue
                k = str(k)
                labels[(dimension,k)] = str(cols[labcol][i] or k)
                d = dims[dimension][k]
                d["total_budgetary_resources"] += (cols["total_budgetary_resources"][i] or 0.0)
                d["obligations_incurred"]      += (cols["obligations_incurred"][i] or 0.0)
                d["unobligated_balance"]       += (cols["unobligated_balance"][i] or 0.0)
                d["gross_outlays"]             += (cols["gross_outlay_amount"][i] or 0.0)

        for sc, m in buckets.items():
            label = ("Department of War (097/021/017/057)" if sc == "DOW"
                     else "All agency codes in File A" if sc == "ALL"
                     else "Non-Department agency codes" if sc == "NON_DOW"
                     else AGENCY_NAME.get(sc.split(":")[1], sc))
            fy_rows.append({"fiscal_year": fy, "scope": sc, "scope_label": label,
                            "submission_period": period, "is_partial_year": partial,
                            "tas_count": counts[sc], **{k: round(v, 2) for k, v in m.items()}})
        for dimension, keys in dims.items():
            ranked = sorted(keys.items(), key=lambda kv: -kv[1]["obligations_incurred"])
            keep = ranked if dimension in ("agency", "budget_function") else ranked[:40]
            for rank, (k, m) in enumerate(keep, 1):
                dim_rows.append({"fiscal_year": fy, "scope": "DOW", "dimension": dimension,
                                 "dim_key": k, "dim_label": labels[(dimension,k)],
                                 "rank_in_dim": rank, **{kk: round(vv,2) for kk,vv in m.items()}})
        print(f"  FY{fy}: {n:,} TAS rows, period {period}{' (PARTIAL)' if partial else ''}")
    write(out, "sbr.json", payload("file_a_sbr", vintage,
          {"dm_sbr_fy": fy_rows, "dm_sbr_dim": dim_rows}, source_path="accounts/file_a"))

# ---------------------------------------------------------------- File B ----
OC_GROUPS = [(("11","12","13"), "Personnel compensation and benefits"),
             (("21","22","23","24","25","26"), "Contractual services and supplies"),
             (("31","32","33"), "Acquisition of assets"),
             (("41","42","43","44"), "Grants and fixed charges")]
def major_class(code: str) -> str:
    head = (code or "").split(".")[0].strip().zfill(2)
    for keys, label in OC_GROUPS:
        if head in keys: return label
    return "Other"

FILE_B_COLS = ["agency_identifier_code","object_class_code","object_class_name",
  "obligations_incurred","obligations_undelivered_orders_unpaid_total",
  "obligations_delivered_orders_unpaid_total","gross_outlay_amount_FYB_to_period_end",
  "deobligations_or_recoveries_or_refunds_from_prior_year","submission_period"]

def step_obligations(out):
    import pyarrow.dataset as ds
    base = os.path.join(WAREHOUSE, "accounts/file_b")
    vintage = mtime_date(base)
    stage_rows, oc_rows = [], []
    for fy in FY_RANGE:
        p = os.path.join(base, f"fiscal_year={fy}")
        if not os.path.isdir(p): continue
        t = ds.dataset(p, format="parquet").to_table(columns=FILE_B_COLS)
        c = {k: t[k].to_pylist() for k in FILE_B_COLS}
        agg = collections.defaultdict(float)
        oc  = collections.defaultdict(lambda: collections.defaultdict(float))
        ocn = {}
        for i in range(t.num_rows):
            if (c["agency_identifier_code"][i] or "") not in DOW_CODES: continue
            agg["obligations_incurred"]      += (c["obligations_incurred"][i] or 0.0)
            agg["undelivered_orders_unpaid"] += (c["obligations_undelivered_orders_unpaid_total"][i] or 0.0)
            agg["delivered_orders_unpaid"]   += (c["obligations_delivered_orders_unpaid_total"][i] or 0.0)
            agg["gross_outlays"]             += (c["gross_outlay_amount_FYB_to_period_end"][i] or 0.0)
            agg["deobligations"]             += (c["deobligations_or_recoveries_or_refunds_from_prior_year"][i] or 0.0)
            k = str(c["object_class_code"][i] or "??")
            ocn[k] = str(c["object_class_name"][i] or k)
            oc[k]["obligations"] += (c["obligations_incurred"][i] or 0.0)
        stage_rows.append({"fiscal_year": fy, "scope": "DOW", **{k: round(v,2) for k,v in agg.items()}})
        for rank,(k,m) in enumerate(sorted(oc.items(), key=lambda kv:-kv[1]["obligations"])[:25],1):
            oc_rows.append({"fiscal_year": fy, "scope":"DOW", "object_class_code": k,
                            "object_class_name": ocn[k], "major_class": major_class(k),
                            "obligations": round(m["obligations"],2), "rank_in_fy": rank})
        print(f"  FY{fy}: obligations {agg['obligations_incurred']/1e9:.1f}B, "
              f"UDO {agg['undelivered_orders_unpaid']/1e9:.1f}B")
    write(out, "obligations.json", payload("file_b_obligations", vintage,
          {"dm_obligation_stage": stage_rows, "dm_object_class": oc_rows},
          source_path="accounts/file_b"))

# -------------------------------------------------------------- contracts ---
# FPDS reports extent competed and pricing type as single-letter codes. Publishing
# the raw code is not a label, and a page that filters on the spelled-out text
# silently matches nothing — so the code book lives here, in the transform.
EXTENT_COMPETED = {
  "A": "Full and open competition",
  "B": "Not available for competition",
  "C": "Not competed",
  "D": "Full and open after exclusion of sources",
  "E": "Follow-on to competed action",
  "F": "Competed under simplified acquisition procedures",
  "G": "Not competed under simplified acquisition procedures",
  "CDO": "Competitive delivery order",
  "NDO": "Non-competitive delivery order",
}
CONTRACT_PRICING = {
  "A": "Fixed price redetermination", "B": "Fixed price level of effort",
  "J": "Firm fixed price", "K": "Fixed price with economic price adjustment",
  "L": "Fixed price incentive", "M": "Fixed price award fee",
  "R": "Cost plus award fee", "S": "Cost no fee", "T": "Cost sharing",
  "U": "Cost plus fixed fee", "V": "Cost plus incentive fee",
  "Y": "Time and materials", "Z": "Labor hours",
  "1": "Order dependent", "2": "Combination", "3": "Other",
}
CODE_BOOKS = {"extent_competed": EXTENT_COMPETED, "pricing": CONTRACT_PRICING}

AWARD_DIMS = [("set_aside","type_of_set_aside"), ("extent_competed","extent_competed"),
              ("pricing","type_of_contract_pricing"), ("naics","naics_code"),
              ("psc","product_or_service_code"), ("recipient","recipient_name"),
              ("sub_agency","awarding_sub_agency_name"), ("state","primary_place_of_performance_state_code")]
DIM_LABEL = {"naics":"naics_description","psc":"product_or_service_code_description"}

def vintages():
    base = os.path.join(WAREHOUSE, "contracts")
    return sorted(d.split("=",1)[1] for d in os.listdir(base) if d.startswith("vintage="))

def step_awards(out, only_fy=None):
    import pyarrow.dataset as ds, pyarrow.compute as pc
    base = os.path.join(WAREHOUSE, "contracts")
    vs = vintages(); current = vs[-1]
    fy_rows, dim_rows, drift_rows = [], [], []
    totals = {v: {} for v in vs}
    for v in vs:
        for fy in FY_RANGE:
            p = os.path.join(base, f"vintage={v}/fy={fy}")
            if not os.path.isdir(p): continue
            t = ds.dataset(p, format="parquet").to_table(columns=["federal_action_obligation"])
            totals[v][fy] = (round(pc.sum(t["federal_action_obligation"]).as_py() or 0.0, 2), t.num_rows)
    maxfy = max(totals[current])
    for fy, (ob, n) in sorted(totals[current].items()):
        fy_rows.append({"vintage": current, "fiscal_year": fy, "obligation": ob,
                        "action_count": n, "is_partial_year": fy == maxfy})
    for a, b in zip(vs, vs[1:]):
        for fy in sorted(set(totals[a]) & set(totals[b])):
            oa, na = totals[a][fy]; ob_, nb = totals[b][fy]
            drift_rows.append({"fiscal_year": fy, "vintage_from": a, "vintage_to": b,
              "obligation_from": oa, "obligation_to": ob_, "obligation_delta": round(ob_-oa,2),
              "actions_from": na, "actions_to": nb, "action_delta": nb-na,
              "year_closed": fy < maxfy})
    # dimensional cuts, current vintage only
    for fy in ([only_fy] if only_fy else sorted(totals[current])):
        p = os.path.join(base, f"vintage={current}/fy={fy}")
        if not os.path.isdir(p): continue
        cols = sorted({c for _, c in AWARD_DIMS} | set(DIM_LABEL.values()) | {"federal_action_obligation"})
        t = ds.dataset(p, format="parquet").to_table(columns=cols)
        for dim, col in AWARD_DIMS:
            lab = DIM_LABEL.get(dim)
            g = t.group_by([col] + ([lab] if lab else [])).aggregate(
                [("federal_action_obligation","sum"), ("federal_action_obligation","count")])
            recs = g.to_pylist()
            recs.sort(key=lambda r: -(r["federal_action_obligation_sum"] or 0))
            for rank, r in enumerate(recs[:25], 1):
                k = r[col]
                if k in (None, ""): k = "(not reported)"
                book = CODE_BOOKS.get(dim, {})
                label = book.get(str(k)) or str(r.get(lab) or k)
                if dim in CODE_BOOKS and str(k) in book:
                    label = f"{k} · {label}"
                dim_rows.append({"fiscal_year": fy, "dimension": dim, "dim_key": str(k),
                    "dim_label": label, "rank_in_dim": rank,
                    "obligation": round(r["federal_action_obligation_sum"] or 0.0, 2),
                    "action_count": r["federal_action_obligation_count"]})
        print(f"  FY{fy} dims done")
    # Merge: dimensional cuts are computed one FY at a time (each is a full-file
    # scan), so preserve cuts already staged for other fiscal years.
    prior = os.path.join(out, "awards.json")
    if only_fy and os.path.exists(prior):
        old_dims = json.load(open(prior))["rows"].get("dm_award_dim", [])
        dim_rows = [r for r in old_dims if r["fiscal_year"] != only_fy] + dim_rows
    dim_rows.sort(key=lambda r: (r["fiscal_year"], r["dimension"], r["rank_in_dim"]))
    write(out, "awards.json", payload("contract_awards", current,
          {"dm_award_fy": fy_rows, "dm_award_dim": dim_rows, "dm_vintage_drift": drift_rows},
          source_path="contracts", vintages=vs))

# ----------------------------------------------------------------- File C ---
# File C is a MONTHLY CUMULATIVE snapshot: each submission period restates the
# fiscal year to date, so P03, P06, P09 and P12 are four overlapping copies of
# the same year, not four slices of it. Summing them multiplies the total.
#
# An earlier version of this step did exactly that, and produced a "linkage
# collapse from 18.2% to 3.1%" that was an artefact of how many period files
# happened to be retained per year, not a change in reporting. The corrected
# rule: use ONE snapshot per fiscal year -- the period carrying the most rows,
# which is the most complete copy we hold -- and publish which period that was
# alongside every other period's row count, so a truncated download is visible
# rather than silently averaged in.
def _filec_best_period(base, fy, ds):
    """(period, rows) for the most complete cumulative snapshot of this FY."""
    p = os.path.join(base, f"fiscal_year={fy}")
    if not os.path.isdir(p): return None, {}
    t = ds.dataset(p, format="parquet").to_table(
        columns=["agency_identifier_code", "submission_period"])
    code = t["agency_identifier_code"].to_pylist()
    per  = t["submission_period"].to_pylist()
    counts = collections.Counter(sp for c, sp in zip(code, per) if c in DOW_CODES and sp)
    if not counts: return None, {}
    return max(counts.items(), key=lambda kv: kv[1])[0], dict(counts)

def step_filec(out):
    import pyarrow.dataset as ds
    base = os.path.join(WAREHOUSE, "accounts/file_c_contracts")
    vintage = mtime_date(base)
    awards_path = os.path.join(out, "awards.json")
    award_by_fy = {}
    if os.path.exists(awards_path):
        a = json.load(open(awards_path))
        award_by_fy = {r["fiscal_year"]: r for r in a["rows"]["dm_award_fy"]}
    rec = []
    for fy in FY_RANGE:
        p = os.path.join(base, f"fiscal_year={fy}")
        if not os.path.isdir(p): continue
        best, period_rows = _filec_best_period(base, fy, ds)
        t = ds.dataset(p, format="parquet").to_table(
            columns=["agency_identifier_code","transaction_obligated_amount","award_unique_key",
                     "submission_period"])
        code = t["agency_identifier_code"].to_pylist()
        amt  = t["transaction_obligated_amount"].to_pylist()
        keys = t["award_unique_key"].to_pylist()
        sper = t["submission_period"].to_pylist()
        tot = 0.0; rows = 0; uniq = set()
        for c_, a_, k_, s_ in zip(code, amt, keys, sper):
            if c_ not in DOW_CODES: continue
            if best and s_ != best: continue     # one cumulative snapshot only
            tot += (a_ or 0.0); rows += 1
            if k_: uniq.add(k_)
        aw = award_by_fy.get(fy)
        awob = aw["obligation"] if aw else 0.0
        rec.append({"fiscal_year": fy, "award_obligation": awob,
            "award_actions": aw["action_count"] if aw else 0,
            "filec_obligation": round(tot,2), "filec_rows": rows, "filec_awards": len(uniq),
            "linkage_pct": round(tot/awob*100, 4) if awob else 0.0,
            "unlinked_obligation": round(awob - tot, 2),
            "submission_period": best,
            "periods_available": len(period_rows),
            "period_row_counts": json.dumps(dict(sorted(period_rows.items()))),
            "is_partial_year": bool(aw and aw["is_partial_year"])})
        print(f"  FY{fy}: File C snapshot {best} -> {tot/1e9:.2f}B over {rows:,} rows / "
              f"{len(uniq):,} awards  (linkage {rec[-1]['linkage_pct']:.1f}%; "
              f"{len(period_rows)} periods held, rows {min(period_rows.values()):,}-{max(period_rows.values()):,})")
    write(out, "filec.json", payload("file_c_reconciliation", vintage,
          {"dm_reconciliation": rec}, source_path="accounts/file_c_contracts"))

DOW_AGENCY_NAMES = {"Department of Defense", "Department of War"}
ASSISTANCE_DIMS = [("assistance_type", "assistance_type_description"),
                    ("sub_agency", "awarding_sub_agency_name"),
                    ("recipient", "recipient_name"),
                    ("cfda", "cfda_number"),
                    ("state", "recipient_state_code")]
ASSIST_DIM_LABEL = {"cfda": "cfda_title"}

# ----------------------------------------------------------------- Assistance ---
def step_assistance(out, only_fy=None):
    """DoD financial-assistance transactions (cooperative agreements, project
    grants, direct payments) -- the File D2 equivalent. Separate warehouse tree
    from contracts/File C; not account-linked and not reconciled against
    anything yet. Rows are explicitly filtered to DOW-named awarding agencies
    rather than trusted to already be scoped, because unlike the contracts and
    File C trees this one is not gated by an agency-identifier-code column."""
    import pyarrow.dataset as ds
    base = os.path.join(WAREHOUSE, "assistance")
    if not os.path.isdir(base):
        print("  no assistance warehouse found, skipping"); return
    vs = sorted(d.split("=", 1)[1] for d in os.listdir(base) if d.startswith("vintage="))
    if not vs:
        print("  no assistance vintages found, skipping"); return
    current = vs[-1]
    fy_rows, dim_rows, drift_rows = [], [], []
    totals = {v: {} for v in vs}

    def scoped_total(t):
        names = t["awarding_agency_name"].to_pylist()
        amt = t["federal_action_obligation"].to_pylist()
        tot = 0.0; n = 0
        for nm, a_ in zip(names, amt):
            if nm not in DOW_AGENCY_NAMES: continue
            tot += (a_ or 0.0); n += 1
        return round(tot, 2), n

    for v in vs:
        for fy in FY_RANGE:
            p = os.path.join(base, f"vintage={v}/fy={fy}")
            if not os.path.isdir(p): continue
            t = ds.dataset(p, format="parquet").to_table(
                columns=["awarding_agency_name", "federal_action_obligation"])
            totals[v][fy] = scoped_total(t)
    if not totals[current]:
        print("  no fiscal years in current assistance vintage, skipping"); return
    maxfy = max(totals[current])
    for fy, (ob, n) in sorted(totals[current].items()):
        fy_rows.append({"vintage": current, "fiscal_year": fy, "obligation": ob,
                        "action_count": n, "is_partial_year": fy == maxfy})
    for a, b in zip(vs, vs[1:]):
        for fy in sorted(set(totals[a]) & set(totals[b])):
            oa, na = totals[a][fy]; ob_, nb = totals[b][fy]
            drift_rows.append({"fiscal_year": fy, "vintage_from": a, "vintage_to": b,
              "obligation_from": oa, "obligation_to": ob_, "obligation_delta": round(ob_ - oa, 2),
              "actions_from": na, "actions_to": nb, "action_delta": nb - na,
              "year_closed": fy < maxfy})

    for fy in ([only_fy] if only_fy else sorted(totals[current])):
        p = os.path.join(base, f"vintage={current}/fy={fy}")
        if not os.path.isdir(p): continue
        cols = sorted({c for _, c in ASSISTANCE_DIMS} | set(ASSIST_DIM_LABEL.values())
                       | {"federal_action_obligation", "awarding_agency_name"})
        t = ds.dataset(p, format="parquet").to_table(columns=cols)
        names = t["awarding_agency_name"].to_pylist()
        keep = [i for i, nm in enumerate(names) if nm in DOW_AGENCY_NAMES]
        if len(keep) != t.num_rows:
            t = t.take(keep)
        for dim, col in ASSISTANCE_DIMS:
            lab = ASSIST_DIM_LABEL.get(dim)
            g = t.group_by([col] + ([lab] if lab else [])).aggregate(
                [("federal_action_obligation", "sum"), ("federal_action_obligation", "count")])
            recs = g.to_pylist()
            recs.sort(key=lambda r: -(r["federal_action_obligation_sum"] or 0))
            for rank, r in enumerate(recs[:25], 1):
                k = r[col]
                if k in (None, ""): k = "(not reported)"
                label = str(r.get(lab) or k) if lab else str(k)
                dim_rows.append({"fiscal_year": fy, "dimension": dim, "dim_key": str(k),
                    "dim_label": label, "rank_in_dim": rank,
                    "obligation": round(r["federal_action_obligation_sum"] or 0.0, 2),
                    "action_count": r["federal_action_obligation_count"]})
        print(f"  FY{fy} assistance dims done")

    prior = os.path.join(out, "assistance.json")
    if only_fy and os.path.exists(prior):
        old_dims = json.load(open(prior))["rows"].get("dm_assistance_dim", [])
        dim_rows = [r for r in old_dims if r["fiscal_year"] != only_fy] + dim_rows
    dim_rows.sort(key=lambda r: (r["fiscal_year"], r["dimension"], r["rank_in_dim"]))
    write(out, "assistance.json", payload("assistance_awards", current,
          {"dm_assistance_fy": fy_rows, "dm_assistance_dim": dim_rows,
           "dm_assistance_vintage_drift": drift_rows},
          source_path="assistance", vintages=vs))

# --------------------------------------------------------------- knowledge --
FIELD_RE = {
 "definition": re.compile(r"\*\*One-line definition:\*\*\s*(.*?)(?=\n\*\*|\Z)", re.S|re.I),
 "why_it_matters": re.compile(r"\*\*Why it matters:\*\*\s*(.*?)(?=\n\*\*|\Z)", re.S|re.I),
 "key_rules": re.compile(r"\*\*Key rules / steps:\*\*\s*(.*?)(?=\n\*\*|\Z)", re.S|re.I),
 "authorities": re.compile(r"\*\*Authoritative sources:\*\*\s*(.*?)(?=\n\*\*|\Z)", re.S|re.I),
 "related": re.compile(r"\*\*Related:\*\*\s*(.*?)(?=\n\*\*|\Z)", re.S|re.I),
 "last_verified": re.compile(r"\*\*Last verified:\*\*\s*([0-9]{4}-[0-9]{2}-[0-9]{2})", re.I),
}
META_RE = re.compile(r"wiki-meta:\s*sources=\[(.*?)\]", re.S)
TOPIC_RULES = [("Budget execution", r"obligat|apportion|allot|funds control|antidefic|execution|reprogram"),
               ("Audit & internal control", r"audit|fiar|material weak|internal control|gagas|opinion|ffmia"),
               ("Accounting & reporting", r"ussgl|accounting|financial statement|fbwt|reporting|afr|balance"),
               ("Acquisition & contracting", r"contract|acquisition|procure|fpds|multiyear"),
               ("Appropriations & authority", r"appropriat|authoriz|statute|ndaa|full funding|transfer"),
               ("Working capital & reimbursables", r"working capital|dwcf|reimbursab|economy act|project order"),
               ("Systems", r"sap|oracle|gfebs|dai|sfis|system")]
def topic_for(text):
    t = text.lower()
    for label, pat in TOPIC_RULES:
        if re.search(pat, t): return label
    return "General"

HEARING_RE = re.compile(r"^CHRG-(\d{3})([hsj])hrg(\d+)_(.*?)_(\d{4}-\d{2}-\d{2})\.pdf$", re.I)
CHAMBER = {"h":"House","s":"Senate","j":"Joint"}
DEFENSE_RE = re.compile(r"defense|armed.?services|military|navy|army|air.?force|nuclear|missile|"
                        r"pentagon|nato|veteran|national.?security|shipbuild|weapon|dod|space.?force", re.I)

def step_knowledge(out):
    vintage = mtime_date(WIKI)
    defs = []
    for fn in sorted(os.listdir(WIKI)):
        if not fn.endswith(".md"): continue
        raw = open(os.path.join(WIKI, fn), encoding="utf-8", errors="replace").read()
        title = raw.split("\n",1)[0].lstrip("# ").strip()
        g = {}
        for k, rx in FIELD_RE.items():
            m = rx.search(raw); g[k] = m.group(1).strip() if m else ""
        if not g["definition"]: continue
        auth = [a.strip(" -•\t") for a in re.split(r"[\n;]", g["authorities"]) if a.strip(" -•\t")]
        rel  = re.findall(r"\[\[(.*?)\]\]", g["related"])
        src  = (META_RE.search(raw).group(1).strip() if META_RE.search(raw) else fn)
        defs.append({"slug": fn[:-3], "term": title, "definition": g["definition"],
            "why_it_matters": g["why_it_matters"], "key_rules": g["key_rules"],
            "authorities": auth[:8], "related": rel[:8], "source_file": src,
            "last_verified": g["last_verified"] or None,
            "topic": topic_for(title + " " + g["definition"])})
    # knowledge-bank folder inventory
    inv = []
    COLL = [("regulation","01-Regulations","Primary regulation (FMR, OMB Circulars, Treasury USSGL)",1),
            ("statute","09-Statute-and-Enactment","Enacted statute, appropriations acts, NDAAs",1),
            ("congressional","10-Congressional-Direction","Committee reports, JES, hearings, prints",1),
            ("justification","11-Budget-Justification","FY2027 J-book justification exhibits",1),
            ("oversight","12-Oversight","GAO reports, appropriations law, IG audits",1),
            ("systems","06-Financial-Systems","GFEBS/SAP, DAI/Oracle platform reference",2),
            ("statements","07-Financial-Statements-and-Audit-Reports","AFRs and GAO audit standards",1),
            ("guidance","02-DoD-Guidance","DoD and service FM guidance",2),
            ("crs","08-CRS-Congressional-Research-Service","CRS primers",2)]
    for coll, folder, label, tier in COLL:
        p = os.path.join(KB, folder)
        if not os.path.isdir(p): continue
        n = sum(1 for r,_d,fs in os.walk(p) for f in fs
                if f.lower().endswith((".pdf",".md",".txt",".xlsx",".docx",".htm",".html")))
        inv.append({"collection": coll, "folder": folder, "label": label,
                    "doc_count": n, "authority_tier": tier, "sort_order": len(inv)*10})
        # second level for congressional
        if coll == "congressional":
            for sub in sorted(os.listdir(p)):
                sp = os.path.join(p, sub)
                if not os.path.isdir(sp): continue
                sn = sum(1 for r,_d,fs in os.walk(sp) for f in fs if f.lower().endswith((".pdf",".txt",".md",".htm",".html")))
                if sn: inv.append({"collection":"congressional_detail","folder":sub,
                    "label": sub.replace("-"," "), "doc_count": sn, "authority_tier": tier,
                    "sort_order": len(inv)*10})
    # justification exhibits by activity
    jrows = []
    jdir = os.path.join(KB, "11-Budget-Justification")
    if os.path.isdir(jdir):
        for d in sorted(os.listdir(jdir)):
            full = os.path.join(jdir, d)
            if not os.path.isdir(full) or d.startswith("_"): continue
            n = sum(1 for r,_x,fs in os.walk(full) for f in fs if f.endswith(".pdf"))
            if n: jrows.append({"fiscal_year": 2027,
                "activity": re.sub(r"^\d+_","",d).replace("_"," ").strip().title(), "exhibit_count": n})
    # hearings
    hrows = []
    hdir = os.path.join(KB, "10-Congressional-Direction/Hearings")
    if os.path.isdir(hdir):
        for f in sorted(os.listdir(hdir)):
            m = HEARING_RE.match(f)
            if not m: continue
            title = re.sub(r"[_-]+"," ", m.group(4)).strip()
            hrows.append({"hearing_id": f"CHRG-{m.group(1)}{m.group(2).lower()}hrg{m.group(3)}",
                "congress": int(m.group(1)), "chamber": CHAMBER.get(m.group(2).lower(),"Other"),
                "title": title, "ingest_date": m.group(5),
                "defense_related": bool(DEFENSE_RE.search(title))})
    print(f"  {len(defs)} definitions, {len(inv)} inventory rows, "
          f"{len(jrows)} activities, {len(hrows)} hearings "
          f"({sum(1 for h in hrows if h['defense_related'])} defense-related)")
    write(out, "knowledge.json", payload("knowledge_bank", vintage,
        {"dm_definition": defs, "dm_kb_inventory": inv,
         "dm_justification_exhibit": jrows, "dm_hearing": hrows}, source_path="knowledge-bank"))

# ----------------------------------------------------------------- exhibits ---
# The President's Budget "-1" exhibits, every book we hold, as the program spine.
#
# THE THREE-YEAR STRUCTURE. Each PB book carries three fiscal years, in three
# different roles:
#     FY(pb-2)  prior-year ACTUALS   -- what was executed
#     FY(pb-1)  current-year ENACTED -- what was appropriated
#     FY(pb)    budget-year REQUEST  -- what is being asked for
# So a single fiscal year appears in three successive books, and its number is
# expected to differ between them: a request becomes an enactment becomes an
# actual. That is not drift to be averaged away — it is the restatement history,
# and it exists nowhere else in these sources. Every row therefore carries BOTH
# pb_year (which book it was read from) and fiscal_year (which year it describes),
# and no query may collapse the two.
#
# THE COLUMN SHAPES DIFFER BY ERA and cannot be hardcoded:
#     FY2020-21  Base / OCO for Base / OCO Direct War / Total OCO / Total (Base+OCO)
#     FY2022-23  a single Actual / Enacted / Request column per year
#     FY2024     Less Supplementals / Supplementals / Total Enacted
#     FY2026-27  Discretionary / Reconciliation or Mandatory / Total
# What is stable is the convention that the BROADEST figure for a fiscal year is
# its LAST amount column. "Total OCO" precedes "Total (Base + OCO)"; "Discretionary"
# and "Mandatory" precede "Total". So the fiscal-year figure is the right-most
# amount column bearing that year, and the columns to its left are its components,
# retained as detail rather than summed (summing them would double count the
# subtotals).
# Header spellings drift across books -- "Line Item" becomes "Budget Line Item",
# "PE / BLI" loses its spaces, "Add/ Non-Add" closes up -- so columns are resolved
# by normalised alias, never by exact string.
EXHIBIT_COLS = {
    "bli":   ("budgetlineitem", "lineitem", "pebli"),
    "title": ("budgetlineitem(bli)title", "lineitemtitle",
              "programelementbudgetlineitem(bli)title", "programelement/budgetlineitem(bli)title"),
    "add":   ("addnonadd",),
    "org":   ("organization",),
    "acct_title": ("accounttitle",),
    "ba":    ("budgetactivity",),
    "ba_title": ("budgetactivitytitle",),
    "cost_type": ("costtype",),
}
EXHIBITS = ("p1", "p1r", "r1")

def _key(h):
    return re.sub(r"[\s/]+", "", _norm(h)).lower()

def _resolve(hdr, which):
    """First column index whose normalised header matches an alias for `which`."""
    keys = {_key(h): i for i, h in enumerate(hdr) if h}
    for alias in EXHIBIT_COLS[which]:
        if alias in keys: return keys[alias]
    return None
PB_YEARS = range(2020, 2028)
_WS = re.compile(r"\s+")
_FY = re.compile(r"FY\s*(\d{4})")

def _norm(h):
    return _WS.sub(" ", str(h)).strip() if h is not None else ""

def _num(v):
    if v in (None, ""): return 0.0
    try: return float(v)
    except (TypeError, ValueError):
        try: return float(re.sub(r"[^0-9.\-]", "", str(v)) or 0)
        except ValueError: return 0.0

def _exhibit_files(root, pb, ex):
    import glob
    for pat in (f"FY{pb}/_Year-Level/{ex}_display_*.xlsx", f"FY{pb}/_Year-Level/{ex}_*.xlsx"):
        hits = sorted(g for g in glob.glob(os.path.join(root, pat)) if "_ooc" not in g)
        if hits: return hits[0]
    return None

def _read_sheet(path):
    import openpyxl
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    ws = wb[wb.sheetnames[0]]
    hdr, rows = None, []
    for row in ws.iter_rows(values_only=True):
        if hdr is None:
            if row and row[0] == "Account":
                hdr = [_norm(h) for h in row]
            continue
        rows.append(row)
    wb.close()
    return hdr, rows

def _year_columns(hdr):
    """{fiscal_year: {'total': idx, 'components': [(idx, label)], 'qty': idx|None}}"""
    out = {}
    for i, h in enumerate(hdr):
        m = _FY.search(h)
        if not h or not m: continue
        fy = int(m.group(1))
        e = out.setdefault(fy, {"total": None, "components": [], "qty": None})
        if "Quantity" in h:
            e["qty"] = i                      # last quantity column wins, same rule
        else:
            e["components"].append((i, h))
            e["total"] = i                    # right-most amount column for the year
    return out

def step_exhibits(out):
    root = os.path.join(KB, "11-Budget-Justification/_Archive")
    if not os.path.isdir(root):
        print("  no exhibit archive found, skipping"); return
    vintage = mtime_date(root)
    lines, prog = [], {}
    for pb in PB_YEARS:
        for ex in EXHIBITS:
            path = _exhibit_files(root, pb, ex)
            if not path: continue
            hdr, rows = _read_sheet(path)
            if not hdr: print(f"  FY{pb} {ex}: no header row, skipped"); continue
            years = _year_columns(hdr)
            iB, iT = _resolve(hdr, "bli"), _resolve(hdr, "title")
            iAdd = _resolve(hdr, "add")          # absent on some p1r books
            if iB is None or iT is None:
                print(f"  FY{pb} {ex}: no line-item/title column, skipped"); continue
            kept = 0
            for r in rows:
                if iAdd is not None and r[iAdd] != "Add":
                    continue                  # Non-Add rows are AP detail, not money
                title = _norm(r[iT])
                if not title: continue
                acct = _norm(r[0]); bli = _norm(r[iB])
                cell = lambda w: (_norm(r[_resolve(hdr, w)])
                                  if _resolve(hdr, w) is not None else "")
                base = {
                    "pb_year": pb, "exhibit": ex, "account": acct,
                    "account_title": cell("acct_title"), "organization": cell("org"),
                    "budget_activity": cell("ba"), "budget_activity_title": cell("ba_title"),
                    "bli": bli, "bli_title": title, "cost_type": cell("cost_type"),
                }
                for fy, cols in years.items():
                    role = ("prior_actual" if fy == pb - 2 else
                            "enacted"      if fy == pb - 1 else
                            "request"      if fy == pb else "other")
                    amt = _num(r[cols["total"]]) if cols["total"] is not None else 0.0
                    qty = _num(r[cols["qty"]]) if cols["qty"] is not None else 0.0
                    if amt == 0 and qty == 0: continue
                    lines.append({**base, "fiscal_year": fy, "fy_role": role,
                        "amount_k": round(amt, 3), "quantity": qty,
                        "total_column": _norm(hdr[cols["total"]]) if cols["total"] is not None else None,
                        "component_count": len(cols["components"])})
                    kept += 1
                    k = (acct, ex, bli)
                    p = prog.setdefault(k, {"account": acct, "exhibit": ex, "bli": bli,
                        "program_name": title, "latest_pb": pb,
                        "organization": base["organization"],
                        "account_title": base["account_title"],
                        "first_fiscal_year": fy, "last_fiscal_year": fy, "pb_years": set()})
                    if pb >= p["latest_pb"]:
                        p["latest_pb"], p["program_name"] = pb, title
                    p["first_fiscal_year"] = min(p["first_fiscal_year"], fy)
                    p["last_fiscal_year"]  = max(p["last_fiscal_year"], fy)
                    p["pb_years"].add(pb)
            print(f"  FY{pb} {ex}: {kept:,} line-years from {len(rows):,} rows "
                  f"({len(years)} fiscal years: {sorted(years)})")
    prog_rows = []
    for k, p in prog.items():
        p = dict(p); p["pb_year_count"] = len(p.pop("pb_years"))
        prog_rows.append(p)
    prog_rows.sort(key=lambda x: (x["exhibit"], x["account"], x["bli"]))
    write(out, "exhibits.json", payload("budget_exhibits", vintage,
        {"dm_exhibit_line": lines, "dm_exhibit_program": prog_rows},
        source_path="knowledge-bank/DOD-FM-Knowledge-Bank/11-Budget-Justification/_Archive",
        pb_years=list(PB_YEARS)))

# ------------------------------------------------------------------ program ---
# The only field on this warehouse that ties execution to a BUDGET LINE rather
# than to an account. Everything else here is account-shaped: File A and File B
# have no program dimension at all, and File C -- the sole bridge between an
# award and a Treasury account -- is the thing this step measures the absence of.
#
# The measure that matters is not the obligation total. It is the share of that
# total whose funding account is actually named. A program obligation published
# without it looks reconciled and is not; PROG-03 exists to stop that.
PROGRAM_DIMS = [("recipient", "recipient_parent_name"),
                ("extent_competed", "extent_competed"),
                ("pricing", "type_of_contract_pricing"),
                ("psc", "product_or_service_code"),
                ("awarding_office", "awarding_office_name"),
                ("sub_agency", "awarding_sub_agency_name")]
PROGRAM_DIM_LABEL = {"psc": "product_or_service_code_description"}
FEATURED_N = 12          # programs carried at full depth
REGISTRY_N = 40          # programs listed in the picker
TOP_AWARDS = 10
TOP_ACCOUNT_SETS = 12
PIN_PROGRAMS = {"198"}   # F-35: the pilot this page was built for
# FPDS records "no acquisition program" as the explicit code 000 / description
# NONE, not as a null. Testing for null alone finds almost nothing and makes the
# tagging look complete; it is not. 000 carries roughly three quarters of DoD
# contract dollars and 99.5% of actions, so it is reported as a coverage measure
# in its own right rather than dropped silently.
SENTINEL_CODES = {"000", "", None}

def _untraced_expr():
    import pyarrow.dataset as ds
    f = ds.field("treasury_accounts_funding_this_award")
    return f.is_null() | (f == "")

def _acct_set(raw):
    """federal_accounts_funding_this_award is a ;-separated list of EVERY account
    funding the award, with no apportionment. Never sum an obligation by account
    from it -- PROG-02 asserts we do not."""
    return sorted({a.strip() for a in (raw or "").split(";") if a.strip()})

def step_program(out, only_fy=None):
    import pyarrow.dataset as ds, pyarrow.compute as pc
    base = os.path.join(WAREHOUSE, "contracts")
    if not os.path.isdir(base):
        print("  no contracts warehouse found, skipping"); return
    vs = vintages(); current = vs[-1]
    years = [fy for fy in FY_RANGE
             if os.path.isdir(os.path.join(base, f"vintage={current}/fy={fy}"))]
    if not years:
        print("  no fiscal years in current contract vintage, skipping"); return
    maxfy = max(years)

    # -- pass 1: every program, obligation and traced/untraced split ----------
    tot = collections.defaultdict(lambda: collections.defaultdict(float))
    cnt = collections.defaultdict(lambda: collections.Counter())
    names, spans, cov_rows = {}, collections.defaultdict(set), []
    for fy in years:
        p = os.path.join(base, f"vintage={current}/fy={fy}")
        t = ds.dataset(p, format="parquet").to_table(columns={
            "code": ds.field("dod_acquisition_program_code"),
            "name": ds.field("dod_acquisition_program_description"),
            "ob":   ds.field("federal_action_obligation"),
            "untraced": _untraced_expr()})
        g = t.group_by(["code", "name", "untraced"]).aggregate([("ob", "sum"), ("ob", "count")])
        all_ob, all_n, un_ob, un_n = 0.0, 0, 0.0, 0
        seen = set()
        for r in g.to_pylist():
            code, amt, n = r["code"], (r["ob_sum"] or 0.0), r["ob_count"]
            all_ob += amt; all_n += n
            if code in SENTINEL_CODES:
                un_ob += amt; un_n += n
                continue
            seen.add(code)
            tot[code][fy] += amt
            tot[code][("untraced", fy)] += amt if r["untraced"] else 0.0
            cnt[code][fy] += n
            if r["name"]: names.setdefault(code, r["name"])
            spans[code].add(fy)
        cov_rows.append({"fiscal_year": fy, "vintage": current,
            "total_obligation": round(all_ob, 2), "total_actions": all_n,
            "attributed_obligation": round(all_ob - un_ob, 2), "attributed_actions": all_n - un_n,
            "unattributed_obligation": round(un_ob, 2), "unattributed_actions": un_n,
            "attributed_pct": round((all_ob - un_ob) / all_ob * 100, 4) if all_ob else 0.0,
            "program_count": len(seen), "is_partial_year": fy == maxfy})
        print(f"  FY{fy}: {len(seen)} program codes; "
              f"{cov_rows[-1]['attributed_pct']:.1f}% of ${all_ob/1e9:.0f}B attributed to a program")

    ranked = sorted(tot, key=lambda c: -sum(v for k, v in tot[c].items() if isinstance(k, int)))
    featured = list(dict.fromkeys(list(PIN_PROGRAMS & set(ranked)) + ranked))[:max(FEATURED_N, len(PIN_PROGRAMS))]
    featured_set = set(featured)

    dim_rows_all = {}
    reg_rows, fy_rows, dim_rows, award_rows, acct_rows = [], [], [], [], []
    for code in ranked[:REGISTRY_N] + [c for c in featured if c not in ranked[:REGISTRY_N]]:
        yrs = sorted(spans[code])
        reg_rows.append({"program_code": code, "program_name": names.get(code) or code,
            "total_obligation": round(sum(v for k, v in tot[code].items() if isinstance(k, int)), 2),
            "first_fiscal_year": yrs[0], "last_fiscal_year": yrs[-1],
            "is_featured": code in featured_set,
            "rank_by_obligation": ranked.index(code) + 1})

    # -- pass 2: featured programs only, at depth -----------------------------
    piids = collections.defaultdict(set)
    cols = sorted({c for _, c in PROGRAM_DIMS} | set(PROGRAM_DIM_LABEL.values()) | {
        "dod_acquisition_program_code", "federal_action_obligation", "award_id_piid",
        "treasury_accounts_funding_this_award", "federal_accounts_funding_this_award",
        "action_date", "recipient_name", "transaction_description", "modification_number"})
    for fy in ([only_fy] if only_fy else years):
        p = os.path.join(base, f"vintage={current}/fy={fy}")
        if not os.path.isdir(p): continue
        t = ds.dataset(p, format="parquet").to_table(
            columns=cols, filter=ds.field("dod_acquisition_program_code").isin(featured))
        code_c = t["dod_acquisition_program_code"].to_pylist()
        ob_c   = t["federal_action_obligation"].to_pylist()
        piid_c = t["award_id_piid"].to_pylist()
        tas_c  = t["treasury_accounts_funding_this_award"].to_pylist()
        fa_c   = t["federal_accounts_funding_this_award"].to_pylist()
        date_c = t["action_date"].to_pylist()
        dim_cols = {c: t[c].to_pylist()
                    for c in {c for _, c in PROGRAM_DIMS} | set(PROGRAM_DIM_LABEL.values())}
        recip = dim_cols.get("recipient_name") or t["recipient_name"].to_pylist()
        desc  = t["transaction_description"].to_pylist()
        by = collections.defaultdict(list)
        for i, code in enumerate(code_c):
            by[code].append(i)
        for code in featured:
            idx = by.get(code, [])
            if not idx: continue
            total = sum(ob_c[i] or 0.0 for i in idx)
            untraced = sum(ob_c[i] or 0.0 for i in idx
                           if tas_c[i] is None or tas_c[i] == "")
            late = sum(ob_c[i] or 0.0 for i in idx
                       if date_c[i] is not None and date_c[i].month in (8, 9))
            top5 = sum(sorted((ob_c[i] or 0.0 for i in idx), reverse=True)[:5])
            pset = {piid_c[i] for i in idx if piid_c[i]}
            piids[code] |= pset
            fy_rows.append({"program_code": code, "fiscal_year": fy, "vintage": current,
                "obligation": round(total, 2),
                "traceable_obligation": round(total - untraced, 2),
                "untraceable_obligation": round(untraced, 2),
                "traceable_pct": round((total - untraced) / total * 100, 4) if total else 0.0,
                "action_count": len(idx), "award_count": len(pset),
                "top5_obligation": round(top5, 2),
                "top5_pct": round(top5 / total * 100, 4) if total else 0.0,
                "late_quarter_obligation": round(late, 2),
                "late_quarter_pct": round(late / total * 100, 4) if total else 0.0,
                "is_partial_year": fy == maxfy})
            # dimensions
            for dim, col in PROGRAM_DIMS:
                vals = dim_cols[col]; labs = dim_cols.get(PROGRAM_DIM_LABEL.get(dim) or "")
                agg = collections.defaultdict(lambda: [0.0, 0, None])
                for i in idx:
                    k = vals[i]
                    if k in (None, ""): k = "(not reported)"
                    a = agg[str(k)]
                    a[0] += ob_c[i] or 0.0; a[1] += 1
                    if a[2] is None and labs: a[2] = labs[i]
                recs = sorted(agg.items(), key=lambda kv: -kv[1][0])[:15]
                for rank, (k, (amt, n, lb)) in enumerate(recs, 1):
                    book = CODE_BOOKS.get(dim, {})
                    label = book.get(k) or str(lb or k)
                    if dim in CODE_BOOKS and k in book: label = f"{k} · {label}"
                    dim_rows.append({"program_code": code, "fiscal_year": fy, "dimension": dim,
                        "dim_key": k, "dim_label": label, "rank_in_dim": rank,
                        "obligation": round(amt, 2), "action_count": n})
            # top awards, by contract rather than by action -- the concentration
            # this page is about lives at the PIID level, not the modification level
            byp, biggest = collections.defaultdict(lambda: [0.0, 0, False]), {}
            for i in idx:
                k = piid_c[i] or "(no PIID)"
                a = byp[k]
                a[0] += ob_c[i] or 0.0
                a[1] += 1
                if tas_c[i]: a[2] = True     # any action on the award named an account
                if k not in biggest or (ob_c[i] or 0.0) > (ob_c[biggest[k]] or 0.0):
                    biggest[k] = i
            for rank, (k, a) in enumerate(sorted(byp.items(), key=lambda kv: -kv[1][0])[:TOP_AWARDS], 1):
                i = biggest[k]
                award_rows.append({"program_code": code, "fiscal_year": fy, "award_id_piid": k,
                    "recipient_name": recip[i] or "(not reported)", "obligation": round(a[0], 2),
                    "action_count": a[1], "rank_in_fy": rank,
                    "share_of_fy_pct": round(a[0] / total * 100, 4) if total else 0.0,
                    "has_account_link": a[2],
                    "largest_action_date": date_c[i].isoformat() if date_c[i] else None,
                    "description": (desc[i] or "")[:240] or None})
            # account combinations -- named, never apportioned
            byacct = collections.defaultdict(lambda: [0.0, 0])
            for i in idx:
                accts = _acct_set(fa_c[i])
                if not accts: continue
                a = byacct[";".join(accts)]
                a[0] += ob_c[i] or 0.0; a[1] += 1
            for rank, (k, a) in enumerate(sorted(byacct.items(), key=lambda kv: -abs(kv[1][0]))[:TOP_ACCOUNT_SETS], 1):
                accts = k.split(";")
                outs = sorted({x for x in accts if x.split("-")[0] not in DOW_CODES})
                acct_rows.append({"program_code": code, "fiscal_year": fy, "account_set": k,
                    "account_count": len(accts), "obligation": round(a[0], 2), "action_count": a[1],
                    "rank_in_fy": rank, "out_of_scope_accounts": outs or None,
                    "has_out_of_scope": bool(outs)})
        print(f"  FY{fy}: {len(featured)} featured programs at depth")

    # -- File C tie-out, by PIID ---------------------------------------------
    fc_base = os.path.join(WAREHOUSE, "accounts/file_c_contracts")
    fc_rows = []
    if os.path.isdir(fc_base) and piids:
        want = {}
        for code, s in piids.items():
            for k in s: want.setdefault(k, []).append(code)
        for fy in years:
            p = os.path.join(fc_base, f"fiscal_year={fy}")
            if not os.path.isdir(p): continue
            t = ds.dataset(p, format="parquet").to_table(
                columns=["agency_identifier_code", "award_id_piid",
                         "transaction_obligated_amount", "submission_period"])
            code_c = t["agency_identifier_code"].to_pylist()
            pi = t["award_id_piid"].to_pylist()
            am = t["transaction_obligated_amount"].to_pylist()
            sp = t["submission_period"].to_pylist()
            acc = collections.defaultdict(lambda: [0.0, 0, set()])
            # One cumulative snapshot, for the same reason as step_filec.
            counts = collections.Counter(s for c_, s in zip(code_c, sp) if c_ in DOW_CODES and s)
            latest = max(counts.items(), key=lambda kv: kv[1])[0] if counts else None
            for c_, k_, a_, s_ in zip(code_c, pi, am, sp):
                if c_ not in DOW_CODES or not k_: continue
                if latest and s_ != latest: continue
                for prog in want.get(k_, ()):
                    e = acc[prog]
                    e[0] += a_ or 0.0; e[1] += 1; e[2].add(k_)
            for code in featured:
                e = acc.get(code, [0.0, 0, set()])
                award = next((r["obligation"] for r in fy_rows
                              if r["program_code"] == code and r["fiscal_year"] == fy), 0.0)
                fc_rows.append({"program_code": code, "fiscal_year": fy,
                    "filec_obligation": round(e[0], 2), "filec_rows": e[1],
                    "filec_awards": len(e[2]),
                    "award_obligation": award,
                    "linkage_pct": round(e[0] / award * 100, 4) if award else 0.0,
                    "submission_period": latest,
                    "is_partial_year": fy == maxfy})
            print(f"  FY{fy}: File C matched {sum(v[1] for v in acc.values()):,} rows"
                  f" for {len(featured)} programs (latest {latest})")

    prior = os.path.join(out, "program.json")
    if only_fy and os.path.exists(prior):
        old = json.load(open(prior))["rows"]
        keep = lambda rs: [r for r in rs if r["fiscal_year"] != only_fy]
        fy_rows    = keep(old.get("dm_program_fy", []))      + fy_rows
        dim_rows   = keep(old.get("dm_program_dim_fy", []))  + dim_rows
        award_rows = keep(old.get("dm_program_award", []))   + award_rows
        acct_rows  = keep(old.get("dm_program_account", [])) + acct_rows
        cov_rows   = keep(old.get("dm_program_coverage", []))  + cov_rows
        if not fc_rows: fc_rows = old.get("dm_program_filec", [])
    write(out, "program.json", payload("program_execution", current,
        {"dm_program_dim": reg_rows, "dm_program_coverage": cov_rows, "dm_program_fy": fy_rows,
         "dm_program_dim_fy": dim_rows, "dm_program_award": award_rows,
         "dm_program_account": acct_rows, "dm_program_filec": fc_rows},
        source_path="contracts + accounts/file_c_contracts", vintages=vs,
        featured=featured))

# ------------------------------------------------------------------- main ---
STEPS = {"exhibits": step_exhibits, "sbr": step_sbr, "obligations": step_obligations, "awards": step_awards,
         "filec": step_filec, "assistance": step_assistance, "program": step_program,
         "knowledge": step_knowledge}

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--step", default="all", help="all|" + "|".join(STEPS))
    ap.add_argument("--out", default=os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".staging"))
    ap.add_argument("--fy", type=int, default=None)
    a = ap.parse_args()
    print(f"datamatter ETL {ETL_VERSION}\n  warehouse: {WAREHOUSE}\n  wiki: {WIKI}\n  out: {a.out}")
    names = list(STEPS) if a.step == "all" else [a.step]
    for nm in names:
        print(f"[{nm}]")
        fn = STEPS[nm]
        fn(a.out, a.fy) if nm in ("awards", "assistance", "program") else fn(a.out)
    print("done.")

if __name__ == "__main__":
    main()

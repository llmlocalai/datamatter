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

WAREHOUSE = _pick(os.path.join(ROOT, "data/usaspending/warehouse"),
                  os.path.join(ROOT, "warehouse"))
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
            # Every federal account is kept, not just the largest forty. The -1
            # exhibits resolve a budget line to a Treasury account, and a top-N
            # cut would leave two thirds of those accounts with no File A row --
            # which reads on the page as an execution gap rather than as a
            # retention decision made here. TAS stays capped: it is an order of
            # magnitude larger and nothing joins to it.
            keep = (ranked if dimension in ("agency", "budget_function", "federal_account")
                    else ranked[:40])
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
# actual. That is not drift to be averaged away -- it is the restatement history,
# and it exists nowhere else in these sources. Every row therefore carries BOTH
# pb_year (which book it was read from) and fiscal_year (which year it describes),
# and no query may collapse the two.
#
# THE COLUMN SHAPES DIFFER BY ERA and cannot be hardcoded:
#     FY2020-21  Base / OCO for Base / OCO Direct War / Total OCO / Total (Base+OCO)
#     FY2022-23  a single Actual / Enacted / Request column per year
#     FY2024     Less Supplementals / Supplementals / Total Enacted
#     FY2026-27  Discretionary / Reconciliation or Mandatory / Total
# Two rules, in order, pick the fiscal-year figure:
#   1. If any column for that year is labelled "Total", the RIGHT-MOST such
#      column is the year's figure. "Total OCO" precedes "Total (Base + OCO)";
#      "Discretionary" and "Mandatory" precede "Total". The columns to its left
#      are components and are never added to it.
#   2. If no column for that year says "Total", the year's columns are disjoint
#      components and are SUMMED. This case is real: the PB2026 P-1R book stops
#      at "FY 2026 Request" and "FY 2026 Reconciliation" with no total, so a
#      right-most-column rule alone would publish the reconciliation add as the
#      whole year and drop the discretionary request.
# Which rule fired is recorded per row in total_basis, so any figure on the site
# can be traced back to the column it came from.
#
# WHAT IS MEMO, NOT MONEY. Three kinds of row restate funding that is already
# counted elsewhere in the same book, and none may enter a total:
#   * the whole P-1R exhibit -- verified across PB2020-PB2027, it is National
#     Guard and Reserve equipment carried as "(MEMO NON ADD)" cost types;
#   * P-1 rows flagged Add/Non-Add = "Non-Add";
#   * R-1 rows flagged Include in TOA = "N";
#   * P-1 rows whose COST TYPE says "(MEMO NON ADD)". These hide inside lines
#     that are otherwise flagged Add: PB2021 line 5300, Completion of PY
#     Shipbuilding Programs, carries $369.1M as Weapon System Cost and then
#     restates exactly that $369.1M again as CVN, CVN RCOH, AUX, LPD 17 and DDG
#     breakouts. Taking the Add flag at face value would double the line;
#   * the P-1 "Advance Procurement (CY)" row, which is the subtotal of that
#     line's "C (FY x for FY y) (M)" detail rows. Verified across all eight
#     books: 520 line-years carry both, the subtotal equals the detail every
#     time, and neither ever appears without the other. Keeping both put the
#     PB2026 procurement request at $219.6B against the $205.2B the Department
#     publishes in Program Acquisition Cost by Weapon System; dropping the
#     subtotal and keeping the by-year detail reproduces $205.2B exactly.
# Non-Add P-1 rows are dropped at read time. The other two are kept and flagged
# is_memo, because dropping a whole exhibit would make its absence unexplainable
# on the page. EXH-03 asserts nothing unflagged carries a memo cost type.
#
# Header spellings drift across books -- "Line Item" becomes "Budget Line Item",
# "PE / BLI" loses its spaces, "Add/ Non-Add" closes up -- so columns are resolved
# by normalised alias, never by exact string.
EXHIBIT_COLS = {
    "bli":   ("budgetlineitem", "lineitem", "pebli"),
    "title": ("budgetlineitem(bli)title", "lineitemtitle",
              "programelementbudgetlineitem(bli)title", "programelement/budgetlineitem(bli)title"),
    "add":   ("addnonadd",),
    "toa":   ("includeintoa",),
    "org":   ("organization",),
    "acct_title": ("accounttitle",),
    "ba":    ("budgetactivity",),
    "ba_title": ("budgetactivitytitle",),
    "bsa":   ("bsa",),
    "bsa_title": ("budgetsubactivity(bsa)title", "budgetsubactivity(bsa)title"),
    "line_no": ("linenumber",),
    "cost_type": ("costtype",),
    "cost_type_title": ("costtypetitle",),
}
EXHIBITS = ("p1", "p1r", "r1")
# The P-1 advance-procurement subtotal, restated by year on the rows beneath it.
AP_SUBTOTAL = "Advance Procurement (CY)"
MEMO_EXHIBITS = ("p1r",)
PB_YEARS = range(2020, 2028)

# The exhibit account symbol is a four-digit main account plus a one-letter
# organisation ("1506N" = Aircraft Procurement, Navy). The letter is the only
# thing standing between it and the Treasury account symbol the execution files
# are keyed on, so it is resolved here rather than at query time.
ACCT_AGENCY = {"A": "021", "N": "017", "F": "057", "D": "097", "M": "017"}
# The Organization column is as-published and drifts between books -- "ARMY" in
# one, "A" in another, "DMACT" and "DEFW" and "OSD" alongside each other -- so it
# is kept verbatim and a stable component is derived from the account symbol
# instead. Grouping a roster by the raw column puts Navy in two buckets.
COMPONENT = {"021": "Army", "017": "Navy and Marine Corps",
             "057": "Air Force and Space Force", "097": "Defense-Wide"}
_ACCT = re.compile(r"^(\d{4})([A-Z])$")

_WS = re.compile(r"\s+")
_FY = re.compile(r"FY\s*(\d{4})")


def _norm(h):
    return _WS.sub(" ", str(h)).strip() if h is not None else ""


def _key(h):
    return re.sub(r"[\s/]+", "", _norm(h)).lower()


def _resolve(hdr, which):
    """First column index whose normalised header matches an alias for `which`."""
    keys = {_key(h): i for i, h in enumerate(hdr) if h}
    for alias in EXHIBIT_COLS[which]:
        if alias in keys:
            return keys[alias]
    return None


def _num(v):
    if v in (None, ""): return 0.0
    try: return float(v)
    except (TypeError, ValueError):
        try: return float(re.sub(r"[^0-9.\-]", "", str(v)) or 0)
        except ValueError: return 0.0


def _account_parts(acct):
    """('1506N') -> ('1506', 'N', '017', '017-1506'); unparsable -> (None,...)."""
    m = _ACCT.match(acct or "")
    if not m: return None, None, None, None
    main, letter = m.group(1), m.group(2)
    agency = ACCT_AGENCY.get(letter)
    return main, letter, agency, (f"{agency}-{main}" if agency else None)


def _exhibit_files(root, pb, ex):
    import glob
    for pat in (f"FY{pb}/_Year-Level/{ex}_display_*.xlsx", f"FY{pb}/_Year-Level/{ex}_*.xlsx"):
        hits = sorted(g for g in glob.glob(os.path.join(root, pat)) if "_ooc" not in g)
        if hits: return hits[0]
    return None


# The exhibit step needs two things that are not in the standard library and are
# not Python packages you would install for the rest of this ETL. Both are
# checked once, up front, and named -- a ModuleNotFoundError raised on the ninth
# workbook after two minutes of parsing tells you what is missing but not that
# the fix is one line, and the pdftotext one does not raise at all: it degrades
# to a load with no weapons book and therefore no EXH-08, which is the only
# control here that checks the extract against a published figure.
def _exhibit_preflight():
    import shutil
    try:
        import openpyxl  # noqa: F401
    except ImportError:
        raise SystemExit(
            "The -1 exhibits are .xlsx workbooks and openpyxl is not installed.\n"
            "  python3 -m pip install openpyxl")
    if shutil.which("pdftotext") is None:
        print("  WARNING: pdftotext is not on PATH, so the Program Acquisition Cost by")
        print("           Weapon System books cannot be read. The load will still")
        print("           succeed, but with no weapons-book roster and no EXH-08 --")
        print("           the only control that ties these exhibit totals to a figure")
        print("           the Department publishes. Install it with: brew install poppler")


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
    """{fiscal_year: {'amount': [idx], 'qty': [idx], 'basis': str, 'label': str}}

    'amount' is the set of columns to add for that year -- one element when a
    "Total" column exists, otherwise every component column. See the header
    comment for why both cases are real."""
    seen = {}
    for i, h in enumerate(hdr):
        m = _FY.search(h or "")
        if not h or not m: continue
        fy = int(m.group(1))
        e = seen.setdefault(fy, {"amt": [], "qty": []})
        e["qty" if "Quantity" in h else "amt"].append((i, h))

    out = {}
    for fy, e in seen.items():
        tot = [c for c in e["amt"] if "Total" in c[1]]
        if tot:
            amount, basis, label = [tot[-1][0]], "total_column", tot[-1][1]
        elif len(e["amt"]) == 1:
            amount, basis, label = [e["amt"][0][0]], "sole_column", e["amt"][0][1]
        else:
            amount = [i for i, _ in e["amt"]]
            basis = "sum_of_components"
            label = " + ".join(h for _, h in e["amt"])
        qtot = [c for c in e["qty"] if "Total" in c[1]]
        qty = [qtot[-1][0]] if qtot else [i for i, _ in e["qty"]]
        out[fy] = {"amount": amount, "qty": qty, "basis": basis,
                   "label": label, "component_count": len(e["amt"])}
    return out


# -- the weapons book -----------------------------------------------------------
# Program Acquisition Cost by Weapon System, one PDF per PB year, one page per
# weapon system. The page's first line after the running header is the program
# name and the line above the page number is its category, so the roster comes
# out of the page furniture rather than out of a hand-kept list.
_WB_PAGE = re.compile(r"^\d+-\d+$")
_WB_DIVIDER = re.compile(r"^FY \d{4} .*: \$", re.I)
# Designators are what actually tie a weapons-book name to a budget line:
# "F-35", "AH-64E", "DDG 51", "CVN 78", "SSN 774", "KC-46A".
#
# A designator written with a separator is strong evidence on its own. One
# written as a single run of characters is not, and the difference is not
# cosmetic: "PATRIOT P3I" yields P-3, which is also the Orion aircraft, and
# matching on it alone files an air-defence missile's contracts under a maritime
# patrol aircraft's budget line. So a run-together designator has to be
# corroborated by a shared significant word before it links anything --
# "M1A2 Abrams" still reaches "M1 Abrams Tank (MOD)" on M-1 plus ABRAMS.
_DESIG = re.compile(r"\b([A-Z]{1,4})[-\s](\d{1,4})([A-Z]{0,2})\b")
_DESIG_RUN = re.compile(r"\b([A-Z]{1,4})(\d{1,4})([A-Z]{0,2})\b")
_STOP = {"THE", "AND", "FOR", "OF", "SYSTEM", "SYSTEMS", "PROGRAM", "PROGRAMS",
         "PROJECTS", "RELATED", "NEW", "MOD", "MODS", "SUPPORT", "EQUIPMENT",
         "US", "USA", "USAF", "USN", "USMC", "INC", "II", "III", "IV",
         # exhibit furniture that would otherwise read as a type designator
         "FY", "BA", "PE", "BLI", "TOA", "PY", "CY", "AP"}


def _words(name):
    return {w for w in re.split(r"[^A-Z0-9]+", (name or "").upper())
            if len(w) > 2 and w not in _STOP}


def _designators(name, strong_only=False):
    out, up = set(), (name or "").upper()
    pats = (_DESIG,) if strong_only else (_DESIG, _DESIG_RUN)
    for pat in pats:
        for a, b, c in pat.findall(up):
            if a in _STOP: continue
            out.add(f"{a}-{b}{c}")
            if c: out.add(f"{a}-{b}")
    return out


def _designator_link(left, right):
    """Shared designator plus the strength of the evidence, or None.

    Returns (token, 'designator') when both names write the designator with a
    separator, (token, 'designator_corroborated') when at least one writes it as
    a run and a significant word is shared as well, and None otherwise."""
    strong = _designators(left, True) & _designators(right, True)
    if strong: return sorted(strong)[0], "designator"
    weak = _designators(left) & _designators(right)
    if weak and (_words(left) & _words(right)):
        return sorted(weak)[0], "designator_corroborated"
    return None


def _weapon_book(root, pb):
    """[{program_name, category, page_no}] for the PB(pb) weapons book, or []."""
    import glob, subprocess
    hits = sorted(glob.glob(os.path.join(
        root, f"FY{pb}/_Year-Level/Program-Acquisition-Costs-by-Weapons-System_*.pdf")))
    if not hits: return []
    try:
        txt = subprocess.run(["pdftotext", "-layout", hits[0], "-"],
                             capture_output=True, text=True, timeout=180).stdout
    except (OSError, subprocess.SubprocessError) as e:
        print(f"  FY{pb} weapons book: pdftotext unavailable ({e}), skipped"); return []
    head = f"FY {pb} Program Acquisition Cost"
    out, seen = [], set()
    for page in txt.split("\f"):
        ne = [l.strip() for l in page.split("\n") if l.strip()]
        if len(ne) < 3 or not ne[0].startswith(head): continue
        page_no = cat = None
        for i in range(len(ne) - 1, 0, -1):
            if _WB_PAGE.fullmatch(ne[i]):
                page_no, cat = ne[i], ne[i - 1]
                break
        if not page_no: continue                    # front matter
        # Every weapon-system page names a prime contractor; the section dividers
        # and the historical-profile pages that share their page furniture do not.
        # That one string is what separates 86 real systems from 16 chapter heads
        # in the PB2026 book, and it needs no per-book list to maintain.
        if "Prime Contractor" not in page: continue
        name = ne[1]
        if name == cat or _WB_DIVIDER.match(name): continue   # category divider
        if (name, page_no) in seen: continue
        seen.add((name, page_no))
        out.append({"pb_year": pb, "program_name": name, "category": cat,
                    "page_no": page_no})
    return out


# The weapons book's own introduction states the Department's investment request
# for the year it covers: "$384.3 billion, which includes $205.2 billion for
# Procurement and $179.1 billion for RDT&E". Those two figures are the only
# independent check available on the -1 extract, because they are the same
# request totalled by the same Department from the same submission. Pulling them
# out turns the exhibit spine from something that is merely internally consistent
# into something that has been reconciled to a published number -- and it is what
# caught the advance-procurement subtotal being double counted.
_WB_TOTALS = re.compile(
    r"totals\s*\$([\d,.]+)\s*billion.*?"
    r"\$([\d,.]+)\s*billion for Procurement and\s*\$([\d,.]+)\s*billion for RDT&E",
    re.S)


def _weapon_book_totals(root, pb):
    """The investment / procurement / RDT&E request the PB(pb) book states."""
    import glob, subprocess
    hits = sorted(glob.glob(os.path.join(
        root, f"FY{pb}/_Year-Level/Program-Acquisition-Costs-by-Weapons-System_*.pdf")))
    if not hits: return []
    try:
        txt = subprocess.run(["pdftotext", "-layout", "-f", "1", "-l", "8", hits[0], "-"],
                             capture_output=True, text=True, timeout=120).stdout
    except (OSError, subprocess.SubprocessError):
        return []
    m = _WB_TOTALS.search(_WS.sub(" ", txt))
    if not m: return []
    cite = (f"Program Acquisition Cost by Weapon System, FY{pb} Budget Request, "
            "Introduction -- Major Weapon Systems Overview")
    val = lambda g: float(m.group(g).replace(",", ""))
    return [{"pb_year": pb, "measure": k, "exhibit": e, "published_b": val(g),
             "citation": cite}
            for k, e, g in (("investment", None, 1), ("procurement", "p1", 2),
                            ("rdte", "r1", 3))]


def _link_weapons(weapons, programs):
    """Tie weapons-book program names to exhibit budget lines, with the evidence.

    A link is only made on shared evidence and always records what that evidence
    was, so a reader can reject an individual match without distrusting the rest:
      designator  -- both names carry the same type designator (F-35, DDG 51)
      phrase      -- three or more shared significant words and no designator on
                     either side to contradict
    Nothing is matched on a single common word."""
    by_pb = collections.defaultdict(list)
    for w in weapons:
        by_pb[w["pb_year"]].append((w, _designators(w["program_name"]), _words(w["program_name"])))
    links = []
    for p in programs:
        cand = by_pb.get(p["latest_pb"]) or by_pb.get(max(by_pb) if by_pb else None) or []
        pd, pw = _designators(p["program_name"]), _words(p["program_name"])
        best = None
        for w, wd, ww in cand:
            hit = _designator_link(p["program_name"], w["program_name"])
            if hit:
                token, how = hit
                score = (200 if how == "designator" else 100) + len(pw & ww)
                if not best or score > best[0]:
                    best = (score, w, how, token)
                continue
            shared_w = pw & ww
            if len(shared_w) >= 3 and not pd and not wd:
                score = len(shared_w)
                if not best or score > best[0]:
                    best = (score, w, "phrase", ";".join(sorted(shared_w)[:4]))
        if not best: continue
        _, w, how, ev = best
        links.append({"account": p["account"], "exhibit": p["exhibit"], "bli": p["bli"],
                      "pb_year": w["pb_year"], "weapon_program": w["program_name"],
                      "weapon_category": w["category"], "weapon_page": w["page_no"],
                      "match_method": how, "match_evidence": ev})
    return links


def step_exhibits(out):
    _exhibit_preflight()
    root = os.path.join(KB, "11-Budget-Justification/_Archive")
    if not os.path.isdir(root):
        print("  no exhibit archive found, skipping"); return
    vintage = mtime_date(root)
    lines, prog, rollup = [], {}, {}
    unparsed_accounts = collections.Counter()

    for pb in PB_YEARS:
        for ex in EXHIBITS:
            path = _exhibit_files(root, pb, ex)
            if not path: continue
            hdr, rows = _read_sheet(path)
            if not hdr:
                print(f"  FY{pb} {ex}: no header row, skipped"); continue
            years = _year_columns(hdr)
            iB, iT = _resolve(hdr, "bli"), _resolve(hdr, "title")
            iAdd, iToa = _resolve(hdr, "add"), _resolve(hdr, "toa")
            if iB is None or iT is None:
                print(f"  FY{pb} {ex}: no line-item/title column, skipped"); continue
            cols = {w: _resolve(hdr, w) for w in
                    ("org", "acct_title", "ba", "ba_title", "bsa", "bsa_title",
                     "line_no", "cost_type", "cost_type_title")}
            kept = memo = 0
            for r in rows:
                if iAdd is not None and r[iAdd] == "Non-Add":
                    continue                      # AP detail already inside the line
                title = _norm(r[iT])
                if not title: continue
                acct = _norm(r[0]); bli = _norm(r[iB])
                main, letter, agency, tas = _account_parts(acct)
                if tas is None: unparsed_accounts[acct] += 1
                cell = lambda w: (_norm(r[cols[w]]) if cols[w] is not None else "")
                cost_type_title = (_norm(r[cols["cost_type_title"]])
                                   if cols["cost_type_title"] is not None else "")
                is_memo = (ex in MEMO_EXHIBITS
                           or (iToa is not None and _norm(r[iToa]) == "N")
                           or "MEMO NON ADD" in cost_type_title.upper()
                           or cost_type_title == AP_SUBTOTAL)
                base = {
                    "pb_year": pb, "exhibit": ex, "account": acct,
                    "account_main": main, "treasury_agency": agency,
                    "treasury_account": tas,
                    "account_title": cell("acct_title"), "organization": cell("org"),
                    "budget_activity": cell("ba"), "budget_activity_title": cell("ba_title"),
                    "bsa": cell("bsa"), "bsa_title": cell("bsa_title"),
                    "line_number": cell("line_no"),
                    "bli": bli, "bli_title": title,
                    "cost_type": cell("cost_type"),
                    "cost_type_title": cost_type_title,
                    "is_memo": is_memo,
                }
                for fy, c in years.items():
                    role = ("prior_actual" if fy == pb - 2 else
                            "enacted"      if fy == pb - 1 else
                            "request"      if fy == pb else "other")
                    amt = sum(_num(r[i]) for i in c["amount"])
                    qty = sum(_num(r[i]) for i in c["qty"])
                    if amt == 0 and qty == 0: continue
                    lines.append({**base, "fiscal_year": fy, "fy_role": role,
                        "amount_k": round(amt, 3), "quantity": qty,
                        "total_column": c["label"][:200], "total_basis": c["basis"],
                        "component_count": c["component_count"]})
                    kept += 1
                    memo += 1 if is_memo else 0

                    # Memo rows roll up separately from money rows. They share a
                    # budget line -- the shipbuilding breakouts and the advance-
                    # procurement subtotal sit on the same BLI as the weapon system
                    # cost -- so a rollup keyed without is_memo would mix a
                    # restatement into the figure it restates.
                    rk = (acct, ex, bli, pb, fy, is_memo)
                    ro = rollup.setdefault(rk, {
                        "account": acct, "treasury_account": tas, "exhibit": ex, "bli": bli,
                        "pb_year": pb, "fiscal_year": fy, "fy_role": role,
                        "bli_title": title, "organization": base["organization"],
                        "account_title": base["account_title"],
                        "budget_activity": base["budget_activity"],
                        "budget_activity_title": base["budget_activity_title"],
                        "is_memo": is_memo, "amount_k": 0.0, "quantity": 0.0,
                        "cost_type_count": 0, "total_basis": c["basis"]})
                    ro["amount_k"] += amt
                    ro["quantity"] += qty
                    ro["cost_type_count"] += 1

                    k = (acct, ex, bli)
                    p = prog.setdefault(k, {"account": acct, "treasury_account": tas,
                        "component": COMPONENT.get(agency, "Unresolved"),
                        "exhibit": ex, "bli": bli,
                        "program_name": title, "latest_pb": pb,
                        "organization": base["organization"],
                        "account_title": base["account_title"],
                        "budget_activity_title": base["budget_activity_title"],
                        "is_memo": is_memo,
                        "first_fiscal_year": fy, "last_fiscal_year": fy,
                        "latest_request_k": 0.0, "latest_request_pb": None,
                        "lifetime_amount_k": 0.0,
                        "pb_years": set()})
                    if pb >= p["latest_pb"]:
                        p["latest_pb"], p["program_name"] = pb, title
                        p["account_title"] = base["account_title"]
                        p["budget_activity_title"] = base["budget_activity_title"]
                    p["first_fiscal_year"] = min(p["first_fiscal_year"], fy)
                    p["last_fiscal_year"]  = max(p["last_fiscal_year"], fy)
                    p["pb_years"].add(pb)
            print(f"  FY{pb} {ex}: {kept:,} line-years from {len(rows):,} rows "
                  f"({memo:,} memo) -- fiscal years {sorted(years)}")

    for ro in rollup.values():
        ro["amount_k"] = round(ro["amount_k"], 3)

    # The headline figure for a line is its newest REQUEST, not its newest number
    # of any kind -- an actual and a request are different claims about a year.
    # The headline figure for a line is its newest REQUEST, which is not the same
    # as its figure in the newest book: a line that stopped being requested still
    # appears for two more books as an enactment and an actual, and reporting a
    # dash there would hide a program that was funded through FY2021 and simply
    # ended. So the newest book that CONTAINS A REQUEST is what is reported, and
    # the book year is carried beside it.
    requests = collections.defaultdict(lambda: collections.defaultdict(float))
    for ro in rollup.values():
        # Memo rollups never enter a headline figure. They share a budget line
        # with the money rows -- the advance-procurement subtotal sits on the
        # same BLI as the weapon system cost -- so adding them here would put
        # the roster's request above the line's own restatement matrix.
        if ro["is_memo"] or ro["fy_role"] != "request": continue
        k = (ro["account"], ro["exhibit"], ro["bli"])
        requests[k][ro["pb_year"]] += ro["amount_k"]
        prog[k]["lifetime_amount_k"] += ro["amount_k"]
    for k, by_pb in requests.items():
        pb = max(by_pb)
        prog[k]["latest_request_pb"] = pb
        prog[k]["latest_request_k"] = by_pb[pb]

    prog_rows = []
    for p in prog.values():
        p = dict(p)
        p["pb_year_count"] = len(p.pop("pb_years"))
        p["latest_request_k"] = round(p["latest_request_k"], 3)
        p["lifetime_amount_k"] = round(p["lifetime_amount_k"], 3)
        p["slug"] = re.sub(r"[^a-z0-9]+", "-",
                           f"{p['exhibit']}-{p['account']}-{p['bli']}".lower()).strip("-")
        prog_rows.append(p)
    prog_rows.sort(key=lambda x: (x["exhibit"], x["account"], x["bli"]))

    weapons = []
    for pb in PB_YEARS:
        w = _weapon_book(root, pb)
        if w: print(f"  FY{pb} weapons book: {len(w)} weapon systems")
        weapons.extend(w)
    tieouts = []
    for pb in PB_YEARS:
        tieouts.extend(_weapon_book_totals(root, pb))
    if tieouts:
        print("  weapons-book totals: " + ", ".join(
            f"PB{t['pb_year']} {t['measure']} ${t['published_b']}B"
            for t in tieouts if t["measure"] == "procurement"))

    links = _link_weapons(weapons, prog_rows)
    linked = {(l["account"], l["exhibit"], l["bli"]) for l in links}
    for p in prog_rows:
        p["in_weapons_book"] = (p["account"], p["exhibit"], p["bli"]) in linked
    print(f"  weapons book: {len(weapons)} system-years, {len(links):,} budget lines linked "
          + ", ".join(f"{n} {m}" for m, n in
                      sorted(collections.Counter(l["match_method"] for l in links).items())))

    if unparsed_accounts:
        print(f"  {sum(unparsed_accounts.values())} rows carry an account symbol that is "
              f"not four digits plus an organisation letter: "
              f"{dict(list(unparsed_accounts.items())[:6])}")

    rollup_rows = sorted(rollup.values(),
                         key=lambda x: (x["exhibit"], x["account"], x["bli"],
                                        x["pb_year"], x["fiscal_year"]))
    write(out, "exhibits.json", payload("budget_exhibits", vintage,
        {"dm_exhibit_line": lines,
         "dm_exhibit_program_fy": rollup_rows,
         "dm_exhibit_program": prog_rows,
         "dm_weapon_system": weapons,
         "dm_exhibit_weapon_link": links,
         "dm_exhibit_tieout": tieouts},
        source_path="knowledge-bank/DOD-FM-Knowledge-Bank/11-Budget-Justification/_Archive",
        pb_years=list(PB_YEARS)))

# --------------------------------------------------------------- crosswalk ---
# The last link in the chain the site is built around: budget line -> Treasury
# account -> contract. The account half falls out of the exhibit symbol. This is
# the other half -- tying a -1 budget line to the FPDS acquisition program code
# the contract file is cut by, which is the only field in that file keyed to a
# budget line rather than to an account.
#
# Neither source carries the other's key, so every link is derived and every
# link records what it rests on. Only two kinds of evidence are accepted:
#   designator  -- both names carry the same type designator (F-35, DDG 51,
#                  CH-53K). This is nearly all of it, and it is strong: the
#                  designator IS the program's identity in both vocabularies.
#   exact_name  -- the normalised names are identical.
# Name similarity short of that is not accepted. A budget line with no link is
# left with none rather than given a plausible one, because a wrong link here
# would put one program's contracts under another program's appropriation.
def step_crosswalk(out):
    ex_path = os.path.join(out, "exhibits.json")
    pr_path = os.path.join(out, "program.json")
    if not (os.path.exists(ex_path) and os.path.exists(pr_path)):
        print("  needs exhibits.json and program.json staged first, skipping"); return
    ex = json.load(open(ex_path)); pr = json.load(open(pr_path))
    programs = ex["rows"]["dm_exhibit_program"]
    fpds = pr["rows"]["dm_program_dim"]
    vintage = min(ex["vintage"], pr["vintage"])

    by_desig = collections.defaultdict(set)
    by_name = {}
    for p in fpds:
        for d in _designators(p["program_name"]):
            by_desig[d].add(p["program_code"])
        by_name.setdefault(re.sub(r"[^A-Z0-9]+", "", p["program_name"].upper()), p)

    links = []
    for e in programs:
        if e["is_memo"]: continue
        hit = None
        for p in fpds:
            d = _designator_link(e["program_name"], p["program_name"])
            if not d: continue
            token, how = d
            # An ambiguous designator names more than one program code and is
            # therefore evidence of nothing; it is skipped, not guessed at.
            if len(by_desig.get(token, ())) != 1: continue
            hit = (p, how, token); break
        if hit is None:
            p = by_name.get(re.sub(r"[^A-Z0-9]+", "", e["program_name"].upper()))
            if p: hit = (p, "exact_name", p["program_name"])
        if hit is None: continue
        p, how, ev = hit
        links.append({"exhibit": e["exhibit"], "account": e["account"], "bli": e["bli"],
                      "treasury_account": e["treasury_account"],
                      "bli_title": e["program_name"],
                      "program_code": p["program_code"], "program_name": p["program_name"],
                      "is_featured": p.get("is_featured", False),
                      "match_method": how, "match_evidence": ev})
    codes = {l["program_code"] for l in links}
    print(f"  {len(links):,} budget lines linked to {len(codes)} of {len(fpds)} "
          f"FPDS acquisition program codes")
    write(out, "crosswalk.json", payload("budget_execution_crosswalk", vintage,
        {"dm_exhibit_program_link": links},
        source_path="derived from budget_exhibits x program_execution"))


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
         "knowledge": step_knowledge,
         "crosswalk": step_crosswalk}

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

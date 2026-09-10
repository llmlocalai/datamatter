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
  pb_display  all seven -1 display tables, latest books -> the FY2027 request page
  execution   File B at reported grain -> account x object class x activity detail
  timing      contract action dates -> daily pace, year-end concentration, signals
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
  "deobligations_or_recoveries_or_refunds_from_prior_year","submission_period",
  # The grain columns. They are not summed; they are what tells a genuine second
  # row apart from the same row published twice - see _fileb_grain below.
  "treasury_account_symbol","direct_or_reimbursable_funding_source",
  "disaster_emergency_fund_code","program_activity_code",
  "program_activity_reporting_key"]

# File B's measures, and the name each one carries in the stage row.
FILE_B_MEASURES = [
  ("obligations_incurred",                                  "obligations_incurred"),
  ("obligations_undelivered_orders_unpaid_total",            "undelivered_orders_unpaid"),
  ("obligations_delivered_orders_unpaid_total",              "delivered_orders_unpaid"),
  ("gross_outlay_amount_FYB_to_period_end",                  "gross_outlays"),
  ("deobligations_or_recoveries_or_refunds_from_prior_year", "deobligations"),
]

# ---------------------------------------------------------------------------
# File B changed its program-activity identifier in FY2026. Through FY2025 a row
# is identified by program_activity_code; from the FY2026 P09 submission that
# column is null on every row and the Program Activity Reporting Key (PARK)
# carries the identity instead.
#
# The transition was not made cleanly. Where an account has several PARKs, the
# FY2026 extract repeats the account's object-class figure verbatim against each
# one rather than splitting it - 017-2026/2030-1612-000 publishes the same
# $7,384,996,196.00 against object class 31.0 under four different PARKs. Adding
# the rows up therefore counts the money once per PARK: Department-wide
# obligations come to $1,652.9B against File A's $1,225.0B, 34.9% too high, and
# that is what TIE-01 was failing on.
#
# So File B is aggregated at its real grain - account, object class, direct or
# reimbursable, emergency fund - and a group whose rows differ only by PARK and
# repeat one figure counts once. The rule is deliberately narrow: it needs every
# row in the group to have a null program_activity_code, which is true only of
# the FY2026 partition, so FY2021-25 pass through untouched (measured: zero rows
# collapsed in any of them). Two program activities in those years may legitimately
# report equal amounts, and there the code still distinguishes them.
# ---------------------------------------------------------------------------
def _fileb_grain(c, rows):
    """Group File B row indices by account/object class/funding source/DEFC.

    Returns (groups, replicated) where groups maps the grain key to its row
    indices and replicated is the subset of those keys where the rows differ
    only by PARK and publish one repeated obligation figure.
    """
    groups, replicated = collections.OrderedDict(), set()
    for i in rows:
        k = (str(c["treasury_account_symbol"][i] or ""),
             str(c["object_class_code"][i] or "??"),
             str(c["direct_or_reimbursable_funding_source"][i] or ""),
             str(c["disaster_emergency_fund_code"][i] or ""))
        groups.setdefault(k, []).append(i)
    for k, idx in groups.items():
        if len(idx) < 2: continue
        if any(c["program_activity_code"][i] not in (None, "") for i in idx): continue
        if any(c["program_activity_reporting_key"][i] in (None, "") for i in idx): continue
        if len({round(c["obligations_incurred"][i] or 0.0, 2) for i in idx}) == 1:
            replicated.add(k)
    return groups, replicated

def _fileb_value(c, idx, col, is_replicated):
    """One group's contribution to a measure.

    A replicated group is one published row repeated, so it contributes that row
    once - the modal value, because the FY2026 extract is not even self-consistent
    across the copies (the gross outlay column disagrees on a minority of them).
    Any other group is a genuine split and is summed.
    """
    vals = [round(c[col][i] or 0.0, 2) for i in idx]
    if not is_replicated: return sum(vals)
    return collections.Counter(vals).most_common(1)[0][0]

def step_obligations(out):
    import pyarrow.dataset as ds
    base = os.path.join(WAREHOUSE, "accounts/file_b")
    vintage = mtime_date(base)
    stage_rows, oc_rows, grain_rows = [], [], []
    for fy in FY_RANGE:
        p = os.path.join(base, f"fiscal_year={fy}")
        if not os.path.isdir(p): continue
        t = ds.dataset(p, format="parquet").to_table(columns=FILE_B_COLS)
        c = {k: t[k].to_pylist() for k in FILE_B_COLS}
        rows = [i for i in range(t.num_rows)
                if (c["agency_identifier_code"][i] or "") in DOW_CODES]
        groups, replicated = _fileb_grain(c, rows)

        agg = collections.defaultdict(float)
        oc  = collections.defaultdict(float)
        ocn = {}
        raw_obl = sum(c["obligations_incurred"][i] or 0.0 for i in rows)
        collapsed = 0
        for k, idx in groups.items():
            rep = k in replicated
            if rep: collapsed += len(idx) - 1
            for col, name in FILE_B_MEASURES:
                agg[name] += _fileb_value(c, idx, col, rep)
            ock = k[1]
            ocn.setdefault(ock, str(c["object_class_name"][idx[0]] or ock))
            oc[ock] += _fileb_value(c, idx, "obligations_incurred", rep)

        # One period per fiscal year is the shape of this extract; if that ever
        # stops being true the period is recorded as ambiguous rather than
        # quietly labelled with one of them, because TIE-01 asserts on it.
        periods = sorted({c["submission_period"][i] for i in rows if c["submission_period"][i]})
        stage_rows.append({
            "fiscal_year": fy, "scope": "DOW",
            **{k: round(v, 2) for k, v in agg.items()},
            "submission_period": periods[0] if len(periods) == 1 else None,
            "periods_available": len(periods),
            "source_rows": len(rows), "grain_rows": len(groups),
            "replicated_rows": collapsed,
        })
        grain_rows.append({
            "fiscal_year": fy, "scope": "DOW",
            "source_rows": len(rows), "grain_rows": len(groups),
            "replicated_groups": len(replicated), "replicated_rows": collapsed,
            "activity_key": "program_activity_reporting_key"
                if all(c["program_activity_code"][i] in (None, "") for i in rows)
                else "program_activity_code",
            "obligations_as_published": round(raw_obl, 2),
            "obligations_at_grain": round(agg["obligations_incurred"], 2),
            "overstatement_pct": round(
                (raw_obl - agg["obligations_incurred"]) / max(1.0, abs(agg["obligations_incurred"])) * 100, 4),
        })
        for rank, (k, v) in enumerate(sorted(oc.items(), key=lambda kv: -kv[1])[:25], 1):
            oc_rows.append({"fiscal_year": fy, "scope": "DOW", "object_class_code": k,
                            "object_class_name": ocn[k], "major_class": major_class(k),
                            "obligations": round(v, 2), "rank_in_fy": rank})
        note = f", {collapsed:,} PARK-replicated rows counted once" if collapsed else ""
        print(f"  FY{fy}: obligations {agg['obligations_incurred']/1e9:.1f}B, "
              f"UDO {agg['undelivered_orders_unpaid']/1e9:.1f}B{note}")
    write(out, "obligations.json", payload("file_b_obligations", vintage,
          {"dm_obligation_stage": stage_rows, "dm_object_class": oc_rows,
           "dm_fileb_grain": grain_rows},
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
    rec, periods = [], []
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
        # Every period is measured, not only the one that is published. File C is
        # a CUMULATIVE snapshot, so a figure read from period 6 states the year
        # through March and a figure read from period 12 states the whole year.
        # Dividing either by a full-year FPDS total gives a linkage percentage,
        # but only the like periods are comparable across years -- and the period
        # that happens to be held differs by year. Without this series the
        # year-over-year trend cannot be read at all.
        per_tot = collections.defaultdict(float)
        per_rows = collections.Counter()
        per_awards = collections.defaultdict(set)
        for c_, a_, k_, s_ in zip(code, amt, keys, sper):
            if c_ not in DOW_CODES: continue
            if s_:
                per_tot[s_] += (a_ or 0.0); per_rows[s_] += 1
                if k_: per_awards[s_].add(k_)
            if best and s_ != best: continue     # one cumulative snapshot only
            tot += (a_ or 0.0); rows += 1
            if k_: uniq.add(k_)
        for s_ in sorted(per_rows):
            m = re.search(r"P(\d+)$", s_)
            periods.append({
                "fiscal_year": fy, "submission_period": s_,
                "period_no": int(m.group(1)) if m else None,
                "obligation": round(per_tot[s_], 2),
                "filec_rows": per_rows[s_],
                "filec_awards": len(per_awards[s_]),
                "award_obligation": (award_by_fy.get(fy) or {}).get("obligation", 0.0),
                "is_chosen": s_ == best})
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
    subs = [x for x in periods if x["filec_rows"] > 1000]
    print(f"  {len(periods)} submission periods held across {len(rec)} fiscal years; "
          f"{len(subs)} carry more than a thousand rows "
          f"({sorted({x['period_no'] for x in subs})} of 12)")
    write(out, "filec.json", payload("file_c_reconciliation", vintage,
          {"dm_reconciliation": rec, "dm_filec_period": periods},
          source_path="accounts/file_c_contracts"))

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


# The token that separates two programmes is often the one a stop list throws
# away. "Small Diameter Bomb (SDB) I" and "SMALL DIAMETER BOMB II" share every
# significant word -- Small, Diameter, Bomb -- and differ only in a roman
# numeral that _STOP removes, so a phrase match cannot tell them apart and files
# SDB II's $195M under SDB I. A variant marker is therefore never evidence FOR a
# match, but a disagreement between two of them is decisive evidence against one.
_VARIANT = re.compile(r"\b(?:(I{1,3}|IV|VI{0,3}|IX)|BLOCK\s*([0-9IVX]+)|INCREMENT\s*([0-9IVX]+))\b")


def _variants(name):
    return {tuple(g for g in m.groups() if g) for m in _VARIANT.finditer((name or "").upper())}


def _variant_conflict(left, right):
    """True when both names carry a variant marker and they disagree."""
    a, b = _variants(left), _variants(right)
    return bool(a) and bool(b) and not (a & b)


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


# ------------------------------------------- the weapons book's cost tables ---
# Every weapon-system page in Program Acquisition Cost by Weapon System carries a
# table of the SAME money the -1 exhibits itemise line by line, but totalled by
# the Department against the system rather than against a budget line: RDT&E and
# Procurement, split by service, with quantities, for three fiscal years. It is
# the only place in these sources that states what a whole programme costs, and
# several pages say in a footnote what that total covers -- "Includes
# Modification Program and Spares" -- which is the only published answer to
# whether spares and modification money is inside the figure or beside it.
#
# The book changes shape between eras exactly as the -1 books do: PB2020 and
# PB2021 split the budget year into Base / OCO / Total Request, PB2026 splits it
# into Discretionary / Mandatory / TOTAL, and PB2022-PB2025 print one column per
# year. So the fiscal-year figure is picked by the SAME two rules used for the
# exhibits -- the right-most column labelled Total, or the sum of that year's
# components where the book labels none -- and which rule fired is recorded per
# row in total_basis. A right-most-column rule alone would publish the PB2026
# mandatory add as the whole year.

_WB_TOTAL_SUB = re.compile(r"Total Request|TOTAL|Total$")
_WB_ANY_SUB = re.compile(r"Base Budget|OCO Budget|Total Request|\(DISC\.\)|\(MAND\.\)|TOTAL")
_WB_FY = re.compile(r"FY\s*(20\d\d)")
_WB_NUM = re.compile(r"^\(?\$?-?[\d,]+(?:\.\d+)?\)?$")
_WB_CTRL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]")
_WB_DASH = ("-", "--", "–", "—")


def _wb_clean(s):
    """Category and system names carry stray control bytes in some books."""
    return _WS.sub(" ", _WB_CTRL.sub("", s or "")).strip()


def _wb_tokens(line):
    return [(m.group(0), m.start(), m.end()) for m in re.finditer(r"\S+", line)]


def _wb_num(t):
    t = t.strip().replace("$", "").replace(",", "")
    if t in _WB_DASH or not t: return None
    neg = t.startswith("(") and t.endswith(")")
    try: v = float(t.strip("()"))
    except ValueError: return None
    return -v if neg else v


def _wb_geometry(lines, ruler_i):
    """The table's columns as [(fiscal_year, is_total_column, qty, amt)], or an error."""
    rt = _wb_tokens(lines[ruler_i])
    if len(rt) % 2: return None, "odd number of column headers"
    pairs = []
    for a, b in zip(rt[0::2], rt[1::2]):
        if {a[0], b[0]} != {"Qty", "$M"}: return None, "column headers are not Qty/$M pairs"
        q, m = (a, b) if a[0] == "Qty" else (b, a)
        pairs.append({"lo": min(a[1], b[1]), "hi": max(a[2], b[2]), "qty": q, "amt": m})
    fy, subs = [], []
    for l in lines[max(0, ruler_i - 4):ruler_i]:
        fy += [(int(m.group(1)), m.start()) for m in _WB_FY.finditer(l)]
        subs += [(m.group(0), m.start()) for m in _WB_ANY_SUB.finditer(l)]
    if not fy: return None, "no fiscal-year labels above the columns"
    fy.sort(key=lambda x: x[1]); subs.sort(key=lambda x: x[1])
    # Extra columns are always sub-columns of the budget year, and sub-labels
    # always describe the trailing columns. Anything else is a shape this parser
    # has not seen: refuse it rather than guess, because one wrong column here
    # publishes an OCO add or a reconciliation add as a whole year.
    if len(pairs) == len(fy):
        years = [y for y, _ in fy]
    elif subs and len(pairs) == len(fy) - 1 + len(subs):
        years = [y for y, _ in fy[:-1]] + [fy[-1][0]] * len(subs)
    else:
        return None, (f"unrecognised header: {len(pairs)} columns, "
                      f"{len(fy)} year labels, {len(subs)} sub-labels")
    total_at = set()
    if subs:
        base = len(pairs) - len(subs)
        total_at = {base + i for i, (t, _) in enumerate(subs) if _WB_TOTAL_SUB.fullmatch(t)}
    return [{"fy": years[i], "is_total": i in total_at, **p}
            for i, p in enumerate(pairs)], None


def _wb_bands(cols):
    """Each column header widened to the midpoint of its neighbours."""
    flat = []
    for c in cols:
        flat.append((c, "qty", c["qty"])); flat.append((c, "amt", c["amt"]))
    flat.sort(key=lambda x: x[2][1])
    out = []
    for i, (c, kind, tok) in enumerate(flat):
        lo = -1 if i == 0 else (flat[i - 1][2][2] + tok[1]) / 2
        hi = 10 ** 6 if i == len(flat) - 1 else (tok[2] + flat[i + 1][2][1]) / 2
        out.append((c, kind, lo, hi))
    return out


def _wb_split_row(line):
    """(label, where the figures start).

    The label is everything before the run of numbers that ends the line.
    Splitting on the column positions truncates 'AH-64E New Build'; splitting on
    the first digit truncates 'Total   13,189'."""
    toks = _wb_tokens(line)
    i = len(toks)
    while i > 0 and (_WB_NUM.match(toks[i - 1][0]) or toks[i - 1][0] in _WB_DASH):
        i -= 1
    if i == 0: return "", (toks[0][1] if toks else 0)
    if i == len(toks): return line.strip(" ."), 10 ** 6
    return line[:toks[i][1]].strip(" ."), toks[i][1]


def _wb_cells(line, bands, figure_start):
    got = {}
    for t, s, e in _wb_tokens(line):
        if s < figure_start: continue
        if not _WB_NUM.match(t): continue   # a dash is an absent figure, not a zero
        c = (s + e) / 2
        for col, kind, lo, hi in bands:
            if lo <= c < hi:
                # The figures are right-aligned to their column, so where two
                # tokens fall in one band -- which happens on rows typeset
                # tightly enough that a figure drifts left out of its own column
                # -- the right-most is the one actually aligned to this column.
                got.setdefault(id(col), {})[kind] = _wb_num(t)
                break
    return got


def _wb_fold(cols, got):
    """One figure per fiscal year, by the exhibits' own two rules."""
    by_year = {}
    for c in cols: by_year.setdefault(c["fy"], []).append(c)
    out = {}
    for year, group in by_year.items():
        cells = [(c, got.get(id(c), {})) for c in group]
        if len(group) == 1:
            amt, qty = cells[0][1].get("amt"), cells[0][1].get("qty")
            basis = "sole_column"
        else:
            tot = [g for c, g in cells if c["is_total"]]
            if tot:
                amt, qty, basis = tot[-1].get("amt"), tot[-1].get("qty"), "total_column"
            else:
                parts = [g.get("amt") for _, g in cells if g.get("amt") is not None]
                qtys = [g.get("qty") for _, g in cells if g.get("qty") is not None]
                amt = round(sum(parts), 3) if parts else None
                qty = round(sum(qtys), 3) if qtys else None
                basis = "sum_of_components"
        if amt is None and qty is None: continue
        out[year] = {"amount_m": amt, "quantity": qty, "total_basis": basis,
                     "component_count": len(group)}
    return out


def _wb_cost_table(page):
    """({rows, note, shape}, error) for one weapon-system page."""
    lines = page.split("\n")
    ruler_i = None
    for i, l in enumerate(lines):
        t = _wb_tokens(l)
        if len(t) >= 2 and all(x[0] in ("Qty", "$M") for x in t):
            ruler_i = i; break
    if ruler_i is None: return None, "no Qty/$M column headers on the page"
    cols, err = _wb_geometry(lines, ruler_i)
    if err: return None, err
    bands = _wb_bands(cols)
    rows, block, block_indent, note = [], None, -1, None
    carry, carry_at = None, -9
    for idx, l in enumerate(lines[ruler_i + 1:]):
        s = l.strip()
        if not s: continue
        if s.startswith("Note:"):
            note = _WS.sub(" ", s[5:].split("Numbers may not")[0]).strip() or note
            break
        if s.startswith("Numbers may not"): break
        label, figure_start = _wb_split_row(l)
        indent = len(l) - len(l.lstrip())
        if not label or not re.search(r"[A-Za-z]", label):
            # A wrapped label puts its figures on a line of their own:
            # "Chemical Agents and" / the figures / "Munitions Destruction".
            if not label and carry and idx - carry_at <= 2:
                label, indent = carry, 0
            else:
                continue
        years = _wb_fold(cols, _wb_cells(l, bands, figure_start))
        low = label.lower()
        kind = "total" if low == "total" else "subtotal" if low == "subtotal" else "detail"
        if not years:                      # a heading, or a row that is all dashes
            if kind == "detail":
                # Only a line at the level of the current heading opens a new
                # appropriation. A deeper one is a service with nothing to
                # report, and promoting it would hand the block's Subtotal to
                # the wrong parent, which double counts: the services under the
                # real parent are then added as well.
                if block is None or indent <= block_indent:
                    block, block_indent = label, indent
                carry, carry_at = label, idx
            continue
        service = None
        if kind == "detail":
            # A valued row at or left of its heading is a sibling of that
            # heading rather than a member of it: "Mods" sits beside RDT&E and
            # Procurement as a third addend, and on pages with no service split
            # the RDT&E heading carries the figure itself.
            if block is None or indent <= block_indent:
                block, block_indent = label, indent
            else:
                service = label
        rows.append({"appropriation": None if kind == "total" else block,
                     "service": service, "row_kind": kind, "years": years})
    return {"rows": rows, "note": note}, None


def _wb_block_total(rows, fy):
    """The sum of the appropriation blocks for one fiscal year.

    A block counts once: its Subtotal where the book prints one, its own row
    where it carries the figure itself, otherwise the sum of its services."""
    blocks = {}
    for r in rows:
        if r["row_kind"] == "total": continue
        amt = r["years"].get(fy, {}).get("amount_m")
        if amt is None: continue
        slot = blocks.setdefault(r["appropriation"],
                                 {"subtotal": None, "own": None, "children": 0.0})
        if r["row_kind"] == "subtotal": slot["subtotal"] = amt
        elif r["service"] is None: slot["own"] = amt
        else: slot["children"] += amt
    return round(sum(s["subtotal"] if s["subtotal"] is not None else
                     s["own"] if s["own"] is not None else s["children"]
                     for s in blocks.values()), 3)


# An abbreviation is an alias for a system only when the book expands it into
# the system's own name. "The F-35 Joint Strike Fighter (JSF)" is evidence;
# "Close Air Support (CAS)" on the same page is not, and neither is "(ISR)".
# The test is the one the weapon crosswalk already uses: two or more shared
# significant words. Nothing is matched on a single common word.
_WB_PAREN = re.compile(r"([A-Z][A-Za-z0-9\-/&' ]{3,60}?)\s*\(([A-Z][A-Za-z0-9\-/]{1,14})\)")


def _wb_aliases(name, body):
    out = []
    nw = _words(name)
    for long, ab in _WB_PAREN.findall(body):
        long = _WS.sub(" ", long).strip()
        shared = _words(long) & nw
        if len(shared) < 2: continue
        if ab.upper() in _STOP or ab.upper() in nw: continue
        out.append({"alias": ab, "expands_to": name, "match_method": "book_parenthetical",
                    "match_evidence": f"{long} ({ab})"[:300]})
    # An abbreviation printed inside the system's own name needs no corroboration.
    for long, ab in _WB_PAREN.findall(name):
        if ab.upper() in _STOP: continue
        out.append({"alias": ab, "expands_to": name, "match_method": "name_parenthetical",
                    "match_evidence": name[:300]})
    seen, uniq = set(), []
    for a in out:
        if a["alias"].upper() in seen: continue
        seen.add(a["alias"].upper()); uniq.append(a)
    return uniq


_WB_PRIME = re.compile(r"Prime Contractor\(?s?\)?\s*:?\s*(.+)", re.S)

def _weapon_book(root, pb):
    """What the PB(pb) weapons book states, or empty structures.

    Returns {systems, costs, aliases}: one system row per page as before, plus
    the page's cost table -- the Department's own total for the same money the
    -1 exhibits itemise -- and the abbreviations the book expands into a
    system's own name, which is the only published source of the shorthand
    people actually search for ("JSF", "FLRAA", "SDB")."""
    import glob, subprocess
    empty = {"systems": [], "costs": [], "aliases": []}
    hits = sorted(glob.glob(os.path.join(
        root, f"FY{pb}/_Year-Level/Program-Acquisition-Costs-by-Weapons-System_*.pdf")))
    if not hits: return empty
    try:
        txt = subprocess.run(["pdftotext", "-layout", hits[0], "-"],
                             capture_output=True, text=True, timeout=180).stdout
    except (OSError, subprocess.SubprocessError) as e:
        print(f"  FY{pb} weapons book: pdftotext unavailable ({e}), skipped"); return empty
    head = f"FY {pb} Program Acquisition Cost"
    systems, costs, aliases, seen = [], [], [], set()
    unparsed = collections.Counter()
    for page in txt.split("\f"):
        ne = [l.strip() for l in page.split("\n") if l.strip()]
        if len(ne) < 3 or not ne[0].startswith(head): continue
        page_no = cat = None
        for i in range(len(ne) - 1, 0, -1):
            if _WB_PAGE.fullmatch(ne[i]):
                page_no, cat = ne[i], _wb_clean(ne[i - 1])
                break
        if not page_no: continue                    # front matter
        # Every weapon-system page names a prime contractor; the section dividers
        # and the historical-profile pages that share their page furniture do not.
        # That one string is what separates 86 real systems from 16 chapter heads
        # in the PB2026 book, and it needs no per-book list to maintain.
        if "Prime Contractor" not in page: continue
        name = _wb_clean(ne[1])
        if name == cat or _WB_DIVIDER.match(name): continue   # category divider
        if (name, page_no) in seen: continue
        seen.add((name, page_no))

        prime = None
        m = _WB_PRIME.search(page)
        if m:
            prime = _WS.sub(" ", m.group(1).split("Numbers may not")[0]).strip()
            prime = prime.split("  ")[0][:400] or None

        table, err = _wb_cost_table(page)
        if err:
            unparsed[err] += 1
        else:
            for r in table["rows"]:
                for fy, v in sorted(r["years"].items()):
                    costs.append({
                        "pb_year": pb, "program_name": name, "page_no": page_no,
                        "appropriation": (r["appropriation"] or "")[:120] or None,
                        "service": (r["service"] or "")[:60] or None,
                        "row_kind": r["row_kind"],
                        "fiscal_year": fy,
                        "fy_role": ("prior_actual" if fy == pb - 2 else
                                    "enacted" if fy == pb - 1 else
                                    "request" if fy == pb else "other"),
                        "amount_m": v["amount_m"], "quantity": v["quantity"],
                        "total_basis": v["total_basis"],
                        "component_count": v["component_count"],
                        "coverage_note": (table["note"] or "")[:300] or None})
            # The page's own footing: the system total against the sum of its
            # appropriation blocks. Published as a finding rather than fixed --
            # a handful of pages are typeset so tightly that a figure cannot be
            # assigned to a column with confidence, and saying which ones is
            # more honest than quietly absorbing them.
            tot = next((r for r in table["rows"] if r["row_kind"] == "total"), None)
            for fy, v in (tot["years"].items() if tot else []):
                if v["amount_m"] is None: continue
                s = _wb_block_total(table["rows"], fy)
                costs.append({
                    "pb_year": pb, "program_name": name, "page_no": page_no,
                    "appropriation": None, "service": None, "row_kind": "block_check",
                    "fiscal_year": fy,
                    "fy_role": ("prior_actual" if fy == pb - 2 else
                                "enacted" if fy == pb - 1 else
                                "request" if fy == pb else "other"),
                    "amount_m": s, "quantity": None,
                    "total_basis": v["total_basis"], "component_count": 0,
                    "coverage_note": (table["note"] or "")[:300] or None})

        body = " ".join(ne[2:16])
        for a in _wb_aliases(name, body):
            aliases.append({"pb_year": pb, **a})
        systems.append({"pb_year": pb, "program_name": name, "category": cat,
                        "page_no": page_no, "prime_contractor": prime,
                        "coverage_note": ((table or {}).get("note") or "")[:300] or None})
    if unparsed:
        print(f"  FY{pb} weapons book: {sum(unparsed.values())} cost tables not read "
              f"-- {dict(list(unparsed.items())[:3])}")
    return {"systems": systems, "costs": costs, "aliases": aliases}


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
    links, ambiguous = [], 0
    for p in programs:
        cand = by_pb.get(p["latest_pb"]) or by_pb.get(max(by_pb) if by_pb else None) or []
        pd, pw = _designators(p["program_name"]), _words(p["program_name"])
        best, runner = None, None
        for w, wd, ww in cand:
            if _variant_conflict(p["program_name"], w["program_name"]):
                continue                     # SDB I is not SDB II
            hit = _designator_link(p["program_name"], w["program_name"])
            if hit:
                token, how = hit
                score = (200 if how == "designator" else 100) + len(pw & ww)
            else:
                shared_w = pw & ww
                if len(shared_w) < 3 or pd or wd: continue
                score, how, token = len(shared_w), "phrase", ";".join(sorted(shared_w)[:4])
            if not best or score > best[0]:
                runner, best = best, (score, w, how, token)
            elif not runner or score > runner[0]:
                runner = (score, w, how, token)
        if not best: continue
        # Two systems that fit equally well is not a match to be broken by
        # iteration order. "Small Diameter Bomb", with no variant marker of its
        # own, fits SDB I and SDB II exactly as well; naming one of them would be
        # a guess wearing the same evidence string as a real match, so it gets
        # no row -- the rule the designator matcher already follows.
        if runner and runner[0] == best[0] and runner[1]["program_name"] != best[1]["program_name"]:
            ambiguous += 1
            continue
        _, w, how, ev = best
        links.append({"account": p["account"], "exhibit": p["exhibit"], "bli": p["bli"],
                      "pb_year": w["pb_year"], "weapon_program": w["program_name"],
                      "weapon_category": w["category"], "weapon_page": w["page_no"],
                      "match_method": how, "match_evidence": ev})
    if ambiguous:
        print(f"  weapons book: {ambiguous} budget lines fit two systems equally well "
              f"and were left unlinked rather than assigned to one")
    return links


# --------------------------------------------------- taxonomy and searching ---
# Two published taxonomies sit over these lines and they answer different
# questions, so both are carried and both are labelled:
#
#   the weapons book's category   -- the Department's own grouping of major
#     systems (Aircraft & Related Systems, Missiles & Munitions, ...). It is
#     authoritative and it is sparse: it covers only the lines that tie to a
#     system page.
#   the J-book's own hierarchy    -- appropriation, budget activity and budget
#     sub-activity as printed in the -1 exhibits (Combat Aircraft, Rotary,
#     Tactical Missiles, ...). It covers every line, because it is the
#     structure the exhibit is organised by.
#
# Neither is invented here, and neither is presented as the other. What IS
# derived is the choice of one spelling per account: the exhibits write the same
# appropriation four ways across eight books ("Research, Development, Test &
# Eval, AF" and "Research, Development, Test and Evaluation, Air Force" are one
# account), so the canonical label is the longest spelling seen for that
# Treasury account, and the account symbol -- not the label -- is the key.

def _canonical_appropriations(lines):
    """{treasury_account: the longest title the books give it}."""
    best = {}
    for l in lines:
        k = l.get("treasury_account") or l.get("account")
        t = (l.get("account_title") or "").strip()
        if not k or not t: continue
        if len(t) > len(best.get(k, "")): best[k] = t
    return best


# The exhibit a line is published in IS its appropriation class: the P-1 and the
# P-1R are procurement exhibits and the R-1 is the research and development
# exhibit. This is a restatement of the source, not a classification of it.
FUND_TYPE = {"p1": "Procurement", "p1r": "Procurement", "r1": "RDT&E"}


def _search_norm(*parts):
    """Case, punctuation and spacing removed, so 'f35', 'F-35' and 'F 35' are one
    string. This is what makes the roster findable without a fuzzy matcher
    guessing: the normalisation is exact and reversible in the sense that
    matters -- it never makes two different designators equal."""
    return " ".join(re.sub(r"[^a-z0-9]+", "", (p or "").lower()) for p in parts if p)

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
                        "budget_activity": base["budget_activity"],
                        "budget_activity_title": base["budget_activity_title"],
                        "bsa": base["bsa"], "bsa_title": base["bsa_title"],
                        "fund_type": FUND_TYPE.get(ex, "Other"),
                        "is_memo": is_memo, "ba_weight": collections.Counter(),
                        "first_fiscal_year": fy, "last_fiscal_year": fy,
                        "latest_request_k": 0.0, "latest_request_pb": None,
                        "lifetime_amount_k": 0.0,
                        "pb_years": set()})
                    if pb >= p["latest_pb"]:
                        p["latest_pb"], p["program_name"] = pb, title
                        p["account_title"] = base["account_title"]
                    # A budget line item is NOT confined to one budget activity.
                    # In the PB2027 P-1, line ATA000 appears under BA 03 Tactical
                    # Forces for $16.6B and again under BA 10 Aircraft Spares and
                    # Repair Parts for $1.0B -- the same line, its airframe money
                    # and its spares money filed in different activities. Taking
                    # whichever row happened to be read last labelled the F-35
                    # procurement line "Aircraft Spares and Repair Parts". So the
                    # activity shown is the one carrying the most money in the
                    # newest book, and how many the line spans is carried beside
                    # it rather than hidden.
                    p["ba_weight"][(pb, base["budget_activity"],
                                    base["budget_activity_title"],
                                    base["bsa"], base["bsa_title"])] += abs(amt)
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
        weight = p.pop("ba_weight")
        newest = [k for k in weight if k[0] == p["latest_pb"]] or list(weight)
        if newest:
            best = max(newest, key=lambda k: weight[k])
            _, p["budget_activity"], p["budget_activity_title"], bsa, bsa_title = best
            p["bsa"], p["bsa_title"] = bsa, bsa_title
            p["activity_count"] = len({(k[1], k[3]) for k in newest})
        p["latest_request_k"] = round(p["latest_request_k"], 3)
        p["lifetime_amount_k"] = round(p["lifetime_amount_k"], 3)
        p["slug"] = re.sub(r"[^a-z0-9]+", "-",
                           f"{p['exhibit']}-{p['account']}-{p['bli']}".lower()).strip("-")
        prog_rows.append(p)
    prog_rows.sort(key=lambda x: (x["exhibit"], x["account"], x["bli"]))

    weapons, wb_costs, wb_aliases = [], [], []
    for pb in PB_YEARS:
        w = _weapon_book(root, pb)
        if w["systems"]:
            print(f"  FY{pb} weapons book: {len(w['systems'])} weapon systems, "
                  f"{len(w['costs']):,} cost rows, {len(w['aliases'])} abbreviations")
        weapons.extend(w["systems"])
        wb_costs.extend(w["costs"])
        wb_aliases.extend(w["aliases"])
    tieouts = []
    for pb in PB_YEARS:
        tieouts.extend(_weapon_book_totals(root, pb))
    if tieouts:
        print("  weapons-book totals: " + ", ".join(
            f"PB{t['pb_year']} {t['measure']} ${t['published_b']}B"
            for t in tieouts if t["measure"] == "procurement"))

    links = _link_weapons(weapons, prog_rows)
    linked = {}
    for l in sorted(links, key=lambda x: x["pb_year"]):
        linked[(l["account"], l["exhibit"], l["bli"])] = l
    canon = _canonical_appropriations(lines)
    for p in prog_rows:
        k = (p["account"], p["exhibit"], p["bli"])
        l = linked.get(k)
        p["in_weapons_book"] = l is not None
        # The Department's own category, carried only where the Department's own
        # book names the system. An empty cell here is not "uncategorised": it
        # means this line is not one of the major systems the weapons book
        # itemises, which is a fact about the book rather than about the line.
        p["weapon_category"] = (l or {}).get("weapon_category")
        p["weapon_program"] = (l or {}).get("weapon_program")
        p["appropriation"] = canon.get(p["treasury_account"] or p["account"],
                                       p["account_title"])
        p["search_norm"] = _search_norm(
            p["program_name"], p["bli"], p["account"], p["treasury_account"],
            p["appropriation"], p.get("bsa_title"), p.get("weapon_program"))

    # One row per abbreviation the weapons book expands into a system's own
    # name. This is what lets "JSF" find the F-35 without the site inventing a
    # synonym list: the book wrote the expansion, and the row carries it.
    alias_rows, aseen = [], set()
    wl_by_program = collections.defaultdict(set)
    for l in links:
        wl_by_program[l["weapon_program"]].add((l["exhibit"], l["account"], l["bli"]))
    for a in sorted(wb_aliases, key=lambda x: -x["pb_year"]):
        key = (a["alias"].upper(), a["expands_to"])
        if key in aseen: continue
        aseen.add(key)
        alias_rows.append({
            "alias": a["alias"][:60],
            "alias_norm": re.sub(r"[^a-z0-9]+", "", a["alias"].lower()),
            "weapon_program": a["expands_to"],
            "pb_year": a["pb_year"],
            "designator_norm": " ".join(sorted(
                re.sub(r"[^a-z0-9]+", "", d.lower())
                for d in _designators(a["expands_to"], True))) or None,
            "linked_lines": len(wl_by_program.get(a["expands_to"], ())),
            "match_method": a["match_method"],
            "match_evidence": a["match_evidence"]})
    print(f"  weapons book: {len(alias_rows)} abbreviations the book expands into a "
          f"system's own name")
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
         "dm_weapon_system_cost": wb_costs,
         "dm_weapon_alias": alias_rows,
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

# ------------------------------------------------------------------ catalog ---
# The field-level truth about every source this site reads.
#
# Every page here is built on joins, and a join can only be understood at the
# level of the columns it is made from. This step walks each source, records what
# it actually carries, how often each column is populated, what real values look
# like, and which columns the site reads at all -- so a reader can see what was
# available and not used, not merely what was used.
#
# It also pulls REAL ROWS that demonstrate each break. A gap asserted in prose is
# an opinion; a gap shown as the record that fails to join is a fact.

CATALOG_SAMPLE_ROWS = 10_000      # per source; printed on the page, never implied

# What the site reads, by source. Everything else in the file is carried by the
# source and ignored here.
FIELDS_READ = {
    "file_a": set(FILE_A_COLS),
    "file_b": set(FILE_B_COLS),
    "file_c_contracts": {"agency_identifier_code", "transaction_obligated_amount",
                         "award_unique_key", "award_id_piid", "submission_period"},
    "contracts": ({"federal_action_obligation", "action_date", "modification_number",
                   "agency_identifier_code", "award_id_piid", "recipient_name",
                   "transaction_description", "awarding_agency_name",
                   "dod_acquisition_program_code", "dod_acquisition_program_description",
                   "treasury_accounts_funding_this_award",
                   "federal_accounts_funding_this_award"}
                  | {c for _, c in AWARD_DIMS} | set(DIM_LABEL.values())),
}

SOURCES = [
    ("file_a", "File A — account balances", "accounts/file_a/fiscal_year=%d"),
    ("file_b", "File B — object class and program activity", "accounts/file_b/fiscal_year=%d"),
    ("file_c_contracts", "File C — award financial", "accounts/file_c_contracts/fiscal_year=%d"),
]


def _arrow_kind(t):
    s = str(t)
    if "string" in s or "utf8" in s: return "text"
    if "int" in s: return "integer"
    if "double" in s or "float" in s or "decimal" in s: return "number"
    if "date" in s or "timestamp" in s: return "date"
    if "bool" in s: return "boolean"
    return s[:24]


def _profile(path, source_key, label, fiscal_year, limit=CATALOG_SAMPLE_ROWS):
    """Every column of one source: how often it is populated, how many distinct
    values it carries, three real values, and whether this site reads it.

    Read as batches rather than with head(): a parquet row group in these files
    is the whole file, so asking for ten thousand rows decompresses ninety
    columns of two million and takes 2.4GB to answer. iter_batches respects the
    batch size inside a row group."""
    import pyarrow.dataset as ds, pyarrow.parquet as pq
    d = ds.dataset(path, format="parquet")
    files = sorted(d.files)
    used = FIELDS_READ.get(source_key, set())
    kinds = {f.name: _arrow_kind(f.type) for f in d.schema}
    pf = pq.ParquetFile(files[0])
    batch = next(pf.iter_batches(batch_size=limit), None)
    if batch is None: return []
    n = batch.num_rows
    out = []
    for i, name in enumerate(batch.schema.names):
        vals = batch.column(i).to_pylist()
        present = [v for v in vals if v is not None and str(v).strip() != ""]
        uniq = collections.Counter(str(v) for v in present)
        out.append({
            "source_key": source_key, "source_label": label, "fiscal_year": fiscal_year,
            "field_name": name, "field_kind": kinds.get(name, "text"),
            "rows_scanned": n,
            "populated_pct": round(len(present) / n * 100, 2) if n else None,
            "distinct_count": len(uniq),
            "sample_values": " | ".join(s[:70] for s, _ in uniq.most_common(3))[:400] or None,
            "is_read": name in used, "note": None})
        del vals, present, uniq
    del batch, pf
    return out


def _stream_table(path, limit, columns):
    """Up to `limit` rows of `columns`, read in batches so a single row group
    cannot pull the whole file into memory."""
    import pyarrow as pa, pyarrow.dataset as ds, pyarrow.parquet as pq
    got, taken = [], 0
    for f in sorted(ds.dataset(path, format="parquet").files):
        pf = pq.ParquetFile(f)
        for b in pf.iter_batches(batch_size=50_000, columns=columns):
            got.append(pa.Table.from_batches([b]))
            taken += b.num_rows
            if taken >= limit: break
        if taken >= limit: break
    return pa.concat_tables(got) if got else None


# Real rows, from every source, and one account followed through all of them.
#
# A column profile says a field exists. It does not show what a record looks
# like, and it cannot show why two records fail to meet. These two structures do:
# dm_source_row carries complete example records from each file, and dm_trace_row
# carries the records from every file that describe ONE Treasury account, in
# chain order, so the step where the key disappears can be seen rather than
# described.

TRACE_ACCOUNT = "017-1506"          # Aircraft Procurement, Navy — the F-35 lines
TRACE_MAIN, TRACE_AGENCY = "1506", "017"


def _rows_as_records(tbl, idxs, cols):
    out = []
    for i in idxs:
        out.append({c: tbl[c][i] for c in cols if c in tbl})
    return out


def _sample_rows(path, source_key, source_label, cols, pick, limit=200_000):
    """`pick` chooses row indexes from the materialised columns."""
    t = _stream_table(path, limit, cols)
    if t is None: return []
    data = {c: t[c].to_pylist() for c in t.column_names}
    out = []
    for label, why, i in pick(data, t.num_rows):
        out.append({"source_key": source_key, "source_label": source_label,
                    "row_label": label, "why": why,
                    "record": json.dumps({c: data[c][i] for c in t.column_names},
                                         default=str)[:2400]})
    return out

def step_catalog(out, only_fy=None):
    """Field inventory of every source, plus the rows that demonstrate each break."""
    import pyarrow.dataset as ds
    fields, samples = [], []
    fy = only_fy or 2025
    vintage = mtime_date(os.path.join(WAREHOUSE, "accounts"))

    for key, label, tmpl in SOURCES:
        p = os.path.join(WAREHOUSE, tmpl % fy)
        if not os.path.isdir(p):
            print(f"  {key}: no FY{fy} partition, skipped"); continue
        rows = _profile(p, key, label, fy)
        fields.extend(rows)
        read = sum(1 for r in rows if r["is_read"])
        print(f"  {key}: {len(rows)} columns, {read} read by the site, "
              f"{len(rows) - read} carried and unused")

    # contracts live under a vintage partition
    cvs = vintages()
    cp = os.path.join(WAREHOUSE, f"contracts/vintage={cvs[-1]}/fy={fy}")
    if os.path.isdir(cp):
        rows = _profile(cp, "contracts", "Contract award transactions (FPDS)", fy)
        fields.extend(rows)
        read = sum(1 for r in rows if r["is_read"])
        print(f"  contracts: {len(rows)} columns, {read} read by the site, "
              f"{len(rows) - read} carried and unused")

    # ------------------------------------------------- the demonstrating rows --
    # Each of these is a real record, quoted, that fails the join the site needs.
    def add(seam, verdict, why, cols):
        samples.append({"seam_key": seam, "fiscal_year": fy, "verdict": verdict,
                        "why": why, "record": json.dumps(cols, default=str)[:1800]})

    if os.path.isdir(cp):
        t = _stream_table(cp, 400_000, [
            "award_id_piid", "modification_number", "federal_action_obligation",
            "recipient_name", "dod_acquisition_program_code",
            "dod_acquisition_program_description", "treasury_accounts_funding_this_award",
            "federal_accounts_funding_this_award", "awarding_sub_agency_name",
            "action_date", "product_or_service_code_description"])
        cols = {c: t[c].to_pylist() for c in t.column_names}
        n = t.num_rows

        def rec(i, keep):
            return {k: cols[k][i] for k in keep}

        # 1. an action naming no Treasury account at all
        big_untraced = sorted(
            (i for i in range(n)
             if not (cols["treasury_accounts_funding_this_award"][i] or "").strip()),
            key=lambda i: -(cols["federal_action_obligation"][i] or 0))[:1]
        for i in big_untraced:
            add("action_account", "no account named",
                "The largest single contract action in the year carries no Treasury account at "
                "all, so this obligation cannot be tied to the appropriation that funded it. It "
                "is counted as untraceable rather than assigned to a likely account. Note that "
                "the same row does name its acquisition programme, so the Department knows what "
                "the money bought and the file still cannot say which appropriation paid.",
                rec(i, ["award_id_piid", "modification_number", "federal_action_obligation",
                        "recipient_name", "awarding_sub_agency_name", "action_date",
                        "treasury_accounts_funding_this_award",
                        "product_or_service_code_description"]))

        # 2. an action naming SEVERAL accounts, with no split between them
        multi = sorted(
            (i for i in range(n)
             if (cols["federal_accounts_funding_this_award"][i] or "").count(";") >= 2),
            key=lambda i: -(cols["federal_action_obligation"][i] or 0))[:1]
        for i in multi:
            acc = _acct_set(cols["federal_accounts_funding_this_award"][i])
            add("action_account", f"{len(acc)} accounts, one amount",
                f"One obligation of ${(cols['federal_action_obligation'][i] or 0):,.0f} names "
                f"{len(acc)} federal accounts in a single semicolon-separated field. The file "
                "states no split between them, so no share of this dollar can be attributed to "
                "any one account without inventing the apportionment.",
                rec(i, ["award_id_piid", "modification_number", "federal_action_obligation",
                        "recipient_name", "federal_accounts_funding_this_award", "action_date"]))

        # 3. the sentinel: a programme field that says NONE rather than being null
        sent = sorted(
            (i for i in range(n)
             if (cols["dod_acquisition_program_code"][i] or "") in ("000", "0", "")
             or (cols["dod_acquisition_program_description"][i] or "").upper() == "NONE"),
            key=lambda i: -(cols["federal_action_obligation"][i] or 0))[:1]
        for i in sent:
            add("action_program", "programme code 000 / NONE",
                "The acquisition programme field is populated, so a test for missing values "
                "finds nothing missing. Its value is the sentinel 000 with description NONE, "
                "which means the opposite: this obligation belongs to no programme the field "
                "can name.",
                rec(i, ["award_id_piid", "federal_action_obligation", "recipient_name",
                        "dod_acquisition_program_code", "dod_acquisition_program_description",
                        "action_date"]))

        # 4. a large action that DOES name a programme, for contrast
        good = sorted(
            (i for i in range(n)
             if (cols["dod_acquisition_program_code"][i] or "") not in ("000", "0", "")
             and (cols["dod_acquisition_program_description"][i] or "").upper() != "NONE"
             and (cols["treasury_accounts_funding_this_award"][i] or "").strip()),
            key=lambda i: -(cols["federal_action_obligation"][i] or 0))[:1]
        for i in good:
            add("action_program", "programme named",
                "The same two fields, both populated: a real programme and a real account. "
                "Roughly one contract action in two hundred names a programme, which is why the "
                "programme view reaches a quarter of the dollars and half a percent of the "
                "actions.",
                rec(i, ["award_id_piid", "federal_action_obligation", "recipient_name",
                        "dod_acquisition_program_code", "dod_acquisition_program_description",
                        "treasury_accounts_funding_this_award", "action_date"]))

        # 5. the award-to-File-C break, shown as a PIID present in one and not the other
        fcp = os.path.join(WAREHOUSE, f"accounts/file_c_contracts/fiscal_year={fy}")
        if os.path.isdir(fcp):
            ft = _stream_table(fcp, 1_500_000,
                ["agency_identifier_code", "award_id_piid", "submission_period",
                 "transaction_obligated_amount", "treasury_account_symbol"])
            # File C is narrow here (five columns) but long; the award-file scan
            # above is capped because it is both.
            fcode = ft["agency_identifier_code"].to_pylist()
            fpiid = ft["award_id_piid"].to_pylist()
            fper = ft["submission_period"].to_pylist()
            famt = ft["transaction_obligated_amount"].to_pylist()
            ftas = ft["treasury_account_symbol"].to_pylist()
            counts = collections.Counter(s for c_, s in zip(fcode, fper) if c_ in DOW_CODES and s)
            best = max(counts.items(), key=lambda kv: kv[1])[0] if counts else None
            in_filec = {p for c_, p, s_ in zip(fcode, fpiid, fper)
                        if c_ in DOW_CODES and s_ == best and p}
            missing = sorted(
                (i for i in range(n)
                 if (cols["award_id_piid"][i] or "") and cols["award_id_piid"][i] not in in_filec
                 and (cols["treasury_accounts_funding_this_award"][i] or "").strip()),
                key=lambda i: -(cols["federal_action_obligation"][i] or 0))[:1]
            for i in missing:
                add("award_filec", f"absent from File C snapshot {best}",
                    "This contract action is in the award files with a Treasury account named on "
                    "it, and its award identifier appears nowhere in the File C snapshot the site "
                    "publishes for the same year. That is a linkage gap in this cut, not evidence "
                    "the obligation was unreported: a different snapshot of the same year may "
                    "carry it.",
                    rec(i, ["award_id_piid", "federal_action_obligation", "recipient_name",
                            "treasury_accounts_funding_this_award", "awarding_sub_agency_name",
                            "action_date"]))
            # and one that DOES reconcile, for contrast
            paid = {p_ for p_, s_, a_, c_ in zip(fpiid, fper, famt, fcode)
                    if c_ in DOW_CODES and s_ == best and p_ and a_}
            hit = sorted(
                (i for i in range(n) if (cols["award_id_piid"][i] or "") in paid),
                key=lambda i: -(cols["federal_action_obligation"][i] or 0))[:1]
            for i in hit:
                j = next((k for k in range(len(fpiid))
                          if fpiid[k] == cols["award_id_piid"][i] and fper[k] == best
                          and famt[k]), None)
                add("award_filec", "reaches File C",
                    "The same identifier on both sides. Note what File C adds that the award "
                    "files do not carry: the Treasury account as a discrete field rather than as "
                    "a semicolon-separated display string.",
                    {**rec(i, ["award_id_piid", "federal_action_obligation", "recipient_name"]),
                     "file_c.treasury_account_symbol": ftas[j] if j is not None else None,
                     "file_c.transaction_obligated_amount": famt[j] if j is not None else None,
                     "file_c.submission_period": best})


    # ------------------------------------------------ real rows, every source --
    rows_out, trace = [], []
    A_COLS = ["treasury_account_symbol", "federal_account_symbol", "federal_account_name",
              "agency_identifier_code", "main_account_code", "sub_account_code",
              "beginning_period_of_availability", "ending_period_of_availability",
              "availability_type_code", "submission_period", "total_budgetary_resources",
              "obligations_incurred", "gross_outlay_amount", "unobligated_balance"]
    B_COLS = ["treasury_account_symbol", "federal_account_symbol", "agency_identifier_code",
              "main_account_code", "object_class_code", "object_class_name",
              "program_activity_code", "program_activity_name",
              "direct_or_reimbursable_funding_source", "submission_period",
              "obligations_incurred", "gross_outlay_amount_FYB_to_period_end"]
    C_COLS = ["treasury_account_symbol", "federal_account_symbol", "agency_identifier_code",
              "main_account_code", "sub_account_code", "beginning_period_of_availability",
              "ending_period_of_availability", "availability_type_code",
              "object_class_code", "program_activity_code",
              "direct_or_reimbursable_funding_source", "submission_period",
              "award_unique_key", "award_id_piid", "parent_award_id_piid",
              "transaction_obligated_amount", "recipient_name", "awarding_office_name"]
    F_COLS = ["award_id_piid", "modification_number", "contract_transaction_unique_key",
              "action_date", "federal_action_obligation", "recipient_name",
              "awarding_sub_agency_name", "dod_acquisition_program_code",
              "dod_acquisition_program_description",
              "treasury_accounts_funding_this_award", "federal_accounts_funding_this_award",
              "object_classes_funding_this_award", "program_activities_funding_this_award",
              "product_or_service_code_description", "extent_competed"]

    def biggest(col):
        def pick(d, n):
            i = max(range(n), key=lambda k: (d[col][k] or 0)) if n else None
            return [("largest obligation in the sample",
                     "One complete record, chosen as the largest value in the scanned batch so it "
                     "is recognisable rather than obscure.", i)] if i is not None else []
        return pick

    fa = os.path.join(WAREHOUSE, f"accounts/file_a/fiscal_year={fy}")
    if os.path.isdir(fa):
        rows_out += _sample_rows(fa, "file_a", "File A — account balances", A_COLS,
                                 biggest("obligations_incurred"), 60_000)
    fb = os.path.join(WAREHOUSE, f"accounts/file_b/fiscal_year={fy}")
    if os.path.isdir(fb):
        rows_out += _sample_rows(fb, "file_b", "File B — object class and programme activity",
                                 B_COLS, biggest("obligations_incurred"), 200_000)
    fcp2 = os.path.join(WAREHOUSE, f"accounts/file_c_contracts/fiscal_year={fy}")
    if os.path.isdir(fcp2):
        rows_out += _sample_rows(fcp2, "file_c_contracts", "File C — award financial", C_COLS,
                                 biggest("transaction_obligated_amount"), 400_000)
    if os.path.isdir(cp):
        rows_out += _sample_rows(cp, "contracts", "Contract award transactions (FPDS)", F_COLS,
                                 biggest("federal_action_obligation"), 400_000)

    # ------------------------------- one account, followed through every file --
    # Aircraft Procurement, Navy. Chosen because the F-35 budget lines sit in it,
    # so the same money is describable at the top of the chain -- and because of
    # what happens to it further down.
    def add_trace(step, source_key, source_label, key_field, key_value, note, record,
                  present=True):
        trace.append({"step": step, "source_key": source_key, "source_label": source_label,
                      "key_field": key_field, "key_value": key_value, "note": note,
                      "is_present": present,
                      "record": json.dumps(record, default=str)[:2400]})

    # step 1 -- the budget line, from the exhibits already staged
    ex_path = os.path.join(out, "exhibits.json")
    if os.path.exists(ex_path):
        ex = json.load(open(ex_path))["rows"]["dm_exhibit_program"]
        cand = [r for r in ex if (r.get("treasury_account") or "") == TRACE_ACCOUNT
                and not r.get("is_memo")]
        cand.sort(key=lambda r: -(r.get("latest_request_k") or 0))
        for r in cand[:1]:
            add_trace(1, "budget_exhibits", "P-1 / R-1 exhibits — the budget line",
                      "treasury_account", TRACE_ACCOUNT,
                      "The top of the chain. This record names a SYSTEM and a budget line item, "
                      "and it resolves to a Treasury account. It is the last record in the chain "
                      "that can say which programme the money is for.",
                      {k: r.get(k) for k in ("exhibit", "account", "treasury_account", "bli",
                                             "program_name", "appropriation", "bsa_title",
                                             "fund_type", "latest_request_k", "latest_request_pb",
                                             "weapon_program")})

    file_a_obl = None
    if os.path.isdir(fa):
        t = _stream_table(fa, 60_000, A_COLS)
        if t is not None:
            d = {c: t[c].to_pylist() for c in t.column_names}
            hits = sorted((i for i in range(t.num_rows)
                           if (d["federal_account_symbol"][i] or "") == TRACE_ACCOUNT),
                          key=lambda i: -(d["obligations_incurred"][i] or 0))
            for i in hits[:1]:
                file_a_obl = d["obligations_incurred"][i]
                add_trace(2, "file_a", "File A — account balances",
                          "federal_account_symbol", TRACE_ACCOUNT,
                          "The account as an execution record. Every SLOA element of the Treasury "
                          "Account Symbol is here as a discrete field. What is NOT here is any "
                          "budget line, so from this row onward the several budget lines inside "
                          "this account cannot be told apart.",
                          {c: d[c][i] for c in t.column_names})

    if os.path.isdir(fb):
        t = _stream_table(fb, 250_000, B_COLS)
        if t is not None:
            d = {c: t[c].to_pylist() for c in t.column_names}
            hits = sorted((i for i in range(t.num_rows)
                           if (d["federal_account_symbol"][i] or "") == TRACE_ACCOUNT),
                          key=lambda i: -(d["obligations_incurred"][i] or 0))
            for i in hits[:1]:
                add_trace(3, "file_b", "File B — object class and programme activity",
                          "federal_account_symbol", TRACE_ACCOUNT,
                          "The same account split by what was bought and under which activity. "
                          "Object class and programme activity arrive as discrete elements. Still "
                          "no budget line.",
                          {c: d[c][i] for c in t.column_names})

    # step 4 -- File C. Measured across the WHOLE file, because an absence has to
    # be established over everything rather than over a sample.
    fc_accounts, fc_rows_for_account = set(), []
    if os.path.isdir(fcp2):
        import pyarrow.parquet as pq
        for f_ in sorted(ds.dataset(fcp2, format="parquet").files):
            pfx = pq.ParquetFile(f_)
            for b in pfx.iter_batches(batch_size=100_000, columns=C_COLS):
                cols_b = {c: b.column(i).to_pylist() for i, c in enumerate(b.schema.names)}
                for i in range(b.num_rows):
                    acc = cols_b["federal_account_symbol"][i] or ""
                    if acc: fc_accounts.add(acc)
                    if acc == TRACE_ACCOUNT:
                        fc_rows_for_account.append({c: cols_b[c][i] for c in b.schema.names})
    if fc_rows_for_account:
        best = max(fc_rows_for_account,
                   key=lambda r: (r.get("transaction_obligated_amount") or 0))
        add_trace(4, "file_c_contracts", "File C — award financial",
                  "award_id_piid", best.get("award_id_piid"),
                  "The bridging record: it carries BOTH the decomposed Treasury account and an "
                  "award identifier. It is the only file that holds the two together.",
                  best)
    else:
        add_trace(4, "file_c_contracts", "File C — award financial",
                  "federal_account_symbol", TRACE_ACCOUNT,
                  f"The chain stops here. Every row of File C for FY{fy} was read -- "
                  f"{len(fc_accounts)} distinct federal accounts appear in it -- and this account "
                  "is not among them. The account is reported in File A with obligations against "
                  "it, and no award-financial record ties any of those obligations to an award. "
                  "There is nothing to join to, so the step below cannot be reached by account at "
                  "all.",
                  {"federal_account_symbol": TRACE_ACCOUNT,
                   "rows_in_file_c": 0,
                   "distinct_accounts_in_file_c": len(fc_accounts),
                   "obligations_reported_in_file_a": file_a_obl},
                  present=False)

    # step 5 -- the award files, reached by the account string rather than a key
    if os.path.isdir(cp):
        ft2 = _stream_table(cp, 400_000, F_COLS)
        if ft2 is not None:
            fd = {c: ft2[c].to_pylist() for c in ft2.column_names}
            m = sorted((k for k in range(ft2.num_rows)
                        if TRACE_ACCOUNT in (fd["federal_accounts_funding_this_award"][k] or "")),
                       key=lambda k: -(fd["federal_action_obligation"][k] or 0))
            if m:
                k = m[0]
                add_trace(5, "contracts", "Contract award transactions (FPDS)",
                          "federal_accounts_funding_this_award (substring)", TRACE_ACCOUNT,
                          "The award files DO name this account -- but as a substring inside a "
                          "semicolon-separated display column, not as an element. This row was "
                          "found by searching text. That is not a join: it cannot be validated, "
                          "it cannot be indexed, and when the column names several accounts there "
                          "is no share of the obligation belonging to any one of them.",
                          {c: fd[c][k] for c in ft2.column_names})

    # how much of File A never reaches File C at all
    if fc_accounts and os.path.isdir(fa):
        t = _stream_table(fa, 60_000, A_COLS)
        if t is not None:
            d = {c: t[c].to_pylist() for c in t.column_names}
            tot = missing = tot_ob = missing_ob = 0
            seen_acc = {}
            for i in range(t.num_rows):
                if (d["agency_identifier_code"][i] or "") not in DOW_CODES: continue
                acc = d["federal_account_symbol"][i] or ""
                if not acc: continue
                seen_acc.setdefault(acc, 0.0)
                seen_acc[acc] += (d["obligations_incurred"][i] or 0.0)
            for acc, ob in seen_acc.items():
                tot += 1; tot_ob += ob
                if acc not in fc_accounts:
                    missing += 1; missing_ob += ob
            add_trace(6, "file_a", "File A against File C — the whole population",
                      "federal_account_symbol", "all Department accounts",
                      "The trace above is one account. This is every account: how many of the "
                      "accounts File A reports obligations against have no award-financial record "
                      "in File C for the same year.",
                      {"department_accounts_in_file_a": tot,
                       "of_those_absent_from_file_c": missing,
                       "obligations_in_file_a": round(tot_ob, 2),
                       "obligations_on_absent_accounts": round(missing_ob, 2),
                       "share_of_obligations_absent_pct":
                           round(missing_ob / tot_ob * 100, 2) if tot_ob else None},
                      present=False)

    print(f"  {len(fields)} field profiles, {len(samples)} demonstrating records, "
          f"{len(rows_out)} sample rows, {len(trace)} trace steps")
    write(out, "catalog.json", payload("source_catalog", vintage,
          {"dm_source_field": fields, "dm_join_sample": samples,
           "dm_source_row": rows_out, "dm_trace_row": trace},
          source_path="accounts/ and contracts/"))

# -------------------------------------------------------------------- jbook ---
# Learning the justification book from the books themselves.
#
# An R-2 is not free prose. It is a fixed sequence of lettered sections wrapped
# around a fixed cost table, and the letters SHIFT depending on the exhibit: a
# program-element R-2 carries a Program Change Summary and a project-level R-2A
# does not, so Acquisition Strategy is section E on one and section D on the
# other. Reproducing the format means encoding that, not guessing it.
#
# What this step extracts is therefore three things: the skeleton (which sections
# exist, in which order, for which exhibit type), the content (so a drafter can
# read how the Department actually writes each section), and per-component style
# measurements (so a new draft can be checked against the house voice rather than
# against an opinion).

_JB_HDR = re.compile(
    r"Exhibit (R-2A?|P-40[A-Z]?), (.+?): PB (\d{4}) (.+?)\s{2,}Date:\s*(.+?)\s*$")
_JB_PE = re.compile(r"\bPE (\d{7}[A-Z0-9]{0,3})\b")
_JB_R1 = re.compile(r"R-1 (?:Line|Program Element) #\s*(\d+)")
_JB_PAGE = re.compile(r"Page (\d+) of (\d+)")
_JB_APPN = re.compile(r"^(\d{4}):\s*(.+?)\s*/\s*BA (\d+):\s*(.*)$")
_JB_SECT = re.compile(r"^([A-H])\.\s+([A-Z][A-Za-z0-9 /&(),'\-\.]{3,80}?)\s*(\(\$ in Millions\))?(?:\s{2,}.*)?$")
_JB_PROJECT = re.compile(r"^Project \(Number/Name\)\s*(\S+)\s*/\s*(.+?)\s*$")
_JB_NOISE = re.compile(r"^\s*(UNCLASSIFIED|THIS PAGE INTENTIONALLY LEFT BLANK)\s*$")


def _jb_pages(path):
    import subprocess
    try:
        return subprocess.run(["pdftotext", "-layout", path, "-"],
                              capture_output=True, text=True, timeout=300).stdout.split("\f")
    except (OSError, subprocess.SubprocessError):
        return []


def _jb_sentences(text):
    return [s.strip() for s in re.split(r"(?<=[.!?])\s+", text or "") if len(s.strip()) > 20]


def _jb_parse_page(page, pb_default):
    """One exhibit page -> (meta, sections) or None."""
    lines = page.split("\n")
    head = next((l for l in lines if "Exhibit R-2" in l or "Exhibit R-2A" in l), None)
    if not head: return None
    m = _JB_HDR.search(head)
    if not m: return None
    kind, title, pb, component, date = m.groups()
    meta = {"exhibit": kind, "exhibit_title": title.strip(), "pb_year": int(pb),
            "component": component.strip(), "book_date": date.strip(),
            "appropriation_code": None, "appropriation": None,
            "budget_activity": None, "budget_activity_title": None,
            "pe": None, "pe_title": None, "project_number": None, "project_title": None,
            "r1_line": None, "page_no": None, "page_of": None}
    body = []
    for l in lines:
        if _JB_NOISE.match(l): continue
        s = l.rstrip()
        a = _JB_APPN.match(s.strip())
        if a and not meta["appropriation"]:
            meta["appropriation_code"], meta["appropriation"] = a.group(1), a.group(2).strip()
            meta["budget_activity"] = a.group(3)
            # The header is two columns: the appropriation and budget activity on
            # the left, the programme element on the right. The budget activity
            # TITLE wraps to the next line, so what follows "BA n:" on this line
            # is the right-hand column, not the title.
            tail = a.group(4).strip()
            meta["budget_activity_title"] = None if (not tail or "PE " in tail) else tail
            meta["_ba_pending"] = meta["budget_activity_title"] is None
        elif meta.get("_ba_pending") and s.strip() and not _JB_PE.search(s):
            cand = re.sub(r"\s{2,}.*$", "", s.strip())
            if 3 < len(cand) < 80 and not _JB_SECT.match(cand):
                meta["budget_activity_title"] = cand
            meta["_ba_pending"] = False
        pe = _JB_PE.search(s)
        if pe and not meta["pe"]:
            meta["pe"] = pe.group(1)
            after = s.split(f"PE {pe.group(1)}", 1)[-1].lstrip(" :/")
            meta["pe_title"] = re.sub(r"\s{2,}.*$", "", after).strip() or None
        pr = _JB_PROJECT.match(s.strip())
        if pr and not meta["project_number"]:
            meta["project_number"], meta["project_title"] = pr.group(1), pr.group(2).strip()
        r1 = _JB_R1.search(s)
        if r1: meta["r1_line"] = int(r1.group(1))
        pg = _JB_PAGE.search(s)
        if pg: meta["page_no"], meta["page_of"] = int(pg.group(1)), int(pg.group(2))
        body.append(s)

    # sections: a lettered heading owns every line until the next heading
    sections, cur = [], None
    for s in body:
        h = _JB_SECT.match(s.strip())
        if h:
            if cur: sections.append(cur)
            cur = {"letter": h.group(1), "title": h.group(2).strip(),
                   "is_table": bool(h.group(3)), "lines": []}
            continue
        if cur is not None: cur["lines"].append(s)
    if cur: sections.append(cur)
    meta.pop("_ba_pending", None)
    for sec in sections:
        raw = "\n".join(sec.pop("lines"))
        # a table section keeps its layout; a prose section is unwrapped
        sec["body"] = raw if sec["is_table"] else _WS.sub(" ", raw).strip()
    return meta, sections


JBOOK_DIRS = [("rdte", "03_RDT_and_E", "RDT&E")]
JBOOK_MAX_PDF = 40


def step_jbook(out):
    """Learn the justification book from the books: skeleton, content, style."""
    import glob
    root = os.path.join(KB, "11-Budget-Justification")
    if not os.path.isdir(root):
        print("  no justification corpus found, skipping"); return
    vintage = mtime_date(root)
    exhibits, sections = {}, []
    files_read = 0

    for fund_key, folder, fund_label in JBOOK_DIRS:
        pdfs = sorted(glob.glob(os.path.join(root, folder, "*.pdf")))[:JBOOK_MAX_PDF]
        for path in pdfs:
            src = os.path.basename(path)
            pages = _jb_pages(path)
            if not pages: continue
            files_read += 1
            found = 0
            for page in pages:
                r = _jb_parse_page(page, None)
                if not r: continue
                meta, secs = r
                key = (meta["component"], meta["pe"], meta.get("project_number"),
                       meta["exhibit"], meta["pb_year"])
                ex = exhibits.setdefault(key, {
                    **{k: v for k, v in meta.items() if k != "page_no"},
                    "fund_key": fund_key, "fund_label": fund_label,
                    "source_file": src, "pages": 0, "slug": None})
                ex["pages"] = max(ex["pages"], meta["page_no"] or 0)
                if meta.get("r1_line") and not ex.get("r1_line"): ex["r1_line"] = meta["r1_line"]
                for s in secs:
                    if not s["body"]: continue
                    sections.append({"_key": key, "letter": s["letter"], "title": s["title"],
                                     "is_table": s["is_table"], "page_no": meta["page_no"],
                                     "body": s["body"][:12000]})
                found += 1
            if found:
                print(f"  {src}: {found} exhibit pages")

    # merge repeated sections (one section can run across pages)
    merged = {}
    for s in sections:
        k = (s["_key"], s["letter"], s["title"])
        m = merged.setdefault(k, {**s, "body": ""})
        if s["body"] not in m["body"]:
            m["body"] = (m["body"] + "\n" + s["body"]).strip()[:16000]

    ex_rows, sec_rows = [], []
    for i, (key, ex) in enumerate(sorted(exhibits.items(), key=lambda kv: str(kv[0]))):
        slug = re.sub(r"[^a-z0-9]+", "-", "-".join(
            str(x) for x in (ex["component"], ex["pe"], ex.get("project_number") or "",
                             ex["exhibit"], ex["pb_year"])).lower()).strip("-")[:120]
        ex["slug"] = slug
        ex_rows.append({k: v for k, v in ex.items() if not k.startswith("_")})
        for (k2, letter, title), m in merged.items():
            if k2 != key: continue
            words = len(re.findall(r"\b\w+\b", m["body"]))
            sents = _jb_sentences(m["body"]) if not m["is_table"] else []
            sec_rows.append({
                "slug": slug, "letter": letter, "title": title, "is_table": m["is_table"],
                "body": m["body"], "word_count": words,
                "sentence_count": len(sents),
                "avg_sentence_words": round(
                    sum(len(re.findall(r"\b\w+\b", x)) for x in sents) / len(sents), 1)
                    if sents else None,
                "opening": (sents[0][:300] if sents else None)})

    # -------------------------------------------------------------- skeleton --
    # Which sections exist, in which order, for which exhibit type. Observed,
    # not asserted: the letters shift because a project-level R-2A carries no
    # Program Change Summary, so Acquisition Strategy is D there and E on an R-2.
    order = collections.defaultdict(collections.Counter)
    seen_in = collections.defaultdict(set)
    for e in ex_rows:
        mine = [s for s in sec_rows if s["slug"] == e["slug"]]
        for s in sorted(mine, key=lambda x: x["letter"]):
            order[e["exhibit"]][(s["letter"], s["title"], s["is_table"])] += 1
            seen_in[e["exhibit"]].add(e["slug"])
    skel = []
    for exh, counter in order.items():
        total = len(seen_in[exh]) or 1
        for (letter, title, is_table), n in sorted(counter.items()):
            skel.append({"exhibit": exh, "letter": letter, "title": title,
                         "is_table": is_table, "seen_count": n,
                         "exhibits_total": total,
                         "share_pct": round(n / total * 100, 1),
                         "is_required": n / total >= 0.9})

    # ----------------------------------------------------------------- style --
    # Measured, per component and section, so a draft can be compared with the
    # house voice rather than with an opinion about it.
    style = []
    by = collections.defaultdict(list)
    comp_of = {e["slug"]: e["component"] for e in ex_rows}
    fund_of = {e["slug"]: e["fund_label"] for e in ex_rows}
    for s in sec_rows:
        if s["is_table"] or not s["sentence_count"]: continue
        by[(comp_of.get(s["slug"]), fund_of.get(s["slug"]), s["letter"], s["title"])].append(s)
    for (comp, fund, letter, title), rows in by.items():
        wc = sorted(r["word_count"] for r in rows)
        asw = [r["avg_sentence_words"] for r in rows if r["avg_sentence_words"]]
        style.append({
            "component": comp, "fund_label": fund, "letter": letter, "title": title,
            "sample_size": len(rows),
            "median_words": wc[len(wc) // 2],
            "min_words": wc[0], "max_words": wc[-1],
            "avg_sentence_words": round(sum(asw) / len(asw), 1) if asw else None,
            "example_opening": rows[0]["opening"]})

    print(f"  {files_read} books read, {len(ex_rows)} exhibits, {len(sec_rows)} sections, "
          f"{len(skel)} skeleton rows, {len(style)} style profiles")
    write(out, "jbook.json", payload("jbook_corpus", vintage,
          {"dm_jbook_exhibit": ex_rows, "dm_jbook_section": sec_rows,
           "dm_jbook_skeleton": skel, "dm_jbook_style": style},
          source_path="knowledge-bank/DOD-FM-Knowledge-Bank/11-Budget-Justification"))

# ------------------------------------------------- the seven display tables ---
# /budget shows the FY2027 President's Budget request as the Department displays
# it: seven "-1" tables, each one an appropriation title. The exhibit spine above
# reads only p1/p1r/r1, because it exists to follow a weapon-system budget line
# across eight books. This step reads all seven, for the latest books only, and
# keeps the DISPLAY HIERARCHY -- appropriation, budget activity, budget
# sub-activity, budget line item -- because that is the structure a budget
# analyst navigates and the earlier page flattened it to the account, which made
# 1,138 P-1 lines look like the same Treasury symbol repeated 1,138 times.
#
# WHAT COUNTS AND WHAT RESTATES. There is no single flag for this: the same
# column means different things in different exhibits, and the difference is not
# stylistic. Each rule below is the source's own evidence, not a convention:
#
#   p1r, whole exhibit          National Guard and Reserve equipment already
#                               inside the P-1 lines. Verified PB2020-PB2027.
#   P-1 "(MEMO NON ADD)"        a line restating its own money by ship class or
#     cost types                variant, inside a row otherwise flagged Add.
#   P-1 Advance Procurement     the subtotal of that line's own "C (FY x for
#     (CY) subtotal             FY y) (M)" rows; keeping both put PB2026
#                               procurement $14.4B above the published figure.
#   R-1 Include in TOA = N      rows outside total obligation authority.
#   O-1 Include in TOA = N      the Indefinite Accounts block. The workbook
#                               itself settles this: it publishes "OM Title" and
#                               "OM Title plus Indefinite" as two sheets, and the
#                               difference is exactly these rows.
#   C-1 Mandatory Reconciliation  a BREAKOUT of projects already in that year's
#     sheets                    sheet, not money beside it. Measured on the
#                               FY2027 book: all 25 reconciliation projects
#                               appear in the FY 2027 sheet, 19 at the identical
#                               amount and 6 as part of a larger project total.
#                               Adding the sheet would count $2.68B twice.
#
# And one rule that reads like the others and is NOT the same:
#
#   M-1 Include in TOA = N      five "Less Reimbursables" rows carrying NEGATIVE
#                               amounts, which the published M-1 total INCLUDES.
#                               Excluding them raises military personnel by
#                               $1.39B in FY2027. They are flagged is_offset and
#                               counted.
#
# Taking "Include in TOA = N" as one rule across the seven exhibits is therefore
# wrong in two directions at once, and nothing in the column itself says so.
#
# THE TIE-OUT IS PUBLISHED IN THE WORKBOOK. Every sheet carries a "Total of
# Displayed Rows" line above its header, stating that sheet's own column totals.
# dm_pb_tieout records, per exhibit and fiscal year, what that line says against
# what this extract counted plus what it flagged memo. PB-01 asserts the two
# agree to the dollar, which is what makes the memo rules checkable rather than
# merely argued: if a rule drops a row it should not, the sum stops matching the
# Department's own footer.
PB_EXHIBITS = ("m1", "o1", "p1", "p1r", "r1", "rf1", "c1")
PB_EXHIBIT_META = {
    "m1":  ("M-1",  "Military Personnel"),
    "o1":  ("O-1",  "Operation and Maintenance"),
    "p1":  ("P-1",  "Procurement"),
    "p1r": ("P-1R", "Procurement, National Guard and Reserve equipment"),
    "r1":  ("R-1",  "Research, Development, Test and Evaluation"),
    "rf1": ("RF-1", "Revolving and Management Funds"),
    "c1":  ("C-1",  "Military Construction and Family Housing"),
}
# How many books back to read. The page shows the newest; the one before it is
# what makes a restatement visible without carrying eight books of O&M detail.
PB_DISPLAY_YEARS = (2026, 2027)

# Header aliases for the display tables. The four exhibits the spine does not
# read name their line item differently -- O-1 and RF-1 use SAG/BLI over an
# AG/BSA, M-1 has no line item below the sub-activity at all, and C-1's leaf is a
# construction project -- so the alias list is ordered from most specific to
# least and the first hit wins. "bsa" is last in the bli list precisely so that
# it only fires for M-1, where the sub-activity IS the leaf.
PB_COLS = {
    "bli":   ("budgetlineitem", "lineitem", "pebli", "sagbli", "constructionproject", "bsa"),
    "title": ("budgetlineitem(bli)title", "lineitemtitle",
              "programelementbudgetlineitem(bli)title",
              "sagbudgetlineitem(bli)title", "constructionprojecttitle",
              "budgetsubactivity(bsa)title"),
    "add": ("addnonadd",), "toa": ("includeintoa",), "org": ("organization",),
    "acct_title": ("accounttitle",), "ba": ("budgetactivity",), "ba_title": ("budgetactivitytitle",),
    "bsa": ("bsa", "agbsa"),
    "bsa_title": ("budgetsubactivity(bsa)title", "agbudgetsubactivity(bsa)title"),
    "line_no": ("linenumber",), "cost_type": ("costtype",), "cost_type_title": ("costtypetitle",),
    "fy_col": ("fiscalyear",), "location": ("locationtitle",), "state": ("statecountrytitle",),
    "facility": ("facilitycategorytitle",),
}
# Column-name fragments that say which half of a year's request a component
# column is. Everything not marked mandatory is discretionary, including the
# plain "Actuals" and "Enacted" columns of the two closed years.
PB_MANDATORY_MARKS = ("mandatory", "reconciliation", "pl 119-21", "pl119-21")



_PB_ACCT = re.compile(r"^(\d{4})(\d{2})?([A-Z])$")


def _pb_account_parts(acct):
    """('493001A') -> ('4930', '01', 'A', '021', '021-4930')."""
    m = _PB_ACCT.match(acct or "")
    if not m:
        return None, None, None, None, None
    main, sub, letter = m.group(1), m.group(2), m.group(3)
    agency = ACCT_AGENCY.get(letter)
    return main, sub, letter, agency, (f"{agency}-{main}" if agency else None)

def _pb_resolve(hdr, which):
    keys = {_key(h): i for i, h in enumerate(hdr) if h}
    for alias in PB_COLS[which]:
        if alias in keys:
            return keys[alias]
    return None


def _pb_mandatory_columns(hdr):
    """{fiscal_year: [column index]} for the mandatory half of that year.

    Only the mandatory side is detected, and the discretionary side is then the
    year's total MINUS it. Reading the discretionary columns directly looks
    equivalent and is not: C-1 publishes four amount columns per year --
    Authorization, Authorization of Appropriation, Appropriation and Total
    Obligation Authority -- which are four measures of one project, not four
    components of a sum. Adding the three non-total columns put every
    construction project's discretionary figure at three times its own total.
    Subtraction cannot make that mistake, because the total column is the figure
    the exhibit itself footed to."""
    out = {}
    for i, h in enumerate(hdr):
        if not h or "Quantity" in h: continue
        m = _FY.search(h)
        if not m: continue
        low = h.lower()
        if "total" in low: continue
        if any(k in low for k in PB_MANDATORY_MARKS):
            out.setdefault(int(m.group(1)), []).append(i)
    return out


def _pb_sheets(path, all_sheets):
    """(sheet_name, header, rows, published_totals_row) for the sheets we read.

    The published-totals row sits ABOVE the header and has no Account cell, so it
    is recognised by its own label rather than by position."""
    import openpyxl
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    names = wb.sheetnames if all_sheets else wb.sheetnames[:1]
    for name in names:
        ws = wb[name]
        hdr, rows, totals = None, [], None
        for row in ws.iter_rows(values_only=True):
            if hdr is None:
                if row and row[0] == "Account":
                    hdr = [_norm(h) for h in row]
                elif row and any(c == "Total of Displayed Rows" for c in row if c):
                    totals = row
                continue
            rows.append(row)
        yield name, hdr, rows, totals
    wb.close()


def _pb_memo(exhibit, is_recon, toa_n, cost_type_title):
    """(is_memo, is_offset, reason). See the header comment for each rule's evidence."""
    if exhibit == "p1r":                  return True, False, "p1r_exhibit"
    if is_recon:                          return True, False, "c1_reconciliation_breakout"
    if exhibit == "m1" and toa_n:         return False, True, "less_reimbursables_offset"
    if toa_n and exhibit == "o1":         return True, False, "outside_toa_indefinite"
    if toa_n:                             return True, False, "include_in_toa_n"
    up = (cost_type_title or "").upper()
    if "MEMO NON ADD" in up:              return True, False, "memo_cost_type"
    if cost_type_title == AP_SUBTOTAL:    return True, False, "advance_procurement_subtotal"
    return False, False, None


def step_pb_display(out):
    _exhibit_preflight()
    root = os.path.join(KB, "11-Budget-Justification/_Archive")
    if not os.path.isdir(root):
        print("  no exhibit archive found, skipping"); return
    vintage = mtime_date(root)
    lines, tie = [], []

    for pb in PB_DISPLAY_YEARS:
        for ex in PB_EXHIBITS:
            path = _exhibit_files(root, pb, ex)
            if not path:
                print(f"  FY{pb} {ex}: no workbook, skipped"); continue
            # C-1 publishes one sheet per fiscal year plus its reconciliation
            # breakouts; the other six carry all three years on their first sheet.
            for sheet, hdr, rows, totals in _pb_sheets(path, all_sheets=(ex == "c1")):
                if not hdr:
                    print(f"  FY{pb} {ex}/{sheet}: no header row, skipped"); continue
                is_recon = "Reconciliation" in sheet
                years = _year_columns(hdr)
                mand_cols = _pb_mandatory_columns(hdr)
                iB, iT = _pb_resolve(hdr, "bli"), _pb_resolve(hdr, "title")
                iAdd, iToa = _pb_resolve(hdr, "add"), _pb_resolve(hdr, "toa")
                iFy = _pb_resolve(hdr, "fy_col")
                cols = {w: _pb_resolve(hdr, w) for w in
                        ("org", "acct_title", "ba", "ba_title", "bsa", "bsa_title",
                         "line_no", "cost_type", "cost_type_title", "location", "state", "facility")}
                # M-1's leaf IS the sub-activity, so the two resolve to one column.
                # Leaving both set would print the same value in two levels of the
                # drill-down and make every M-1 sub-activity look like it has
                # exactly one child with the same name.
                if cols["bsa"] == iB: cols["bsa"] = None
                if cols["bsa_title"] == iT: cols["bsa_title"] = None
                # The reconciliation sheets name no fiscal year in any header --
                # the year is a column on the row -- so the amount is the sheet's
                # TOA column and the year is read per row.
                recon_amt = [i for i, h in enumerate(hdr) if h and "TOA" in h][-1:] if is_recon else []

                counted = collections.defaultdict(float)
                memoed  = collections.defaultdict(float)
                nrows   = collections.Counter()
                for r in rows:
                    # A Non-Add row is the advance-procurement detail that its own
                    # line already carries. Dropped at read time, as in the spine.
                    if iAdd is not None and _norm(r[iAdd]) == "Non-Add": continue
                    title = _norm(r[iT]) if iT is not None else ""
                    bli = _norm(r[iB]) if iB is not None else ""
                    acct = _norm(r[0])
                    # Spacer rows have no account. A row that HAS an account but
                    # no line item is not a spacer: PB2026 O-1 carries $24K on
                    # 5286A budget activity 10 with every leaf column blank, and
                    # dropping it for want of a label was the one sheet-year in
                    # twenty-eight that stopped matching the workbook's own
                    # published footer. It is kept, and the page prints the
                    # missing leaf as "no line item published" rather than
                    # inventing one.
                    if not acct: continue
                    main, sub, letter, agency, tas = _pb_account_parts(acct)
                    cell = lambda w: (_norm(r[cols[w]]) if cols[w] is not None else "")
                    ctt = cell("cost_type_title")
                    toa_n = iToa is not None and _norm(r[iToa]) == "N"
                    is_memo, is_offset, reason = _pb_memo(ex, is_recon, toa_n, ctt)
                    base = {
                        "pb_year": pb, "exhibit": ex, "sheet_name": sheet,
                        "account": acct, "account_main": main, "account_sub": sub, "treasury_agency": agency,
                        "treasury_account": tas, "account_title": cell("acct_title"),
                        "component": COMPONENT.get(agency, "Unattributed"),
                        "organization": cell("org"),
                        "budget_activity": cell("ba"), "budget_activity_title": cell("ba_title"),
                        "bsa": cell("bsa"), "bsa_title": cell("bsa_title"),
                        "line_number": cell("line_no"), "bli": bli, "bli_title": title,
                        "cost_type": cell("cost_type"), "cost_type_title": ctt,
                        "location": cell("location") or cell("state") or cell("facility"),
                        "is_memo": is_memo, "is_offset": is_offset, "memo_reason": reason,
                        "include_in_toa": "N" if toa_n else ("Y" if iToa is not None else ""),
                    }
                    if is_recon:
                        fy = int(_num(r[iFy])) if iFy is not None else pb
                        amt = sum(_num(r[i]) for i in recon_amt)
                        if not amt: continue
                        lines.append({**base, "fiscal_year": fy, "fy_role": "request",
                            "amount_k": round(amt, 3), "discretionary_k": 0.0,
                            "mandatory_k": round(amt, 3), "quantity": 0.0,
                            "total_column": _norm(hdr[recon_amt[0]])[:200],
                            "total_basis": "sole_column", "component_count": 1})
                        memoed[fy] += amt; nrows[fy] += 1
                        continue
                    for fy, c in years.items():
                        amt = sum(_num(r[i]) for i in c["amount"])
                        qty = sum(_num(r[i]) for i in c["qty"])
                        if amt == 0 and qty == 0: continue
                        mand = sum(_num(r[i]) for i in mand_cols.get(fy, ()))
                        disc = amt - mand
                        role = ("prior_actual" if fy == pb - 2 else
                                "enacted" if fy == pb - 1 else
                                "request" if fy == pb else "other")
                        lines.append({**base, "fiscal_year": fy, "fy_role": role,
                            "amount_k": round(amt, 3), "discretionary_k": round(disc, 3),
                            "mandatory_k": round(mand, 3), "quantity": qty,
                            "total_column": c["label"][:200], "total_basis": c["basis"],
                            "component_count": c["component_count"]})
                        (memoed if is_memo else counted)[fy] += amt
                        nrows[fy] += 1

                for fy in sorted(set(counted) | set(memoed)):
                    if is_recon:
                        published = None
                    else:
                        c = years.get(fy)
                        published = (sum(_num(totals[i]) for i in c["amount"])
                                     if totals and c and all(i < len(totals) for i in c["amount"])
                                     else None)
                    got = counted[fy] + memoed[fy]
                    tie.append({
                        "pb_year": pb, "exhibit": ex, "sheet_name": sheet, "fiscal_year": fy,
                        "published_k": None if published is None else round(published, 3),
                        "counted_k": round(counted[fy], 3), "memo_k": round(memoed[fy], 3),
                        "difference_k": None if published is None else round(got - published, 3),
                        "row_count": nrows[fy]})
            name, _ = PB_EXHIBIT_META[ex]
            got = sum(t["counted_k"] for t in tie if t["exhibit"] == ex and t["pb_year"] == pb
                      and t["fiscal_year"] == pb)
            print(f"  FY{pb} {name:5s} request {got/1e6:>9,.1f}B")

    off = [t for t in tie if t["difference_k"] is not None and abs(t["difference_k"]) >= 1]
    if off:
        print(f"  WARNING: {len(off)} sheet-years do not match the workbook's own"
              f" 'Total of Displayed Rows'. PB-01 will fail this load.")
        for t in off[:6]:
            print(f"    FY{t['pb_year']} {t['exhibit']} {t['sheet_name']} FY{t['fiscal_year']}:"
                  f" counted+memo {t['counted_k']+t['memo_k']:,.0f}K vs published {t['published_k']:,.0f}K")
    write(out, "pb_display.json", payload("pb_display", vintage,
          {"dm_pb_line": lines, "dm_pb_tieout": tie},
          source_path="11-Budget-Justification/_Archive"))


# ------------------------------------------------------- execution detail ---
# File B, published at the grain it is reported at rather than as a single row
# per fiscal year.
#
# The earlier extract kept two things from this file: five Department-wide
# totals and the top twenty-five object classes. That is enough to draw the
# undelivered/delivered orders chart and nothing else. Everything an execution
# review actually asks -- which account is behind, whether the money is annual
# or multi-year, whether an account's obligations are sitting in undelivered
# orders or have been received and not paid, which object class moved, how much
# of the year's undelivered balance was carried in rather than created -- needs
# the account, the object class, the funding source and the period of
# availability on the same row. There are only about 27,000 File B rows a year
# in Department scope, so the detail is published whole rather than sampled.
#
# THE PARK REPLICATION IS HANDLED HERE TOO, and it has to be, because it is
# worse at detail grain than in a total. From the FY2026 P09 submission
# program_activity_code is null on every row and the Program Activity Reporting
# Key carries the identity; where an account has several PARKs the extract
# repeats the account's object-class figure verbatim against each one instead of
# splitting it. Summing the file as published overstates Department obligations
# by 34.9%. A group whose rows differ only by PARK and publish one repeated
# figure therefore becomes ONE row here, with activity_kind = 'collapsed' and
# activity_count saying how many keys it covered, rather than several rows each
# carrying the whole amount. Genuine splits -- every FY2021-25 row -- pass
# through untouched and keep their own activity.
#
# WHAT THE FY2026 SUBMISSION DOES NOT CARRY. There is no program activity NAME
# on any FY2026 row: the column is null throughout, so the activity can be
# identified but not read. The page prints the key and says so rather than
# borrowing a name from a different year's row that happens to share a key.
EXEC_COLS = FILE_B_COLS + [
  "treasury_account_name", "federal_account_symbol", "federal_account_name",
  "budget_function", "budget_subfunction", "program_activity_name",
  "availability_type_code", "beginning_period_of_availability",
  "ending_period_of_availability",
  "obligations_undelivered_orders_unpaid_total_FYB",
  "gross_outlays_undelivered_orders_prepaid_total",
  "gross_outlays_delivered_orders_paid_total",
  "USSGL488100_upward_adj_prior_year_undeliv_orders_oblig_unpaid",
  "USSGL498100_upward_adj_of_prior_year_deliv_orders_oblig_unpaid",
  "USSGL487100_downward_adj_prior_year_unpaid_undeliv_orders_oblig",
  "USSGL497100_downward_adj_prior_year_unpaid_deliv_orders_oblig",
  "USSGL487200_downward_adj_prior_year_prepaid_undeliv_order_oblig",
  "USSGL497200_downward_adj_of_prior_year_paid_deliv_orders_oblig",
]

# The measures carried per detail row, as (source column, published name).
EXEC_MEASURES = [
  ("obligations_incurred", "obligations"),
  ("obligations_undelivered_orders_unpaid_total", "undelivered_unpaid"),
  ("obligations_undelivered_orders_unpaid_total_FYB", "undelivered_unpaid_bf"),
  ("obligations_delivered_orders_unpaid_total", "delivered_unpaid"),
  ("gross_outlay_amount_FYB_to_period_end", "gross_outlays"),
  ("gross_outlays_undelivered_orders_prepaid_total", "outlays_prepaid"),
  ("gross_outlays_delivered_orders_paid_total", "outlays_paid"),
  ("deobligations_or_recoveries_or_refunds_from_prior_year", "deobligations"),
]
EXEC_UPWARD = ["USSGL488100_upward_adj_prior_year_undeliv_orders_oblig_unpaid",
               "USSGL498100_upward_adj_of_prior_year_deliv_orders_oblig_unpaid"]
EXEC_DOWNWARD = ["USSGL487100_downward_adj_prior_year_unpaid_undeliv_orders_oblig",
                 "USSGL497100_downward_adj_prior_year_unpaid_deliv_orders_oblig",
                 "USSGL487200_downward_adj_prior_year_prepaid_undeliv_order_oblig",
                 "USSGL497200_downward_adj_of_prior_year_paid_deliv_orders_oblig"]


def _fund_life(avail_type, bpoa, epoa):
    """'no-year' | 'annual' | 'multi-year (N)' | 'unknown'.

    This is the single most decision-relevant attribute in the file at the end
    of a fiscal year and it is not published as a field: it has to be read off
    the period of availability. Annual money expires on 30 September and cannot
    be obligated afterwards; multi-year and no-year money can. A year-end
    obligation rate that mixes the two answers no question at all."""
    if (avail_type or "").strip().upper() == "X": return "no-year"
    try: b, e = int(bpoa), int(epoa)
    except (TypeError, ValueError): return "unknown"
    if b <= 0 or e <= 0: return "unknown"
    n = e - b + 1
    return "annual" if n <= 1 else f"multi-year ({n})"


# Detail is published for the years an execution review actually works in --
# the year in progress and the two before it. Earlier years are carried as
# account and object-class rollups over the whole window, which is what a trend
# needs, at a twentieth of the rows.
EXEC_DETAIL_YEARS = 3


def step_execution(out):
    import pyarrow.dataset as ds
    base = os.path.join(WAREHOUSE, "accounts/file_b")
    vintage = mtime_date(base)
    years = [fy for fy in FY_RANGE
             if os.path.isdir(os.path.join(base, f"fiscal_year={fy}"))]
    detail_years = set(years[-EXEC_DETAIL_YEARS:])
    detail, fy_rows, acct_dim, act_dim = [], [], {}, {}
    acct_fy, oc_fy = {}, {}

    for fy in years:
        t = ds.dataset(os.path.join(base, f"fiscal_year={fy}"),
                       format="parquet").to_table(columns=EXEC_COLS)
        c = {k: t[k].to_pylist() for k in EXEC_COLS}
        rows = [i for i in range(t.num_rows)
                if (c["agency_identifier_code"][i] or "") in DOW_CODES]
        groups, replicated = _fileb_grain(c, rows)
        emitted = collapsed_rows = 0
        keep_detail = fy in detail_years

        for k, idx in groups.items():
            rep = k in replicated
            if rep:
                collapsed_rows += len(idx) - 1
                buckets = {"": idx}
            else:
                buckets = {}
                for i in idx:
                    aid = (str(c["program_activity_code"][i] or "").strip()
                           or str(c["program_activity_reporting_key"][i] or "").strip() or "")
                    buckets.setdefault(aid, []).append(i)
            for aid, part in buckets.items():
                i0 = part[0]
                m = {name: round(_fileb_value(c, part, col, rep), 2)
                     for col, name in EXEC_MEASURES}
                m["upward_adjustments"] = round(
                    sum(_fileb_value(c, part, col, rep) for col in EXEC_UPWARD), 2)
                m["downward_adjustments"] = round(
                    sum(_fileb_value(c, part, col, rep) for col in EXEC_DOWNWARD), 2)
                if all(abs(v) < 0.005 for v in m.values()): continue
                agency = str(c["agency_identifier_code"][i0] or "")
                oc = str(c["object_class_code"][i0] or "??")
                tas = k[0]
                life = _fund_life(c["availability_type_code"][i0],
                                  c["beginning_period_of_availability"][i0],
                                  c["ending_period_of_availability"][i0])
                acct_dim.setdefault((fy, tas), {
                    "fiscal_year": fy, "treasury_account": tas,
                    "treasury_account_name": str(c["treasury_account_name"][i0] or ""),
                    "federal_account": str(c["federal_account_symbol"][i0] or ""),
                    "federal_account_name": str(c["federal_account_name"][i0] or ""),
                    "agency_code": agency, "agency_name": AGENCY_NAME.get(agency, ""),
                    "budget_function": str(c["budget_function"][i0] or ""),
                    "budget_subfunction": str(c["budget_subfunction"][i0] or ""),
                    "fund_life": life})
                if rep:
                    kind = "collapsed"
                    count = len({str(c["program_activity_reporting_key"][i] or "") for i in idx})
                elif str(c["program_activity_code"][i0] or "").strip():
                    kind, count = "code", 1
                elif aid:
                    kind, count = "park", 1
                else:
                    kind, count = "none", 1
                if aid:
                    act_dim.setdefault((fy, aid), {
                        "fiscal_year": fy, "activity_id": aid, "activity_kind": kind,
                        "activity_name": str(c["program_activity_name"][i0] or "").strip()})
                if keep_detail:
                    detail.append({"fiscal_year": fy, "scope": "DOW", "treasury_account": tas,
                        "object_class_code": oc, "activity_id": aid, "activity_kind": kind,
                        "activity_count": count, "funding_source": k[2] or "", "defc": k[3] or "",
                        "fund_life": life, "source_rows": len(part), "is_replicated": rep, **m})
                    emitted += 1
                a = acct_fy.setdefault((fy, tas), {"fiscal_year": fy, "scope": "DOW",
                    "treasury_account": tas, "fund_life": life, "detail_rows": 0,
                    **{name: 0.0 for _, name in EXEC_MEASURES},
                    "upward_adjustments": 0.0, "downward_adjustments": 0.0})
                o = oc_fy.setdefault((fy, oc), {"fiscal_year": fy, "scope": "DOW",
                    "object_class_code": oc,
                    "object_class_name": str(c["object_class_name"][i0] or oc),
                    "major_class": major_class(oc), "detail_rows": 0,
                    **{name: 0.0 for _, name in EXEC_MEASURES},
                    "upward_adjustments": 0.0, "downward_adjustments": 0.0})
                for row in (a, o):
                    row["detail_rows"] += 1
                    for key, v in m.items(): row[key] = round(row[key] + v, 2)

        periods = sorted({c["submission_period"][i] for i in rows if c["submission_period"][i]})
        obl = sum(v["obligations"] for (f, _), v in acct_fy.items() if f == fy)
        fy_rows.append({"fiscal_year": fy, "scope": "DOW",
            "submission_period": periods[0] if len(periods) == 1 else None,
            "source_rows": len(rows), "detail_rows": emitted, "collapsed_rows": collapsed_rows,
            "has_detail": keep_detail,
            "accounts": len([1 for (f, _) in acct_fy if f == fy]),
            "object_classes": len([1 for (f, _) in oc_fy if f == fy]),
            "activities": len([1 for (f, _) in act_dim if f == fy]),
            "has_activity_names": any(v["activity_name"] for (f, _), v in act_dim.items() if f == fy),
            "obligations": round(obl, 2)})
        print(f"  FY{fy}: {len(rows):,} source rows -> "
              f"{emitted:,} detail rows{'' if keep_detail else ' (rollup only)'}"
              f"{f', {collapsed_rows:,} PARK-replicated counted once' if collapsed_rows else ''}")

    write(out, "execution.json", payload("file_b_detail", vintage,
          {"dm_exec_detail": detail, "dm_exec_account": list(acct_dim.values()),
           "dm_exec_activity": list(act_dim.values()),
           "dm_exec_account_fy": list(acct_fy.values()),
           "dm_exec_object_class_fy": list(oc_fy.values()),
           "dm_exec_fy": fy_rows},
          source_path="accounts/file_b"))


# --------------------------------------------------------- execution timing ---
# WHEN contract money moved, at day grain, and what that says about the year end.
#
# File B answers what kind of money an obligation is and how far through the
# pipeline it has travelled. It cannot answer when, because the warehouse holds
# ONE submission per fiscal year -- FY2026 at P09 -- so there is no within-year
# series in it at all. The contract files do carry a date on every action, so
# the timing question is answered from FPDS and labelled as what it is: contract
# obligations, which are a THIRD of Department obligations -- 33.9% in FY2025 --
# not the whole. The largest block they do not cover is personnel compensation
# and benefits, 40.4% of the year, which is paid on a schedule and has no
# year-end timing question in it. The share is measured on the page rather than
# asserted here, so it cannot drift away from the data.
#
# WHY THIS MATTERS ON 10 SEPTEMBER. Annual appropriations expire on 30 September
# and cannot be obligated afterwards, so the last weeks of a fiscal year carry a
# concentration of obligations that exists for a legal reason rather than an
# operational one. That is not itself a finding -- it is the shape of the
# system -- and the failure mode of every year-end story is treating the shape
# as the finding. What can be measured is DEVIATION FROM A CATEGORY'S OWN
# HISTORY: an office that has put 8% of its year into September for four years
# and puts 30% into it in the fifth has done something its own past does not
# explain, and a product class that has never been bought in September appearing
# there at scale is a question worth asking. Both are computed here, per
# category, against that category's own prior years.
#
# THE BASELINE IS ROBUST, NOT AVERAGE. Prior-year values are summarised by their
# MEDIAN and their median absolute deviation rather than mean and standard
# deviation. With four or five prior observations a single unusual year drags a
# mean far enough to hide the year after it, and these series contain exactly
# that kind of year -- FY2021 and FY2022 carry supplemental and emergency money
# that lands in months the base budget does not use. A median of five is
# unmoved by one outlier; a mean of five is moved by a fifth of it.
#
# WHAT IS NOT CLAIMED. A deviation is a question, not a finding: none of these
# signals observes impropriety, and several of the largest are certainly
# legitimate -- a shipbuilding award or an exercised option lands as one action
# with no anomaly in it beyond its size. Every signal therefore carries the
# evidence it was computed from and the method that produced it, and the page
# prints both beside it. The page says "worth asking about", never "improper".

# FPDS writes the product or service code's own description on the row, so the
# label is the source's. What is derived is the coarse kind, and that is the
# structure FPDS itself uses: a numeric first character is a product class, A is
# research and development, and every other letter is a service group.
def psc_kind(code: str) -> str:
    c = (code or "").strip().upper()
    if not c: return "Not reported"
    if c[0].isdigit(): return "Product"
    if c[0] == "A": return "Research and development"
    return "Service"


# The Federal Supply Classification groups and the service categories, which is
# the structure FPDS itself codes to: a product code's first two digits name its
# supply group, a service code's first letter names its category. This coarser
# key exists because the questions asked of year-end spending are almost never
# about the largest classes. Furniture, food and office supplies are far too
# small to appear among the forty biggest four-digit codes and are exactly what
# a reader arrives having read about, so they need a level at which they are
# visible rather than a threshold that excludes them.
PSC_GROUP = {
 "10":"Weapons","11":"Nuclear ordnance","12":"Fire control equipment",
 "13":"Ammunition and explosives","14":"Guided missiles",
 "15":"Aircraft and airframe structural components",
 "16":"Aircraft components and accessories",
 "17":"Aircraft launching, landing and ground handling equipment",
 "18":"Space vehicles","19":"Ships, small craft, pontoons and floating docks",
 "20":"Ship and marine equipment","22":"Railway equipment",
 "23":"Motor vehicles, trailers and cycles","24":"Tractors",
 "25":"Vehicular equipment components","26":"Tires and tubes",
 "28":"Engines, turbines and components","29":"Engine accessories",
 "30":"Mechanical power transmission equipment","31":"Bearings",
 "32":"Woodworking machinery","34":"Metalworking machinery",
 "35":"Service and trade equipment","36":"Special industry machinery",
 "37":"Agricultural machinery","38":"Construction and highway maintenance equipment",
 "39":"Materials handling equipment","40":"Rope, cable, chain and fittings",
 "41":"Refrigeration and air conditioning equipment",
 "42":"Fire fighting, rescue and safety equipment","43":"Pumps and compressors",
 "44":"Furnace, steam plant and drying equipment",
 "45":"Plumbing, heating and waste disposal equipment",
 "46":"Water purification and sewage treatment equipment",
 "47":"Pipe, tubing, hose and fittings","48":"Valves",
 "49":"Maintenance and repair shop equipment","51":"Hand tools",
 "52":"Measuring tools","53":"Hardware and abrasives",
 "54":"Prefabricated structures and scaffolding","55":"Lumber, millwork and plywood",
 "56":"Construction and building materials",
 "58":"Communication, detection and coherent radiation equipment",
 "59":"Electrical and electronic equipment components",
 "60":"Fibre optics materials and components",
 "61":"Electric wire and power distribution equipment",
 "62":"Lighting fixtures and lamps","63":"Alarm, signal and security detection systems",
 "65":"Medical, dental and veterinary equipment and supplies",
 "66":"Instruments and laboratory equipment","67":"Photographic equipment",
 "68":"Chemicals and chemical products","69":"Training aids and devices",
 "70":"General purpose information technology equipment","71":"Furniture",
 "72":"Household and commercial furnishings and appliances",
 "73":"Food preparation and serving equipment","74":"Office machines",
 "75":"Office supplies and devices","76":"Books, maps and other publications",
 "77":"Musical instruments and home-type radios",
 "78":"Recreational and athletic equipment","79":"Cleaning equipment and supplies",
 "80":"Brushes, paints, sealers and adhesives",
 "81":"Containers, packaging and packing supplies",
 "83":"Textiles, leather, furs, apparel findings, tents and flags",
 "84":"Clothing, individual equipment and insignia","85":"Toiletries",
 "87":"Agricultural supplies","88":"Live animals","89":"Subsistence (food)",
 "91":"Fuels, lubricants, oils and waxes","93":"Nonmetallic fabricated materials",
 "94":"Nonmetallic crude materials","95":"Metal bars, sheets and shapes",
 "96":"Ores, minerals and their primary products","99":"Miscellaneous",
}
PSC_SERVICE_GROUP = {
 "A":"Research and development","B":"Special studies and analysis",
 "C":"Architect and engineering","D":"Information technology and telecommunications",
 "E":"Purchase of structures and facilities","F":"Natural resources and conservation",
 "G":"Social services","H":"Quality control, testing and inspection",
 "J":"Maintenance, repair and rebuilding of equipment","K":"Modification of equipment",
 "L":"Technical representative","M":"Operation of government-owned facilities",
 "N":"Installation of equipment","P":"Salvage","Q":"Medical services",
 "R":"Professional, administrative and management support",
 "S":"Utilities and housekeeping","T":"Photographic, mapping, printing and publication",
 "U":"Education and training","V":"Transportation, travel and relocation",
 "W":"Lease or rental of equipment","X":"Lease or rental of facilities",
 "Y":"Construction of structures and facilities",
 "Z":"Maintenance, repair and alteration of real property",
}
# The classes a year-end story is normally about: things that are consumed,
# furnished or eaten rather than fielded. Named here so the page can show them
# without a threshold quietly deciding they do not exist.
PSC_SUPPLY_WATCH = ("71", "72", "73", "75", "77", "78", "79", "85", "89")



def _shared_prefix_label(descriptions):
    """The words every description in a group begins with, or ''.

    A few product classes are not in the published supply-group list -- the 7A
    to 7K information-technology classes are the live example -- and inventing a
    name for them would be exactly the kind of made-up label this codebase
    refuses elsewhere. Their own four-digit descriptions all begin the same way
    ("IT AND TELECOM - ..."), so the group's name is taken from the words they
    share rather than from anywhere outside the source."""
    parts = [re.split(r"\s+", (d or "").strip().upper()) for d in descriptions if d]
    if not parts: return ""
    out = []
    for i in range(min(len(x) for x in parts)):
        w = parts[0][i]
        if all(x[i] == w for x in parts): out.append(w)
        else: break
    # Six words is enough to name a group and short enough to sit in a table
    # cell; a class with a single member would otherwise take that member's
    # whole description as the group name. Acronyms keep their case -- "It And
    # Telecom" is not what the source says.
    words = out[:6]
    _JOIN = {"AND", "THE", "FOR", "OF", "OR"}
    label = " ".join(w.lower() if w in _JOIN and i else
                     (w if (w.isupper() and len(w) <= 3) else w.capitalize())
                     for i, w in enumerate(words)).strip(" -,;:")
    return label if len(label) >= 4 else ""

def psc_group_key(code):
    c = (code or "").strip().upper()
    if not c: return "", "(not reported)"
    if c[0].isdigit():
        g = c[:2]
        return g, f"{g} · {PSC_GROUP.get(g, 'Supply group ' + g)}"
    g = c[0]
    return g, f"{g} · {PSC_SERVICE_GROUP.get(g, 'Service category ' + g)}"


TIMING_DIMS = [("sub_agency", "awarding_sub_agency_name", None),
               ("office", "awarding_office_name", None),
               ("psc", "product_or_service_code", "product_or_service_code_description"),
               ("psc_class", "psc_class_key", None),
               ("pricing", "type_of_contract_pricing", None),
               ("competition", "extent_competed", None),
               ("recipient", "recipient_name", None)]
TIMING_KEEP = 80          # keys carried per dimension per year
FY_MONTH_LABEL = ["Oct", "Nov", "Dec", "Jan", "Feb", "Mar",
                  "Apr", "May", "Jun", "Jul", "Aug", "Sep"]


def _median(xs):
    s = sorted(xs); n = len(s)
    if not n: return 0.0
    return s[n // 2] if n % 2 else (s[n // 2 - 1] + s[n // 2]) / 2.0


# A scale floor, and why there has to be one. 1.4826 scales the median absolute
# deviation to a standard deviation for a normal sample, so the ratio reads on
# the familiar z scale. But a category whose four prior years are 1.1%, 0.9%,
# 1.1% and 1.0% has a MAD near zero, and dividing by it produced a z of 416 --
# a number that says nothing except that the denominator was small. The scale is
# therefore floored at 5% of the median, or at a twentieth of the value where
# the median is zero, and the result is capped at 99. Both are stated on the
# page beside the figure: a capped z means "far outside its own history", not a
# measurement.
_Z_CAP = 99.0


def _mad_z(value, prior):
    """(robust z, median, scale). None when there are too few prior years to
    summarise -- three is the minimum at which a median means anything here."""
    if len(prior) < 3: return None, _median(prior) if prior else 0.0, 0.0
    med = _median(prior)
    mad = _median([abs(x - med) for x in prior]) * 1.4826
    floor = abs(med) * 0.05 if med else abs(value) * 0.05
    scale = max(mad, floor)
    if scale <= 0:
        return (None if abs(value - med) < 1e-9 else
                (_Z_CAP if value > med else -_Z_CAP)), med, 0.0
    z = (value - med) / scale
    return max(-_Z_CAP, min(_Z_CAP, z)), med, mad



# The reporting frontier, and why the maximum action date is not it.
#
# The FY2026 contract file runs to 2026-08-04 and is substantially complete only
# to the end of April. October through April carry 280,000 to 400,000 actions a
# month; May carries 75,000, June 67, July 105 and August 8. Those last 180
# actions are stragglers and forward-dated records, not activity, and taking the
# maximum date as the extent of the file made the page wrong in three ways at
# once: the cumulative curve ran flat for three months, the year looked like it
# had ten months observed when it had seven, and every pace and projection
# compared seven real months of FY2026 against ten of every prior year --
# understating the live year by about a third.
#
# So the extent is derived from where the file actually IS. A fiscal month counts
# as observed when it carries at least half the median month's action count for
# that year, and the frontier is the end of the last observed month counting
# CONSECUTIVELY from October -- consecutively, because a gap in the middle is a
# hole in the data rather than the end of it, and treating it as the end would
# hide the hole.
FRONTIER_SHARE = 0.5


def _fy_month_start(fy: int, m: int) -> dt.date:
    """First calendar day of fiscal month m (1 = October) of fiscal year fy."""
    mo = (10 + m - 2) % 12 + 1
    return dt.date(fy - 1 if m <= 3 else fy, mo, 1)


def _reporting_frontier(fy, month_actions):
    """(full_months, frontier_day_of_fy, frontier_date).

    A complete year returns 12 and its own last day."""
    present = [n for n in month_actions.values() if n > 0]
    med = _median(present) if present else 0.0
    full = 0
    for m in range(1, 13):
        n = month_actions.get(m, 0)
        if n > 0 and n >= FRONTIER_SHARE * med: full = m
        else: break
    end = (dt.date(fy, 9, 30) if full >= 12
           else _fy_month_start(fy, full + 1) - dt.timedelta(days=1))
    return full, (end - dt.date(fy - 1, 10, 1)).days + 1, end

def step_timing(out, only_fy=None):
    import pyarrow as pa, pyarrow.dataset as ds, pyarrow.compute as pc
    base = os.path.join(WAREHOUSE, "contracts")
    current = vintages()[-1]
    cols = ["action_date", "federal_action_obligation", "awarding_sub_agency_name",
            "awarding_office_name", "product_or_service_code",
            "product_or_service_code_description", "type_of_contract_pricing",
            "extent_competed", "recipient_name"]

    day_rows, month_rows, eoy_rows = [], [], []
    fy_meta = {}
    # keyed (dimension, key) -> {fy: {"obl","act","months":{m:obl},"sep","last5"}}
    series = collections.defaultdict(dict)
    labels, class_descs = {}, {}

    years = sorted(int(d.split("=", 1)[1]) for d in os.listdir(os.path.join(base, f"vintage={current}"))
                   if d.startswith("fy="))
    for fy in years:
        p = os.path.join(base, f"vintage={current}/fy={fy}")
        if not os.path.isdir(p): continue
        t = ds.dataset(p, format="parquet").to_table(columns=cols)
        epoch0 = (dt.date(fy - 1, 10, 1) - dt.date(1970, 1, 1)).days
        days = pc.cast(t["action_date"], pa.int32())
        dofy = pc.add(pc.subtract(days, pa.scalar(epoch0, pa.int32())), 1)
        # October is fiscal month 1 and September is 12. pyarrow.compute has no
        # modulo, so the wrap is written as the branch it actually is.
        cm = pc.month(t["action_date"])
        fym = pc.if_else(pc.greater_equal(cm, pa.scalar(10, pa.int64())),
                         pc.subtract(cm, pa.scalar(9, pa.int64())),
                         pc.add(cm, pa.scalar(3, pa.int64())))
        # The supply group or service category, derived once as a column rather
        # than folded together after aggregation: a product code's first two
        # digits, a service code's first letter.
        psc = t["product_or_service_code"]
        first = pc.utf8_slice_codeunits(psc, 0, 1)
        grp = pc.if_else(pc.match_substring_regex(first, r"^[0-9]$"),
                         pc.utf8_slice_codeunits(psc, 0, 2), first)
        t = (t.append_column("day_of_fy", dofy)
              .append_column("fy_month", fym)
              .append_column("psc_class_key", grp))

        # -- the daily curve, which is what a pace comparison is read from -----
        g = t.group_by(["day_of_fy"]).aggregate(
            [("federal_action_obligation", "sum"), ("federal_action_obligation", "count")])
        daily = sorted(({"d": r["day_of_fy"],
                         "o": round(r["federal_action_obligation_sum"] or 0.0, 2),
                         "n": r["federal_action_obligation_count"]}
                        for r in g.to_pylist() if r["day_of_fy"] is not None),
                       key=lambda r: r["d"])
        daily = [r for r in daily if 1 <= r["d"] <= 366]   # an action dated outside its own year
        cum_o = cum_n = 0.0
        last_day = max((r["d"] for r in daily), default=0)
        month_actions, month_obl = collections.Counter(), collections.Counter()
        for r in daily:
            d0 = dt.date(fy - 1, 10, 1) + dt.timedelta(days=r["d"] - 1)
            m = (d0.month - 10) % 12 + 1
            month_actions[m] += r["n"]; month_obl[m] += r["o"]
            cum_o += r["o"]; cum_n += r["n"]
            day_rows.append({"fiscal_year": fy, "day_of_fy": r["d"],
                             "obligation": r["o"], "action_count": r["n"],
                             "cum_obligation": round(cum_o, 2), "cum_actions": int(cum_n)})
        full_months, frontier_day, frontier_date = _reporting_frontier(fy, month_actions)
        tail = [r for r in daily if r["d"] > frontier_day]
        fy_meta[fy] = {"last_day": last_day, "obligation": round(cum_o, 2), "actions": int(cum_n),
                       "full_months": full_months, "frontier_day": frontier_day,
                       "frontier_date": frontier_date.isoformat(),
                       "frontier_obligation": round(sum(r["o"] for r in daily if r["d"] <= frontier_day), 2),
                       "frontier_actions": int(sum(r["n"] for r in daily if r["d"] <= frontier_day)),
                       "tail_actions": int(sum(r["n"] for r in tail)),
                       "tail_obligation": round(sum(r["o"] for r in tail), 2)}

        # -- month x dimension, and the year-end shares built from it ----------
        gd = t.group_by(["psc_class_key", "product_or_service_code_description"]).aggregate(
            [("federal_action_obligation", "count")])
        for r in gd.to_pylist():
            k = r["psc_class_key"]
            if k: class_descs.setdefault(str(k), set()).add(
                r["product_or_service_code_description"])

        for dim, col, labcol in TIMING_DIMS:
            keys = t.group_by([col] + ([labcol] if labcol else [])).aggregate(
                [("federal_action_obligation", "sum"), ("federal_action_obligation", "count")])
            recs = sorted(keys.to_pylist(),
                          key=lambda r: -(r["federal_action_obligation_sum"] or 0.0))
            keep = []
            for r in recs[:TIMING_KEEP]:
                k = r[col]
                k = "(not reported)" if k in (None, "") else str(k)
                keep.append(k)
                if dim == "psc_class":
                    _, lab = psc_group_key(k)
                else:
                    book = CODE_BOOKS.get(dim, {})
                    lab = book.get(k) or (str(r.get(labcol)) if labcol and r.get(labcol) else k)
                    if dim in CODE_BOOKS and k in book: lab = f"{k} · {lab}"
                labels[(dim, k)] = lab
                series[(dim, k)][fy] = {"obl": round(r["federal_action_obligation_sum"] or 0.0, 2),
                                        "act": r["federal_action_obligation_count"],
                                        "months": {}, "last5": 0.0}
            keepset = set(keep)
            gm = t.group_by([col, "fy_month"]).aggregate(
                [("federal_action_obligation", "sum"), ("federal_action_obligation", "count")])
            for r in gm.to_pylist():
                k = r[col]; k = "(not reported)" if k in (None, "") else str(k)
                if k not in keepset or r["fy_month"] is None: continue
                m = int(r["fy_month"]); o = round(r["federal_action_obligation_sum"] or 0.0, 2)
                series[(dim, k)][fy]["months"][m] = o
                month_rows.append({"fiscal_year": fy, "fy_month": m,
                                   "month_label": FY_MONTH_LABEL[m - 1],
                                   "dimension": dim, "dim_key": k, "dim_label": labels[(dim, k)],
                                   "obligation": o,
                                   "action_count": r["federal_action_obligation_count"]})
            # The final five days of the fiscal year, which is where a
            # deadline-driven obligation actually lands.
            tail = t.filter(pc.greater_equal(t["day_of_fy"], pa.scalar(last_day - 4, pa.int32()))) \
                    if last_day >= 5 else t.slice(0, 0)
            if tail.num_rows:
                gt = tail.group_by([col]).aggregate([("federal_action_obligation", "sum")])
                for r in gt.to_pylist():
                    k = r[col]; k = "(not reported)" if k in (None, "") else str(k)
                    if k in keepset:
                        series[(dim, k)][fy]["last5"] = round(r["federal_action_obligation_sum"] or 0.0, 2)
        m = fy_meta[fy]
        print(f"  FY{fy}: {m['actions']:,} actions, ${m['obligation']/1e9:,.1f}B; "
              f"{m['full_months']} whole months observed, frontier {m['frontier_date']}"
              + (f" ({m['tail_actions']:,} straggler actions dated after it, "
                 f"${m['tail_obligation']/1e6:,.1f}M)" if m['tail_actions'] else ""))
        del t

    # A supply group the published list does not name takes its label from the
    # words its own four-digit descriptions share. Done after the year loop so
    # every year's descriptions are in hand, and applied to the rows already
    # emitted rather than leaving two spellings of one group on the page.
    relabelled = {}
    for (dim, k), lab in list(labels.items()):
        if dim != "psc_class" or "Supply group" not in lab: continue
        derived = _shared_prefix_label(class_descs.get(k, ()))
        if derived:
            relabelled[k] = f"{k} · {derived}"
            labels[(dim, k)] = relabelled[k]
    if relabelled:
        for r in month_rows:
            if r["dimension"] == "psc_class" and r["dim_key"] in relabelled:
                r["dim_label"] = relabelled[r["dim_key"]]
        print(f"  {len(relabelled)} supply groups labelled from their own descriptions: "
              + ", ".join(sorted(relabelled.values())[:4]))

    # ----- the year-end shares, per dimension key per year --------------------
    for (dim, k), byfy in series.items():
        for fy, v in byfy.items():
            months = v["months"]
            sep = months.get(12, 0.0)
            q4 = sum(months.get(m, 0.0) for m in (10, 11, 12))
            tot = v["obl"] or 0.0
            eoy_rows.append({
                "fiscal_year": fy, "dimension": dim, "dim_key": k, "dim_label": labels[(dim, k)],
                "fy_obligation": tot, "fy_actions": v["act"],
                "sep_obligation": round(sep, 2),
                "sep_share_pct": round(sep / tot * 100, 4) if tot else 0.0,
                "q4_obligation": round(q4, 2),
                "q4_share_pct": round(q4 / tot * 100, 4) if tot else 0.0,
                "last5_obligation": round(v["last5"], 2),
                "last5_share_pct": round(v["last5"] / tot * 100, 4) if tot else 0.0,
                "months_observed": len(months),
                "is_complete_year": fy_meta.get(fy, {}).get("last_day", 0) >= 360})
    # =====================================================================
    # Signals. Everything below compares a category with its OWN prior years;
    # nothing is compared with a Department-wide average, because the categories
    # differ by three orders of magnitude in size and a shared threshold would
    # only ever select the largest of them.
    # =====================================================================
    complete = sorted(fy for fy, m in fy_meta.items() if m["full_months"] >= 12)
    partial = [fy for fy in sorted(fy_meta) if fy not in complete]
    live = partial[-1] if partial else (complete[-1] if complete else None)
    # The months of the live year that are fully observed -- derived by
    # _reporting_frontier from where the file actually is, never from its maximum
    # action date. Reading the maximum date as the extent put ten months against
    # FY2026's seven and understated every pace figure by about a third.
    live_full_months = fy_meta[live]["full_months"] if live is not None else 0
    signals, executors, action_rows = [], [], []

    def ytd(byfy, fy, months):
        v = byfy.get(fy)
        return sum(v["months"].get(m, 0.0) for m in range(1, months + 1)) if v else 0.0

    for (dim, k), byfy in series.items():
        lab = labels[(dim, k)]
        prior_complete = [fy for fy in complete if fy in byfy and fy != live]
        if len(prior_complete) < 3: continue
        # A key tracked in four of five complete years is not a four-year
        # history: it is a five-year history with one year missing because the
        # key fell outside the eighty largest that year, and the missing year is
        # a SMALL one. Leaving it out makes the years that remain look more alike
        # than they are and inflates every deviation measured against them. The
        # comparative signals therefore run only where the key is present in
        # every complete year; the descriptive one below states its own coverage.
        full_baseline = len(prior_complete) == len([fy for fy in complete if fy != live])
        sep_shares = []
        for fy in prior_complete:
            v = byfy[fy]
            tot = v["obl"] or 0.0
            if tot > 0: sep_shares.append((fy, v["months"].get(12, 0.0) / tot * 100))
        if not sep_shares: continue
        med_share = _median([s for _, s in sep_shares])
        med_sep = _median([byfy[fy]["months"].get(12, 0.0) for fy in prior_complete])

        # -- S1  how much of this category's year has historically landed in
        #        September. Not a finding: the shape of the system, published so
        #        the deviations below can be read against it.
        if med_sep >= 25e6:
            signals.append({"signal_kind": "eoy_concentration", "dimension": dim, "dim_key": k,
                "dim_label": lab, "fiscal_year": live, "metric": round(med_share, 3),
                "baseline": round(med_share, 3), "mad": 0.0, "deviation": None,
                "amount": round(med_sep, 2), "baseline_years": len(prior_complete),
                "direction": "high" if med_share >= 20 else "normal",
                "headline": f"{lab} has put a median {med_share:.1f}% of its year into September",
                "evidence": "; ".join(f"FY{fy} {s:.1f}%" for fy, s in sep_shares),
                "method": "median of the category's September share across its complete years"})

        # -- S2  a year whose September share its own history does not explain.
        for fy in (prior_complete if full_baseline else ()):
            tot = byfy[fy]["obl"] or 0.0
            if tot <= 0: continue
            share = byfy[fy]["months"].get(12, 0.0) / tot * 100
            others = [s for f2, s in sep_shares if f2 != fy]
            z, med, mad = _mad_z(share, others)
            if z is not None and abs(z) >= 3.0 and byfy[fy]["months"].get(12, 0.0) >= 50e6:
                signals.append({"signal_kind": "eoy_deviation", "dimension": dim, "dim_key": k,
                    "dim_label": lab, "fiscal_year": fy, "metric": round(share, 3),
                    "baseline": round(med, 3), "mad": round(mad, 3), "deviation": round(z, 2),
                    "amount": round(byfy[fy]["months"].get(12, 0.0), 2),
                    "baseline_years": len(others),
                    "direction": "high" if z > 0 else "low",
                    "headline": f"FY{fy}: {lab} put {share:.1f}% of its year into September "
                                f"against a {med:.1f}% norm",
                    "evidence": "; ".join(f"FY{f2} {s:.1f}%" for f2, s in sep_shares),
                    "method": "robust z of the September share against the median and scaled "
                              "median absolute deviation of the category's other complete years"})

        if live is None or live_full_months < 3 or not full_baseline: continue
        M = live_full_months
        live_ytd = ytd(byfy, live, M)
        prior_ytd = [ytd(byfy, fy, M) for fy in prior_complete]

        # -- S3  pace against the same window of prior years. The window is the
        #        live year's whole months only, so nothing is compared with a
        #        part-month.
        z, med, mad = _mad_z(live_ytd, prior_ytd)
        if med > 0 and (live_ytd >= 100e6 or med >= 100e6):
            ratio = live_ytd / med * 100
            if z is not None and abs(z) >= 2.5:
                signals.append({"signal_kind": "pace", "dimension": dim, "dim_key": k,
                    "dim_label": lab, "fiscal_year": live, "metric": round(live_ytd, 2),
                    "baseline": round(med, 2), "mad": round(mad, 2), "deviation": round(z, 2),
                    "amount": round(live_ytd - med, 2), "baseline_years": len(prior_ytd),
                    "direction": "high" if z > 0 else "low",
                    "headline": f"{lab} is at {ratio:.0f}% of its own {FY_MONTH_LABEL[0]}–"
                                f"{FY_MONTH_LABEL[M-1]} norm with the year end ahead",
                    "evidence": "; ".join(f"FY{fy} ${v/1e9:,.2f}B" for fy, v in
                                          zip(prior_complete, prior_ytd))
                                + f"; FY{live} ${live_ytd/1e9:,.2f}B",
                    "method": f"obligations in fiscal months 1-{M} against the median of the "
                              "same window in the category's complete years"})

        # -- S4  what September looks like if this category behaves as it has.
        #        A ratio of September to the same observed window, not a share of
        #        a full year: the live year has no full year to take a share of.
        ratios = [byfy[fy]["months"].get(12, 0.0) / max(1.0, ytd(byfy, fy, M))
                  for fy in prior_complete if ytd(byfy, fy, M) > 0]
        if ratios and live_ytd > 0:
            lo, hi, mid = min(ratios), max(ratios), _median(ratios)
            proj = live_ytd * mid
            if proj >= 100e6:
                signals.append({"signal_kind": "eoy_projection", "dimension": dim, "dim_key": k,
                    "dim_label": lab, "fiscal_year": live, "metric": round(proj, 2),
                    "baseline": round(med_sep, 2), "mad": 0.0, "deviation": None,
                    "amount": round(proj, 2), "baseline_years": len(ratios),
                    "direction": "high" if proj > med_sep else "low",
                    "headline": f"{lab} projects ${proj/1e9:,.2f}B of September obligations",
                    "evidence": f"FY{live} months 1-{M} ${live_ytd/1e9:,.2f}B; September ran "
                                f"{lo*100:.0f}%–{hi*100:.0f}% of that window in FY"
                                f"{prior_complete[0]}–FY{prior_complete[-1]}, median {mid*100:.0f}%",
                    "method": "the live year's observed window scaled by the median ratio of "
                              "September to the same window in prior complete years; the range "
                              "is the observed minimum and maximum of that ratio"})

        # -- S5  a month of the live year its own history does not explain.
        for m in range(1, M + 1):
            v = byfy.get(live, {}).get("months", {}).get(m, 0.0)
            hist = [byfy[fy]["months"].get(m, 0.0) for fy in prior_complete]
            z, med_m, mad_m = _mad_z(v, hist)
            if z is not None and abs(z) >= 4.0 and abs(v) >= 50e6:
                signals.append({"signal_kind": "spike", "dimension": dim, "dim_key": k,
                    "dim_label": lab, "fiscal_year": live, "metric": round(v, 2),
                    "baseline": round(med_m, 2), "mad": round(mad_m, 2), "deviation": round(z, 2),
                    "amount": round(v - med_m, 2), "baseline_years": len(base),
                    "direction": "high" if z > 0 else "low",
                    "headline": f"{lab} obligated ${v/1e9:,.2f}B in {FY_MONTH_LABEL[m-1]} "
                                f"against a ${med_m/1e9:,.2f}B norm",
                    "evidence": "; ".join(f"FY{fy} ${b/1e6:,.0f}M" for fy, b in
                                          zip(prior_complete, hist))
                                + f"; FY{live} ${v/1e6:,.0f}M",
                    "method": f"robust z of {FY_MONTH_LABEL[m-1]} against the same month in the "
                              "category's complete years"})

        # -- S6  a category that was not being bought and now is.
        if live_ytd >= 25e6 and all(v <= 0 for v in prior_ytd):
            signals.append({"signal_kind": "new_activity", "dimension": dim, "dim_key": k,
                "dim_label": lab, "fiscal_year": live, "metric": round(live_ytd, 2),
                "baseline": 0.0, "mad": 0.0, "deviation": None, "amount": round(live_ytd, 2),
                "baseline_years": len(prior_ytd), "direction": "high",
                "headline": f"{lab} has ${live_ytd/1e6:,.0f}M in FY{live} and nothing in the "
                            f"same window of any prior year held",
                "evidence": f"FY{prior_complete[0]}–FY{prior_complete[-1]} months 1-{M}: $0",
                "method": "no obligations in the same window of any prior complete year"})

    for s in signals:
        s["severity_rank"] = 0
        s.setdefault("full_baseline", True)
    order = {"eoy_deviation": 0, "spike": 1, "pace": 2, "new_activity": 3,
             "eoy_projection": 4, "eoy_concentration": 5}
    signals.sort(key=lambda s: (order.get(s["signal_kind"], 9),
                                -abs(s["deviation"] or 0), -abs(s["amount"] or 0)))
    for i, s in enumerate(signals, 1): s["severity_rank"] = i

    # ----- executor scorecard, by awarding sub-agency -------------------------
    if live is not None and live_full_months >= 3:
        M = live_full_months
        for (dim, k), byfy in series.items():
            if dim != "sub_agency": continue
            prior_complete = [fy for fy in complete if fy in byfy and fy != live]
            if len(prior_complete) < 3 or live not in byfy: continue
            live_ytd = ytd(byfy, live, M)
            prior_ytd = [ytd(byfy, fy, M) for fy in prior_complete]
            med = _median(prior_ytd)
            sep_shares = [byfy[fy]["months"].get(12, 0.0) / max(1.0, byfy[fy]["obl"]) * 100
                          for fy in prior_complete]
            last5 = [byfy[fy]["last5"] / max(1.0, byfy[fy]["obl"]) * 100 for fy in prior_complete]
            ratios = [byfy[fy]["months"].get(12, 0.0) / max(1.0, ytd(byfy, fy, M))
                      for fy in prior_complete if ytd(byfy, fy, M) > 0]
            executors.append({
                "fiscal_year": live, "dim_key": k, "dim_label": labels[(dim, k)],
                "ytd_obligation": round(live_ytd, 2), "ytd_norm": round(med, 2),
                "pace_pct": round(live_ytd / med * 100, 2) if med else None,
                "months_observed": M,
                "sep_share_median_pct": round(_median(sep_shares), 3),
                "last5_share_median_pct": round(_median(last5), 3),
                "projected_sep": round(live_ytd * _median(ratios), 2) if ratios else None,
                "projected_sep_low": round(live_ytd * min(ratios), 2) if ratios else None,
                "projected_sep_high": round(live_ytd * max(ratios), 2) if ratios else None,
                "baseline_years": len(prior_complete),
                "actions_ytd": byfy[live]["act"]})
        executors.sort(key=lambda r: -(r["ytd_obligation"] or 0))
        for i, r in enumerate(executors, 1): r["rank_in_fy"] = i

    # ----- exemplar actions ---------------------------------------------------
    # The signals above are about categories. A reviewer's next question is
    # always "which action", so the largest actions behind the two windows that
    # matter -- the last complete year's September, and the live year to date --
    # are carried with the description the contracting officer wrote. The scan
    # is filtered to actions of $5M or more first, because the description column
    # is the widest in the file and pulling it for four million rows to keep
    # fifty is the one thing here that will not fit in memory.
    exemplar_cols = cols + ["award_id_piid", "transaction_description",
                            "prime_award_base_transaction_description", "action_type",
                            "naics_description", "recipient_state_code"]

    def emit(fy, bucket, recs, limit, last_day):
        recs = sorted(recs, key=lambda r: -(r["federal_action_obligation"] or 0.0))
        for rank, r in enumerate(recs[:limit], 1):
            psc = str(r.get("product_or_service_code") or "")
            gk, glab = psc_group_key(psc)
            action_rows.append({
                "fiscal_year": fy, "bucket": bucket, "rank_in_bucket": rank,
                "action_date": r["action_date"].isoformat() if r.get("action_date") else None,
                "day_of_fy": r.get("day_of_fy"),
                "days_to_year_end": (None if not r.get("day_of_fy") else last_day - r["day_of_fy"]),
                "award_id_piid": str(r.get("award_id_piid") or ""),
                "recipient_name": str(r.get("recipient_name") or ""),
                "recipient_state": str(r.get("recipient_state_code") or ""),
                "sub_agency": str(r.get("awarding_sub_agency_name") or ""),
                "office": str(r.get("awarding_office_name") or ""),
                "psc": psc,
                "psc_description": str(r.get("product_or_service_code_description") or ""),
                "psc_class": gk, "psc_class_label": glab, "psc_kind": psc_kind(psc),
                "naics_description": str(r.get("naics_description") or ""),
                "pricing": CONTRACT_PRICING.get(str(r.get("type_of_contract_pricing") or ""),
                                                str(r.get("type_of_contract_pricing") or "")),
                "competition": EXTENT_COMPETED.get(str(r.get("extent_competed") or ""),
                                                   str(r.get("extent_competed") or "")),
                "action_type": str(r.get("action_type") or ""),
                "obligation": round(r.get("federal_action_obligation") or 0.0, 2),
                "description": (r.get("transaction_description")
                                or r.get("prime_award_base_transaction_description") or "")[:600]})

    want = [fy for fy in ([complete[-1]] if complete else []) + ([live] if live else []) if fy]
    for fy in want:
        p = os.path.join(base, f"vintage={current}/fy={fy}")
        if not os.path.isdir(p): continue
        d = ds.dataset(p, format="parquet")
        last_day = fy_meta[fy]["last_day"]
        epoch0 = (dt.date(fy - 1, 10, 1) - dt.date(1970, 1, 1)).days

        def load(expr):
            t = d.to_table(columns=exemplar_cols, filter=expr)
            if not t.num_rows: return []
            dofy = pc.add(pc.subtract(pc.cast(t["action_date"], pa.int32()),
                                      pa.scalar(epoch0, pa.int32())), 1)
            return t.append_column("day_of_fy", dofy).to_pylist()

        big = load(ds.field("federal_action_obligation") >= 5_000_000)
        emit(fy, "largest", big, 60, last_day)
        # September is a calendar month of the same year as the fiscal year, so
        # it can be filtered on the date column itself rather than on the derived
        # day-of-year -- which is what keeps this a pushed-down scan instead of a
        # full read.
        sep = load((ds.field("action_date") >= dt.date(fy, 9, 1))
                   & (ds.field("federal_action_obligation") >= 250_000))
        emit(fy, "september", sep, 60, last_day)
        emit(fy, "last5", [r for r in sep if r.get("day_of_fy")
                           and r["day_of_fy"] >= last_day - 4], 60, last_day)
        # The classes a year-end story is usually about. They are far too small
        # to reach any dollar-ranked list, so they get their own, and the page
        # says plainly that buying supplies in September is not itself a finding.
        emit(fy, "september_supplies",
             [r for r in sep
              if psc_group_key(r.get("product_or_service_code"))[0] in PSC_SUPPLY_WATCH],
             60, last_day)
        n = len([a for a in action_rows if a["fiscal_year"] == fy])
        print(f"  FY{fy}: {n:,} exemplar actions across "
              f"{len({a['bucket'] for a in action_rows if a['fiscal_year']==fy})} buckets")
        del big, sep

    meta_rows = [{"fiscal_year": fy, "last_day_of_fy": m["last_day"],
                  "last_action_date": (dt.date(fy - 1, 10, 1)
                                       + dt.timedelta(days=m["last_day"] - 1)).isoformat(),
                  "obligation": m["obligation"], "action_count": m["actions"],
                  "is_complete_year": m["full_months"] >= 12,
                  "full_months_observed": m["full_months"],
                  "frontier_day_of_fy": m["frontier_day"],
                  "frontier_date": m["frontier_date"],
                  "frontier_obligation": m["frontier_obligation"],
                  "frontier_actions": m["frontier_actions"],
                  "tail_actions": m["tail_actions"],
                  "tail_obligation": m["tail_obligation"]}
                 for fy, m in sorted(fy_meta.items())]
    print(f"  {len(signals):,} signals, {len(executors)} executor rows, "
          f"{len(action_rows):,} exemplar actions")
    write(out, "timing.json", payload("contract_timing", current,
          {"dm_fpds_day": day_rows, "dm_fpds_month": month_rows, "dm_fpds_eoy": eoy_rows,
           "dm_fpds_year": meta_rows, "dm_exec_signal": signals,
           "dm_exec_executor": executors, "dm_fpds_action": action_rows},
          source_path="contracts", vintages=vintages()))


# ------------------------------------------------------------------- main ---
STEPS = {"exhibits": step_exhibits, "pb_display": step_pb_display, "execution": step_execution, "timing": step_timing, "sbr": step_sbr, "obligations": step_obligations, "awards": step_awards,
         "filec": step_filec, "assistance": step_assistance, "program": step_program,
         "knowledge": step_knowledge,
         "crosswalk": step_crosswalk, "catalog": step_catalog,
         "jbook": step_jbook}

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
        fn(a.out, a.fy) if nm in ("awards", "assistance", "program", "timing") else fn(a.out)
    print("done.")

if __name__ == "__main__":
    main()

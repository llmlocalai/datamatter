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
        t = ds.dataset(p, format="parquet").to_table(
            columns=["agency_identifier_code","transaction_obligated_amount","award_unique_key"])
        code = t["agency_identifier_code"].to_pylist()
        amt  = t["transaction_obligated_amount"].to_pylist()
        keys = t["award_unique_key"].to_pylist()
        tot = 0.0; rows = 0; uniq = set()
        for c_, a_, k_ in zip(code, amt, keys):
            if c_ not in DOW_CODES: continue
            tot += (a_ or 0.0); rows += 1
            if k_: uniq.add(k_)
        aw = award_by_fy.get(fy)
        awob = aw["obligation"] if aw else 0.0
        rec.append({"fiscal_year": fy, "award_obligation": awob,
            "award_actions": aw["action_count"] if aw else 0,
            "filec_obligation": round(tot,2), "filec_rows": rows, "filec_awards": len(uniq),
            "linkage_pct": round(tot/awob*100, 4) if awob else 0.0,
            "unlinked_obligation": round(awob - tot, 2),
            "is_partial_year": bool(aw and aw["is_partial_year"])})
        print(f"  FY{fy}: File C {tot/1e9:.2f}B over {rows:,} rows / {len(uniq):,} awards"
              f"  -> linkage {rec[-1]['linkage_pct']:.1f}%")
    write(out, "filec.json", payload("file_c_reconciliation", vintage,
          {"dm_reconciliation": rec}, source_path="accounts/file_c_contracts"))

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

# ------------------------------------------------------------------- main ---
STEPS = {"sbr": step_sbr, "obligations": step_obligations, "awards": step_awards,
         "filec": step_filec, "knowledge": step_knowledge}

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
        fn(a.out, a.fy) if nm == "awards" else fn(a.out)
    print("done.")

if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
Fetch File A and File B for EVERY submission period of a fiscal year.

Why this exists
---------------
The account warehouse holds exactly one submission period per fiscal year --
FY2021-FY2025 at P12 and FY2026 at P10 -- and that is faithful to what was
downloaded. USASpending's account download returns the position as of the LATEST
period in the range you request, so a file named `FY2025P01-P12_...` carries
`submission_period = FY2025P12` on every one of its rows. P01-P12 is the request,
not the content. Verified across all 41 account CSVs on disk.

The consequence is that nothing in File A or File B can answer WHEN money moved,
and /execution and /execution/chain both say so and fall back to contract action
dates, which are a third of obligations and name their Treasury account on only
1-6% of current-year dollars.

The fix is not code. It is asking for each period separately, which is what this
script does. Run it once per fiscal year and the monthly series exists at 100%
coverage, at Treasury account x programme activity x object class grain, with
obligations AND outlays.

It must run on a machine with network access to api.usaspending.gov. Neither
sandbox has it.

Usage
-----
    python3 scripts/fetch_account_periods.py --fy 2026
    python3 scripts/fetch_account_periods.py --fy 2026 --periods 2,3,4,5,6,7,8,9,10
    python3 scripts/fetch_account_periods.py --fy 2024 --out /Volumes/AI_DATA/data/usaspending/periods

Resumable: a period already downloaded is skipped, so an interrupted run is safe
to repeat. The API builds each file asynchronously, which takes a few minutes per
period; the script polls and waits.
"""
from __future__ import annotations
import argparse, json, os, sys, time, urllib.request, urllib.error

API = "https://api.usaspending.gov/api/v2/bulk_download/accounts/"
STATUS = "https://api.usaspending.gov/api/v2/bulk_download/status/"
# Monthly submissions begin at P02: October and November are reported together.
PERIODS = list(range(2, 13))
DOD_AGENCY = "097"          # the toptier agency USASpending files DoD under
POLL_SECONDS = 20
POLL_LIMIT = 90             # 30 minutes per file before giving up


def post(url: str, body: dict) -> dict:
    data = json.dumps(body).encode()
    req = urllib.request.Request(url, data=data,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode())


def get(url: str) -> dict:
    with urllib.request.urlopen(url, timeout=60) as r:
        return json.loads(r.read().decode())


def request_period(fy: int, period: int, level: str, submission: str) -> dict:
    """Ask for ONE period. `period` here is the submission period, not a range."""
    return post(API, {
        "account_level": level,                 # treasury_account | federal_account
        "filters": {
            "fy": fy,
            "period": period,
            "agency": DOD_AGENCY,
            "submission_types": [submission],   # account_balances | object_class_program_activity
        },
        "file_format": "csv",
    })


def wait_for(file_name: str) -> str | None:
    """Poll until the file is generated. Returns the download url, or None."""
    for _ in range(POLL_LIMIT):
        try:
            st = get(STATUS + "?file_name=" + file_name)
        except urllib.error.HTTPError as e:
            print(f"      status {e.code}; retrying", flush=True)
            time.sleep(POLL_SECONDS); continue
        s = st.get("status")
        if s == "finished":
            return st.get("file_url")
        if s == "failed":
            print(f"      generation failed: {st.get('message')}", flush=True)
            return None
        time.sleep(POLL_SECONDS)
    print("      timed out waiting for generation", flush=True)
    return None


def download(url: str, dest: str) -> None:
    tmp = dest + ".part"
    with urllib.request.urlopen(url, timeout=600) as r, open(tmp, "wb") as fh:
        while True:
            chunk = r.read(1 << 20)
            if not chunk: break
            fh.write(chunk)
    os.replace(tmp, dest)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--fy", type=int, required=True)
    ap.add_argument("--periods", default=",".join(str(p) for p in PERIODS),
                    help="comma-separated submission periods (default 2-12)")
    ap.add_argument("--out", default="/Volumes/AI_DATA/data/usaspending/periods")
    ap.add_argument("--level", default="treasury_account",
                    choices=("treasury_account", "federal_account"))
    a = ap.parse_args()
    periods = [int(x) for x in a.periods.split(",") if x.strip()]
    os.makedirs(a.out, exist_ok=True)

    jobs = [("account_balances", "AccountBalances"),
            ("object_class_program_activity", "ObjectClassProgramActivity")]
    done = skipped = failed = 0
    for period in periods:
        for submission, label in jobs:
            dest = os.path.join(
                a.out, f"FY{a.fy}P{period:02d}_DoD_{label}_{a.level}.zip")
            if os.path.exists(dest):
                print(f"  FY{a.fy} P{period:02d} {label}: already here, skipping", flush=True)
                skipped += 1; continue
            print(f"  FY{a.fy} P{period:02d} {label}: requesting", flush=True)
            try:
                r = request_period(a.fy, period, a.level, submission)
            except urllib.error.HTTPError as e:
                body = e.read().decode()[:200]
                print(f"      refused ({e.code}): {body}", flush=True)
                failed += 1; continue
            name = r.get("file_name")
            url = r.get("file_url")
            if not url:
                url = wait_for(name) if name else None
            if not url:
                failed += 1; continue
            print(f"      downloading {name}", flush=True)
            try:
                download(url, dest)
            except Exception as e:                       # noqa: BLE001
                print(f"      download failed: {e}", flush=True)
                failed += 1; continue
            print(f"      -> {dest} ({os.path.getsize(dest)/1e6:.1f} MB)", flush=True)
            done += 1

    print(f"\nFY{a.fy}: {done} downloaded, {skipped} already present, {failed} failed")
    if done:
        print("\nNext: point the warehouse builder at these and partition by the\n"
              "submission_period column the rows carry, rather than by the filename.\n"
              "Then /execution/chain's modelled and censored layers can be replaced\n"
              "with a measured monthly series at full coverage.")
    return 1 if failed and not done else 0


if __name__ == "__main__":
    sys.exit(main())

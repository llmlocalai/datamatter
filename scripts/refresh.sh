#!/bin/zsh
# =============================================================================
#  refresh.sh — the last link of the USASpending chain. Runs on this Mac only.
#
#  Upstream, outside this repo, two launchd jobs already keep the warehouse
#  current (see /Volumes/AI_DATA/Install-Account-Refresh-Schedule.command):
#     collector (03:15)  -> zips
#     com.dodfm.usaspending-refresh (on zip change, 07:20 backstop)
#                        -> warehouse/accounts/*.parquet
#     refresh-award-warehouse.sh  -> warehouse/contracts|assistance/vintage=*
#  Until 2026-10-13 nothing ran THIS step after them, so the warehouse reached
#  FY2026 P11 and contract vintage 2026-09-06 on 6-7 October while Neon, and
#  the site, stayed on the 19 September load. This script closes that gap:
#
#     warehouse changed? -> migrate -> ETL --step all -> load (controls inside
#     the transaction) -> knowledge index -> verify (next build against Neon)
#     -> Vercel deploy hook, so every page is prerendered against the new load.
#
#  Gate: a digest of the warehouse parquet inventory (name + size + mtime).
#  launchd may fire this many times a day; it does work only when the digest
#  changed, or the last good run is older than DM_MAX_AGE_DAYS (default 7, so
#  exhibits, books and the submission calendar still refresh weekly).
#
#  Usage:
#     scripts/refresh.sh            run only if the warehouse changed
#     scripts/refresh.sh --force    run regardless
#     scripts/refresh.sh --dry      say what it would do, change nothing
#
#  Failure is loud and safe: a critical control rolls the load back and the
#  previous vintage stays published. Any failed step writes
#  /Volumes/AI_DATA/logs/DATAMATTER-REFRESH-ATTENTION.txt and does NOT stamp,
#  so the next fire retries.
# =============================================================================
set -u
setopt pipefail 2>/dev/null

REPO="${0:A:h:h}"
AI=/Volumes/AI_DATA
WH="$AI/data/usaspending/warehouse"
STATE_DIR="$AI/data/usaspending"
STAMP="$STATE_DIR/datamatter_loaded_warehouse.sha"
LASTOK="$STATE_DIR/datamatter_last_ok"
LOG_DIR="${DM_LOG_DIR:-$AI/logs}"
LOG="$LOG_DIR/datamatter-refresh.log"
ATTENTION="$LOG_DIR/DATAMATTER-REFRESH-ATTENTION.txt"
LOCK=/tmp/datamatter-refresh.lock
QUIET_MIN=15             # a parquet younger than this may still be written
MAX_AGE_DAYS="${DM_MAX_AGE_DAYS:-7}"
MODE="${1:-auto}"

# launchd starts with PATH=/usr/bin:/bin. node, npm, pdftotext and a python
# with pyarrow all live under Homebrew.
export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:$PATH"

mkdir -p "$LOG_DIR" 2>/dev/null
say() { print -r -- "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG"; }
attention() {
  { echo "$(date '+%Y-%m-%d %H:%M:%S')  datamatter refresh FAILED at: $1"
    echo "The site still shows the previous load. The next launchd fire retries."
    echo "Log: $LOG"
    echo "Run by hand:  $REPO/scripts/refresh.sh --force"; } > "$ATTENTION"
  say "FAILED $1 — wrote $ATTENTION"
}

if ! /sbin/mount | grep -q "on /Volumes/AI_DATA "; then
  echo "$(date -Iseconds) datamatter-refresh: AI_DATA not mounted; skipping" \
    >> "$HOME/Library/Logs/datamatter-refresh-fallback.log"
  exit 0
fi
cd "$REPO" || exit 1

# ---- never read a warehouse while upstream is writing it ---------------------
for l in /tmp/dodfm-account-pipeline.lock /tmp/dodfm-award-warehouse.lock; do
  if [[ -d "$l" ]]; then
    [[ "$MODE" == "--dry" ]] && say "DRY upstream running ($l)"
    exit 0      # silent: the upstream job's own write will fire us again
  fi
done
if [[ -n "$(find "$WH" -name '*.parquet' -mmin -$QUIET_MIN 2>/dev/null | head -1)" ]]; then
  say "SKIP a warehouse file is younger than ${QUIET_MIN}m; the backstop picks it up"
  exit 0
fi

# ---- has the warehouse changed since the last good load? ---------------------
NFILES=$(find "$WH" -name '*.parquet' -type f 2>/dev/null | wc -l | tr -d ' ')
if [[ "$NFILES" -eq 0 ]]; then
  say "FATAL 0 parquet files under $WH — volume half-mounted or folder moved"
  attention "warehouse not found"; exit 1
fi
FINGERPRINT=$(find "$WH" -name '*.parquet' -type f -not -path '*/_tmp/*' \
                -exec stat -f '%N %z %m' {} \; 2>/dev/null | sort | shasum -a 256 | awk '{print $1}')
PREVIOUS=$(cat "$STAMP" 2>/dev/null || echo none)
AGE_OK=0
if [[ -f "$LASTOK" ]] && [[ -n "$(find "$LASTOK" -mtime -$MAX_AGE_DAYS 2>/dev/null)" ]]; then AGE_OK=1; fi

if [[ "$MODE" == "--dry" ]]; then
  say "DRY warehouse=$FINGERPRINT loaded=$PREVIOUS last_ok_recent=$AGE_OK"
  if [[ "$FINGERPRINT" != "$PREVIOUS" ]]; then say "DRY warehouse changed — would run the full chain"
  elif [[ $AGE_OK -eq 0 ]]; then say "DRY last good run older than ${MAX_AGE_DAYS}d — would run"
  else say "DRY nothing to do"; fi
  exit 0
fi
if [[ "$MODE" != "--force" && "$FINGERPRINT" == "$PREVIOUS" && $AGE_OK -eq 1 ]]; then
  exit 0        # the common case: silent
fi

if ! mkdir "$LOCK" 2>/dev/null; then
  say "SKIP another datamatter refresh is running ($LOCK)"; exit 0
fi
trap 'rmdir "$LOCK" 2>/dev/null' EXIT INT TERM

# ---- tools -------------------------------------------------------------------
PY=""
for c in "${DM_PYTHON:-}" /opt/homebrew/bin/python3 /usr/local/bin/python3 python3; do
  [[ -n "$c" ]] || continue
  if "$c" -c "import pyarrow, openpyxl" 2>/dev/null; then PY="$c"; break; fi
done
if [[ -z "$PY" ]]; then
  say "FATAL no python3 with pyarrow + openpyxl (set DM_PYTHON in the plist)"
  attention "python with pyarrow/openpyxl"; exit 1
fi
command -v node >/dev/null || { attention "node not on PATH"; exit 1; }
command -v pdftotext >/dev/null || say "WARN pdftotext missing — EXH-08 will have no weapons-book roster"

say "=============================================================="
say "datamatter refresh: warehouse $FINGERPRINT (loaded $PREVIOUS) mode=$MODE"
say "  python $PY · node $(node -v)"

step() {           # step <label> <command...>
  local label="$1"; shift
  local t0=$SECONDS
  say "-> $label"
  if ! "$@" >> "$LOG" 2>&1; then
    # Name the cause on the terminal, not just the step: a Neon quota refusal
    # and a broken extract both stop here and need very different responses.
    local why=$(grep -E '^(error|Error|[A-Za-z]*Error):' "$LOG" | tail -1)
    [[ -n "$why" ]] && say "   cause: $why"
    attention "$label${why:+ — $why}"; exit 1
  fi
  say "   $label ok in $((SECONDS - t0))s"
}

step "migrate"         node scripts/apply_schema.js
step "etl"             nice -n 10 "$PY" scripts/etl_analytics.py --step all
step "load"            node scripts/load_analytics.js
step "knowledge-index" "$PY" scripts/etl_knowledge_index.py

# The load is committed and the live site's ISR pages will pick it up within
# six hours on their own. The redeploy is what makes it prompt: every page is
# prerendered against the new load at build time, where no function timeout
# applies. verify runs the same prerender here first so a page that cannot
# build against the new data is caught on this machine, not on Vercel.
if [[ "${DM_SKIP_VERIFY:-0}" != "1" ]]; then
  step "verify" npm run --silent verify
fi

HOOK=$(sed -nE 's/^[[:space:]]*VERCEL_DEPLOY_HOOK[[:space:]]*=[[:space:]]*"?([^"]+)"?[[:space:]]*$/\1/p' .env.local 2>/dev/null | head -1)
if [[ -n "$HOOK" ]]; then
  if curl -fsS -X POST "$HOOK" -o /dev/null; then say "-> deploy hook triggered (status only; URL not logged)"
  else say "WARN deploy hook POST failed — ISR will still refresh pages within 6 h"; fi
else
  say "NOTE no VERCEL_DEPLOY_HOOK in .env.local — relying on ISR (6 h) to show the new load"
fi

print -r -- "$FINGERPRINT" > "$STAMP"
touch "$LASTOK"
rm -f "$ATTENTION" 2>/dev/null
say "done. stamp updated."
say "=============================================================="
exit 0

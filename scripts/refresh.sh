#!/usr/bin/env bash
# Daily refresh. Runs where the warehouse lives (this Mac): extract, then load.
# The load is transactional and runs the control suite before committing, so a
# bad extract cannot become the published figures — the previous vintage stays.
#
# Install as a daily job:
#   cp scripts/com.datamatter.refresh.plist ~/Library/LaunchAgents/
#   launchctl load ~/Library/LaunchAgents/com.datamatter.refresh.plist
set -euo pipefail
cd "$(dirname "$0")/.."
LOG_DIR="${DM_LOG_DIR:-$HOME/Library/Logs/datamatter}"
mkdir -p "$LOG_DIR"
STAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
{
  echo "=== datamatter refresh $STAMP ==="
  PYTHON="${DM_PYTHON:-python3}"
  "$PYTHON" scripts/etl_analytics.py --step sbr
  "$PYTHON" scripts/etl_analytics.py --step obligations
  "$PYTHON" scripts/etl_analytics.py --step knowledge
  for fy in 2021 2022 2023 2024 2025 2026; do
    "$PYTHON" scripts/etl_analytics.py --step awards --fy "$fy"
  done
  "$PYTHON" scripts/etl_analytics.py --step filec
  node scripts/load_analytics.js
  echo "=== complete $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
} 2>&1 | tee -a "$LOG_DIR/refresh.log"

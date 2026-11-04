#!/bin/zsh
# =============================================================================
#  Install-Refresh-Schedule.command — double-click, re-runnable.
#
#  Puts datamatter's refresh (scripts/refresh.sh) under launchd as
#  com.datamatter.refresh, chained after the warehouse jobs:
#
#    WatchPaths  /Volumes/AI_DATA/data/usaspending   fires when the account
#                pipeline or the award warehouse writes its manifest
#    09:40 daily backstop (after the 07:20 account chain; ODD hour, so it never
#                contends with the even-hour learner for the Ollama slot)
#
#  refresh.sh no-ops unless the warehouse parquet set changed (or the last good
#  run is a week old), so the many WatchPaths fires cost nothing.
#
#  Same pattern as Install-Account-Refresh-Schedule.command: the wrapper lives
#  on the INTERNAL disk so launchd can start it before AI_DATA mounts, and the
#  job is verified with `launchctl list`, not load's exit code.
# =============================================================================
set -u
REPO="${0:A:h:h}"
SUP="$HOME/Library/Application Support/llmpowerhouse"
LA="$HOME/Library/LaunchAgents"
LABEL="com.datamatter.refresh"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

print -P "%F{cyan}=============================================================%f"
print -P "%F{cyan}  INSTALL DATAMATTER REFRESH SCHEDULE%f"
print -P "%F{cyan}=============================================================%f"
echo ""

# ---- preflight ---------------------------------------------------------------
print -P "%F{cyan}Preflight%f"
PY=""
for c in /opt/homebrew/bin/python3 /usr/local/bin/python3 python3; do
  if "$c" -c "import pyarrow, openpyxl" 2>/dev/null; then PY="$c"; break; fi
done
if [[ -n "$PY" ]]; then print -P "  %F{green}ok%f   $PY has pyarrow + openpyxl"
else print -P "  %F{red}FAIL%f no python3 with pyarrow + openpyxl:  python3 -m pip install pyarrow openpyxl"; fi
command -v node >/dev/null && print -P "  %F{green}ok%f   node $(node -v)" \
                           || print -P "  %F{red}FAIL%f node not found under /opt/homebrew/bin"
command -v pdftotext >/dev/null && print -P "  %F{green}ok%f   pdftotext" \
                                || print -P "  %F{yellow}warn%f pdftotext missing:  brew install poppler"
grep -q '^DATABASE_URL=.' "$REPO/.env.local" 2>/dev/null && print -P "  %F{green}ok%f   DATABASE_URL in .env.local" \
                                                         || print -P "  %F{red}FAIL%f DATABASE_URL missing from .env.local"
if grep -q '^VERCEL_DEPLOY_HOOK=.' "$REPO/.env.local" 2>/dev/null; then
  print -P "  %F{green}ok%f   VERCEL_DEPLOY_HOOK set — each refresh redeploys the site"
else
  print -P "  %F{yellow}warn%f no VERCEL_DEPLOY_HOOK in .env.local — pages refresh by ISR only."
  print -P "       Vercel > datamatter > Settings > Git > Deploy Hooks > create (branch main),"
  print -P "       then add a line  VERCEL_DEPLOY_HOOK=<url>  to .env.local"
fi
echo ""

mkdir -p "$SUP" "$LA"
chmod +x "$REPO/scripts/refresh.sh"

# ---- wrapper on the internal disk -------------------------------------------
cat > "$SUP/datamatter-refresh-run.sh" <<WRAP
#!/bin/zsh
# Waits for AI_DATA, then runs datamatter's refresh. Written by
# Install-Refresh-Schedule.command.
set -u
CANARY="/Volumes/AI_DATA/.ai_data_canary"
RUNNER="$REPO/scripts/refresh.sh"
for i in \$(seq 1 120); do
  if /sbin/mount | grep -q "on /Volumes/AI_DATA " && [[ -f "\$CANARY" ]]; then break; fi
  sleep 5
done
[[ -f "\$CANARY" ]] || { echo "\$(date -Iseconds) AI_DATA never mounted" >> "\$HOME/Library/Logs/datamatter-refresh-fallback.log"; exit 0; }
exec /bin/zsh "\$RUNNER" "\$@"
WRAP
chmod +x "$SUP/datamatter-refresh-run.sh"
print -P "  %F{green}wrote%f $SUP/datamatter-refresh-run.sh"

# ---- plist ---------------------------------------------------------------------
cat > "$LA/$LABEL.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>$LABEL</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/zsh</string>
        <string>$SUP/datamatter-refresh-run.sh</string>
    </array>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key><string>/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
        <key>DM_PYTHON</key><string>${PY:-python3}</string>
    </dict>
    <key>WatchPaths</key>
    <array><string>/Volumes/AI_DATA/data/usaspending</string></array>
    <key>StartCalendarInterval</key>
    <dict><key>Hour</key><integer>9</integer><key>Minute</key><integer>40</integer></dict>
    <key>RunAtLoad</key><false/>
    <key>ExitTimeOut</key><integer>0</integer>
    <key>ThrottleInterval</key><integer>300</integer>
    <key>Nice</key><integer>10</integer>
    <key>ProcessType</key><string>Background</string>
    <key>StandardOutPath</key><string>/tmp/$LABEL.out</string>
    <key>StandardErrorPath</key><string>/tmp/$LABEL.err</string>
</dict>
</plist>
PLIST
/usr/bin/plutil -lint "$LA/$LABEL.plist" >/dev/null 2>&1 || { print -P "  %F{red}plist malformed%f"; read "?Press return."; exit 1; }

launchctl unload "$LA/$LABEL.plist" >/dev/null 2>&1
launchctl load   "$LA/$LABEL.plist" >/dev/null 2>&1
if launchctl list | grep -q "$LABEL"; then print -P "  %F{green}loaded%f $LABEL"
else print -P "  %F{red}NOT loaded%f $LABEL — see /tmp/$LABEL.err"; fi
TEMPLATES=/Volumes/AI_DATA/apps/agent-server/nightly/launchagents
[[ -d "$TEMPLATES" ]] && cp "$LA/$LABEL.plist" "$TEMPLATES/" 2>/dev/null

echo ""
print -P "%F{cyan}Catching up now%f (the site is behind the warehouse). Runs in the background;"
print -P "it takes several minutes. You can close this window."
launchctl kickstart -k "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || \
  (nohup /bin/zsh "$REPO/scripts/refresh.sh" --force >/dev/null 2>&1 &)
echo ""
print -P "%F{cyan}Watch it%f      tail -f /Volumes/AI_DATA/logs/datamatter-refresh.log"
print -P "%F{cyan}Force a run%f   $REPO/scripts/refresh.sh --force"
print -P "%F{cyan}Check only%f    $REPO/scripts/refresh.sh --dry"
echo ""
read "?Press return to close."

#!/usr/bin/env bash
# Installs cron entries that ping healthchecks.io ONLY when both backend and
# frontend are responding. Schedule: 21:00, 21:30, 22:00, 22:30, 23:00, 23:30,
# and 24:00 (midnight) Monday through Friday.
# Idempotent: safe to run multiple times.

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PING_SCRIPT="$SCRIPT_DIR/ping-if-healthy.sh"
TAG="# fat-premium-hc-ping"

if [ ! -x "$PING_SCRIPT" ]; then
    chmod +x "$PING_SCRIPT"
fi

# The 21:00–23:30 slots (Mon–Fri = weekday 1..5)
LINE1="0,30 21-23 * * 1-5 $PING_SCRIPT >/dev/null 2>&1 $TAG"
# 24:00 Mon–Fri == 00:00 Tue–Sat = weekday 2..6
LINE2="0 0 * * 2-6 $PING_SCRIPT >/dev/null 2>&1 $TAG"

current="$(crontab -l 2>/dev/null || true)"
cleaned="$(printf '%s\n' "$current" | grep -Fv "$TAG" || true)"
new="$(printf '%s\n%s\n%s\n' "$cleaned" "$LINE1" "$LINE2" | awk 'NF')"

printf '%s\n' "$new" | crontab -

echo "Installed cron entries:"
crontab -l | grep -F "$TAG"

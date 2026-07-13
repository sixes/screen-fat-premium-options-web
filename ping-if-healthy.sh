#!/usr/bin/env bash
# Ping healthchecks.io only when BOTH backend (:9188) and frontend (:5173)
# are responding. On failure, ping the /fail endpoint so alerts fire immediately.

PING_URL="https://hc-ping.com/859b7562-4509-4280-a285-be694b045d39"
BACKEND_URL="http://localhost:9188/api/universe"
FRONTEND_URL="http://localhost:5173/"
TIMEOUT=5

check() {
    curl -fsS -o /dev/null -m "$TIMEOUT" "$1"
}

if check "$BACKEND_URL" && check "$FRONTEND_URL"; then
    curl -fsS --retry 2 -m 10 "$PING_URL" >/dev/null 2>&1
    exit 0
else
    curl -fsS --retry 2 -m 10 "$PING_URL/fail" >/dev/null 2>&1
    exit 1
fi

#!/usr/bin/env sh
set -eu

STATUS_URL="${1:-http://127.0.0.1:8788/status}"
INTERVAL_SECONDS="${2:-2}"

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required for status checks." >&2
  exit 2
fi

while true; do
  if output="$(curl -fsS "$STATUS_URL" 2>/dev/null)"; then
    checked="$(printf "%s" "$output" | node -e 'const fs=require("node:fs");const d=JSON.parse(fs.readFileSync(0,"utf8"));const at=(d&&d.heartbeat&&typeof d.heartbeat.checkedAtMs!=="undefined")?d.heartbeat.checkedAtMs:"n/a";console.log("status="+d.status+" checkedAtMs="+at+" active="+d.activeConnections+" total="+d.totalConnections);')"
    now="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
    echo "$now $checked"
  else
    echo "status check failed: unable to reach $STATUS_URL"
  fi
  sleep "$INTERVAL_SECONDS"
done

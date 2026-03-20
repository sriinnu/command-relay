#!/usr/bin/env bash
set -euo pipefail

STATUS_URL="${1:-http://127.0.0.1:8788/status}"
if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required for status checks." >&2
  exit 2
fi

echo "Checking relay status at: $STATUS_URL"
if [ -n "${COMMANDRELAY_RELAY_REQUIRED_TOKEN:-}" ]; then
  curl -fsS -H "Authorization: Bearer ${COMMANDRELAY_RELAY_REQUIRED_TOKEN}" "$STATUS_URL" | cat
else
  curl -fsS "$STATUS_URL" | cat
fi

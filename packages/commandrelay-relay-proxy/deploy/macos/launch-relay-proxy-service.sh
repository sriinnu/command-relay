#!/usr/bin/env sh
set -eu

PACKAGE_ROOT="${1:-}"
ENV_FILE="${2:-}"

if [ -z "$PACKAGE_ROOT" ]; then
  PACKAGE_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
fi

if [ -z "$ENV_FILE" ]; then
  ENV_FILE="$PACKAGE_ROOT/deploy/relay-proxy.env.example"
fi

if [ -f "$ENV_FILE" ]; then
  while IFS= read -r line; do
    trimmed="$(printf "%s" "$line" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
    if [ -z "$trimmed" ] || printf "%s" "$trimmed" | grep -q "^#"; then
      continue
    fi
    key="${trimmed%%=*}"
    value="${trimmed#*=}"
    if [ -n "$key" ]; then
      export "$key=$value"
    fi
  done < "$ENV_FILE"
fi

LISTEN_HOST="${COMMANDRELAY_RELAY_LISTEN_HOST:-127.0.0.1}"
LISTEN_PORT="${COMMANDRELAY_RELAY_LISTEN_PORT:-8788}"
CLI_PATH="$PACKAGE_ROOT/dist/cli.js"

if [ -f "$CLI_PATH" ]; then
  exec "$(command -v node)" "$CLI_PATH" --host "$LISTEN_HOST" --port "$LISTEN_PORT"
fi

exec commandrelay-relay-proxy --host "$LISTEN_HOST" --port "$LISTEN_PORT"


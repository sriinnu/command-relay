#!/usr/bin/env sh
set -eu

exec commandrelay-relay-proxy \
  --host "${COMMANDRELAY_RELAY_LISTEN_HOST:-0.0.0.0}" \
  --port "${COMMANDRELAY_RELAY_LISTEN_PORT:-8788}"

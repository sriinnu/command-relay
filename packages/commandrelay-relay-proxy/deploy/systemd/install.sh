#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "install.sh must run as root (or via sudo)." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACKAGE_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
SYSTEMD_UNIT_SRC="$SCRIPT_DIR/commandrelay-relay-proxy.service"
SYSTEMD_UNIT_DST="/etc/systemd/system/commandrelay-relay-proxy.service"
ENV_SRC="$PACKAGE_DIR/deploy/relay-proxy.env.example"
ENV_DST="/etc/commandrelay-relay-proxy.env"

if ! command -v commandrelay-relay-proxy >/dev/null 2>&1; then
  echo "commandrelay-relay-proxy executable not found in PATH." >&2
  echo "Install globally first: npm install -g @commandrelay/relay-proxy" >&2
  exit 1
fi

if [[ ! -f "$SYSTEMD_UNIT_SRC" ]]; then
  echo "systemd unit template missing: $SYSTEMD_UNIT_SRC" >&2
  exit 1
fi

cp "$SYSTEMD_UNIT_SRC" "$SYSTEMD_UNIT_DST"

if [[ ! -f "$ENV_DST" ]]; then
  cp "$ENV_SRC" "$ENV_DST"
  chmod 600 "$ENV_DST"
  echo "created env file: $ENV_DST"
  echo "edit it before enable/start for secrets/tokens."
else
  echo "env file exists: $ENV_DST"
fi

systemctl daemon-reload
systemctl enable --now commandrelay-relay-proxy.service
systemctl status --no-pager --full commandrelay-relay-proxy.service

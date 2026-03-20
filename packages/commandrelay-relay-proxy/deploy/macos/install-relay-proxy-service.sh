#!/usr/bin/env bash
set -euo pipefail

PACKAGE_ROOT="${1:-$(cd "$(dirname "$0")/../.." && pwd)}"
SERVICE_LABEL="com.commandrelay.relay-proxy"
ENV_FILE="$PACKAGE_ROOT/deploy/relay-proxy.env.example"

if [ "${2:-}" ]; then
  if [ -f "$2" ]; then
    ENV_FILE="$2"
  else
    SERVICE_LABEL="$2"
  fi
fi

if [ "${3:-}" ]; then
  ENV_FILE="$3"
fi

RUN_SCRIPT="$PACKAGE_ROOT/deploy/macos/launch-relay-proxy-service.sh"
PLIST_DIR="$HOME/Library/LaunchAgents"
PLIST_PATH="$PLIST_DIR/$SERVICE_LABEL.plist"
PLIST_TMP="$(mktemp)"

if [ ! -f "$RUN_SCRIPT" ]; then
  echo "run script missing: $RUN_SCRIPT" >&2
  exit 1
fi

if [ ! -f "$ENV_FILE" ]; then
  echo "env file missing: $ENV_FILE" >&2
  echo "pass an existing env file as the second argument (or third to override label)." >&2
  exit 1
fi

if ! command -v launchctl >/dev/null 2>&1; then
  echo "launchctl not available; this script must run on macOS." >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1 && ! command -v commandrelay-relay-proxy >/dev/null 2>&1; then
  echo "Neither node nor commandrelay-relay-proxy are available in PATH." >&2
  echo "Install dependencies (or publish a local dist build) before running this installer." >&2
  exit 1
fi

chmod +x "$RUN_SCRIPT"
mkdir -p "$HOME/Library/Logs"

cat > "$PLIST_TMP" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$SERVICE_LABEL</string>

  <key>ProgramArguments</key>
  <array>
    <string>$RUN_SCRIPT</string>
    <string>$PACKAGE_ROOT</string>
    <string>$ENV_FILE</string>
  </array>

  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>$HOME/Library/Logs/$SERVICE_LABEL.log</string>
  <key>StandardErrorPath</key>
  <string>$HOME/Library/Logs/$SERVICE_LABEL.err</string>

  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>$(printf "%s" "$PATH")</string>
  </dict>
</dict>
</plist>
EOF

mkdir -p "$PLIST_DIR"
cp "$PLIST_TMP" "$PLIST_PATH"
rm "$PLIST_TMP"

echo "installed: $PLIST_PATH"
echo "loading launch service for label: $SERVICE_LABEL"

launchctl unload "$PLIST_PATH" 2>/dev/null || true

if ! launchctl bootstrap "gui/$(id -u)" "$PLIST_PATH"; then
  echo "bootstrap fallback to legacy load path..."
  launchctl load -w "$PLIST_PATH"
fi

launchctl kickstart -k "gui/$(id -u)/$SERVICE_LABEL" || true

echo "status:"
launchctl print "gui/$(id -u)/$SERVICE_LABEL" 2>/dev/null | head -n 40 || launchctl list | grep -F "$SERVICE_LABEL" || true

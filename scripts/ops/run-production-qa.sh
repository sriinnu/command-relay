#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/../.." && pwd)"
ARTIFACT_DIR="${REPO_ROOT}/artifacts"
RELAY_CLI="${REPO_ROOT}/packages/commandrelay-relay-proxy/dist/cli.js"

BATCH_DATE="$(date -u +%Y-%m-%d)"
HOST="127.0.0.1"
PORT="8788"
UPSTREAM="ws://127.0.0.1:8787/ws"
RELAY_PATH="/ws"
HEALTH_PATH="/health"
TOKEN=""
PACKAGE_SELECTOR="@commandrelay/proxy-*,@commandrelay/relay-proxy,@commandrelay/proxy-*"
WATCH_INTERVAL_MS="1500"
RESTART_ON_CHANGE="true"
RUN_SECTIONS=()
SKIP_INSTALL=0

KNOWN_SECTIONS=("deps" "ci" "release" "relay" "smoke")

usage() {
  cat <<'USAGE'
Usage: run-production-qa.sh [options]

General:
  -h, --help
  --section <deps|ci|release|relay|smoke|all>  One or more values, comma separated or repeated
  --batch-date YYYY-MM-DD
  --host <host>
  --port <port>
  --upstream <url>
  --relay-path <path>           default: /ws
  --health-path <path>          default: /health
  --token <value>               optional; generated automatically when omitted
  --package-selector <selector>
  --watch-interval-ms <ms>
  --restart-on-change true|false
  --skip-install

Sections:
  deps    check:all + build:packages + test:packages + verify:consumer-smoke
  ci      ci:check + ci:build + ci:test + ci:all
  release release lockstep/preflight + deterministic validation
  relay   build+test relay package + status endpoint contract probes
  smoke   workspace-by-workspace relay-oriented package tests
USAGE
}

resolve_token() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
    return 0
  fi

  if command -v uuidgen >/dev/null 2>&1; then
    uuidgen | tr '[:upper:]' '[:lower:]' | tr -d '\n'
    return 0
  fi

  date +%s%N | sha256sum | awk '{print $1}'
}

run_command() {
  local label="$1"
  shift
  local -a cmd=("$@")

  printf '\n====================================================\n'
  printf 'RUN: %s\n' "$label"
  printf 'CMD: %s\n' "${cmd[*]}"

  if ! (cd "$REPO_ROOT" && "${cmd[@]}"); then
    printf 'FAIL: %s\n' "$label"
    return 1
  fi

  printf 'PASS: %s\n' "$label"
}

run_if_selected() {
  local section="$1"
  if (( ${#RUN_SECTIONS[@]} == 0 )); then
    return 0
  fi
  if [[ " ${RUN_SECTIONS[*]} " == *" all "* ]]; then
    return 0
  fi
  for target in "${RUN_SECTIONS[@]}"; do
    if [[ "$target" == "$section" ]]; then
      return 0
    fi
  done
  return 1
}

normalize_sections() {
  local -a normalized=()
  local -a deduped=()
  local raw
  local value
  local section
  local found

  for raw in "${RUN_SECTIONS[@]}"; do
    IFS=',' read -r -a values <<< "$raw"
    for value in "${values[@]}"; do
      value="${value//[$'\t\r\n ']/}"
      if [[ -z "$value" ]]; then
        continue
      fi
      found=0
      if [[ "$value" == "all" ]]; then
        normalized=("all")
        break 2
      fi
      for section in "${KNOWN_SECTIONS[@]}"; do
        if [[ "$section" == "$value" ]]; then
          found=1
          break
        fi
      done
      if (( found == 0 )); then
        echo "Unknown section: $value" >&2
        echo "Allowed: deps, ci, release, relay, smoke, all" >&2
        exit 2
      fi
      normalized+=("$value")
    done
  done

  if (( ${#normalized[@]} == 0 )); then
    RUN_SECTIONS=()
  else
    for value in "${normalized[@]}"; do
      found=0
      for section in "${deduped[@]}"; do
        if [[ "$section" == "$value" ]]; then
          found=1
          break
        fi
      done
      if (( found == 0 )); then
        deduped+=("$value")
      fi
    done
    RUN_SECTIONS=("${deduped[@]}")
  fi
}

record_result() {
  local name="$1"
  local result="$2"
  if [[ "$result" == "PASS" ]]; then
    PASSES+=("$name")
  else
    FAILS+=("$name")
  fi
}

cleanup_relay_process() {
  local pid="$1"
  if [[ -z "$pid" ]]; then
    return
  fi
  if kill -0 "$pid" >/dev/null 2>&1; then
    kill "$pid" >/dev/null 2>&1 || true
    wait "$pid" 2>/dev/null || true
  fi
}

assert_command() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Required command not found in PATH: $cmd" >&2
    return 1
  fi
}

probe_endpoint() {
  local url="$1"
  local timeout_s="$2"
  local auth_header="${3:-}"
  local i=1
  while (( i <= timeout_s )); do
    if [[ -n "$auth_header" ]]; then
      if curl -sS -H "$auth_header" "$url" >/dev/null; then
        return 0
      fi
    elif curl -sS "$url" >/dev/null; then
      return 0
    fi
    sleep 1
    ((i += 1))
  done
  return 1
}

probe_relay_endpoints() {
  local health_url="http://$HOST:$PORT$HEALTH_PATH"
  local status_url="http://$HOST:$PORT/status"

  if ! run_command "relay health endpoint" bash -lc "curl -sS -H 'Authorization: Bearer $TOKEN' \"$health_url\" >/dev/null"; then
    return 1
  fi

  if ! run_command "relay status endpoint with token" bash -lc "curl -sS -H 'Authorization: Bearer $TOKEN' \"$status_url\" >/dev/null"; then
    return 1
  fi

  if ! run_command "relay status contract fields" bash -lc "curl -sS -H 'Authorization: Bearer $TOKEN' \"$status_url\" | node -e 'const fs=require(\"node:fs\"); const data=JSON.parse(fs.readFileSync(0,\"utf8\")); if (data.statusContractVersion!==2){process.exit(1);} if (typeof data.configFingerprint!==\"string\" || data.configFingerprint.length===0){process.exit(1);} if (!data.heartbeat || typeof data.heartbeat.checkedAtMs!==\"number\"){process.exit(1);} if (!data.upstream || !data.upstream.rotation || typeof data.upstream.rotation.status!==\"string\"){process.exit(1);}'"; then
    return 1
  fi

  local status_code
  if ! status_code="$(cd "$REPO_ROOT" && curl -sS -o /dev/null -w '%{http_code}' "$status_url")"; then
    echo "Unable to check unauthorized /status endpoint." >&2
    return 1
  fi
  if [[ "$status_code" != "401" ]]; then
    echo "Expected unauthorized /status to return 401, got: $status_code" >&2
    return 1
  fi
}

start_and_probe_relay() {
  local log_file="${ARTIFACT_DIR}/run-production-qa-relay.log"
  local relay_pid=""
  local -a relay_cmd=()

  if ! assert_command curl; then
    return 1
  fi

  if ! assert_command node; then
    return 1
  fi

  if [[ ! -x "$RELAY_CLI" ]]; then
    echo "Relay CLI missing at ${RELAY_CLI}" >&2
    return 1
  fi

  mkdir -p "$ARTIFACT_DIR"
  rm -f "$log_file"

  relay_cmd=(
    env
    COMMANDRELAY_RELAY_REQUIRED_TOKEN="$TOKEN"
    node
    "$RELAY_CLI"
    --host
    "$HOST"
    --port
    "$PORT"
    --upstream
    "$UPSTREAM"
    --relay-path
    "$RELAY_PATH"
    --health-path
    "$HEALTH_PATH"
    --upstream-tls-watch-interval-ms
    "$WATCH_INTERVAL_MS"
    --upstream-tls-restart-on-change
    "$RESTART_ON_CHANGE"
  )

  (
    cd "$REPO_ROOT" || exit 1
    "${relay_cmd[@]}" >"$log_file" 2>&1
  ) &
  relay_pid=$!

  trap 'cleanup_relay_process "$relay_pid"' EXIT

  sleep 1

  if ! kill -0 "$relay_pid" >/dev/null 2>&1; then
    echo "Relay process exited early. Log:" >&2
    sed -n '1,80p' "$log_file" >&2
    return 1
  fi

  if ! probe_endpoint "http://$HOST:$PORT$HEALTH_PATH" 30 "Authorization: Bearer $TOKEN"; then
    echo "Relay health probe timed out." >&2
    tail -n 80 "$log_file" >&2
    return 1
  fi

  if ! probe_relay_endpoints; then
    echo "Relay endpoint probe failed." >&2
    tail -n 120 "$log_file" >&2
    return 1
  fi

  cleanup_relay_process "$relay_pid"
  trap - EXIT
  echo "Relay smoke passed. Log: $log_file"
  return 0
}

phase_deps() {
  run_command "preflight tooling" node -v
  run_command "pnpm version" pnpm -v
  run_command "git status (pre-check)" bash -lc "git status --short"
  run_command "workspace integrity" pnpm run check:all
  run_command "package build" pnpm run build:packages
  run_command "package tests" pnpm run test:packages
  run_command "consumer smoke" pnpm run verify:consumer-smoke
}

phase_ci() {
  run_command "ci:check" pnpm run ci:check
  run_command "ci:build" pnpm run ci:build
  run_command "ci:test" pnpm run ci:test
  run_command "ci:all" pnpm run ci:all
}

phase_release() {
  run_command "lockstep" pnpm run release:proxy:lockstep
  run_command "preflight" pnpm run release:proxy:preflight -- --batch-date "$BATCH_DATE" --package-selector "$PACKAGE_SELECTOR"
  run_command "deterministic validate" pnpm run release:proxy:deterministic-validate -- --with-build
}

phase_smoke() {
  local -a workspaces=(
    "@commandrelay/cli-proxy"
    "@commandrelay/proxy-core"
    "@commandrelay/proxy-agent"
    "@commandrelay/proxy-http-client"
    "@commandrelay/proxy-fetch"
    "@commandrelay/proxy-undici"
    "@commandrelay/proxy-axios"
    "@commandrelay/proxy-got"
    "@commandrelay/proxy-runtime"
    "@commandrelay/relay-proxy"
    "@commandrelay/client"
    "@commandrelay/protocol"
    "@commandrelay/tui"
  )
  local ws

  for ws in "${workspaces[@]}"; do
    run_command "test ${ws}" pnpm --filter "$ws" run test
  done
}

phase_relay() {
  run_command "build relay package" pnpm --filter @commandrelay/relay-proxy run build
  run_command "relay unit tests" pnpm --filter @commandrelay/relay-proxy run test
  if ! start_and_probe_relay; then
    return 1
  fi
}

while [[ "$#" -gt 0 ]]; do
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    --section)
      if [[ -z "${2:-}" ]]; then
        echo "--section requires a value" >&2
        exit 2
      fi
      RUN_SECTIONS+=("$2")
      shift 2
      ;;
    --batch-date)
      BATCH_DATE="${2:?missing --batch-date value}"
      shift 2
      ;;
    --host)
      HOST="${2:?missing --host value}"
      shift 2
      ;;
    --port)
      PORT="${2:?missing --port value}"
      shift 2
      ;;
    --upstream)
      UPSTREAM="${2:?missing --upstream value}"
      shift 2
      ;;
    --relay-path)
      RELAY_PATH="${2:?missing --relay-path value}"
      shift 2
      ;;
    --health-path)
      HEALTH_PATH="${2:?missing --health-path value}"
      shift 2
      ;;
    --token)
      TOKEN="${2:?missing --token value}"
      shift 2
      ;;
    --package-selector)
      PACKAGE_SELECTOR="${2:?missing --package-selector value}"
      shift 2
      ;;
    --watch-interval-ms)
      WATCH_INTERVAL_MS="${2:?missing --watch-interval-ms value}"
      shift 2
      ;;
    --restart-on-change)
      RESTART_ON_CHANGE="${2:?missing --restart-on-change value}"
      shift 2
      ;;
    --skip-install)
      SKIP_INSTALL=1
      shift
      ;;
    *)
      echo "Unknown arg: $1" >&2
      usage
      exit 2
      ;;
  esac
done

normalize_sections

if (( SKIP_INSTALL == 0 )); then
  run_command "pnpm install" pnpm install --frozen-lockfile
fi

PASSES=()
FAILS=()

if [[ -z "${TOKEN}" ]]; then
  TOKEN="$(resolve_token)"
fi

if run_if_selected "deps"; then
  if phase_deps; then
    record_result "deps" "PASS"
  else
    record_result "deps" "FAIL"
  fi
fi

if run_if_selected "ci"; then
  if phase_ci; then
    record_result "ci" "PASS"
  else
    record_result "ci" "FAIL"
  fi
fi

if run_if_selected "release"; then
  if phase_release; then
    record_result "release" "PASS"
  else
    record_result "release" "FAIL"
  fi
fi

if run_if_selected "relay"; then
  if phase_relay; then
    record_result "relay" "PASS"
  else
    record_result "relay" "FAIL"
  fi
fi

if run_if_selected "smoke"; then
  if phase_smoke; then
    record_result "smoke" "PASS"
  else
    record_result "smoke" "FAIL"
  fi
fi

if (( ${#RUN_SECTIONS[@]} == 0 )); then
  RUN_SECTIONS=("all")
fi

cat <<EOF

====================================================
Production QA run summary
Sections run: ${RUN_SECTIONS[*]}
Passes: ${#PASSES[@]}
Fails: ${#FAILS[@]}
====================================================
EOF

if (( ${#PASSES[@]} > 0 )); then
  printf 'PASS: %s\n' "${PASSES[@]}"
fi

if (( ${#FAILS[@]} > 0 )); then
  printf 'FAIL: %s\n' "${FAILS[@]}"
  exit 1
fi

exit 0

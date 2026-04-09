#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./common.sh
source "${SCRIPT_DIR}/common.sh"

usage() {
  cat <<'USAGE'
Usage: scripts/chitragupta/health.sh [options]

Runs practical local diagnostics for chitragupta MCP:
  - dependency checks (node, pnpm, tsx/dist)
  - entrypoint presence
  - MCP self-check (--check)

Options:
  --chitragupta-dir <path>  Path to chitragupta repo (default: ../chitragupta)
  --project <path>          Project path for MCP context (default: terminal root)
  --check-delegation        Run provider readiness preflight
  --delegation-smoke        Run end-to-end delegation smoke check (implies --check-delegation)
  --delegation-provider <id>  Provider override passed to smoke check
  --delegation-timeout-seconds <n>  Smoke timeout override
  -h, --help                Show this help
USAGE
}

CHITRAGUPTA_DIR=""
PROJECT_DIR=""
CHECK_DELEGATION=false
DELEGATION_SMOKE=false
DELEGATION_PROVIDER=""
DELEGATION_TIMEOUT_SECONDS=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --chitragupta-dir)
      CHITRAGUPTA_DIR="${2:-}"
      shift 2
      ;;
    --project)
      PROJECT_DIR="${2:-}"
      shift 2
      ;;
    --check-delegation)
      CHECK_DELEGATION=true
      shift
      ;;
    --delegation-smoke)
      CHECK_DELEGATION=true
      DELEGATION_SMOKE=true
      shift
      ;;
    --delegation-provider)
      CHECK_DELEGATION=true
      DELEGATION_PROVIDER="${2:-}"
      shift 2
      ;;
    --delegation-timeout-seconds)
      CHECK_DELEGATION=true
      DELEGATION_TIMEOUT_SECONDS="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      print_error "Unknown option: $1"
      usage
      exit 2
      ;;
  esac
done

failures=0

if command_exists node; then
  print_info "node: $(command -v node)"
else
  print_error "node is missing."
  failures=$((failures + 1))
fi

if command_exists pnpm; then
  print_info "pnpm: $(command -v pnpm)"
else
  print_error "pnpm is missing."
  failures=$((failures + 1))
fi

if [[ "${failures}" -gt 0 ]]; then
  exit 1
fi

node_major="$(node_major_version)"
if [[ -z "${node_major}" || "${node_major}" -lt 22 ]]; then
  print_error "Node >= 22 required. Found: $(node -v 2>/dev/null || echo unknown)"
  failures=$((failures + 1))
fi

CHITRAGUPTA_DIR="$(resolve_chitragupta_dir "${CHITRAGUPTA_DIR}")"
PROJECT_DIR="$(resolve_project_dir "${PROJECT_DIR}")"
SRC_ENTRY="$(src_entry_path "${CHITRAGUPTA_DIR}")"
DIST_ENTRY="$(dist_entry_path "${CHITRAGUPTA_DIR}")"

if [[ ! -f "${SRC_ENTRY}" ]]; then
  print_error "Missing source entrypoint: ${SRC_ENTRY}"
  failures=$((failures + 1))
fi
if [[ ! -f "${DIST_ENTRY}" ]]; then
  print_warn "Dist entrypoint not found: ${DIST_ENTRY}"
fi

if [[ "${failures}" -gt 0 ]]; then
  exit 1
fi

if tsx_is_available "${CHITRAGUPTA_DIR}"; then
  print_info "Launch mode: tsx source entrypoint."
  export CHITRAGUPTA_MCP_AGENT="${CHITRAGUPTA_MCP_AGENT:-true}"
  export CHITRAGUPTA_MCP_PROJECT="${CHITRAGUPTA_MCP_PROJECT:-${PROJECT_DIR}}"
  diagnostics_log="$(mktemp)"
  if pnpm --dir "${CHITRAGUPTA_DIR}" exec node --import tsx "${SRC_ENTRY}" --check --project "${PROJECT_DIR}" --agent --name terminal 2>&1 | tee "${diagnostics_log}" >&2; then
    if grep -Eq 'FAIL' "${diagnostics_log}"; then
      print_error "MCP diagnostics: FAIL (reported failing checks)"
      failures=$((failures + 1))
    else
      print_info "MCP diagnostics: PASS"
    fi
  else
    print_error "MCP diagnostics: FAIL"
    failures=$((failures + 1))
  fi
  rm -f "${diagnostics_log}"
else
  if [[ -f "${DIST_ENTRY}" ]]; then
    print_warn "tsx missing, using dist entrypoint diagnostics."
    export CHITRAGUPTA_MCP_AGENT="${CHITRAGUPTA_MCP_AGENT:-true}"
    export CHITRAGUPTA_MCP_PROJECT="${CHITRAGUPTA_MCP_PROJECT:-${PROJECT_DIR}}"
    diagnostics_log="$(mktemp)"
    if node "${DIST_ENTRY}" --check --project "${PROJECT_DIR}" --agent --name terminal 2>&1 | tee "${diagnostics_log}" >&2; then
      if grep -Eq 'FAIL' "${diagnostics_log}"; then
        print_error "MCP diagnostics: FAIL (reported failing checks)"
        failures=$((failures + 1))
      else
        print_info "MCP diagnostics: PASS (dist fallback)"
        show_missing_tsx_recovery "${CHITRAGUPTA_DIR}" "${PROJECT_DIR}"
      fi
    else
      print_error "MCP diagnostics: FAIL (dist fallback)"
      failures=$((failures + 1))
    fi
    rm -f "${diagnostics_log}"
  else
    print_error "tsx is missing and no dist entrypoint is available."
    show_missing_tsx_recovery "${CHITRAGUPTA_DIR}" "${PROJECT_DIR}"
    failures=$((failures + 1))
  fi
fi

if [[ "${CHECK_DELEGATION}" == "true" ]]; then
  preflight_cmd=(
    "${SCRIPT_DIR}/delegation-preflight.sh"
    --chitragupta-dir "${CHITRAGUPTA_DIR}"
    --project "${PROJECT_DIR}"
  )

  if [[ "${DELEGATION_SMOKE}" == "true" ]]; then
    preflight_cmd+=(--smoke)
  fi
  if [[ -n "${DELEGATION_PROVIDER}" ]]; then
    preflight_cmd+=(--provider "${DELEGATION_PROVIDER}")
  fi
  if [[ -n "${DELEGATION_TIMEOUT_SECONDS}" ]]; then
    preflight_cmd+=(--timeout-seconds "${DELEGATION_TIMEOUT_SECONDS}")
  fi

  if "${preflight_cmd[@]}"; then
    print_info "Delegation readiness check: PASS"
  else
    print_error "Delegation readiness check: FAIL"
    failures=$((failures + 1))
  fi
fi

if [[ "${failures}" -gt 0 ]]; then
  exit 1
fi

print_info "Health checks completed successfully."

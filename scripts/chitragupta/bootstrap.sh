#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./common.sh
source "${SCRIPT_DIR}/common.sh"

usage() {
  cat <<'USAGE'
Usage: scripts/chitragupta/bootstrap.sh [options]

Checks local chitragupta prerequisites for MCP usage.

Options:
  --chitragupta-dir <path>  Path to chitragupta repo (default: ../chitragupta)
  --project <path>          Project path passed to MCP (default: terminal root)
  --fix                     Run pnpm install if tsx is missing
  -h, --help                Show this help
USAGE
}

CHITRAGUPTA_DIR=""
PROJECT_DIR=""
FIX=false

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
    --fix)
      FIX=true
      shift
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

if ! command_exists node; then
  print_error "node is required but not installed."
  exit 1
fi
if ! command_exists pnpm; then
  print_error "pnpm is required but not installed."
  exit 1
fi

node_major="$(node_major_version)"
if [[ -z "${node_major}" || "${node_major}" -lt 22 ]]; then
  print_error "Node >= 22 is required. Found: $(node -v 2>/dev/null || echo unknown)"
  exit 1
fi

CHITRAGUPTA_DIR="$(resolve_chitragupta_dir "${CHITRAGUPTA_DIR}")"
PROJECT_DIR="$(resolve_project_dir "${PROJECT_DIR}")"
SRC_ENTRY="$(src_entry_path "${CHITRAGUPTA_DIR}")"
DIST_ENTRY="$(dist_entry_path "${CHITRAGUPTA_DIR}")"

if [[ ! -f "${SRC_ENTRY}" ]]; then
  print_error "Missing source MCP entrypoint: ${SRC_ENTRY}"
  exit 1
fi

if tsx_is_available "${CHITRAGUPTA_DIR}"; then
  print_info "tsx dependency check passed."
else
  print_warn "tsx dependency is missing."
  if [[ "${FIX}" == "true" ]]; then
    print_info "Running pnpm install in ${CHITRAGUPTA_DIR}..."
    pnpm --dir "${CHITRAGUPTA_DIR}" install
  fi
fi

if tsx_is_available "${CHITRAGUPTA_DIR}"; then
  print_info "Bootstrap status: ready (tsx launch mode)."
elif [[ -f "${DIST_ENTRY}" ]]; then
  print_warn "Bootstrap status: ready with fallback (dist launch mode)."
  show_missing_tsx_recovery "${CHITRAGUPTA_DIR}" "${PROJECT_DIR}"
else
  print_error "Neither tsx nor dist entrypoint is available."
  show_missing_tsx_recovery "${CHITRAGUPTA_DIR}" "${PROJECT_DIR}"
  exit 1
fi

cat >&2 <<EOF

Next commands:
1) scripts/chitragupta/health.sh --chitragupta-dir "${CHITRAGUPTA_DIR}" --project "${PROJECT_DIR}"
2) scripts/chitragupta/start-mcp.sh --chitragupta-dir "${CHITRAGUPTA_DIR}" --project "${PROJECT_DIR}" --name terminal
EOF

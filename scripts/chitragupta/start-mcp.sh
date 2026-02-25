#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./common.sh
source "${SCRIPT_DIR}/common.sh"

usage() {
  cat <<'USAGE'
Usage: scripts/chitragupta/start-mcp.sh [options] [-- additional-mcp-args]

Starts chitragupta MCP using an EPERM-safe command:
  pnpm exec node --import tsx .../mcp-entry.ts

If tsx is missing, falls back to dist/mcp-entry.js when present.

Options:
  --chitragupta-dir <path>  Path to chitragupta repo (default: ../chitragupta)
  --project <path>          Project path for MCP context (default: terminal root)
  -h, --help                Show this help
USAGE
}

CHITRAGUPTA_DIR=""
PROJECT_DIR=""
EXTRA_ARGS=()

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
    -h|--help)
      usage
      exit 0
      ;;
    --)
      shift
      if [[ $# -gt 0 ]]; then
        EXTRA_ARGS+=("$@")
      fi
      break
      ;;
    *)
      EXTRA_ARGS+=("$1")
      shift
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

CHITRAGUPTA_DIR="$(resolve_chitragupta_dir "${CHITRAGUPTA_DIR}")"
PROJECT_DIR="$(resolve_project_dir "${PROJECT_DIR}")"
SRC_ENTRY="$(src_entry_path "${CHITRAGUPTA_DIR}")"
DIST_ENTRY="$(dist_entry_path "${CHITRAGUPTA_DIR}")"

DEFAULT_ARGS=()
if [[ " ${EXTRA_ARGS[*]} " != *" --stdio "* && " ${EXTRA_ARGS[*]} " != *" --sse "* ]]; then
  DEFAULT_ARGS+=(--stdio)
fi
if [[ " ${EXTRA_ARGS[*]} " != *" --project "* ]]; then
  DEFAULT_ARGS+=(--project "${PROJECT_DIR}")
fi
if [[ " ${EXTRA_ARGS[*]} " != *" --agent "* ]]; then
  DEFAULT_ARGS+=(--agent)
fi
if [[ " ${EXTRA_ARGS[*]} " != *" --name "* ]]; then
  DEFAULT_ARGS+=(--name terminal)
fi

export CHITRAGUPTA_MCP_AGENT="${CHITRAGUPTA_MCP_AGENT:-true}"
export CHITRAGUPTA_MCP_PROJECT="${CHITRAGUPTA_MCP_PROJECT:-${PROJECT_DIR}}"

if tsx_is_available "${CHITRAGUPTA_DIR}"; then
  exec pnpm --dir "${CHITRAGUPTA_DIR}" exec node --import tsx "${SRC_ENTRY}" "${DEFAULT_ARGS[@]}" "${EXTRA_ARGS[@]}"
fi

if [[ -f "${DIST_ENTRY}" ]]; then
  print_warn "tsx missing, falling back to dist entrypoint: ${DIST_ENTRY}"
  exec node "${DIST_ENTRY}" "${DEFAULT_ARGS[@]}" "${EXTRA_ARGS[@]}"
fi

print_error "Cannot start MCP: tsx dependency is missing and dist entrypoint does not exist."
show_missing_tsx_recovery "${CHITRAGUPTA_DIR}" "${PROJECT_DIR}"
exit 1

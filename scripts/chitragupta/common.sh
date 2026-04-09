#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TERMINAL_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

print_info() {
  printf '[INFO] %s\n' "$*" >&2
}

print_warn() {
  printf '[WARN] %s\n' "$*" >&2
}

print_error() {
  printf '[ERROR] %s\n' "$*" >&2
}

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

canonical_dir() {
  local dir="$1"
  if [[ -d "${dir}" ]]; then
    (cd "${dir}" && pwd)
    return 0
  fi
  return 1
}

resolve_chitragupta_dir() {
  local requested="${1:-}"
  if [[ -z "${requested}" ]]; then
    requested="${CHITRAGUPTA_DIR:-${TERMINAL_ROOT}/../chitragupta}"
  fi

  if ! canonical_dir "${requested}"; then
    print_error "Chitragupta directory not found: ${requested}"
    return 1
  fi
}

resolve_project_dir() {
  local requested="${1:-}"
  if [[ -z "${requested}" ]]; then
    requested="${CHITRAGUPTA_MCP_PROJECT:-${TERMINAL_ROOT}}"
  fi

  if ! canonical_dir "${requested}"; then
    print_error "Project directory not found: ${requested}"
    return 1
  fi
}

node_major_version() {
  local node_version
  node_version="$(node -v 2>/dev/null || true)"
  node_version="${node_version#v}"
  echo "${node_version%%.*}"
}

src_entry_path() {
  local chitragupta_dir="$1"
  echo "${chitragupta_dir}/packages/cli/src/mcp-entry.ts"
}

dist_entry_path() {
  local chitragupta_dir="$1"
  echo "${chitragupta_dir}/packages/cli/dist/mcp-entry.js"
}

cli_src_entry_path() {
  local chitragupta_dir="$1"
  echo "${chitragupta_dir}/packages/cli/src/cli.ts"
}

cli_dist_entry_path() {
  local chitragupta_dir="$1"
  echo "${chitragupta_dir}/packages/cli/dist/cli.js"
}

tsx_is_available() {
  local chitragupta_dir="$1"
  pnpm --dir "${chitragupta_dir}" exec node -p "require.resolve('tsx/package.json')" >/dev/null 2>&1
}

nonempty_env_var() {
  local name="$1"
  local value="${!name:-}"
  [[ -n "${value//[[:space:]]/}" ]]
}

is_numeric() {
  local value="$1"
  [[ "${value}" =~ ^[0-9]+$ ]]
}

validate_numeric_range() {
  local label="$1"
  local value="$2"
  local min="$3"
  local max="$4"

  if ! is_numeric "${value}"; then
    print_error "${label} must be numeric. Found: ${value}"
    return 1
  fi

  if (( value < min || value > max )); then
    print_error "${label} must be in range ${min}-${max}. Found: ${value}"
    return 1
  fi
}

show_missing_tsx_recovery() {
  local chitragupta_dir="$1"
  local project_dir="$2"
  local start_script="${SCRIPT_DIR}/start-mcp.sh"

  cat >&2 <<EOF
tsx dependency is missing from ${chitragupta_dir}.

Recovery path to restore MCP agent capabilities (February 25, 2026):
1) cd "${chitragupta_dir}"
2) pnpm install
3) pnpm exec node -p "require.resolve('tsx/package.json')"
4) "${start_script}" --chitragupta-dir "${chitragupta_dir}" --project "${project_dir}" --name terminal

If step 3 still fails, install tsx explicitly:
5) cd "${chitragupta_dir}"
6) pnpm add -D tsx
7) pnpm exec node -p "require.resolve('tsx/package.json')"
8) "${start_script}" --chitragupta-dir "${chitragupta_dir}" --project "${project_dir}" --name terminal
EOF
}

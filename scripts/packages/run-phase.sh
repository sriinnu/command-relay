#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
PACKAGES_DIR="${REPO_ROOT}/packages"

usage() {
  cat <<'USAGE'
Usage: scripts/packages/run-phase.sh <phase> [--include-root] [--root-script <script_name>]

Runs `npm run <phase>` for every package directory under packages/* that has a package.json.

Options:
  --include-root         Run an npm script in the repository root before package runs.
  --root-script <name>   Script to run in root when --include-root is set (default: <phase>).
USAGE
}

run_npm_script() {
  local workdir="$1"
  local label="$2"
  local script_name="$3"

  echo "==> [${label}] npm run ${script_name}"
  if (cd "${workdir}" && npm run "${script_name}"); then
    echo "<== [${label}] PASS"
    return 0
  fi

  echo "<== [${label}] FAIL" >&2
  return 1
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

PHASE="${1:-}"
if [[ -z "${PHASE}" ]]; then
  usage
  exit 2
fi
shift

INCLUDE_ROOT=0
ROOT_SCRIPT="${PHASE}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --include-root)
      INCLUDE_ROOT=1
      shift
      ;;
    --root-script)
      if [[ $# -lt 2 ]]; then
        echo "Missing value for --root-script" >&2
        usage
        exit 2
      fi
      ROOT_SCRIPT="$2"
      shift 2
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      exit 2
      ;;
  esac
done

if [[ ! -d "${PACKAGES_DIR}" ]]; then
  echo "Packages directory not found: ${PACKAGES_DIR}" >&2
  exit 1
fi

status=0
if [[ "${INCLUDE_ROOT}" -eq 1 ]]; then
  if ! run_npm_script "${REPO_ROOT}" "root" "${ROOT_SCRIPT}"; then
    status=1
  fi
fi

mapfile -t package_dirs < <(find "${PACKAGES_DIR}" -mindepth 1 -maxdepth 1 -type d | LC_ALL=C sort)

for package_dir in "${package_dirs[@]}"; do
  if [[ ! -f "${package_dir}/package.json" ]]; then
    continue
  fi

  package_name="$(basename "${package_dir}")"
  if ! run_npm_script "${package_dir}" "${package_name}" "${PHASE}"; then
    status=1
  fi
done

exit "${status}"

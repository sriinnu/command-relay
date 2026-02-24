#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
TARGET_RUNNER="${SCRIPT_DIR}/ci-test-target.sh"

usage() {
  cat <<'USAGE'
Usage: scripts/ci-test-all.sh [tap_output_dir]

Runs deterministic TAP test execution for:
  root
  proxy-core
  proxy-agent
  proxy-http-client
USAGE
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if [[ ! -x "${TARGET_RUNNER}" ]]; then
  chmod +x "${TARGET_RUNNER}"
fi

TAP_OUTPUT_DIR="${1:-${REPO_ROOT}/.ci-artifacts/tap}"
mkdir -p "${TAP_OUTPUT_DIR}"

targets=(
  "root"
  "proxy-core"
  "proxy-agent"
  "proxy-http-client"
)

status=0
for target in "${targets[@]}"; do
  tap_file="${TAP_OUTPUT_DIR}/${target}.tap"
  if ! "${TARGET_RUNNER}" "${target}" "${tap_file}"; then
    status=1
  fi
done

if [[ "${status}" -eq 0 ]]; then
  echo "All test targets passed. TAP files are in ${TAP_OUTPUT_DIR}"
else
  echo "One or more test targets failed. TAP files are in ${TAP_OUTPUT_DIR}" >&2
fi

exit "${status}"

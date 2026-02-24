#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

usage() {
  cat <<'USAGE'
Usage: scripts/ci-test-target.sh <target> [tap_file]

Targets:
  root
  proxy-core
  proxy-agent
  proxy-http-client
USAGE
}

set_deterministic_env() {
  # CI defaults chosen to keep logs and test scheduling stable across runners.
  export CI=1
  export TZ=UTC
  export LANG=C
  export LC_ALL=C
  export NO_COLOR=1
  export FORCE_COLOR=0
  export npm_config_audit=false
  export npm_config_fund=false
}

write_failure_tap() {
  local tap_file="$1"
  local test_name="$2"
  local reason="$3"
  local log_file="$4"

  {
    echo "TAP version 13"
    echo "1..1"
    echo "not ok 1 - ${test_name}"
    echo "  ---"
    echo "  message: ${reason}"
    echo "  ..."
    if [[ -s "${log_file}" ]]; then
      sed 's/^/# /' "${log_file}"
    fi
  } >"${tap_file}"
}

run_node_tap() {
  local workdir="$1"
  local tap_file="$2"
  shift 2

  (
    cd "${workdir}"
    node "$@"
  ) >"${tap_file}" 2>&1
}

run_root() {
  local tap_file="$1"
  run_node_tap \
    "${REPO_ROOT}" \
    "${tap_file}" \
    --test \
    --import tsx \
    --test-reporter=tap \
    --test-concurrency=1 \
    src/net/proxy-router.test.ts \
    src/net/proxy-agent-factory.test.ts
}

run_proxy_core() {
  local tap_file="$1"
  local pkg_dir="${REPO_ROOT}/packages/proxy-core"
  local -a test_files=()
  local log_file
  log_file="$(mktemp)"

  mapfile -t test_files < <(
    cd "${pkg_dir}"
    find test -type f -name '*.test.ts' | LC_ALL=C sort
  )

  if [[ "${#test_files[@]}" -eq 0 ]]; then
    echo "No TypeScript tests found in ${pkg_dir}/test" >"${log_file}"
    write_failure_tap "${tap_file}" "proxy-core tests" "No test files matched." "${log_file}"
    rm -f "${log_file}"
    return 1
  fi

  rm -f "${log_file}"
  run_node_tap \
    "${pkg_dir}" \
    "${tap_file}" \
    --test \
    --import tsx \
    --test-reporter=tap \
    --test-concurrency=1 \
    "${test_files[@]}"
}

run_proxy_agent() {
  local tap_file="$1"
  local pkg_dir="${REPO_ROOT}/packages/proxy-agent"
  local -a test_files=()
  local log_file
  log_file="$(mktemp)"

  mapfile -t test_files < <(
    cd "${pkg_dir}"
    find test -type f -name '*.test.ts' | LC_ALL=C sort
  )

  if [[ "${#test_files[@]}" -eq 0 ]]; then
    echo "No TypeScript tests found in ${pkg_dir}/test" >"${log_file}"
    write_failure_tap "${tap_file}" "proxy-agent tests" "No test files matched." "${log_file}"
    rm -f "${log_file}"
    return 1
  fi

  rm -f "${log_file}"
  run_node_tap \
    "${pkg_dir}" \
    "${tap_file}" \
    --test \
    --import tsx \
    --test-reporter=tap \
    --test-concurrency=1 \
    "${test_files[@]}"
}

run_proxy_http_client() {
  local tap_file="$1"
  local pkg_dir="${REPO_ROOT}/packages/proxy-http-client"
  local build_dir="${pkg_dir}/.test-dist"
  local tsc_bin="${REPO_ROOT}/node_modules/.bin/tsc"
  local compile_log
  local log_file
  local -a compiled_tests=()
  local status=0
  compile_log="$(mktemp)"
  log_file="$(mktemp)"

  if [[ ! -x "${tsc_bin}" ]]; then
    echo "TypeScript compiler not found at ${tsc_bin}" >"${log_file}"
    write_failure_tap "${tap_file}" "proxy-http-client compile" "Compiler not available." "${log_file}"
    rm -f "${compile_log}" "${log_file}"
    rm -rf "${build_dir}"
    return 1
  fi

  rm -rf "${build_dir}"
  if ! (
    cd "${pkg_dir}"
    "${tsc_bin}" -p tsconfig.json --noEmit false --outDir .test-dist
  ) >"${compile_log}" 2>&1; then
    write_failure_tap "${tap_file}" "proxy-http-client compile" "TypeScript compile failed." "${compile_log}"
    rm -f "${compile_log}" "${log_file}"
    rm -rf "${build_dir}"
    return 1
  fi

  mapfile -t compiled_tests < <(
    cd "${pkg_dir}"
    find .test-dist/test -type f -name '*.test.js' | LC_ALL=C sort
  )

  if [[ "${#compiled_tests[@]}" -eq 0 ]]; then
    echo "No compiled test files found under ${build_dir}/test" >"${log_file}"
    write_failure_tap "${tap_file}" "proxy-http-client tests" "No compiled tests matched." "${log_file}"
    rm -f "${compile_log}" "${log_file}"
    rm -rf "${build_dir}"
    return 1
  fi

  if run_node_tap \
    "${pkg_dir}" \
    "${tap_file}" \
    --test \
    --test-reporter=tap \
    --test-concurrency=1 \
    "${compiled_tests[@]}"; then
    status=0
  else
    status=$?
  fi

  rm -f "${compile_log}" "${log_file}"
  rm -rf "${build_dir}"
  return "${status}"
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

TARGET="${1:-}"
if [[ -z "${TARGET}" ]]; then
  usage
  exit 2
fi

TAP_FILE="${2:-${REPO_ROOT}/.ci-artifacts/tap/${TARGET}.tap}"
mkdir -p "$(dirname "${TAP_FILE}")"

set_deterministic_env

status=0
case "${TARGET}" in
  root)
    if run_root "${TAP_FILE}"; then
      :
    else
      status=$?
    fi
    ;;
  proxy-core)
    if run_proxy_core "${TAP_FILE}"; then
      :
    else
      status=$?
    fi
    ;;
  proxy-agent)
    if run_proxy_agent "${TAP_FILE}"; then
      :
    else
      status=$?
    fi
    ;;
  proxy-http-client)
    if run_proxy_http_client "${TAP_FILE}"; then
      :
    else
      status=$?
    fi
    ;;
  *)
    echo "Unknown target: ${TARGET}" >&2
    usage
    exit 2
    ;;
esac

if [[ "${status}" -eq 0 ]]; then
  echo "[PASS] ${TARGET} -> ${TAP_FILE}"
else
  echo "[FAIL] ${TARGET} -> ${TAP_FILE}" >&2
fi

exit "${status}"

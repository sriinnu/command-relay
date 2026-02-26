#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

usage() {
  cat <<'USAGE'
Usage: scripts/ci-test-target.sh <target> [tap_file]

Targets:
  root
  web-smoke
  proxy-core
  proxy-agent
  proxy-http-client

Optional environment variables:
  WEB_SMOKE_DIR   Relative or absolute path to the web app root for web-smoke target.
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

write_skip_tap() {
  local tap_file="$1"
  local reason="$2"

  {
    echo "TAP version 13"
    echo "1..0 # SKIP ${reason}"
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

run_web_smoke() {
  local tap_file="$1"
  local web_root_override="${WEB_SMOKE_DIR:-}"
  local web_root=""
  local first_existing_web_root=""
  local candidate_root=""
  local syntax_log
  local log_file
  local syntax_status=0
  local -a candidate_roots=(
    "apps/web"
    "web"
    "frontend"
    "ui"
  )
  local -a web_source_files=()
  local -a js_files=()

  syntax_log="$(mktemp)"
  log_file="$(mktemp)"

  if [[ -n "${web_root_override}" ]]; then
    if [[ "${web_root_override}" = /* ]]; then
      web_root="${web_root_override}"
    else
      web_root="${REPO_ROOT}/${web_root_override}"
    fi

    if [[ ! -d "${web_root}" ]]; then
      echo "WEB_SMOKE_DIR points to a missing directory: ${web_root}" >"${log_file}"
      write_failure_tap "${tap_file}" "web smoke" "Configured web app directory is missing." "${log_file}"
      rm -f "${syntax_log}" "${log_file}"
      return 1
    fi
  else
    for rel_root in "${candidate_roots[@]}"; do
      candidate_root="${REPO_ROOT}/${rel_root}"
      if [[ ! -d "${candidate_root}" ]]; then
        continue
      fi

      if [[ -z "${first_existing_web_root}" ]]; then
        first_existing_web_root="${candidate_root}"
      fi

      if find "${candidate_root}" \
        -type f \
        \( \
        -name '*.html' -o \
        -name '*.css' -o \
        -name '*.js' -o \
        -name '*.mjs' -o \
        -name '*.cjs' -o \
        -name '*.ts' -o \
        -name '*.tsx' -o \
        -name '*.jsx' \
        \) \
        ! -path '*/node_modules/*' \
        ! -path '*/dist/*' \
        ! -path '*/build/*' \
        ! -path '*/coverage/*' \
        ! -path '*/.next/*' \
        ! -path '*/.nuxt/*' \
        ! -path '*/.svelte-kit/*' \
        -print -quit | grep -q .; then
        web_root="${candidate_root}"
        break
      fi
    done

    if [[ -z "${web_root}" ]]; then
      web_root="${first_existing_web_root}"
    fi
  fi

  if [[ -z "${web_root}" ]]; then
    write_skip_tap "${tap_file}" "no web app directory detected"
    rm -f "${syntax_log}" "${log_file}"
    return 0
  fi

  mapfile -t web_source_files < <(
    find "${web_root}" \
      -type d \
      \( \
      -name node_modules -o \
      -name dist -o \
      -name build -o \
      -name coverage -o \
      -name .next -o \
      -name .nuxt -o \
      -name .svelte-kit \
      \) -prune -o \
      -type f \
      \( \
      -name '*.html' -o \
      -name '*.css' -o \
      -name '*.js' -o \
      -name '*.mjs' -o \
      -name '*.cjs' -o \
      -name '*.ts' -o \
      -name '*.tsx' -o \
      -name '*.jsx' \
      \) -print | LC_ALL=C sort
  )

  if [[ "${#web_source_files[@]}" -eq 0 ]]; then
    echo "No web source files found under ${web_root}" >"${log_file}"
    write_failure_tap "${tap_file}" "web smoke" "No web source files matched." "${log_file}"
    rm -f "${syntax_log}" "${log_file}"
    return 1
  fi

  mapfile -t js_files < <(
    find "${web_root}" \
      -type d \
      \( \
      -name node_modules -o \
      -name dist -o \
      -name build -o \
      -name coverage -o \
      -name .next -o \
      -name .nuxt -o \
      -name .svelte-kit \
      \) -prune -o \
      -type f \
      \( \
      -name '*.js' -o \
      -name '*.mjs' -o \
      -name '*.cjs' \
      \) -print | LC_ALL=C sort
  )

  if [[ "${#js_files[@]}" -eq 0 ]]; then
    {
      echo "TAP version 13"
      echo "1..1"
      echo "ok 1 - web smoke"
      echo "  ---"
      echo "  message: Found ${#web_source_files[@]} web files under ${web_root}; no JS files to syntax-check."
      echo "  ..."
    } >"${tap_file}"

    rm -f "${syntax_log}" "${log_file}"
    return 0
  fi

  for js_file in "${js_files[@]}"; do
    if ! node --check "${js_file}" >>"${syntax_log}" 2>&1; then
      syntax_status=1
    fi
  done

  if [[ "${syntax_status}" -ne 0 ]]; then
    {
      echo "JavaScript syntax validation failed under ${web_root}"
      echo "Checked files: ${#js_files[@]}"
      cat "${syntax_log}"
    } >"${log_file}"
    write_failure_tap "${tap_file}" "web smoke syntax" "JavaScript syntax check failed." "${log_file}"
    rm -f "${syntax_log}" "${log_file}"
    return 1
  fi

  {
    echo "TAP version 13"
    echo "1..1"
    echo "ok 1 - web smoke"
    echo "  ---"
    echo "  message: Found ${#web_source_files[@]} web files under ${web_root}; syntax-checked ${#js_files[@]} JS files."
    echo "  ..."
  } >"${tap_file}"

  rm -f "${syntax_log}" "${log_file}"
  return 0
}

run_root() {
  local tap_file="$1"
  local -a test_files=()
  local log_file
  log_file="$(mktemp)"

  mapfile -t test_files < <(
    cd "${REPO_ROOT}"
    find src -type f -name '*.test.ts' | LC_ALL=C sort
  )

  if [[ "${#test_files[@]}" -eq 0 ]]; then
    echo "No TypeScript tests found under ${REPO_ROOT}/src" >"${log_file}"
    write_failure_tap "${tap_file}" "root tests" "No test files matched." "${log_file}"
    rm -f "${log_file}"
    return 1
  fi

  rm -f "${log_file}"
  run_node_tap \
    "${REPO_ROOT}" \
    "${tap_file}" \
    --test \
    --import tsx \
    --test-reporter=tap \
    --test-concurrency=1 \
    "${test_files[@]}"
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
if case "${TARGET}" in
  root) run_root "${TAP_FILE}" ;;
  web-smoke) run_web_smoke "${TAP_FILE}" ;;
  proxy-core) run_proxy_core "${TAP_FILE}" ;;
  proxy-agent) run_proxy_agent "${TAP_FILE}" ;;
  proxy-http-client) run_proxy_http_client "${TAP_FILE}" ;;
  *)
    echo "Unknown target: ${TARGET}" >&2
    usage
    exit 2
    ;;
esac; then
  status=0
else
  status=$?
fi

if [[ "${status}" -eq 0 ]]; then
  echo "[PASS] ${TARGET} -> ${TAP_FILE}"
else
  echo "[FAIL] ${TARGET} -> ${TAP_FILE}" >&2
fi

exit "${status}"

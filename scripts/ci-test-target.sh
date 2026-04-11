#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
NODE_CMD=(pnpm exec node)
TSX_CMD=(pnpm exec tsx)

usage() {
  cat <<'USAGE'
Usage: scripts/ci-test-target.sh <target> [tap_file]

Targets:
  root
  web-smoke
  package:<package-dir>
  proxy-core (legacy alias for package:proxy-core)
  proxy-agent (legacy alias for package:proxy-agent)
  proxy-http-client (legacy alias for package:proxy-http-client)

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

package_has_script() {
  local package_json="$1"
  local script_name="$2"
  local package_dir
  local package_file

  package_dir="$(dirname "${package_json}")"
  package_file="$(basename "${package_json}")"

  (
    cd "${package_dir}"
    "${NODE_CMD[@]}" -e '
const fs = require("node:fs");
const pkg = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const scripts = pkg.scripts ?? {};
process.exit(Object.prototype.hasOwnProperty.call(scripts, process.argv[2]) ? 0 : 1);
' "${package_file}" "${script_name}"
  )
}

read_package_name() {
  local package_json="$1"
  local package_dir
  local package_file

  package_dir="$(dirname "${package_json}")"
  package_file="$(basename "${package_json}")"

  (
    cd "${package_dir}"
    "${NODE_CMD[@]}" -e '
const fs = require("node:fs");
const pkg = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
if (typeof pkg.name === "string" && pkg.name.length > 0) {
  process.stdout.write(pkg.name);
  process.exit(0);
}
process.stdout.write("unknown-package");
' "${package_file}"
  )
}

run_node_tap() {
  local workdir="$1"
  local tap_file="$2"
  shift 2

  (
    cd "${workdir}"
    "${NODE_CMD[@]}" "$@"
  ) >"${tap_file}" 2>&1
}

run_tsx_tap() {
  local workdir="$1"
  local tap_file="$2"
  shift 2

  (
    cd "${workdir}"
    "${TSX_CMD[@]}" "$@"
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

  web_source_files=()
  while IFS= read -r web_source_file; do
    web_source_files+=("${web_source_file}")
  done < <(
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

  js_files=()
  while IFS= read -r js_file; do
    js_files+=("${js_file}")
  done < <(
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
    relative_js_file="${js_file#"${web_root}/"}"
    if ! (
      cd "${web_root}"
      "${NODE_CMD[@]}" --check "${relative_js_file}"
    ) >>"${syntax_log}" 2>&1; then
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

  test_files=()
  while IFS= read -r test_file; do
    test_files+=("${test_file}")
  done < <(
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
  run_tsx_tap \
    "${REPO_ROOT}" \
    "${tap_file}" \
    --test \
    --test-reporter=tap \
    --test-concurrency=1 \
    "${test_files[@]}"
}

run_package_test() {
  local tap_file="$1"
  local package_dir_name="$2"
  local pkg_dir="${REPO_ROOT}/packages/${package_dir_name}"
  local package_json="${pkg_dir}/package.json"
  local package_name
  local log_file
  log_file="$(mktemp)"

  if [[ ! "${package_dir_name}" =~ ^[a-zA-Z0-9._-]+$ ]]; then
    echo "Invalid package directory selector: ${package_dir_name}" >"${log_file}"
    write_failure_tap "${tap_file}" "package tests" "Invalid package selector." "${log_file}"
    rm -f "${log_file}"
    return 1
  fi

  if [[ ! -f "${package_json}" ]]; then
    echo "Missing package.json: ${package_json}" >"${log_file}"
    write_failure_tap "${tap_file}" "package tests" "Package definition not found." "${log_file}"
    rm -f "${log_file}"
    return 1
  fi

  package_name="$(read_package_name "${package_json}")"

  if ! package_has_script "${package_json}" "test"; then
    write_skip_tap "${tap_file}" "${package_name} does not define a test script"
    rm -f "${log_file}"
    return 0
  fi

  if (cd "${pkg_dir}" && pnpm run test) >"${log_file}" 2>&1; then
    {
      echo "TAP version 13"
      echo "1..1"
      echo "ok 1 - ${package_name} tests"
      echo "  ---"
      echo "  message: pnpm run test passed in packages/${package_dir_name}"
      echo "  ..."
    } >"${tap_file}"
    rm -f "${log_file}"
    return 0
  else
    write_failure_tap "${tap_file}" "${package_name} tests" "pnpm run test failed." "${log_file}"
    rm -f "${log_file}"
    return 1
  fi
}

normalize_target() {
  local target="$1"

  case "${target}" in
    proxy-core|proxy-agent|proxy-http-client)
      printf 'package:%s\n' "${target}"
      return 0
      ;;
    *)
      printf '%s\n' "${target}"
      return 0
      ;;
  esac
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
TARGET="$(normalize_target "${TARGET}")"
TARGET_FILE_ID="${TARGET//:/-}"

TAP_FILE="${2:-${REPO_ROOT}/.ci-artifacts/tap/${TARGET_FILE_ID}.tap}"
mkdir -p "$(dirname "${TAP_FILE}")"

set_deterministic_env

status=0
if case "${TARGET}" in
  root) run_root "${TAP_FILE}" ;;
  web-smoke) run_web_smoke "${TAP_FILE}" ;;
  package:*)
    run_package_test "${TAP_FILE}" "${TARGET#package:}"
    ;;
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

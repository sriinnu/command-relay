#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
SAFETY_GATE_SCRIPT="${SCRIPT_DIR}/safety-gate.sh"

RUN_CHECK=1
RUN_TEST=1
RUN_BUILD=0
KEEP_CREDENTIALS=0

usage() {
  cat <<'USAGE'
Usage: scripts/release/deterministic-validate.sh [options]

Run reproducible check/test validation with credential scrubbing enabled by default.

Options:
  --skip-check          Skip `npm run ci:check`
  --skip-test           Skip `npm run ci:test`
  --with-build          Also run `npm run ci:build`
  --keep-credentials    Do not unset cloud/provider credentials
  --help, -h            Show this help

Examples:
  scripts/release/deterministic-validate.sh
  scripts/release/deterministic-validate.sh --with-build
  scripts/release/deterministic-validate.sh --skip-check --with-build
USAGE
}

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

require_command() {
  local command_name="$1"
  command -v "${command_name}" >/dev/null 2>&1 || die "required command not found: ${command_name}"
}

set_deterministic_env() {
  umask 022
  export CI=1
  export TZ=UTC
  export LANG=C
  export LC_ALL=C
  export NO_COLOR=1
  export FORCE_COLOR=0
  export npm_config_audit=false
  export npm_config_fund=false
  export npm_config_update_notifier=false
  export npm_config_progress=false
  export SOURCE_DATE_EPOCH="${SOURCE_DATE_EPOCH:-1704067200}"
  export COMMANDRELAY_DETERMINISTIC_VALIDATION=1
}

unset_cloud_provider_credentials() {
  local unset_count=0
  local var_name=""
  local -a credential_vars=(
    AWS_ACCESS_KEY_ID
    AWS_SECRET_ACCESS_KEY
    AWS_SESSION_TOKEN
    AWS_PROFILE
    AWS_DEFAULT_PROFILE
    AWS_SHARED_CREDENTIALS_FILE
    AWS_CONFIG_FILE
    CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE
    GOOGLE_APPLICATION_CREDENTIALS
    GOOGLE_CLOUD_PROJECT
    GCP_PROJECT
    AZURE_CLIENT_ID
    AZURE_CLIENT_SECRET
    AZURE_TENANT_ID
    AZURE_SUBSCRIPTION_ID
    OPENAI_API_KEY
    ANTHROPIC_API_KEY
    GEMINI_API_KEY
    GOOGLE_API_KEY
    MISTRAL_API_KEY
    GROQ_API_KEY
    COHERE_API_KEY
    HF_TOKEN
    HUGGINGFACEHUB_API_TOKEN
    NPM_TOKEN
    GH_TOKEN
    GITHUB_TOKEN
    SENTRY_AUTH_TOKEN
  )

  for var_name in "${credential_vars[@]}"; do
    if [[ -n "${!var_name-}" ]]; then
      unset_count=$((unset_count + 1))
    fi
    unset "${var_name}" || true
  done

  printf 'credential scrub: unset %d known credential variables\n' "${unset_count}"
}

run_step() {
  local step_name="$1"
  shift
  local -a cmd=("$@")

  printf 'run: %s\n' "${step_name}"
  printf 'cmd: %s\n' "${cmd[*]}"

  if [[ -x "${SAFETY_GATE_SCRIPT}" ]]; then
    "${SAFETY_GATE_SCRIPT}" --quiet "${cmd[@]}"
  fi

  (
    cd "${REPO_ROOT}"
    "${cmd[@]}"
  )
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-check)
      RUN_CHECK=0
      shift
      ;;
    --skip-test)
      RUN_TEST=0
      shift
      ;;
    --with-build)
      RUN_BUILD=1
      shift
      ;;
    --keep-credentials)
      KEEP_CREDENTIALS=1
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      die "unknown argument: $1"
      ;;
  esac
done

if [[ "${RUN_CHECK}" -ne 1 && "${RUN_TEST}" -ne 1 && "${RUN_BUILD}" -ne 1 ]]; then
  die "nothing to run: enable at least one pipeline"
fi

[[ -f "${REPO_ROOT}/package.json" ]] || die "package.json not found at repo root: ${REPO_ROOT}"
require_command npm
require_command node

set_deterministic_env

if [[ "${KEEP_CREDENTIALS}" -eq 1 ]]; then
  printf 'credential scrub: skipped (--keep-credentials)\n'
else
  unset_cloud_provider_credentials
fi

if [[ "${RUN_CHECK}" -eq 1 ]]; then
  run_step "ci:check" npm run ci:check
fi

if [[ "${RUN_BUILD}" -eq 1 ]]; then
  run_step "ci:build" npm run ci:build
fi

if [[ "${RUN_TEST}" -eq 1 ]]; then
  run_step "ci:test" npm run ci:test
fi

printf 'deterministic validation complete\n'

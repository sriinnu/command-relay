#!/usr/bin/env bash
set -euo pipefail

readonly EXIT_OK=0
readonly EXIT_USAGE=2
readonly EXIT_RUNTIME=1

BATCH_DATE="$(date -u +%F)"
REPO_SLUG="sriinnu/command-relay"
DEFAULT_BRANCH="main"
ARTIFACT_DIR=""

usage() {
  cat <<'USAGE'
Capture governance evidence artifacts required by release preflight.

Usage:
  scripts/release/capture-governance-evidence.sh [options]

Options:
      --batch-date <YYYY-MM-DD>      Batch date (default: current UTC date)
      --repo <owner/repo>            Repository slug (default: sriinnu/command-relay)
      --default-branch <branch>      Branch for protection evidence (default: main)
      --artifact-dir <path>          Output dir (default: artifacts/<batch>-proxy-publish-governance)
  -h, --help                         Show this help

Output files:
  npm-token-presence.txt
  npm-publish-environment.txt
  default-branch-protection.json
USAGE
}

die_usage() {
  printf 'error: %s\n' "$*" >&2
  exit "$EXIT_USAGE"
}

require_value() {
  local flag="$1"
  local value="${2:-}"
  if [[ -z "$value" || "$value" == -* ]]; then
    die_usage "${flag} requires a value"
  fi
}

while (($# > 0)); do
  case "$1" in
    --batch-date)
      require_value "$1" "${2:-}"
      BATCH_DATE="$2"
      shift 2
      ;;
    --repo)
      require_value "$1" "${2:-}"
      REPO_SLUG="$2"
      shift 2
      ;;
    --default-branch)
      require_value "$1" "${2:-}"
      DEFAULT_BRANCH="$2"
      shift 2
      ;;
    --artifact-dir)
      require_value "$1" "${2:-}"
      ARTIFACT_DIR="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit "$EXIT_OK"
      ;;
    *)
      die_usage "unknown argument: $1"
      ;;
  esac
done

if [[ ! "$BATCH_DATE" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
  die_usage "--batch-date must match YYYY-MM-DD"
fi

if [[ -z "$ARTIFACT_DIR" ]]; then
  ARTIFACT_DIR="artifacts/${BATCH_DATE}-proxy-publish-governance"
fi

if ! command -v gh >/dev/null 2>&1; then
  printf 'error: gh CLI is required\n' >&2
  exit "$EXIT_RUNTIME"
fi
if ! command -v node >/dev/null 2>&1; then
  printf 'error: node is required\n' >&2
  exit "$EXIT_RUNTIME"
fi

mkdir -p "$ARTIFACT_DIR"

TMP_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

NOW_UTC="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

run_gh_api() {
  local endpoint="$1"
  local out_file="$2"
  local err_file="$3"
  if gh api "$endpoint" >"$out_file" 2>"$err_file"; then
    return 0
  fi
  return 1
}

# Repository secrets evidence.
SECRETS_JSON="$TMP_DIR/secrets.json"
SECRETS_ERR="$TMP_DIR/secrets.err"
SECRETS_ENDPOINT="repos/${REPO_SLUG}/actions/secrets"
SECRETS_STATUS="ok"
if ! run_gh_api "$SECRETS_ENDPOINT" "$SECRETS_JSON" "$SECRETS_ERR"; then
  SECRETS_STATUS="error"
fi

if [[ "$SECRETS_STATUS" == "ok" ]]; then
  SECRETS_TOTAL="$(node -e "const fs=require('node:fs');const p=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));process.stdout.write(String(p.total_count ?? 0));" "$SECRETS_JSON")"
  HAS_NPM_TOKEN="$(node -e "const fs=require('node:fs');const p=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));const arr=Array.isArray(p.secrets)?p.secrets:[];process.stdout.write(arr.some((item)=>item?.name==='NPM_TOKEN')?'true':'false');" "$SECRETS_JSON")"
else
  SECRETS_TOTAL="unknown"
  HAS_NPM_TOKEN="unknown"
fi

cat >"${ARTIFACT_DIR}/npm-token-presence.txt" <<EOF2
generated_at_utc=${NOW_UTC}
repo=${REPO_SLUG}
source_endpoint=${SECRETS_ENDPOINT}
status=${SECRETS_STATUS}
secrets_total_count=${SECRETS_TOTAL}
contains_NPM_TOKEN=${HAS_NPM_TOKEN}
EOF2
if [[ "$SECRETS_STATUS" != "ok" ]]; then
  printf 'error=%s\n' "$(tr '\n' ' ' < "$SECRETS_ERR")" >>"${ARTIFACT_DIR}/npm-token-presence.txt"
fi

# Environment evidence.
ENVS_JSON="$TMP_DIR/envs.json"
ENVS_ERR="$TMP_DIR/envs.err"
ENVS_ENDPOINT="repos/${REPO_SLUG}/environments"
ENVS_STATUS="ok"
if ! run_gh_api "$ENVS_ENDPOINT" "$ENVS_JSON" "$ENVS_ERR"; then
  ENVS_STATUS="error"
fi

ENV_PRESENT="unknown"
ENVS_TOTAL="unknown"
ENV_DETAILS_STATUS="not-requested"
ENV_DETAILS_ENDPOINT="repos/${REPO_SLUG}/environments/npm-publish"
ENV_DETAILS_OUT="$TMP_DIR/env-detail.json"
ENV_DETAILS_ERR="$TMP_DIR/env-detail.err"

if [[ "$ENVS_STATUS" == "ok" ]]; then
  ENVS_TOTAL="$(node -e "const fs=require('node:fs');const p=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));process.stdout.write(String(p.total_count ?? 0));" "$ENVS_JSON")"
  ENV_PRESENT="$(node -e "const fs=require('node:fs');const p=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));const arr=Array.isArray(p.environments)?p.environments:[];process.stdout.write(arr.some((e)=>e?.name==='npm-publish')?'true':'false');" "$ENVS_JSON")"
  if [[ "$ENV_PRESENT" == "true" ]]; then
    ENV_DETAILS_STATUS="ok"
    if ! run_gh_api "$ENV_DETAILS_ENDPOINT" "$ENV_DETAILS_OUT" "$ENV_DETAILS_ERR"; then
      ENV_DETAILS_STATUS="error"
    fi
  else
    ENV_DETAILS_STATUS="missing"
  fi
else
  ENV_PRESENT="unknown"
fi

cat >"${ARTIFACT_DIR}/npm-publish-environment.txt" <<EOF2
generated_at_utc=${NOW_UTC}
repo=${REPO_SLUG}
source_endpoint=${ENVS_ENDPOINT}
status=${ENVS_STATUS}
environments_total_count=${ENVS_TOTAL}
npm_publish_environment_present=${ENV_PRESENT}
environment_details_endpoint=${ENV_DETAILS_ENDPOINT}
environment_details_status=${ENV_DETAILS_STATUS}
EOF2
if [[ "$ENVS_STATUS" != "ok" ]]; then
  printf 'error=%s\n' "$(tr '\n' ' ' < "$ENVS_ERR")" >>"${ARTIFACT_DIR}/npm-publish-environment.txt"
fi
if [[ "$ENV_DETAILS_STATUS" == "error" ]]; then
  printf 'details_error=%s\n' "$(tr '\n' ' ' < "$ENV_DETAILS_ERR")" >>"${ARTIFACT_DIR}/npm-publish-environment.txt"
fi

# Branch protection evidence.
BRANCH_ENDPOINT="repos/${REPO_SLUG}/branches/${DEFAULT_BRANCH}"
BRANCH_JSON="$TMP_DIR/branch.json"
BRANCH_ERR="$TMP_DIR/branch.err"
BRANCH_STATUS="ok"
if ! run_gh_api "$BRANCH_ENDPOINT" "$BRANCH_JSON" "$BRANCH_ERR"; then
  BRANCH_STATUS="error"
fi

PROTECTION_ENDPOINT="repos/${REPO_SLUG}/branches/${DEFAULT_BRANCH}/protection"
PROTECTION_JSON="$TMP_DIR/protection.json"
PROTECTION_ERR="$TMP_DIR/protection.err"
PROTECTION_STATUS="ok"
if ! run_gh_api "$PROTECTION_ENDPOINT" "$PROTECTION_JSON" "$PROTECTION_ERR"; then
  PROTECTION_STATUS="error"
fi

node - "$ARTIFACT_DIR/default-branch-protection.json" "$NOW_UTC" "$REPO_SLUG" "$DEFAULT_BRANCH" "$BRANCH_ENDPOINT" "$BRANCH_STATUS" "$BRANCH_JSON" "$BRANCH_ERR" "$PROTECTION_ENDPOINT" "$PROTECTION_STATUS" "$PROTECTION_JSON" "$PROTECTION_ERR" <<'NODE'
const fs = require('node:fs');

const [
  outputPath,
  generatedAt,
  repo,
  branch,
  branchEndpoint,
  branchStatus,
  branchJsonPath,
  branchErrPath,
  protectionEndpoint,
  protectionStatus,
  protectionJsonPath,
  protectionErrPath
] = process.argv.slice(2);

const readJson = (path) => {
  try {
    return JSON.parse(fs.readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
};
const readText = (path) => {
  try {
    return fs.readFileSync(path, 'utf8').trim();
  } catch {
    return '';
  }
};

const branchPayload = branchStatus === 'ok' ? readJson(branchJsonPath) : null;
const branchSummary = branchPayload
  ? {
      name: typeof branchPayload.name === 'string' ? branchPayload.name : null,
      protected: Boolean(branchPayload.protected),
      protection: branchPayload.protection ?? null,
      protection_url:
        typeof branchPayload.protection_url === 'string' ? branchPayload.protection_url : null
    }
  : null;

const payload = {
  generated_at_utc: generatedAt,
  repo,
  branch,
  branch_endpoint: branchEndpoint,
  branch_status: branchStatus,
  branch_summary: branchSummary,
  branch_error: branchStatus === 'ok' ? null : readText(branchErrPath),
  protection_endpoint: protectionEndpoint,
  protection_status: protectionStatus,
  protection_response: protectionStatus === 'ok' ? readJson(protectionJsonPath) : null,
  protection_error: protectionStatus === 'ok' ? null : readText(protectionErrPath)
};

fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`);
NODE

printf 'PASS governance artifacts captured in %s\n' "$ARTIFACT_DIR"
printf 'INFO npm-token: %s\n' "${ARTIFACT_DIR}/npm-token-presence.txt"
printf 'INFO env: %s\n' "${ARTIFACT_DIR}/npm-publish-environment.txt"
printf 'INFO branch-protection: %s\n' "${ARTIFACT_DIR}/default-branch-protection.json"

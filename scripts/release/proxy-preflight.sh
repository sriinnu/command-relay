#!/usr/bin/env bash
set -euo pipefail

readonly EXIT_OK=0
readonly EXIT_GUARDRAIL=1
readonly EXIT_USAGE=2

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/../.." && pwd)"

BATCH_DATE="$(date -u +%F)"
PACKAGE_SELECTOR="@commandrelay/proxy-*,@commandrelay/relay-proxy,@commandrelay/proxy-*"
RUNBOOK_PATH="docs/release/proxy-publish.md"
CHECKPOINT_FILE=""
DRY_RUN_ARTIFACT_DIR=""
GOVERNANCE_ARTIFACT_DIR=""
ROOT_TAP_EVIDENCE=""

print_help() {
  cat <<'EOF'
Proxy release preflight guardrails.

Hard-fails when:
  - git working tree is dirty,
  - governance placeholders/artifacts are missing,
  - dry-run evidence artifacts are missing for the selected batch.

Usage:
  scripts/release/proxy-preflight.sh [options]

Options:
      --batch-date <YYYY-MM-DD>          Batch date (default: today in UTC)
      --package-selector <selector>      Comma-separated wildcard selector
                                         (default: @commandrelay/proxy-*,@commandrelay/relay-proxy,@commandrelay/proxy-*)
      --runbook <path>                   Release runbook path
                                         (default: docs/release/proxy-publish.md)
      --checkpoint-file <path>           Dry-run checkpoint markdown path
                                         (default: scripts/checkpoints/runs/<batch>-proxy-publish-dry-run.md)
      --dry-run-artifact-dir <path>      Dry-run artifacts directory
                                         (default: artifacts/<batch>-proxy-publish-dry-run)
      --governance-artifact-dir <path>   Governance artifacts directory
                                         (default: artifacts/<batch>-proxy-publish-governance)
      --root-tap-evidence <path>         Root TAP evidence file
                                         (default: artifacts/tap-local/root.tap)
  -h, --help                             Show this help

Exit codes:
  0  All guardrails satisfied
  1  One or more guardrails failed
  2  Invalid usage
EOF
}

die_usage() {
  printf 'FAIL usage: %s\n' "$1" >&2
  exit "$EXIT_USAGE"
}

require_value() {
  local flag="$1"
  local value="${2:-}"
  if [[ -z "$value" || "$value" == -* ]]; then
    die_usage "missing value for ${flag}"
  fi
}

ensure_batch_date() {
  if [[ ! "$BATCH_DATE" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
    die_usage "--batch-date must match YYYY-MM-DD (received: ${BATCH_DATE})"
  fi
}

collect_selected_packages() {
  PACKAGE_SELECTOR="$PACKAGE_SELECTOR" node <<'NODE'
const fs = require('node:fs');
const path = require('node:path');

const selector = process.env.PACKAGE_SELECTOR ?? '@commandrelay/proxy-*,@commandrelay/relay-proxy,@commandrelay/proxy-*';
const packagesDir = path.resolve(process.cwd(), 'packages');
const packageNameRegex = /^@commandrelay\/(proxy-[a-z0-9][a-z0-9-]*|relay-proxy)$/;

const escapeRegExp = (value) => value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
const selectorPatterns = selector
  .split(',')
  .map((value) => value.trim())
  .filter((value) => value.length > 0);

if (selectorPatterns.length === 0) {
  throw new Error(`No valid selector patterns found in "${selector}"`);
}

const selectorRegexes = selectorPatterns.map((pattern) => {
  const regexBody = pattern
    .split('*')
    .map((part) => part.split('?').map(escapeRegExp).join('.'))
    .join('.*');
  return new RegExp(`^${regexBody}$`);
});

const selected = [];

if (fs.existsSync(packagesDir)) {
  const dirs = fs
    .readdirSync(packagesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  for (const dirName of dirs) {
    const packageJsonPath = path.join(packagesDir, dirName, 'package.json');
    if (!fs.existsSync(packageJsonPath)) {
      continue;
    }

    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    if (pkg.private === true) {
      continue;
    }
    if (typeof pkg.name !== 'string' || typeof pkg.version !== 'string') {
      continue;
    }
    if (!packageNameRegex.test(pkg.name)) {
      continue;
    }
    if (!selectorRegexes.some((regex) => regex.test(pkg.name))) {
      continue;
    }

    selected.push({
      packageName: pkg.name,
      version: pkg.version,
      packageDir: dirName
    });
  }
}

for (const entry of selected) {
  process.stdout.write(`${entry.packageName}|${entry.version}|${entry.packageDir}\n`);
}
NODE
}

while (($# > 0)); do
  case "$1" in
    --batch-date)
      require_value "$1" "${2:-}"
      BATCH_DATE="$2"
      shift 2
      ;;
    --package-selector)
      require_value "$1" "${2:-}"
      PACKAGE_SELECTOR="$2"
      shift 2
      ;;
    --runbook)
      require_value "$1" "${2:-}"
      RUNBOOK_PATH="$2"
      shift 2
      ;;
    --checkpoint-file)
      require_value "$1" "${2:-}"
      CHECKPOINT_FILE="$2"
      shift 2
      ;;
    --dry-run-artifact-dir)
      require_value "$1" "${2:-}"
      DRY_RUN_ARTIFACT_DIR="$2"
      shift 2
      ;;
    --governance-artifact-dir)
      require_value "$1" "${2:-}"
      GOVERNANCE_ARTIFACT_DIR="$2"
      shift 2
      ;;
    --root-tap-evidence)
      require_value "$1" "${2:-}"
      ROOT_TAP_EVIDENCE="$2"
      shift 2
      ;;
    -h|--help)
      print_help
      exit "$EXIT_OK"
      ;;
    *)
      die_usage "unknown argument: $1 (use --help)"
      ;;
  esac
done

ensure_batch_date

if [[ -z "$CHECKPOINT_FILE" ]]; then
  CHECKPOINT_FILE="scripts/checkpoints/runs/${BATCH_DATE}-proxy-publish-dry-run.md"
fi
if [[ -z "$DRY_RUN_ARTIFACT_DIR" ]]; then
  DRY_RUN_ARTIFACT_DIR="artifacts/${BATCH_DATE}-proxy-publish-dry-run"
fi
if [[ -z "$GOVERNANCE_ARTIFACT_DIR" ]]; then
  GOVERNANCE_ARTIFACT_DIR="artifacts/${BATCH_DATE}-proxy-publish-governance"
fi
if [[ -z "$ROOT_TAP_EVIDENCE" ]]; then
  ROOT_TAP_EVIDENCE="artifacts/tap-local/root.tap"
fi

cd "$REPO_ROOT"

if ! git rev-parse --git-dir >/dev/null 2>&1; then
  printf 'FAIL preflight: not inside a git repository\n' >&2
  exit "$EXIT_GUARDRAIL"
fi

if ! command -v node >/dev/null 2>&1; then
  printf 'FAIL preflight: node command is required\n' >&2
  exit "$EXIT_GUARDRAIL"
fi

failures=()
record_failure() {
  failures+=("$1")
  printf 'FAIL %s\n' "$1" >&2
}

assert_non_empty_file() {
  local path="$1"
  local label="$2"
  if [[ -s "$path" ]]; then
    printf 'PASS %s: %s\n' "$label" "$path"
  else
    record_failure "${label} missing (${path})"
  fi
}

assert_no_legacy_namespace_references() {
  local legacy_hits
  legacy_hits="$(rg -n "@termina/" "$REPO_ROOT" | sed -n '1,10p' || true)"
  if [[ -z "$legacy_hits" ]]; then
    printf 'PASS legacy namespace sweep: no @termina/ references found\n'
    return 0
  fi

  printf 'FAIL legacy namespace sweep: @termina/ references remain\n%s\n' "$legacy_hits" >&2
  record_failure "legacy namespace references (@termina/) present"
}

printf 'INFO batch-date=%s selector=%s\n' "$BATCH_DATE" "$PACKAGE_SELECTOR"

git_status="$(git status --porcelain=v1)"
if [[ -n "$git_status" ]]; then
  record_failure "git tree is dirty (commit/stash changes before publish preflight)"
  printf 'INFO dirty-tree-preview:\n%s\n' "$(printf '%s\n' "$git_status" | sed -n '1,20p')" >&2
else
  printf 'PASS git tree clean\n'
fi

if [[ ! -f "$RUNBOOK_PATH" ]]; then
  record_failure "release runbook missing (${RUNBOOK_PATH})"
else
  printf 'PASS release runbook present: %s\n' "$RUNBOOK_PATH"
fi
assert_no_legacy_namespace_references

readonly GOVERNANCE_PLACEHOLDER_TOKENS=(
  "proxy-release-governance:npm-token"
  "proxy-release-governance:npm-publish-environment"
  "proxy-release-governance:default-branch-protection"
)

for token in "${GOVERNANCE_PLACEHOLDER_TOKENS[@]}"; do
  if [[ -f "$RUNBOOK_PATH" ]] && grep -Fq "$token" "$RUNBOOK_PATH"; then
    printf 'PASS governance placeholder: %s\n' "$token"
  else
    record_failure "governance placeholder token missing in ${RUNBOOK_PATH} (${token})"
  fi
done

assert_non_empty_file "${GOVERNANCE_ARTIFACT_DIR}/npm-token-presence.txt" "governance artifact"
assert_non_empty_file "${GOVERNANCE_ARTIFACT_DIR}/npm-publish-environment.txt" "governance artifact"
assert_non_empty_file "${GOVERNANCE_ARTIFACT_DIR}/default-branch-protection.json" "governance artifact"

assert_non_empty_file "$CHECKPOINT_FILE" "dry-run checkpoint"
assert_non_empty_file "$ROOT_TAP_EVIDENCE" "root TAP evidence"

mapfile -t selected_packages < <(collect_selected_packages)
if ((${#selected_packages[@]} == 0)); then
  record_failure "no packages matched selector (${PACKAGE_SELECTOR})"
else
  printf 'PASS selector matched %s package(s)\n' "${#selected_packages[@]}"
fi

for entry in "${selected_packages[@]}"; do
  IFS='|' read -r package_name package_version package_dir <<<"$entry"
  if [[ -z "$package_name" || -z "$package_version" || -z "$package_dir" ]]; then
    record_failure "invalid package selector output entry (${entry})"
    continue
  fi

  printf 'INFO checking dry-run artifacts for %s@%s (%s)\n' "$package_name" "$package_version" "$package_dir"
  assert_non_empty_file "${DRY_RUN_ARTIFACT_DIR}/${package_dir}-check.log" "dry-run artifact"
  assert_non_empty_file "${DRY_RUN_ARTIFACT_DIR}/${package_dir}-build.log" "dry-run artifact"
  assert_non_empty_file "${DRY_RUN_ARTIFACT_DIR}/${package_dir}-test.log" "dry-run artifact"
  assert_non_empty_file "${DRY_RUN_ARTIFACT_DIR}/${package_dir}-pack-dry-run.json" "dry-run artifact"
  assert_non_empty_file "${DRY_RUN_ARTIFACT_DIR}/${package_dir}-publish-dry-run.log" "dry-run artifact"

  if [[ -f "$CHECKPOINT_FILE" ]] && grep -Fq "${package_name}@${package_version}" "$CHECKPOINT_FILE"; then
    printf 'PASS checkpoint references %s@%s\n' "$package_name" "$package_version"
  else
    record_failure "checkpoint does not reference ${package_name}@${package_version} (${CHECKPOINT_FILE})"
  fi
done

if ((${#failures[@]} > 0)); then
  printf 'FAIL preflight: %s guardrail(s) failed for batch %s\n' "${#failures[@]}" "$BATCH_DATE" >&2
  exit "$EXIT_GUARDRAIL"
fi

printf 'PASS preflight: all release guardrails satisfied for batch %s\n' "$BATCH_DATE"
exit "$EXIT_OK"

#!/usr/bin/env bash
set -euo pipefail

readonly EXIT_OK=0
readonly EXIT_USAGE=2

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/../.." && pwd)"

BATCH_DATE="$(date -u +%F)"
PACKAGE_SELECTOR="@commandrelay/proxy-*,@commandrelay/relay-proxy,@commandrelay/proxy-*"
DIST_TAG="latest"
ARTIFACT_DIR=""
CHECKPOINT_FILE=""
ROOT_TAP_FILE=""
SKIP_ROOT_TAP="false"

usage() {
  cat <<'USAGE'
Capture local dry-run evidence artifacts for proxy package release preflight.

Usage:
  scripts/release/capture-proxy-dry-run-artifacts.sh [options]

Options:
      --batch-date <YYYY-MM-DD>      Batch date (default: today in UTC)
      --package-selector <selector>  Comma-separated wildcard selector
      --dist-tag <tag>               npm dist-tag for publish dry-run (default: latest)
      --artifact-dir <path>          Output dir (default: artifacts/<batch>-proxy-publish-dry-run)
      --checkpoint-file <path>       Checkpoint path (default: scripts/checkpoints/runs/<batch>-proxy-publish-dry-run.md)
      --root-tap-file <path>         Root TAP evidence path (default: artifacts/tap-local/root.tap)
      --skip-root-tap                Skip regenerating root TAP evidence
  -h, --help                         Show this help
USAGE
}

die_usage() {
  printf 'error: %s\n' "$1" >&2
  exit "$EXIT_USAGE"
}

require_value() {
  local flag="$1"
  local value="${2:-}"
  if [[ -z "$value" || "$value" == -* ]]; then
    die_usage "${flag} requires a value"
  fi
}

ensure_batch_date() {
  if [[ ! "$BATCH_DATE" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
    die_usage "--batch-date must match YYYY-MM-DD"
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

if (!fs.existsSync(packagesDir)) {
  process.exit(0);
}

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

  process.stdout.write(`${pkg.name}|${pkg.version}|${dirName}\n`);
}
NODE
}

write_checkpoint() {
  local checkpoint_path="$1"
  local batch_date="$2"
  local selector="$3"
  local dist_tag="$4"
  local root_tap_file="$5"
  local artifact_dir="$6"
  local root_tap_status="$7"
  shift 7
  local -a package_entries=("$@")
  local artifact_rel
  local root_tap_rel
  local branch
  local commit
  local node_version
  local npm_version

  artifact_rel="${artifact_dir#${REPO_ROOT}/}"
  root_tap_rel="${root_tap_file#${REPO_ROOT}/}"
  branch="$(git rev-parse --abbrev-ref HEAD)"
  commit="$(git rev-parse --short HEAD)"
  node_version="$(node -v)"
  npm_version="$(npm -v)"

  mkdir -p "$(dirname -- "$checkpoint_path")"
  {
    echo "# ${batch_date} Proxy Publish Local Dry-Run Checkpoint"
    echo
    echo "## Scope"
    echo
    echo "- Branch: \`${branch}\`"
    echo "- Commit: \`${commit}\`"
    echo "- Selector: \`${selector}\`"
    echo "- Dist-tag: \`${dist_tag}\`"
    echo "- Mode: local CLI dry-run evidence (\`npm pack --dry-run --json\`, \`npm publish --dry-run\`)"
    echo "- Publish safety: dry-run only, no registry mutation"
    echo
    echo "## Environment"
    echo
    echo "- \`pwd\`: \`${REPO_ROOT}\`"
    echo "- \`node -v\`: \`${node_version}\`"
    echo "- \`npm -v\`: \`${npm_version}\`"
    echo "- cache strategy: scoped npm cache under \`${artifact_rel}/.npm-cache\`"
    echo "- root TAP evidence: \`${root_tap_status}\`"
    if [[ "$root_tap_status" == "generated" ]]; then
      echo "- root TAP file: [root TAP](../../../${root_tap_rel})"
    fi
    echo
    echo "## Selected Packages"
    echo
    local index=1
    local entry
    for entry in "${package_entries[@]}"; do
      IFS='|' read -r package_name package_version _package_dir <<<"$entry"
      echo "${index}. \`${package_name}@${package_version}\`"
      index=$((index + 1))
    done
    echo
    echo "## Validation Results"
    echo
    echo "| Package | \`check\` | \`build\` | \`test\` |"
    echo "| --- | --- | --- | --- |"
    for entry in "${package_entries[@]}"; do
      IFS='|' read -r package_name _package_version package_dir <<<"$entry"
      echo "| \`${package_name}\` | pass | pass | pass |"
    done
    echo
    echo "Validation logs:"
    echo
    for entry in "${package_entries[@]}"; do
      IFS='|' read -r _package_name _package_version package_dir <<<"$entry"
      echo "- \`${package_dir}\`: [check](../../../${artifact_rel}/${package_dir}-check.log), [build](../../../${artifact_rel}/${package_dir}-build.log), [test](../../../${artifact_rel}/${package_dir}-test.log)"
    done
    echo
    echo "## Pack Dry-Run Results"
    echo
    local pack_json
    local pack_summary
    for entry in "${package_entries[@]}"; do
      IFS='|' read -r package_name package_version package_dir <<<"$entry"
      pack_json="${artifact_dir}/${package_dir}-pack-dry-run.json"
      pack_summary="$(node - "$pack_json" <<'NODE'
const fs = require('node:fs');
const file = process.argv[2];
const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
const first = Array.isArray(payload) ? payload[0] : payload;
const fileName = first?.filename ?? 'unknown';
const entryCount = Array.isArray(first?.files) ? first.files.length : 'unknown';
process.stdout.write(`${fileName}|${entryCount}`);
NODE
)"
      IFS='|' read -r pack_file entry_count <<<"$pack_summary"
      echo "- \`${package_name}@${package_version}\`: [pack JSON](../../../${artifact_rel}/${package_dir}-pack-dry-run.json), tarball \`${pack_file}\`, \`entryCount=${entry_count}\`"
    done
    echo
    echo "## Publish Dry-Run Results"
    echo
    echo "All selected packages completed \`npm publish --dry-run --access public --tag ${dist_tag}\` successfully."
    echo
    for entry in "${package_entries[@]}"; do
      IFS='|' read -r _package_name _package_version package_dir <<<"$entry"
      echo "- \`${package_dir}\`: [publish log](../../../${artifact_rel}/${package_dir}-publish-dry-run.log)"
    done
    echo
    echo "## Conclusion"
    echo
    echo "- Local dry-run evidence for batch \`${batch_date}\` is complete."
    echo "- This checkpoint satisfies the package/version references required by \`release:proxy:preflight\`."
  } >"$checkpoint_path"
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
    --dist-tag)
      require_value "$1" "${2:-}"
      DIST_TAG="$2"
      shift 2
      ;;
    --artifact-dir)
      require_value "$1" "${2:-}"
      ARTIFACT_DIR="$2"
      shift 2
      ;;
    --checkpoint-file)
      require_value "$1" "${2:-}"
      CHECKPOINT_FILE="$2"
      shift 2
      ;;
    --root-tap-file)
      require_value "$1" "${2:-}"
      ROOT_TAP_FILE="$2"
      shift 2
      ;;
    --skip-root-tap)
      SKIP_ROOT_TAP="true"
      shift
      ;;
    -h|--help)
      usage
      exit "$EXIT_OK"
      ;;
    --)
      shift
      break
      ;;
    *)
      die_usage "unknown argument: $1"
      ;;
  esac
done

ensure_batch_date

if [[ -z "$ARTIFACT_DIR" ]]; then
  ARTIFACT_DIR="${REPO_ROOT}/artifacts/${BATCH_DATE}-proxy-publish-dry-run"
fi
if [[ -z "$CHECKPOINT_FILE" ]]; then
  CHECKPOINT_FILE="${REPO_ROOT}/scripts/checkpoints/runs/${BATCH_DATE}-proxy-publish-dry-run.md"
fi
if [[ -z "$ROOT_TAP_FILE" ]]; then
  ROOT_TAP_FILE="${REPO_ROOT}/artifacts/tap-local/root.tap"
fi

cd "$REPO_ROOT"

command -v pnpm >/dev/null 2>&1 || die_usage "pnpm is required"
command -v npm >/dev/null 2>&1 || die_usage "npm is required"
command -v node >/dev/null 2>&1 || die_usage "node is required"

mkdir -p "$ARTIFACT_DIR"
mkdir -p "$(dirname -- "$ROOT_TAP_FILE")"

readonly NPM_CACHE_DIR="${ARTIFACT_DIR}/.npm-cache"
mkdir -p "$NPM_CACHE_DIR"

selected_packages=()
while IFS= read -r entry; do
  selected_packages+=("$entry")
done < <(collect_selected_packages)

if ((${#selected_packages[@]} == 0)); then
  die_usage "no packages matched selector (${PACKAGE_SELECTOR})"
fi

root_tap_status="skipped"
if [[ "$SKIP_ROOT_TAP" != "true" ]]; then
  bash scripts/ci-test-target.sh root "$ROOT_TAP_FILE" >"${ARTIFACT_DIR}/root-tap.log" 2>&1
  root_tap_status="generated"
fi

# I build the full workspace first so package dry-runs match the release workflow shape.
pnpm run build:all >"${ARTIFACT_DIR}/workspace-build.log" 2>&1

for entry in "${selected_packages[@]}"; do
  IFS='|' read -r package_name _package_version package_dir <<<"$entry"
  package_path="${REPO_ROOT}/packages/${package_dir}"

  pnpm --filter "$package_name" run check >"${ARTIFACT_DIR}/${package_dir}-check.log" 2>&1
  pnpm --filter "$package_name" run build >"${ARTIFACT_DIR}/${package_dir}-build.log" 2>&1
  pnpm --filter "$package_name" run test >"${ARTIFACT_DIR}/${package_dir}-test.log" 2>&1

  (
    cd "$package_path"
    env npm_config_cache="$NPM_CACHE_DIR" npm pack --dry-run --json >"${ARTIFACT_DIR}/${package_dir}-pack-dry-run.json"
  )
  (
    cd "$package_path"
    env npm_config_cache="$NPM_CACHE_DIR" npm publish --dry-run --access public --tag "$DIST_TAG" >"${ARTIFACT_DIR}/${package_dir}-publish-dry-run.log" 2>&1
  )
done

write_checkpoint \
  "$CHECKPOINT_FILE" \
  "$BATCH_DATE" \
  "$PACKAGE_SELECTOR" \
  "$DIST_TAG" \
  "$ROOT_TAP_FILE" \
  "$ARTIFACT_DIR" \
  "$root_tap_status" \
  "${selected_packages[@]}"

printf 'PASS proxy dry-run artifacts captured for batch %s\n' "$BATCH_DATE"
printf 'INFO artifact-dir=%s\n' "$ARTIFACT_DIR"
printf 'INFO checkpoint=%s\n' "$CHECKPOINT_FILE"
if [[ "$root_tap_status" == "generated" ]]; then
  printf 'INFO root-tap=%s\n' "$ROOT_TAP_FILE"
fi

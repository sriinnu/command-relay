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

has_npm_script() {
  local package_json="$1"
  local script_name="$2"

  node -e '
const fs = require("node:fs");
const pkg = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const scripts = pkg.scripts ?? {};
process.exit(Object.prototype.hasOwnProperty.call(scripts, process.argv[2]) ? 0 : 1);
' "${package_json}" "${script_name}"
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

if [[ "${PHASE}" == "build" ]]; then
  mapfile -t package_dirs < <(node - "${PACKAGES_DIR}" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');

const packagesDir = process.argv[2];
const dependencyFields = ['dependencies', 'optionalDependencies', 'peerDependencies'];

const packageDirs = fs
  .readdirSync(packagesDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

const workspacePackages = [];
const packageNameToDir = new Map();

for (const dirName of packageDirs) {
  const packageJsonPath = path.join(packagesDir, dirName, 'package.json');
  if (!fs.existsSync(packageJsonPath)) {
    continue;
  }

  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  const packageName = typeof pkg.name === 'string' ? pkg.name : null;

  workspacePackages.push({ dirName, pkg });
  if (packageName) {
    packageNameToDir.set(packageName, dirName);
  }
}

const indegree = new Map();
const dependents = new Map();
const workspaceDirNames = workspacePackages.map((entry) => entry.dirName);

for (const dirName of workspaceDirNames) {
  indegree.set(dirName, 0);
  dependents.set(dirName, new Set());
}

for (const { dirName, pkg } of workspacePackages) {
  const localDeps = new Set();
  for (const fieldName of dependencyFields) {
    const deps = pkg[fieldName];
    if (!deps || typeof deps !== 'object') {
      continue;
    }
    for (const depName of Object.keys(deps)) {
      const depDir = packageNameToDir.get(depName);
      if (!depDir || depDir === dirName) {
        continue;
      }
      localDeps.add(depDir);
    }
  }

  for (const depDir of localDeps) {
    if (dependents.get(depDir).has(dirName)) {
      continue;
    }
    dependents.get(depDir).add(dirName);
    indegree.set(dirName, indegree.get(dirName) + 1);
  }
}

const queue = workspaceDirNames.filter((dirName) => indegree.get(dirName) === 0).sort();
const ordered = [];

while (queue.length > 0) {
  const dirName = queue.shift();
  ordered.push(dirName);

  const dependentDirs = Array.from(dependents.get(dirName)).sort();
  for (const dependentDir of dependentDirs) {
    const nextDegree = indegree.get(dependentDir) - 1;
    indegree.set(dependentDir, nextDegree);
    if (nextDegree === 0) {
      queue.push(dependentDir);
      queue.sort();
    }
  }
}

if (ordered.length !== workspaceDirNames.length) {
  const seen = new Set(ordered);
  for (const dirName of [...workspaceDirNames].sort()) {
    if (!seen.has(dirName)) {
      ordered.push(dirName);
    }
  }
}

const output = ordered.map((dirName) => path.join(packagesDir, dirName)).join('\n');
if (output.length > 0) {
  process.stdout.write(`${output}\n`);
}
NODE
)
else
  mapfile -t package_dirs < <(find "${PACKAGES_DIR}" -mindepth 1 -maxdepth 1 -type d | LC_ALL=C sort)
fi
matched_packages=0

for package_dir in "${package_dirs[@]}"; do
  package_json="${package_dir}/package.json"
  if [[ ! -f "${package_json}" ]]; then
    continue
  fi

  package_name="$(basename "${package_dir}")"
  if ! has_npm_script "${package_json}" "${PHASE}"; then
    echo "==> [${package_name}] SKIP (no '${PHASE}' script)"
    continue
  fi

  matched_packages=$((matched_packages + 1))
  if ! run_npm_script "${package_dir}" "${package_name}" "${PHASE}"; then
    status=1
  fi
done

if [[ "${matched_packages}" -eq 0 ]]; then
  echo "No package under ${PACKAGES_DIR} defines script '${PHASE}'" >&2
  status=1
fi

exit "${status}"

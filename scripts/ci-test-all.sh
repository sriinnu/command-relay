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
  web-smoke
  package:<dir> (auto-discovered under packages/* with a `test` script)
USAGE
}

write_missing_tap() {
  local tap_file="$1"
  local target="$2"

  {
    echo "TAP version 13"
    echo "1..1"
    echo "not ok 1 - ${target}"
    echo "  ---"
    echo "  message: target did not produce TAP output"
    echo "  ..."
  } >"${tap_file}"
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
  "web-smoke"
)
package_targets=()
while IFS= read -r package_target; do
  package_targets+=("${package_target}")
done < <(
  node <<'NODE'
const fs = require("node:fs");
const path = require("node:path");

const packagesDir = path.resolve(process.cwd(), "packages");
if (!fs.existsSync(packagesDir)) {
  process.exit(0);
}

const packages = new Map();
for (const entry of fs.readdirSync(packagesDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) {
    continue;
  }

  const packageJsonPath = path.join(packagesDir, entry.name, "package.json");
  if (!fs.existsSync(packageJsonPath)) {
    continue;
  }

  const manifest = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  if (typeof manifest.name !== "string" || !manifest.name.startsWith("@commandrelay/")) {
    continue;
  }
  packages.set(manifest.name, {
    dirName: entry.name,
    manifest
  });
}

const inDegree = new Map();
const adjacency = new Map();
for (const packageName of packages.keys()) {
  inDegree.set(packageName, 0);
  adjacency.set(packageName, new Set());
}

for (const [packageName, info] of packages.entries()) {
  const dependencySections = {
    ...(info.manifest.dependencies ?? {}),
    ...(info.manifest.devDependencies ?? {}),
    ...(info.manifest.peerDependencies ?? {})
  };

  for (const dependencyName of Object.keys(dependencySections)) {
    if (!packages.has(dependencyName)) {
      continue;
    }
    adjacency.get(dependencyName).add(packageName);
    inDegree.set(packageName, (inDegree.get(packageName) ?? 0) + 1);
  }
}

const queue = [...packages.keys()]
  .filter((packageName) => (inDegree.get(packageName) ?? 0) === 0)
  .sort((left, right) => left.localeCompare(right));
const buildOrder = [];

while (queue.length > 0) {
  const current = queue.shift();
  buildOrder.push(current);
  for (const dependant of adjacency.get(current) ?? []) {
    inDegree.set(dependant, (inDegree.get(dependant) ?? 0) - 1);
    if ((inDegree.get(dependant) ?? 0) === 0) {
      queue.push(dependant);
      queue.sort((left, right) => left.localeCompare(right));
    }
  }
}

for (const packageName of buildOrder.reverse()) {
  const info = packages.get(packageName);
  const scripts = info?.manifest?.scripts ?? {};
  if (!info || !Object.prototype.hasOwnProperty.call(scripts, "test")) {
    continue;
  }

  process.stdout.write(`package:${info.dirName}\n`);
}
NODE
)

if [[ "${#package_targets[@]}" -gt 0 ]]; then
  targets+=("${package_targets[@]}")
fi

status=0
for target in "${targets[@]}"; do
  tap_file="${TAP_OUTPUT_DIR}/${target//:/-}.tap"
  rm -f "${tap_file}"
  if ! "${TARGET_RUNNER}" "${target}" "${tap_file}"; then
    status=1
  fi
  if [[ ! -s "${tap_file}" ]]; then
    write_missing_tap "${tap_file}" "${target}"
    status=1
  fi
done

if [[ "${status}" -eq 0 ]]; then
  echo "All test targets passed. TAP files are in ${TAP_OUTPUT_DIR}"
else
  echo "One or more test targets failed. TAP files are in ${TAP_OUTPUT_DIR}" >&2
fi

exit "${status}"

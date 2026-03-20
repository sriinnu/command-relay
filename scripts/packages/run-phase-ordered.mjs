#!/usr/bin/env node
/* eslint-disable no-console */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const command = args[0];
if (!command || ["-h", "--help", "help"].includes(command)) {
  showUsage();
  process.exit(command ? 0 : 2);
}

let includeRoot = false;
let rootScript = command === "build" ? "build:packages:ordered" : command;
let dryRun = false;
let printOrder = false;

for (let index = 1; index < args.length; index += 1) {
  const current = args[index];
  if (current === "--include-root") {
    includeRoot = true;
  } else if (current === "--root-script" && index + 1 < args.length) {
    rootScript = args[index + 1];
    index += 1;
  } else if (current === "--print-order") {
    printOrder = true;
  } else if (current === "--dry-run") {
    dryRun = true;
  } else if (current === "--help" || current === "-h") {
    showUsage();
    process.exit(0);
  } else {
    console.error(`Unknown argument: ${current}`);
    showUsage();
    process.exit(2);
  }
}

const scriptName = command;
const repoRoot = path.resolve(import.meta.dirname, "../..");
const rootPackageJson = path.join(repoRoot, "package.json");
const packagesDir = path.join(repoRoot, "packages");
const phaseRunner = detectRunner();

const packages = discoverWorkspacePackages(packagesDir);
const order = resolveBuildOrder(packages);

if (printOrder) {
  for (const packageName of order) {
    process.stdout.write(`${packageName}\n`);
  }
  if (!dryRun) {
    process.exit(0);
  }
}

if (!order.length) {
  console.error(`No @commandrelay packages found under ${packagesDir}`);
  process.exit(1);
}

if (includeRoot) {
  console.log(`==> [root] ${phaseRunner} run ${rootScript}`);
  if (!hasScript(rootPackageJson, rootScript)) {
    console.log(`==> [root] SKIP (missing '${rootScript}' script)`);
  } else if (!dryRun && !runScript(rootPackageJson, rootScript, phaseRunner)) {
    process.exit(1);
  }
}

for (const packageName of order) {
  const packageDir = packages.get(packageName);
  if (!packageDir) continue;
  if (!hasScript(packageDir, scriptName)) {
    console.log(`==> [${packageName}] SKIP (missing '${scriptName}' script)`);
    continue;
  }
  console.log(`==> [${packageName}] ${phaseRunner} run ${scriptName}`);
  if (dryRun) continue;
  if (!runScript(packageDir, scriptName, phaseRunner)) {
    process.exit(1);
  }
}

function resolveBuildOrder(packages) {
  const packageNames = [...packages.keys()];
  const inDegree = new Map();
  const adjacency = new Map();

  for (const name of packageNames) {
    inDegree.set(name, 0);
    adjacency.set(name, new Set());
  }

  for (const [name, manifestDir] of packages) {
    const manifest = readManifest(manifestDir);
    const localDependencies = collectLocalCommandRelayDependencies(manifest, packages);
    for (const dependency of localDependencies) {
      adjacency.get(dependency).add(name);
      inDegree.set(name, (inDegree.get(name) ?? 0) + 1);
    }
  }

  const queue = packageNames
    .filter((name) => (inDegree.get(name) ?? 0) === 0)
    .sort((a, b) => a.localeCompare(b));
  const resolved = [];

  while (queue.length) {
    const current = queue.shift();
    resolved.push(current);
    for (const dependant of adjacency.get(current) ?? []) {
      inDegree.set(dependant, inDegree.get(dependant) - 1);
      if (inDegree.get(dependant) === 0) {
        queue.push(dependant);
      }
    }
    queue.sort((a, b) => a.localeCompare(b));
  }

  if (resolved.length !== packageNames.length) {
    const unresolved = packageNames.filter((name) => !(inDegree.get(name) === 0));
    console.error(`Dependency cycle detected; cannot compute a full install/build order.
Unresolved packages: ${unresolved.join(", ")}`);
    process.exit(1);
  }

  return resolved;
}

function collectLocalCommandRelayDependencies(manifest, packageMap) {
  const dependencyNames = new Set();
  const scope = "@commandrelay/";
  const allDependencySections = {
    ...(manifest.dependencies ?? {}),
    ...(manifest.devDependencies ?? {}),
    ...(manifest.peerDependencies ?? {})
  };

  for (const dependencyName of Object.keys(allDependencySections)) {
    if (packageMap.has(dependencyName) && dependencyName.startsWith(scope)) {
      dependencyNames.add(dependencyName);
    }
  }

  return dependencyNames;
}

function discoverWorkspacePackages(packagesDir) {
  const entries = fs.readdirSync(packagesDir, { withFileTypes: true });
  const packages = new Map();
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const packageJsonPath = path.join(packagesDir, entry.name, "package.json");
    if (!fs.existsSync(packageJsonPath)) continue;
    try {
      const manifest = readManifest(packageJsonPath);
      if (typeof manifest.name !== "string") continue;
      if (!manifest.name.startsWith("@commandrelay/")) continue;
      packages.set(manifest.name, packageJsonPath);
    } catch (error) {
      console.warn(`Skipping invalid manifest: ${packageJsonPath} (${error instanceof Error ? error.message : "unknown error"})`);
    }
  }

  return packages;
}

function hasScript(packageJsonPath, scriptName) {
  const manifest = readManifest(packageJsonPath);
  const scripts = manifest.scripts ?? {};
  return Object.prototype.hasOwnProperty.call(scripts, scriptName);
}

function runScript(packageRootOrPackageJson, scriptName, phaseRunner) {
  const result = spawnSync(phaseRunner, ["run", scriptName], {
    cwd: path.dirname(packageRootOrPackageJson),
    stdio: "inherit"
  });
  if (result.error) {
    const cause = result.error instanceof Error ? result.error.message : String(result.error);
    console.error(`Failed command: ${phaseRunner} run ${scriptName} in ${path.dirname(packageRootOrPackageJson)}`);
    console.error(cause);
    return false;
  }

  if (result.status !== 0) {
    console.error(`Command failed with exit ${result.status}: ${phaseRunner} run ${scriptName} in ${path.dirname(packageRootOrPackageJson)}`);
    return false;
  }

  return true;
}

function readManifest(manifestPath) {
  const raw = fs.readFileSync(manifestPath, "utf8");
  return JSON.parse(raw);
}

function detectRunner() {
  if (process.platform === "win32") {
    return "pnpm";
  }
  return "pnpm";
}

function showUsage() {
  console.log(`Usage: scripts/packages/run-phase-ordered.mjs <phase> [options]

Runs a workspace phase in strict dependency order for @commandrelay packages.

Options:
  --include-root          Run the same phase in repository root first.
  --root-script <name>    Override root script when --include-root is used.
  --print-order           Print resolved package order only.
  --dry-run               Print commands without executing them.
  --help                  Show this message.`);
}

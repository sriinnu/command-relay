import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

type ProxyPackage = {
  readonly packageDir: string;
  readonly packageName: string;
  readonly version: string;
};
type ProxyDependencyEdge = {
  readonly packageName: string;
  readonly packageDir: string;
  readonly dependencyName: string;
  readonly dependencyVersion: string;
  readonly dependencyField: "dependencies" | "devDependencies" | "peerDependencies" | "optionalDependencies";
};

type ProxyPackageJson = {
  readonly name?: unknown;
  readonly version?: unknown;
  readonly dependencies?: Record<string, unknown>;
  readonly devDependencies?: Record<string, unknown>;
  readonly peerDependencies?: Record<string, unknown>;
  readonly optionalDependencies?: Record<string, unknown>;
};

const PACKAGE_NAME_PATTERNS = [
  /^@commandrelay\/proxy-[a-z0-9][a-z0-9-]*$/,
  /^@commandrelay\/relay-proxy$/
];

function printHelp(): void {
  process.stdout.write(`Usage:
  node --import tsx scripts/release/check-proxy-lockstep-versions.ts

Checks lockstep version alignment for:
  - @commandrelay/proxy-*
  - @commandrelay/relay-proxy

Exit codes:
  0  Versions are aligned
  1  Version drift detected or no proxy packages found
`);
}

function resolveRepoRoot(): string {
  const scriptPath = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(scriptPath), "..", "..");
}

function readProxyPackages(repoRoot: string): ProxyPackage[] {
  const packagesDir = path.join(repoRoot, "packages");
  if (!fs.existsSync(packagesDir)) {
    return [];
  }

  const packageDirs = fs
    .readdirSync(packagesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  const results: ProxyPackage[] = [];

  for (const packageDir of packageDirs) {
    const packageJsonPath = path.join(packagesDir, packageDir, "package.json");
    if (!fs.existsSync(packageJsonPath)) {
      continue;
    }

    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as {
      readonly name?: unknown;
      readonly version?: unknown;
    };

    if (typeof packageJson.name !== "string" || typeof packageJson.version !== "string") {
      continue;
    }
    const isMatch = PACKAGE_NAME_PATTERNS.some((pattern) => pattern.test(packageJson.name));
    if (!isMatch) {
      continue;
    }

    results.push({
      packageDir,
      packageName: packageJson.name,
      version: packageJson.version
    });
  }

  return results;
}
function readProxyPackageJson(packageDirPath: string): ProxyPackageJson | null {
  const packageJsonPath = path.join(packageDirPath, "package.json");
  if (!fs.existsSync(packageJsonPath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as ProxyPackageJson;
  } catch {
    return null;
  }
}
function scanDependencyEdges(
  repoRoot: string,
  packages: readonly ProxyPackage[],
  alignedVersion: string
): ProxyDependencyEdge[] {
  const knownPackageNames = new Set(packages.map((entry) => entry.packageName));
  const violations: ProxyDependencyEdge[] = [];
  const seenEdges = new Set<string>();
  const dependencyFields = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"] as const;

  for (const pkg of packages) {
    const packageJsonPath = path.join(repoRoot, "packages", pkg.packageDir);
    const packageJson = readProxyPackageJson(packageJsonPath);
    if (!packageJson) {
      continue;
    }
    for (const field of dependencyFields) {
      const rawField = packageJson[field];
      if (typeof rawField !== "object" || rawField === null) {
        continue;
      }
      const entries = rawField as Record<string, unknown>;
      for (const [dependencyName, dependencyVersion] of Object.entries(entries)) {
        if (!dependencyName.startsWith("@commandrelay/")) {
          continue;
        }
        if (typeof dependencyVersion !== "string") {
          const edgeKey = `${pkg.packageName}|${dependencyName}|${field}|non-string`;
          if (seenEdges.has(edgeKey)) {
            continue;
          }
          seenEdges.add(edgeKey);
          violations.push({
            packageName: pkg.packageName,
            packageDir: pkg.packageDir,
            dependencyName,
            dependencyVersion: String(dependencyVersion),
            dependencyField: field
          });
          continue;
        }
        if (!knownPackageNames.has(dependencyName)) {
          continue;
        }
        if (isAlignedDependencySpecifier(dependencyVersion, alignedVersion)) {
          continue;
        }
        const edgeKey = `${pkg.packageName}|${dependencyName}|${field}|${dependencyVersion}`;
        if (seenEdges.has(edgeKey)) {
          continue;
        }
        seenEdges.add(edgeKey);
        violations.push({
          packageName: pkg.packageName,
          packageDir: pkg.packageDir,
          dependencyName,
          dependencyVersion,
          dependencyField: field
        });
      }
    }
  }

  return violations;
}
function isAlignedDependencySpecifier(specifier: string, alignedVersion: string): boolean {
  if (specifier === "workspace:*") {
    return true;
  }
  if (specifier.startsWith("workspace:")) {
    const workspaceSpecifier = specifier.slice("workspace:".length);
    return (
      workspaceSpecifier === "*" ||
      workspaceSpecifier === alignedVersion ||
      workspaceSpecifier === `^${alignedVersion}` ||
      workspaceSpecifier === `~${alignedVersion}`
    );
  }
  return (
    specifier === alignedVersion ||
    specifier === `^${alignedVersion}` ||
    specifier === `~${alignedVersion}` ||
    specifier === `=${alignedVersion}`
  );
}
function printDependencyViolations(violations: readonly ProxyDependencyEdge[], version: string): void {
  process.stdout.write(
    `FAIL lockstep: commandrelay dependency specs out of sync with ${version} (` +
      `${violations.length} issue${violations.length === 1 ? "" : "s"})\n`
  );
  for (const entry of violations) {
    process.stdout.write(
      `- [${entry.dependencyField}] ${entry.packageName} (${entry.packageDir}) -> ${entry.dependencyName}@${entry.dependencyVersion}\n`
    );
  }
}

function printPackageTable(packages: readonly ProxyPackage[]): void {
  process.stdout.write("INFO proxy package versions:\n");
  for (const pkg of packages) {
    process.stdout.write(`- ${pkg.packageName}@${pkg.version} (${pkg.packageDir})\n`);
  }
}

function printDriftByVersion(packages: readonly ProxyPackage[]): void {
  const byVersion = new Map<string, string[]>();
  for (const pkg of packages) {
    const entries = byVersion.get(pkg.version) ?? [];
    entries.push(pkg.packageName);
    byVersion.set(pkg.version, entries);
  }

  const sortedEntries = [...byVersion.entries()].sort((left, right) => left[0].localeCompare(right[0]));
  process.stdout.write("FAIL lockstep: version drift detected\n");
  process.stdout.write("INFO version buckets:\n");
  for (const [version, packageNames] of sortedEntries) {
    packageNames.sort((left, right) => left.localeCompare(right));
    process.stdout.write(`- ${version}: ${packageNames.join(", ")}\n`);
  }
}

function main(): void {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    printHelp();
    return;
  }
  if (argv.length > 0) {
    process.stderr.write(`FAIL usage: unknown argument(s): ${argv.join(" ")}\n`);
    process.exitCode = 1;
    return;
  }

  const repoRoot = resolveRepoRoot();
  const packages = readProxyPackages(repoRoot);

  if (packages.length === 0) {
    process.stderr.write(
      "FAIL lockstep: no @commandrelay/proxy-* or @commandrelay/relay-proxy packages found\n"
    );
    process.exitCode = 1;
    return;
  }

  printPackageTable(packages);

  const uniqueVersions = new Set(packages.map((pkg) => pkg.version));
  if (uniqueVersions.size !== 1) {
    printDriftByVersion(packages);
    process.exitCode = 1;
    return;
  }

  const alignedVersion = [...uniqueVersions][0];
  const violations = scanDependencyEdges(repoRoot, packages, alignedVersion);

  if (violations.length > 0) {
    printDependencyViolations(violations, alignedVersion);
    process.exitCode = 1;
    return;
  }

  const commandrelayCount = packages.length;
  process.stdout.write(
    `PASS lockstep: ${packages.length} proxy package(s) aligned at version ${alignedVersion} (@commandrelay=${commandrelayCount})\n`
  );
}

main();

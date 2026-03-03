import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

type ProxyPackage = {
  readonly packageDir: string;
  readonly packageName: string;
  readonly version: string;
  readonly scope: "@commandrelay" | "@termina";
};

const PACKAGE_NAME_PATTERN = /^@(commandrelay|termina)\/proxy-[a-z0-9][a-z0-9-]*$/;

function printHelp(): void {
  process.stdout.write(`Usage:
  node --import tsx scripts/release/check-proxy-lockstep-versions.ts

Checks lockstep version alignment for:
  - @commandrelay/proxy-*
  - @termina/proxy-*

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
    if (!PACKAGE_NAME_PATTERN.test(packageJson.name)) {
      continue;
    }

    const scope = packageJson.name.startsWith("@commandrelay/") ? "@commandrelay" : "@termina";
    results.push({
      packageDir,
      packageName: packageJson.name,
      version: packageJson.version,
      scope
    });
  }

  return results;
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
    process.stderr.write("FAIL lockstep: no @commandrelay/proxy-* or @termina/proxy-* packages found\n");
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
  const commandrelayCount = packages.filter((pkg) => pkg.scope === "@commandrelay").length;
  const terminaCount = packages.filter((pkg) => pkg.scope === "@termina").length;
  process.stdout.write(
    `PASS lockstep: ${packages.length} proxy package(s) aligned at version ${alignedVersion} (@commandrelay=${commandrelayCount}, @termina=${terminaCount})\n`
  );
}

main();

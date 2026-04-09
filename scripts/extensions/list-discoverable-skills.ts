import { constants } from "node:fs";
import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { EXTENSION_ALLOWLIST } from "./extension-registry.js";

const USAGE = `Usage:
  node --import tsx scripts/extensions/list-discoverable-skills.ts [--format table|json]

Description:
  Lists discoverable SKILL.md entries for apps and packages.

Examples:
  node --import tsx scripts/extensions/list-discoverable-skills.ts
  node --import tsx scripts/extensions/list-discoverable-skills.ts --format json
`;

type OutputFormat = "table" | "json";

interface ParsedArgs {
  help: boolean;
  format: OutputFormat;
}

interface DiscoverableSkill {
  id: string;
  scope: "app" | "package";
  name: string;
  skillPath: string;
  svgPath: string | null;
  extensionCli: string;
}

interface PackageManifest {
  name?: string;
}

async function main(): Promise<void> {
  const parsed = parseCliArgs(process.argv.slice(2));
  if (parsed.help) {
    process.stdout.write(USAGE);
    return;
  }

  const skills = await discoverSkills(process.cwd());
  if (parsed.format === "json") {
    process.stdout.write(
      `${JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          count: skills.length,
          skills
        },
        null,
        2
      )}\n`
    );
    return;
  }

  const rows = skills.map((entry) => [
    entry.id,
    entry.scope,
    entry.name,
    entry.extensionCli,
    entry.skillPath,
    entry.svgPath ?? "-"
  ]);

  process.stdout.write(
    `${renderTable(["ID", "SCOPE", "NAME", "EXTENSION CLI", "SKILL", "SVG"], rows)}\n`
  );
}

function parseCliArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    help: false,
    format: "table"
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--help" || token === "-h") {
      parsed.help = true;
      continue;
    }

    const option = parseOptionToken(token);
    if (option.flag === "--format") {
      const format = consumeValue(argv, option.inlineValue, "--format", index);
      if (option.inlineValue === undefined) index += 1;
      if (format !== "table" && format !== "json") {
        throw new Error(`Unsupported --format value: ${format}`);
      }
      parsed.format = format;
      continue;
    }

    throw new Error(`Unknown option: ${token}`);
  }

  return parsed;
}

async function discoverSkills(rootDir: string): Promise<DiscoverableSkill[]> {
  const appEntries = await readDirectoryNames(path.resolve(rootDir, "apps"));
  const packageEntries = await readDirectoryNames(path.resolve(rootDir, "packages"));
  const skills: DiscoverableSkill[] = [];

  for (const appDir of appEntries) {
    const skillPath = path.join("apps", appDir, "SKILL.md");
    if (!(await fileExists(path.resolve(rootDir, skillPath)))) {
      continue;
    }

    const svgPath = path.join("apps", appDir, "assets", "brand.svg");
    const defaultAction = deriveDefaultAction(appDir, "info");
    skills.push({
      id: appDir,
      scope: "app",
      name: appDir,
      skillPath,
      svgPath: (await fileExists(path.resolve(rootDir, svgPath))) ? svgPath : null,
      extensionCli: `npm run extension:run -- ${appDir} ${defaultAction}`
    });
  }

  for (const packageDir of packageEntries) {
    const skillPath = path.join("packages", packageDir, "SKILL.md");
    if (!(await fileExists(path.resolve(rootDir, skillPath)))) {
      continue;
    }

    const packageManifest = await readPackageManifest(
      path.resolve(rootDir, "packages", packageDir, "package.json")
    );
    const defaultAction = deriveDefaultAction(
      packageDir,
      packageDir === "cli-proxy" ? "cli" : "check"
    );
    skills.push({
      id: packageDir,
      scope: "package",
      name: packageManifest.name ?? packageDir,
      skillPath,
      svgPath: await findPackageSvg(rootDir, packageDir),
      extensionCli:
        defaultAction === "cli"
          ? `npm run extension:run -- ${packageDir} cli -- --help`
          : `npm run extension:run -- ${packageDir} ${defaultAction}`
    });
  }

  return skills.sort((left, right) => left.id.localeCompare(right.id));
}

async function readPackageManifest(packageJsonPath: string): Promise<PackageManifest> {
  try {
    const content = await readFile(packageJsonPath, "utf8");
    return JSON.parse(content) as PackageManifest;
  } catch {
    return {};
  }
}

async function findPackageSvg(rootDir: string, packageDir: string): Promise<string | null> {
  const assetsDir = path.resolve(rootDir, "packages", packageDir, "docs", "assets");
  const entries = await readFileNames(assetsDir);
  const svgFile = entries.find((entry) => entry.toLowerCase().endsWith(".svg")) ?? null;
  return svgFile ? path.join("packages", packageDir, "docs", "assets", svgFile) : null;
}

async function readDirectoryNames(dirPath: string): Promise<string[]> {
  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  } catch {
    return [];
  }
}

async function readFileNames(dirPath: string): Promise<string[]> {
  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    return entries.filter((entry) => entry.isFile()).map((entry) => entry.name).sort();
  } catch {
    return [];
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function deriveDefaultAction(extensionId: string, fallbackAction: string): string {
  const extension = EXTENSION_ALLOWLIST[extensionId];
  if (!extension) {
    return fallbackAction;
  }

  if (extension.actions.includes("check")) {
    return "check";
  }
  if (extension.actions.includes("preview")) {
    return "preview";
  }
  if (extension.actions.includes("cli")) {
    return "cli";
  }
  return "info";
}

function parseOptionToken(token: string): { flag: string; inlineValue?: string } {
  const delimiterIndex = token.indexOf("=");
  if (delimiterIndex === -1) {
    return { flag: token };
  }

  return {
    flag: token.slice(0, delimiterIndex),
    inlineValue: token.slice(delimiterIndex + 1)
  };
}

function consumeValue(
  argv: string[],
  inlineValue: string | undefined,
  flag: string,
  index: number
): string {
  if (inlineValue !== undefined) {
    return inlineValue;
  }

  const next = argv[index + 1];
  if (next === undefined || next.startsWith("-")) {
    throw new Error(`${flag} requires a value.`);
  }
  return next;
}

function renderTable(headers: string[], rows: string[][]): string {
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => (row[index] ?? "").length))
  );

  const headerRow = headers.map((header, index) => header.padEnd(widths[index])).join("  ");
  const divider = widths.map((width) => "-".repeat(width)).join("  ");
  const body = rows
    .map((row) => row.map((value, index) => (value ?? "").padEnd(widths[index])).join("  "))
    .join("\n");

  return `${headerRow}\n${divider}${body ? `\n${body}` : ""}`;
}

main().catch((error) => {
  process.stderr.write(
    `list-discoverable-skills error: ${error instanceof Error ? error.message : String(error)}\n\n${USAGE}`
  );
  process.exitCode = 1;
});

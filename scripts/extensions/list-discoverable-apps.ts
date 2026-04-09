import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { EXTENSION_ALLOWLIST, type ExtensionDefinition } from "./extension-registry.js";

const USAGE = `Usage:
  node --import tsx scripts/extensions/list-discoverable-apps.ts [--format table|json]

Description:
  Lists discoverable app/extension entries with safe CLI actions.

Examples:
  node --import tsx scripts/extensions/list-discoverable-apps.ts
  node --import tsx scripts/extensions/list-discoverable-apps.ts --format json
`;

type OutputFormat = "table" | "json";

interface ParsedArgs {
  help: boolean;
  format: OutputFormat;
}

interface DiscoverableApp {
  id: string;
  kind: "app" | "extension";
  name: string;
  rootDir: string;
  skillPath: string;
  svgPath: string | null;
  actions: string[];
  defaultCli: string;
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

  const discoverableApps = await discoverApps(process.cwd());
  if (parsed.format === "json") {
    process.stdout.write(
      `${JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          count: discoverableApps.length,
          apps: discoverableApps
        },
        null,
        2
      )}\n`
    );
    return;
  }

  const rows = discoverableApps.map((entry) => [
    entry.id,
    entry.kind,
    entry.name,
    entry.actions.join(","),
    entry.defaultCli,
    entry.skillPath,
    entry.svgPath ?? "-"
  ]);
  process.stdout.write(
    `${renderTable(
      ["ID", "KIND", "NAME", "ACTIONS", "DEFAULT CLI", "SKILL", "SVG"],
      rows
    )}\n`
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

async function discoverApps(rootDir: string): Promise<DiscoverableApp[]> {
  const allowlistedExtensions = Object.values(EXTENSION_ALLOWLIST).sort((left, right) =>
    left.id.localeCompare(right.id)
  );
  const discovered: DiscoverableApp[] = [];

  for (const extension of allowlistedExtensions) {
    const skillExists = await fileExists(path.resolve(rootDir, extension.skillPath));
    if (!skillExists) {
      continue;
    }

    const packageJsonPath = path.resolve(rootDir, extension.rootDir, "package.json");
    const packageJson =
      extension.kind === "package" ? await readPackageManifest(packageJsonPath) : {};
    const actions = [...extension.actions];

    discovered.push({
      id: extension.id,
      kind: extension.kind === "app" ? "app" : "extension",
      name: packageJson.name ?? extension.displayName,
      rootDir: extension.rootDir,
      skillPath: extension.skillPath,
      svgPath: (await fileExists(path.resolve(rootDir, extension.svgPath))) ? extension.svgPath : null,
      actions,
      defaultCli: `npm run extension:run -- ${extension.id} ${deriveDefaultAction(extension)}`
    });
  }

  return discovered;
}

function deriveDefaultAction(extension: ExtensionDefinition): string {
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

async function readPackageManifest(packageJsonPath: string): Promise<PackageManifest> {
  try {
    const content = await readFile(packageJsonPath, "utf8");
    return JSON.parse(content) as PackageManifest;
  } catch {
    return {};
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
    `list-discoverable-apps error: ${error instanceof Error ? error.message : String(error)}\n\n${USAGE}`
  );
  process.exitCode = 1;
});

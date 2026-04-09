import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import {
  EXTENSION_ALLOWLIST,
  type ExtensionAction,
  type ExtensionDefinition
} from "./extension-registry.js";
import { runWebPreview } from "./web-preview.js";

const USAGE = `Usage:
  node --import tsx scripts/extensions/run-extension-cli.ts <extension-id> <action> [-- <args...>]
  node --import tsx scripts/extensions/run-extension-cli.ts --extension <extension-id> --action <action> [-- <args...>]
  node --import tsx scripts/extensions/run-extension-cli.ts --list [--format table|json]

Description:
  Safe extension CLI dispatcher with explicit allowlist and no shell eval.

Examples:
  node --import tsx scripts/extensions/run-extension-cli.ts --list
  node --import tsx scripts/extensions/run-extension-cli.ts proxy-core check
  node --import tsx scripts/extensions/run-extension-cli.ts cli-proxy cli -- --help
  node --import tsx scripts/extensions/run-extension-cli.ts web info
  node --import tsx scripts/extensions/run-extension-cli.ts web preview -- --port 4173
`;

type OutputFormat = "table" | "json";

interface ParsedArgs {
  extensionId?: string;
  action?: string;
  passthrough: string[];
  list: boolean;
  help: boolean;
  format: OutputFormat;
}

async function main(): Promise<void> {
  const parsed = parseCliArgs(process.argv.slice(2));
  if (parsed.help) {
    process.stdout.write(USAGE);
    return;
  }
  if (parsed.list) {
    printAllowlistedExtensions(parsed.format);
    return;
  }

  const extensionId = requireValue(parsed.extensionId, "extension id");
  const action = requireValue(parsed.action, "action");
  const extension = EXTENSION_ALLOWLIST[extensionId];
  if (!extension) {
    throw new Error(
      `Unsupported extension "${extensionId}". Allowed: ${Object.keys(EXTENSION_ALLOWLIST).join(", ")}`
    );
  }
  if (!extension.actions.includes(action as ExtensionAction)) {
    throw new Error(
      `Unsupported action "${action}" for "${extensionId}". Allowed: ${extension.actions.join(", ")}`
    );
  }

  await executeAction(extension, action as ExtensionAction, parsed.passthrough);
}

function parseCliArgs(argv: string[]): ParsedArgs {
  const separatorIndex = argv.indexOf("--");
  const rawArgs = separatorIndex >= 0 ? argv.slice(0, separatorIndex) : argv;
  const passthrough = separatorIndex >= 0 ? argv.slice(separatorIndex + 1) : [];
  const positional: string[] = [];

  const parsed: ParsedArgs = {
    passthrough,
    list: false,
    help: false,
    format: "table"
  };

  for (let index = 0; index < rawArgs.length; index += 1) {
    const token = rawArgs[index];
    if (token === "--help" || token === "-h") {
      parsed.help = true;
      continue;
    }
    if (token === "--list") {
      parsed.list = true;
      continue;
    }

    const option = parseOptionToken(token);
    if (option.flag === "--format") {
      const format = consumeValue(rawArgs, option.inlineValue, "--format", index);
      if (option.inlineValue === undefined) index += 1;
      if (format !== "table" && format !== "json") {
        throw new Error(`Unsupported --format value: ${format}`);
      }
      parsed.format = format;
      continue;
    }
    if (option.flag === "--extension" || option.flag === "-e") {
      parsed.extensionId = consumeValue(rawArgs, option.inlineValue, option.flag, index);
      if (option.inlineValue === undefined) index += 1;
      continue;
    }
    if (option.flag === "--action" || option.flag === "-a") {
      parsed.action = consumeValue(rawArgs, option.inlineValue, option.flag, index);
      if (option.inlineValue === undefined) index += 1;
      continue;
    }
    if (token.startsWith("-")) {
      throw new Error(`Unknown option: ${token}`);
    }
    positional.push(token);
  }

  if (!parsed.extensionId && positional.length > 0) parsed.extensionId = positional.shift();
  if (!parsed.action && positional.length > 0) parsed.action = positional.shift();
  if (positional.length > 0) {
    throw new Error(`Unexpected positional arguments: ${positional.join(" ")}`);
  }
  return parsed;
}

async function executeAction(
  extension: ExtensionDefinition,
  action: ExtensionAction,
  passthrough: string[]
): Promise<void> {
  if (action === "help") {
    printExtensionHelp(extension);
    return;
  }
  if (action === "info") {
    await printExtensionInfo(extension);
    return;
  }
  if (action === "preview") {
    if (extension.id !== "web") {
      throw new Error(`Action "preview" is only supported for extension "web".`);
    }
    await runWebPreview(extension, passthrough);
    return;
  }
  if (action === "cli") {
    if (extension.id !== "cli-proxy") {
      throw new Error(`Action "cli" is only supported for extension "${EXTENSION_ALLOWLIST["cli-proxy"].id}".`);
    }

    const scriptPath = path.resolve("packages/cli-proxy/src/cli.ts");
    const code = await runProcess(process.execPath, ["--import", "tsx", scriptPath, ...passthrough]);
    process.exitCode = code;
    return;
  }

  if (!extension.workspace) {
    throw new Error(`Extension "${extension.id}" does not define an npm workspace target.`);
  }

  const npmArgs = ["run", "--workspace", extension.workspace, action];
  if (passthrough.length > 0) npmArgs.push("--", ...passthrough);
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  const code = await runProcess(npmCommand, npmArgs);
  process.exitCode = code;
}

async function runProcess(command: string, args: string[]): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", shell: false });
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 1));
  });
}

async function printExtensionInfo(extension: ExtensionDefinition): Promise<void> {
  const readmePath = path.resolve(extension.rootDir, "README.md");
  const packageJsonPath = path.resolve(extension.rootDir, "package.json");
  const packageJsonExists = await fileExists(packageJsonPath);

  const payload = {
    id: extension.id,
    kind: extension.kind,
    displayName: extension.displayName,
    description: extension.description,
    rootDir: extension.rootDir,
    workspace: extension.workspace ?? null,
    actions: extension.actions,
    files: {
      skillPath: extension.skillPath,
      skillExists: await fileExists(path.resolve(extension.skillPath)),
      svgPath: extension.svgPath,
      svgExists: await fileExists(path.resolve(extension.svgPath)),
      readmePath: path.relative(process.cwd(), readmePath),
      readmeExists: await fileExists(readmePath),
      packageJsonPath: path.relative(process.cwd(), packageJsonPath),
      packageJsonExists
    },
    packageName: packageJsonExists ? await readPackageName(packageJsonPath) : null
  };

  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

function printExtensionHelp(extension: ExtensionDefinition): void {
  const lines = [
    `${extension.id} (${extension.kind})`,
    `Description: ${extension.description}`,
    `Allowed actions: ${extension.actions.join(", ")}`,
    "Examples:"
  ];

  for (const action of extension.actions) {
    const command =
      action === "cli"
        ? `npm run extension:run -- ${extension.id} cli -- --help`
        : `npm run extension:run -- ${extension.id} ${action}`;
    lines.push(`  - ${command}`);
  }

  process.stdout.write(`${lines.join("\n")}\n`);
}

function printAllowlistedExtensions(format: OutputFormat): void {
  const entries = Object.values(EXTENSION_ALLOWLIST).sort((left, right) => left.id.localeCompare(right.id));
  const rows = entries.map((entry) => ({
    id: entry.id,
    kind: entry.kind,
    workspace: entry.workspace ?? "-",
    actions: entry.actions.join(",")
  }));

  if (format === "json") {
    process.stdout.write(`${JSON.stringify({ count: rows.length, extensions: rows }, null, 2)}\n`);
    return;
  }

  process.stdout.write(
    `${renderTable(
      ["ID", "KIND", "WORKSPACE", "ACTIONS"],
      rows.map((row) => [row.id, row.kind, row.workspace, row.actions])
    )}\n`
  );
}

function parseOptionToken(token: string): { flag: string; inlineValue?: string } {
  const delimiterIndex = token.indexOf("=");
  if (delimiterIndex === -1) return { flag: token };
  return { flag: token.slice(0, delimiterIndex), inlineValue: token.slice(delimiterIndex + 1) };
}

function consumeValue(
  argv: string[],
  inlineValue: string | undefined,
  flag: string,
  index: number
): string {
  if (inlineValue !== undefined) return inlineValue;
  const next = argv[index + 1];
  if (next === undefined || next.startsWith("-")) {
    throw new Error(`${flag} requires a value.`);
  }
  return next;
}

function requireValue(raw: string | undefined, field: string): string {
  const value = raw?.trim();
  if (!value) throw new Error(`Missing required ${field}.`);
  return value;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function readPackageName(packageJsonPath: string): Promise<string | null> {
  try {
    const content = await readFile(packageJsonPath, "utf8");
    const parsed = JSON.parse(content) as { name?: unknown };
    return typeof parsed.name === "string" && parsed.name.trim() ? parsed.name : null;
  } catch {
    return null;
  }
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
    `run-extension-cli error: ${error instanceof Error ? error.message : String(error)}\n\n${USAGE}`
  );
  process.exitCode = 1;
});

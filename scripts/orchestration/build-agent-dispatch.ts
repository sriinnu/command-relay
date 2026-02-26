import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildSpawnAgentTemplate } from "../../src/orchestration/agent-dispatch.js";

const USAGE = `Usage:
  node --import tsx scripts/orchestration/build-agent-dispatch.ts \\
    --brief <path> \\
    --owner <text> \\
    --path <owned-path> [--path <owned-path>]... \\
    [--agent-type <worker|explorer|awaiter|default>] \\
    [--task <text>] \\
    [--instruction <text>]... \\
    --out <path>

Options:
  --brief <path>               Brief input file path (required)
  --owner <text>               Dispatch owner label (required)
  --path <owned-path>          Owned file/directory path (repeatable, at least one)
  --agent-type <value>         Agent type: worker|explorer|awaiter|default (default: worker)
  --task <text>                Optional task override. If omitted, reads from brief Task section.
  --instruction <text>         Additional instruction (repeatable)
  --out <path>                 Output dispatch JSON path (required)
  --help, -h                   Show this help
`;

type AgentType = "worker" | "explorer" | "awaiter" | "default";

interface CliArgs {
  brief?: string;
  owner?: string;
  paths: string[];
  agentType?: string;
  task?: string;
  instructions: string[];
  out?: string;
  help: boolean;
}

async function main(): Promise<void> {
  const parsed = parseCliArgs(process.argv.slice(2));

  if (parsed.help) {
    process.stdout.write(USAGE);
    return;
  }

  const briefPath = requireValue(parsed.brief, "--brief");
  const owner = requireValue(parsed.owner, "--owner");
  const outPath = requireValue(parsed.out, "--out");
  const ownedPaths = requireRepeatedValues(parsed.paths, "--path");
  const agentType = parseAgentType(parsed.agentType);
  const task = normalizeOptionalText(parsed.task);
  const instructions = normalizeUniqueList(parsed.instructions);

  const briefBody = await readBrief(path.resolve(briefPath));

  const payload = buildSpawnAgentTemplate({
    agentType,
    owner,
    ownedPaths,
    briefBody,
    instructions,
    ...(task ? { task } : {})
  });

  const resolvedOut = path.resolve(outPath);
  await mkdir(path.dirname(resolvedOut), { recursive: true });
  await writeFile(resolvedOut, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function parseCliArgs(argv: string[]): CliArgs {
  const parsed: CliArgs = {
    paths: [],
    instructions: [],
    help: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === "--help" || token === "-h") {
      parsed.help = true;
      continue;
    }

    const option = parseOptionToken(token);
    switch (option.flag) {
      case "--brief":
        parsed.brief = consumeValue(argv, option.inlineValue, "--brief", index);
        if (option.inlineValue === undefined) index += 1;
        break;
      case "--owner":
        parsed.owner = consumeValue(argv, option.inlineValue, "--owner", index);
        if (option.inlineValue === undefined) index += 1;
        break;
      case "--path":
        parsed.paths.push(consumeValue(argv, option.inlineValue, "--path", index));
        if (option.inlineValue === undefined) index += 1;
        break;
      case "--agent-type":
        parsed.agentType = consumeValue(argv, option.inlineValue, "--agent-type", index);
        if (option.inlineValue === undefined) index += 1;
        break;
      case "--task":
        parsed.task = consumeValue(argv, option.inlineValue, "--task", index);
        if (option.inlineValue === undefined) index += 1;
        break;
      case "--instruction":
        parsed.instructions.push(consumeValue(argv, option.inlineValue, "--instruction", index));
        if (option.inlineValue === undefined) index += 1;
        break;
      case "--out":
        parsed.out = consumeValue(argv, option.inlineValue, "--out", index);
        if (option.inlineValue === undefined) index += 1;
        break;
      default:
        throw new Error(`Unknown option: ${option.flag}`);
    }
  }

  return parsed;
}

function parseOptionToken(token: string): { flag: string; inlineValue?: string } {
  if (!token.startsWith("--")) {
    throw new Error(`Unexpected token: ${token}`);
  }

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
  if (next === undefined || isOptionToken(next)) {
    throw new Error(`${flag} requires a value.`);
  }

  return next;
}

function requireValue(raw: string | undefined, flag: string): string {
  if (!raw) {
    throw new Error(`Missing required option: ${flag}`);
  }

  const value = raw.trim();
  if (!value) {
    throw new Error(`${flag} cannot be empty.`);
  }

  return value;
}

function requireRepeatedValues(values: readonly string[], flag: string): string[] {
  const normalized = normalizeUniqueList(values);
  if (normalized.length === 0) {
    throw new Error(`Missing required option: ${flag} (provide at least one value).`);
  }

  return normalized;
}

function normalizeUniqueList(values: readonly string[]): string[] {
  const deduped = new Set<string>();
  for (const raw of values) {
    const normalized = raw.trim();
    if (!normalized) continue;
    deduped.add(normalized);
  }

  return Array.from(deduped);
}

function parseAgentType(raw: string | undefined): AgentType {
  const normalized = normalizeOptionalText(raw) ?? "worker";
  if (normalized === "worker") return normalized;
  if (normalized === "explorer") return normalized;
  if (normalized === "awaiter") return normalized;
  if (normalized === "default") return normalized;

  throw new Error(
    `--agent-type must be one of: worker, explorer, awaiter, default (received "${normalized}").`
  );
}

function normalizeOptionalText(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;

  const normalized = raw.trim();
  if (!normalized) return undefined;

  return normalized;
}

async function readBrief(absolutePath: string): Promise<string> {
  try {
    const raw = await readFile(absolutePath, "utf8");
    const normalized = raw.replace(/\r\n/g, "\n").trim();
    if (!normalized) {
      throw new Error("brief file is empty.");
    }

    return normalized;
  } catch (error) {
    throw new Error(`Unable to read brief file "${absolutePath}": ${formatError(error)}`, {
      cause: error
    });
  }
}

function isOptionToken(token: string): boolean {
  return token === "--help" || token === "-h" || token.startsWith("--");
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

main().catch((error) => {
  process.stderr.write(
    `build-agent-dispatch error: ${error instanceof Error ? error.message : String(error)}\n\n${USAGE}`
  );
  process.exitCode = 1;
});

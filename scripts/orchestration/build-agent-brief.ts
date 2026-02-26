import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { TASK_CAPSULE_SCHEMA_VERSION } from "../../src/orchestration/task-capsule.js";

const USAGE = `Usage:
  node --import tsx scripts/orchestration/build-agent-brief.ts \\
    --capsule <path> \\
    --task <text> \\
    --owner <text> \\
    --path <owned-path> [--path <owned-path>]... \\
    [--accept <criterion>]... \\
    [--risk <risk>]... \\
    --out <path>

Options:
  --capsule <path>              Capsule JSON input path (required)
  --task <text>                 Task statement for the brief (required)
  --owner <text>                Agent owner label (required)
  --path <owned-path>           Owned file/directory path (repeatable, at least one)
  --accept <criterion>          Additional acceptance criterion (repeatable)
  --risk <risk>                 Additional risk note (repeatable)
  --out <path>                  Output brief file path (required)
  --help, -h                    Show this help
`;

interface CliArgs {
  capsule?: string;
  task?: string;
  owner?: string;
  paths: string[];
  acceptanceCriteria: string[];
  risks: string[];
  out?: string;
  help: boolean;
}

interface TaskCapsuleSnippetEssential {
  path: string;
  content: string;
  startLine?: number;
  endLine?: number;
}

interface TaskCapsuleEssential {
  schemaVersion: string;
  goal: string;
  owner: string;
  paths: string[];
  acceptanceCriteria: string[];
  risks: string[];
  snippets: TaskCapsuleSnippetEssential[];
}

interface AgentBriefBuildInput {
  capsule: TaskCapsuleEssential;
  ownedPaths: readonly string[];
}

type AgentBriefBuilder = (input: AgentBriefBuildInput) => unknown | Promise<unknown>;

async function main(): Promise<void> {
  const parsed = parseCliArgs(process.argv.slice(2));

  if (parsed.help) {
    process.stdout.write(USAGE);
    return;
  }

  const capsulePath = requireValue(parsed.capsule, "--capsule");
  const task = requireValue(parsed.task, "--task");
  const owner = requireValue(parsed.owner, "--owner");
  const out = requireValue(parsed.out, "--out");
  const ownedPaths = requireRepeatedValues(parsed.paths, "--path");

  const capsule = await readAndValidateCapsule(capsulePath);
  const acceptanceCriteria = normalizeUniqueList([
    ...capsule.acceptanceCriteria,
    ...parsed.acceptanceCriteria
  ]);
  const risks = normalizeUniqueList([...capsule.risks, ...parsed.risks]);

  const capsuleForBrief: TaskCapsuleEssential = {
    ...capsule,
    goal: task,
    owner,
    acceptanceCriteria,
    risks
  };

  const input: AgentBriefBuildInput = {
    capsule: capsuleForBrief,
    ownedPaths
  };

  const builder = await loadCoreBuilder();
  const brief = normalizeBriefOutput(await invokeCoreBuilder(builder, input));

  const outPath = path.resolve(out);
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, brief, "utf8");
}

function parseCliArgs(argv: string[]): CliArgs {
  const parsed: CliArgs = {
    paths: [],
    acceptanceCriteria: [],
    risks: [],
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
      case "--capsule":
        parsed.capsule = consumeValue(argv, option.inlineValue, "--capsule", index);
        if (option.inlineValue === undefined) index += 1;
        break;
      case "--task":
        parsed.task = consumeValue(argv, option.inlineValue, "--task", index);
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
      case "--accept":
        parsed.acceptanceCriteria.push(consumeValue(argv, option.inlineValue, "--accept", index));
        if (option.inlineValue === undefined) index += 1;
        break;
      case "--risk":
        parsed.risks.push(consumeValue(argv, option.inlineValue, "--risk", index));
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
  const seen = new Set<string>();
  for (const rawValue of values) {
    const normalized = rawValue.trim();
    if (!normalized) continue;
    seen.add(normalized);
  }
  return Array.from(seen);
}

async function readAndValidateCapsule(capsulePath: string): Promise<TaskCapsuleEssential> {
  const absolutePath = path.resolve(capsulePath);
  const rawContent = await readFile(absolutePath, "utf8");

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawContent) as unknown;
  } catch (error) {
    throw new Error(`Invalid capsule JSON at "${absolutePath}": ${formatError(error)}`, {
      cause: error
    });
  }

  return parseTaskCapsuleEssential(parsed);
}

function parseTaskCapsuleEssential(value: unknown): TaskCapsuleEssential {
  const capsule = asRecord(value, "capsule JSON root");
  const schemaVersion = readRequiredString(capsule, "schemaVersion");
  if (schemaVersion !== TASK_CAPSULE_SCHEMA_VERSION) {
    throw new Error(
      `capsule.schemaVersion must be "${TASK_CAPSULE_SCHEMA_VERSION}" (received "${schemaVersion}").`
    );
  }

  const snippetsRaw = readArray(capsule, "snippets");
  const snippets = snippetsRaw.map((entry, index) => parseSnippet(entry, index));

  return {
    schemaVersion,
    goal: readRequiredString(capsule, "goal"),
    owner: readRequiredString(capsule, "owner"),
    paths: readStringArray(capsule, "paths"),
    acceptanceCriteria: readStringArray(capsule, "acceptanceCriteria"),
    risks: readStringArray(capsule, "risks"),
    snippets
  };
}

function parseSnippet(value: unknown, index: number): TaskCapsuleSnippetEssential {
  const snippet = asRecord(value, `capsule.snippets[${index}]`);
  const startLine = readOptionalPositiveInteger(snippet, "startLine", `capsule.snippets[${index}]`);
  const endLine = readOptionalPositiveInteger(snippet, "endLine", `capsule.snippets[${index}]`);

  if (startLine !== undefined && endLine !== undefined && endLine < startLine) {
    throw new Error(`capsule.snippets[${index}].endLine cannot be less than startLine.`);
  }

  return {
    path: readRequiredString(snippet, "path", `capsule.snippets[${index}]`),
    content: readRequiredString(snippet, "content", `capsule.snippets[${index}]`, false),
    ...(startLine !== undefined ? { startLine } : {}),
    ...(endLine !== undefined ? { endLine } : {})
  };
}

async function loadCoreBuilder(): Promise<AgentBriefBuilder> {
  const coreModulePath = "../../src/orchestration/" + "agent-brief.js";
  let moduleValue: unknown;

  try {
    moduleValue = await import(coreModulePath);
  } catch (error) {
    throw new Error(
      `Unable to load core module src/orchestration/agent-brief.ts: ${formatError(error)}`,
      { cause: error }
    );
  }

  return resolveBuilder(moduleValue);
}

function resolveBuilder(moduleValue: unknown): AgentBriefBuilder {
  const moduleRecord = asRecord(moduleValue, "agent-brief module");
  const candidates: unknown[] = [
    moduleRecord.buildAgentBrief,
    moduleRecord.renderAgentBrief,
    moduleRecord.createAgentBrief,
    moduleRecord.default
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "function") {
      return candidate as AgentBriefBuilder;
    }
  }

  if (isRecord(moduleRecord.default)) {
    const nestedDefault = moduleRecord.default;
    if (typeof nestedDefault.buildAgentBrief === "function") {
      return nestedDefault.buildAgentBrief as AgentBriefBuilder;
    }
  }

  const exportedKeys = Object.keys(moduleRecord).sort().join(", ");
  throw new Error(
    `Core module does not expose a supported builder function (buildAgentBrief/renderAgentBrief/createAgentBrief/default). Exports: ${exportedKeys || "<none>"}.`
  );
}

async function invokeCoreBuilder(
  builder: AgentBriefBuilder,
  input: AgentBriefBuildInput
): Promise<string> {
  const result = await builder(input);
  if (typeof result === "string") {
    if (result.trim().length === 0) {
      throw new Error("Core builder returned an empty brief string.");
    }
    return result;
  }

  if (isRecord(result)) {
    for (const key of ["brief", "content", "text", "output"] as const) {
      const candidate = result[key];
      if (typeof candidate === "string" && candidate.trim().length > 0) {
        return candidate;
      }
    }
  }

  throw new Error("Core builder returned unsupported output; expected non-empty string brief.");
}

function normalizeBriefOutput(rawBrief: string): string {
  return `${rawBrief.replace(/\r\n/g, "\n").trimEnd()}\n`;
}

function readRequiredString(
  source: Record<string, unknown>,
  field: string,
  context = "capsule",
  requireNonEmpty = true
): string {
  const value = source[field];
  if (typeof value !== "string") {
    throw new Error(`${context}.${field} must be a string.`);
  }

  const normalized = value.trim();
  if (requireNonEmpty && !normalized) {
    throw new Error(`${context}.${field} cannot be empty.`);
  }
  return requireNonEmpty ? normalized : value;
}

function readStringArray(source: Record<string, unknown>, field: string): string[] {
  const value = readArray(source, field);
  const normalized: string[] = [];

  value.forEach((entry, index) => {
    if (typeof entry !== "string") {
      throw new Error(`capsule.${field}[${index}] must be a string.`);
    }

    const text = entry.trim();
    if (text) {
      normalized.push(text);
    }
  });

  return normalizeUniqueList(normalized);
}

function readArray(source: Record<string, unknown>, field: string): unknown[] {
  const value = source[field];
  if (!Array.isArray(value)) {
    throw new Error(`capsule.${field} must be an array.`);
  }
  return value;
}

function readOptionalPositiveInteger(
  source: Record<string, unknown>,
  field: string,
  context: string
): number | undefined {
  const value = source[field];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new Error(`${context}.${field} must be a positive integer when provided.`);
  }
  return value;
}

function asRecord(value: unknown, context: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`${context} must be an object.`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
    `build-agent-brief error: ${error instanceof Error ? error.message : String(error)}\n\n${USAGE}`
  );
  process.exitCode = 1;
});

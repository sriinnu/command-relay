import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  buildTaskCapsule,
  parseFileSnippetSelector,
  type TaskCapsuleSnippetInput
} from "../../src/orchestration/task-capsule.js";

const USAGE = `Usage:
  node --import tsx scripts/orchestration/build-task-capsule.ts \\
    --goal <text> \\
    --owner <text> \\
    [--path <file-or-dir>]... \\
    [--accept <criterion>]... \\
    [--risk <risk>]... \\
    [--snippet <path[:start[:end]]>]... \\
    --out <output.json>

Options:
  --goal <text>                 Capsule goal (required)
  --owner <text>                Capsule owner (required)
  --path <value>                Included path (repeatable)
  --accept <value>              Acceptance criterion (repeatable)
  --risk <value>                Risk note (repeatable)
  --snippet <selector>          File snippet selector path[:start[:end]] (repeatable)
  --out <path>                  Output JSON path (required)
  --help, -h                    Show this help
`;

interface CliArgs {
  goal?: string;
  owner?: string;
  paths: string[];
  acceptanceCriteria: string[];
  risks: string[];
  snippets: string[];
  out?: string;
  help: boolean;
}

async function main(): Promise<void> {
  const parsed = parseCliArgs(process.argv.slice(2));

  if (parsed.help) {
    process.stdout.write(USAGE);
    return;
  }

  const goal = requireValue(parsed.goal, "--goal");
  const owner = requireValue(parsed.owner, "--owner");
  const out = requireValue(parsed.out, "--out");

  const snippetInputs = await Promise.all(parsed.snippets.map(readSnippetInput));
  const capsule = buildTaskCapsule({
    goal,
    owner,
    paths: parsed.paths,
    acceptanceCriteria: parsed.acceptanceCriteria,
    risks: parsed.risks,
    snippets: snippetInputs
  });

  const outPath = path.resolve(out);
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(capsule, null, 2)}\n`, "utf8");
}

function parseCliArgs(argv: string[]): CliArgs {
  const parsed: CliArgs = {
    paths: [],
    acceptanceCriteria: [],
    risks: [],
    snippets: [],
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
      case "--goal":
        parsed.goal = consumeValue(argv, option.inlineValue, "--goal", index);
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
      case "--snippet":
        parsed.snippets.push(consumeValue(argv, option.inlineValue, "--snippet", index));
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

async function readSnippetInput(selector: string): Promise<TaskCapsuleSnippetInput> {
  try {
    const parsed = parseFileSnippetSelector(selector);
    const absolutePath = path.resolve(parsed.path);
    const fileContent = await readFile(absolutePath, "utf8");

    return {
      selector,
      content: selectSnippetContent(fileContent, parsed.startLine, parsed.endLine)
    };
  } catch (error) {
    throw new Error(
      `Unable to read snippet for selector "${selector}": ${formatError(error)}`,
      { cause: error }
    );
  }
}

function selectSnippetContent(
  fileContent: string,
  startLine: number | undefined,
  endLine: number | undefined
): string {
  const normalizedContent = fileContent.replace(/\r\n/g, "\n");
  if (startLine === undefined && endLine === undefined) {
    return normalizedContent;
  }

  const lines = normalizedContent.split("\n");
  if (lines.length === 0) return "";

  const safeStart = clampLine(startLine ?? 1, 1, lines.length);
  const safeEnd = clampLine(endLine ?? lines.length, safeStart, lines.length);
  return lines.slice(safeStart - 1, safeEnd).join("\n");
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

function clampLine(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function isOptionToken(token: string): boolean {
  return token === "--help" || token === "-h" || token.startsWith("--");
}

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

main().catch((error) => {
  process.stderr.write(
    `build-task-capsule error: ${error instanceof Error ? error.message : String(error)}\n\n${USAGE}`
  );
  process.exitCode = 1;
});

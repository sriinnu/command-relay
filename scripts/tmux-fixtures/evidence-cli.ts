import path from "node:path";
import type { Options } from "./evidence-types.js";

const DEFAULT_SESSION = "fixture_a2_evidence";
const DEFAULT_WINDOW = "fixture";
const DEFAULT_PANES = 3;
const DEFAULT_PROFILE = "replay";
const DEFAULT_CYCLES = 4;
const DEFAULT_LINES_PER_CYCLE = 3;
const DEFAULT_DELAY_MS = 0;

/** CLI help text for the fixture evidence harness. */
export const USAGE = `Usage:
  node --import tsx scripts/tmux-fixtures/run-fixture-evidence.ts [options]

Runs deterministic tmux fixture evidence automation for A2:
  create-fixture -> emit-fixture-output -> replay-order assertions -> teardown-fixture

Outputs:
  - checkpoint markdown artifact in scripts/checkpoints/runs/
  - absolute artifact path on stdout

Options:
  --session <name>          Fixture session name (default: ${DEFAULT_SESSION})
  --window <name>           Fixture window name (default: ${DEFAULT_WINDOW})
  --panes <n>               Pane count (default: ${DEFAULT_PANES})
  --profile <name>          replay | load (default: ${DEFAULT_PROFILE})
  --cycles <n>              Emit cycles (default: ${DEFAULT_CYCLES})
  --lines-per-cycle <n>     Lines per pane each cycle (default: ${DEFAULT_LINES_PER_CYCLE})
  --delay-ms <n>            Delay between cycles in milliseconds (default: ${DEFAULT_DELAY_MS})
  --output <path>           Checkpoint artifact path (default: scripts/checkpoints/runs/<date>-a2-tmux-fixture-harness-evidence.md)
  --keep-fixture            Skip teardown for debugging (default: false)
  --help, -h                Show this help

Examples:
  node --import tsx scripts/tmux-fixtures/run-fixture-evidence.ts
  node --import tsx scripts/tmux-fixtures/run-fixture-evidence.ts --session fixture_a2_local --panes 4 --cycles 6
`;

/**
 * Parses CLI arguments into evidence harness options.
 */
export function parseArgs(argv: string[]): Options {
  const options: Options = {
    session: DEFAULT_SESSION,
    window: DEFAULT_WINDOW,
    panes: DEFAULT_PANES,
    profile: DEFAULT_PROFILE,
    cycles: DEFAULT_CYCLES,
    linesPerCycle: DEFAULT_LINES_PER_CYCLE,
    delayMs: DEFAULT_DELAY_MS,
    outputPath: null,
    keepFixture: false,
    help: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === "--help" || argument === "-h") {
      options.help = true;
      continue;
    }
    if (argument === "--keep-fixture") {
      options.keepFixture = true;
      continue;
    }

    const nextValue = argv[index + 1];
    if (!nextValue) {
      throw new Error(`missing value for ${argument}`);
    }

    if (argument === "--session") {
      options.session = nextValue;
      index += 1;
      continue;
    }
    if (argument === "--window") {
      options.window = nextValue;
      index += 1;
      continue;
    }
    if (argument === "--panes") {
      options.panes = parsePositiveInteger(nextValue, "--panes");
      index += 1;
      continue;
    }
    if (argument === "--profile") {
      if (nextValue !== "replay" && nextValue !== "load") {
        throw new Error(`--profile must be replay or load (received: ${nextValue})`);
      }
      options.profile = nextValue;
      index += 1;
      continue;
    }
    if (argument === "--cycles") {
      options.cycles = parsePositiveInteger(nextValue, "--cycles");
      index += 1;
      continue;
    }
    if (argument === "--lines-per-cycle") {
      options.linesPerCycle = parsePositiveInteger(nextValue, "--lines-per-cycle");
      index += 1;
      continue;
    }
    if (argument === "--delay-ms") {
      options.delayMs = parseNonNegativeInteger(nextValue, "--delay-ms");
      index += 1;
      continue;
    }
    if (argument === "--output") {
      options.outputPath = nextValue;
      index += 1;
      continue;
    }

    throw new Error(`unknown argument: ${argument}`);
  }

  return options;
}

/**
 * Resolves the checkpoint path to an absolute path.
 */
export function resolveCheckpointPath(outputPath: string | null, checkpointRunsDir: string): string {
  if (outputPath) {
    return path.isAbsolute(outputPath) ? outputPath : path.resolve(process.cwd(), outputPath);
  }
  const datePrefix = new Date().toISOString().slice(0, 10);
  return path.join(checkpointRunsDir, `${datePrefix}-a2-tmux-fixture-harness-evidence.md`);
}

function parsePositiveInteger(rawValue: string, optionName: string): number {
  if (!/^\d+$/.test(rawValue)) {
    throw new Error(`${optionName} must be an integer >= 1`);
  }
  const parsed = Number.parseInt(rawValue, 10);
  if (parsed < 1) {
    throw new Error(`${optionName} must be an integer >= 1`);
  }
  return parsed;
}

function parseNonNegativeInteger(rawValue: string, optionName: string): number {
  if (!/^\d+$/.test(rawValue)) {
    throw new Error(`${optionName} must be an integer >= 0`);
  }
  return Number.parseInt(rawValue, 10);
}

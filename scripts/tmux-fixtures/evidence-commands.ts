import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type {
  CommandResult,
  FixtureEvent,
  FixtureProfile,
  PaneCapture,
  PaneRow
} from "./evidence-types.js";

const execFileAsync = promisify(execFile);
const COMMAND_TIMEOUT_MS = 30_000;

const FIXTURE_LINE_PATTERN =
  /^\[fixture profile=(?<profile>[a-z]+) seq=(?<seq>\d+)\] .* pane=(?<pane>\d+) cycle=(?<cycle>\d+) line=(?<line>\d+)/;

/**
 * Error thrown when a shell command exits unsuccessfully.
 */
export class CommandFailure extends Error {
  public readonly result: CommandResult;

  constructor(result: CommandResult) {
    super(
      `${result.command} ${result.args.join(" ")} failed (duration=${result.durationMs}ms): ${result.stderr.trim() || "no stderr"}`
    );
    this.name = "CommandFailure";
    this.result = result;
  }
}

/**
 * Executes one tmux fixture shell script from this repository.
 */
export async function runFixtureScript(
  scriptDir: string,
  projectRoot: string,
  scriptName: string,
  scriptArgs: string[]
): Promise<CommandResult> {
  const scriptPath = path.join(scriptDir, scriptName);
  return runCommand(projectRoot, "bash", [scriptPath, ...scriptArgs]);
}

/**
 * Lists pane indices and pane IDs for the target session/window.
 */
export async function listPanes(
  projectRoot: string,
  sessionName: string,
  windowName: string
): Promise<PaneRow[]> {
  const listing = await runCommand(projectRoot, "tmux", [
    "list-panes",
    "-t",
    `${sessionName}:${windowName}`,
    "-F",
    "#{pane_index}\t#{pane_id}"
  ]);

  return listing.stdout
    .split("\n")
    .map((row) => row.trim())
    .filter((row) => row.length > 0)
    .map((row) => {
      const match = /^(\d+)(?:\\t|\s+)(.+)$/.exec(row);
      if (!match) {
        throw new Error(`invalid pane row: ${row}`);
      }
      const paneIndex = Number.parseInt(match[1], 10);
      const paneId = match[2].trim();
      if (!Number.isFinite(paneIndex) || !paneId) {
        throw new Error(`invalid pane row: ${row}`);
      }
      return { paneIndex, paneId };
    })
    .sort((left, right) => left.paneIndex - right.paneIndex);
}

/**
 * Captures a pane buffer and extracts fixture events for a profile.
 */
export async function capturePane(
  projectRoot: string,
  paneRow: PaneRow,
  profile: FixtureProfile
): Promise<PaneCapture> {
  const capture = await runCommand(projectRoot, "tmux", [
    "capture-pane",
    "-p",
    "-J",
    "-S",
    "-200",
    "-t",
    paneRow.paneId
  ]);
  const events = extractFixtureCandidateLines(capture.stdout)
    .map((line) => parseFixtureEvent(line))
    .filter((event): event is FixtureEvent => event !== null)
    .filter((event) => event.profile === profile);
  const uniqueBySeq = new Map<number, FixtureEvent>();
  for (const event of events) {
    if (!uniqueBySeq.has(event.seq)) {
      uniqueBySeq.set(event.seq, event);
    }
  }
  const dedupedEvents = Array.from(uniqueBySeq.values()).sort((left, right) => left.seq - right.seq);

  return {
    paneIndex: paneRow.paneIndex,
    paneId: paneRow.paneId,
    fixtureEventCount: dedupedEvents.length,
    events: dedupedEvents
  };
}

async function runCommand(projectRoot: string, command: string, args: string[]): Promise<CommandResult> {
  const startedAt = Date.now();
  try {
    const result = await execFileAsync(command, args, {
      cwd: projectRoot,
      timeout: COMMAND_TIMEOUT_MS,
      maxBuffer: 1024 * 1024
    });
    return {
      command,
      args,
      stdout: result.stdout.trim(),
      stderr: result.stderr.trim(),
      durationMs: Date.now() - startedAt,
      success: true
    };
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    const failedResult: CommandResult = {
      command,
      args,
      stdout:
        typeof (error as { stdout?: string }).stdout === "string" ? (error as { stdout: string }).stdout.trim() : "",
      stderr:
        typeof (error as { stderr?: string }).stderr === "string" ? (error as { stderr: string }).stderr.trim() : "",
      durationMs,
      success: false
    };
    throw new CommandFailure(failedResult);
  }
}

function parseFixtureEvent(line: string): FixtureEvent | null {
  const match = FIXTURE_LINE_PATTERN.exec(line);
  if (!match?.groups) {
    return null;
  }

  return {
    profile: match.groups.profile,
    seq: Number.parseInt(match.groups.seq, 10),
    pane: Number.parseInt(match.groups.pane, 10),
    cycle: Number.parseInt(match.groups.cycle, 10),
    line: Number.parseInt(match.groups.line, 10),
    raw: line
  };
}

/**
 * Extracts complete fixture event candidate lines from wrapped tmux captures.
 *
 * @param captureOutput Raw pane capture output.
 * @returns Reconstructed fixture candidate lines.
 */
function extractFixtureCandidateLines(captureOutput: string): string[] {
  const lines = captureOutput.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
  const fixtures: string[] = [];
  let current = "";

  for (const line of lines) {
    if (line.startsWith("[fixture profile=")) {
      if (current.length > 0) {
        fixtures.push(current);
      }
      current = line;
      continue;
    }
    if (current.length > 0) {
      // tmux wraps long lines; stitch continuation fragments back together.
      current += line;
    }
  }

  if (current.length > 0) {
    fixtures.push(current);
  }
  return fixtures;
}

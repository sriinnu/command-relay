import path from "node:path";
import process from "node:process";

import type { RunLedgerRecord, RunOpenTarget, RunRuntime } from "@commandrelay/run-core";
import { detectTerminalEnvironment } from "@commandrelay/terminal-discovery";
import type { RunOrchestrator } from "@commandrelay/run-orchestrator";

import { isBackend, type Backend } from "./backend.js";
import { assertLaunchableOpenBackend, createRunCliExecutionDependencies } from "./run-cli-runtime.js";

/**
 * Supported top-level run CLI operations.
 */
export type RunCliInvocation =
  | {
      kind: "run";
      runDirectory?: string;
      spec: {
        runtime: RunRuntime;
        command: string;
        title?: string;
        cwd?: string;
        shell?: string;
        detach: boolean;
        openTarget: RunOpenTarget | null;
      };
    }
  | { kind: "runs-ls"; runDirectory?: string }
  | { kind: "runs-inspect"; runId: string; runDirectory?: string }
  | { kind: "runs-open"; runId: string; openTarget: RunOpenTarget | null; runDirectory?: string }
  | { kind: "runs-stop"; runId: string; runDirectory?: string }
  | { kind: "runs-reconcile"; runId: string | null; runDirectory?: string };

/**
 * Dependency injection surface used to test run command execution.
 */
export interface RunCliExecutionDependencies {
  orchestrator: Pick<RunOrchestrator, "startRun" | "listRuns" | "inspectRun" | "stopRun" | "reconcileRun" | "reconcileRuns">;
  launchLocalTerminal: (backend: Backend, command: string) => void;
  detectOpenBackend: () => Backend;
  canLaunchBackend: (backend: Backend) => boolean;
}

/**
 * Parses top-level `run` and `runs` subcommands.
 *
 * @param argv Raw process argv slice after the executable.
 * @returns Parsed invocation or `null` when the CLI should continue with interactive mode.
 */
export function parseRunCliArgs(argv: string[]): RunCliInvocation | null {
  const [subcommand, ...rest] = argv;
  if (subcommand !== "run" && subcommand !== "runs") {
    return null;
  }

  if (subcommand === "run") {
    return parseSingleRunInvocation(rest);
  }

  return parseRunsInvocation(rest);
}

/**
 * Executes a parsed run invocation.
 *
 * @param invocation Parsed invocation.
 * @param writeLine Line writer used by the CLI entry point.
 * @param dependencies Optional overrides for tests.
 */
export async function executeRunCliInvocation(
  invocation: RunCliInvocation,
  writeLine: (text: string) => void,
  dependencies: Partial<RunCliExecutionDependencies> = {}
): Promise<void> {
  if (
    invocation.kind === "run" &&
    invocation.spec.runtime === "ssh-tmux" &&
    !dependencies.orchestrator &&
    !process.env.COMMANDRELAY_SSH_TARGET?.trim()
  ) {
    throw new Error("ssh-tmux runs require COMMANDRELAY_SSH_TARGET");
  }

  const resolvedDependencies = createRunCliExecutionDependencies(dependencies, invocation.runDirectory);

  if (invocation.kind === "run") {
    const record = await resolvedDependencies.orchestrator.startRun(invocation.spec);
    writeRunRecordSummary(record, writeLine);
    if (invocation.spec.openTarget) {
      const backend = toBackend(invocation.spec.openTarget);
      assertLaunchableOpenBackend(backend, resolvedDependencies);
      resolvedDependencies.launchLocalTerminal(backend, record.attachCommand);
      writeLine(`opened ${invocation.spec.openTarget} for ${record.runId}`);
    }
    return;
  }

  if (invocation.kind === "runs-ls") {
    const records = await resolvedDependencies.orchestrator.listRuns();
    if (records.length === 0) {
      writeLine("no durable runs recorded");
      return;
    }
    for (const record of records) {
      writeLine(
        `${record.runId}  ${record.runtime}  ${record.status}  ${record.updatedAt}  ${record.cwd}  ${record.sessionName}`
      );
    }
    return;
  }

  if (invocation.kind === "runs-open") {
    const record = await resolvedDependencies.orchestrator.inspectRun(invocation.runId);
    if (!record) {
      writeLine(`run not found: ${invocation.runId}`);
      return;
    }
    if (record.status !== "running") {
      writeLine(`cannot open ${record.runId}: status is ${record.status}`);
      return;
    }
    const backend = invocation.openTarget
      ? toBackend(invocation.openTarget)
      : resolvedDependencies.detectOpenBackend();
    if (invocation.openTarget) {
      assertLaunchableOpenBackend(backend, resolvedDependencies);
    }
    resolvedDependencies.launchLocalTerminal(backend, record.attachCommand);
    writeLine(`opened ${backend} for ${record.runId}`);
    return;
  }

  if (invocation.kind === "runs-stop") {
    const record = await resolvedDependencies.orchestrator.stopRun(invocation.runId);
    if (!record) {
      writeLine(`run not found: ${invocation.runId}`);
      return;
    }
    writeLine(`run stopped: ${record.runId}`);
    writeLine(`status: ${record.status}`);
    writeLine(`reason: ${record.statusReason ?? "none"}`);
    return;
  }

  if (invocation.kind === "runs-reconcile") {
    if (invocation.runId) {
      const record = await resolvedDependencies.orchestrator.reconcileRun(invocation.runId);
      if (!record) {
        writeLine(`run not found: ${invocation.runId}`);
        return;
      }
      writeLine(`reconciled ${record.runId}: ${record.status}`);
      return;
    }

    const records = await resolvedDependencies.orchestrator.reconcileRuns();
    writeLine(`reconciled ${records.length} durable runs`);
    for (const record of records) {
      writeLine(`${record.runId}  ${record.runtime}  ${record.status}`);
    }
    return;
  }

  const record = await resolvedDependencies.orchestrator.inspectRun(invocation.runId);
  if (!record) {
    writeLine(`run not found: ${invocation.runId}`);
    return;
  }
  writeLine(JSON.stringify(record, null, 2));
}

function parseSingleRunInvocation(argv: string[]): RunCliInvocation {
  let runtime: RunRuntime | null = null;
  let title: string | undefined;
  let cwd: string | undefined;
  let shell: string | undefined;
  let runDirectory: string | undefined;
  let detach = true;
  let openTarget: RunOpenTarget | null = null;
  let index = 0;

  while (index < argv.length) {
    const current = argv[index];
    const next = argv[index + 1];

    if (current === "--runtime") {
      if (!next) throw new Error("missing --runtime value");
      runtime = normalizeRunRuntime(next);
      index += 2;
      continue;
    }
    if (current === "--title") {
      if (!next) throw new Error("missing --title value");
      title = next;
      index += 2;
      continue;
    }
    if (current === "--cwd") {
      if (!next) throw new Error("missing --cwd value");
      cwd = next;
      index += 2;
      continue;
    }
    if (current === "--shell") {
      if (!next) throw new Error("missing --shell value");
      shell = next;
      index += 2;
      continue;
    }
    if (current === "--run-dir") {
      if (!next) throw new Error("missing --run-dir value");
      runDirectory = next;
      index += 2;
      continue;
    }
    if (current === "--open") {
      if (!next) throw new Error("missing --open value");
      openTarget = normalizeOpenTarget(next);
      index += 2;
      continue;
    }
    if (current === "--detach") {
      detach = true;
      index += 1;
      continue;
    }
    if (current === "--") {
      const command = argv.slice(index + 1).join(" ").trim();
      if (!command) throw new Error("run requires a command after --");
      return {
        kind: "run",
        runDirectory,
        spec: {
          runtime: runtime ?? detectDefaultRunRuntime(),
          command,
          title,
          cwd,
          shell,
          detach,
          openTarget
        }
      };
    }
    if (current.startsWith("--")) {
      throw new Error(`unknown option '${current}'`);
    }

    const command = argv.slice(index).join(" ").trim();
    if (!command) throw new Error("run requires a command");
    return {
      kind: "run",
      runDirectory,
      spec: {
        runtime: runtime ?? detectDefaultRunRuntime(),
        command,
        title,
        cwd,
        shell,
        detach,
        openTarget
      }
    };
  }

  throw new Error("run requires a command");
}

function parseRunsInvocation(argv: string[]): RunCliInvocation {
  const action = argv[0] ?? "ls";
  if (action === "ls") {
    return { kind: "runs-ls", runDirectory: parseRunDirectoryOption(argv.slice(1)) };
  }
  if (action === "inspect") {
    const runId = argv[1]?.trim();
    if (!runId) throw new Error("usage: runs inspect <run-id>");
    return { kind: "runs-inspect", runId, runDirectory: parseRunDirectoryOption(argv.slice(2)) };
  }
  if (action === "open") {
    const runId = argv[1]?.trim();
    if (!runId) throw new Error("usage: runs open <run-id> [--open ghostty|terminal.app|wt|powershell|cmd|wsl|console]");
    let openTarget: RunOpenTarget | null = null;
    let runDirectory: string | undefined;
    let index = 2;
    while (index < argv.length) {
      const current = argv[index];
      const next = argv[index + 1];
      if (current === "--run-dir") {
        if (!next) throw new Error("missing --run-dir value");
        runDirectory = next;
        index += 2;
        continue;
      }
      if (current === "--open") {
        if (!next) throw new Error("missing --open value");
        openTarget = normalizeOpenTarget(next);
        index += 2;
        continue;
      }
      throw new Error(`unknown option '${current}'`);
    }
    return { kind: "runs-open", runId, openTarget, runDirectory };
  }
  if (action === "stop") {
    const runId = argv[1]?.trim();
    if (!runId) throw new Error("usage: runs stop <run-id>");
    return { kind: "runs-stop", runId, runDirectory: parseRunDirectoryOption(argv.slice(2)) };
  }
  if (action === "reconcile") {
    let runId: string | null = null;
    let runDirectory: string | undefined;
    let index = 1;
    while (index < argv.length) {
      const current = argv[index];
      const next = argv[index + 1];
      if (current === "--run-dir") {
        if (!next) throw new Error("missing --run-dir value");
        runDirectory = next;
        index += 2;
        continue;
      }
      if (current === "--all") {
        runId = null;
        index += 1;
        continue;
      }
      if (current.startsWith("--")) {
        throw new Error(`unknown option '${current}'`);
      }
      if (runId) {
        throw new Error("usage: runs reconcile [<run-id>|--all]");
      }
      runId = current;
      index += 1;
    }
    return { kind: "runs-reconcile", runId, runDirectory };
  }

  throw new Error(`unknown runs action '${action}'`);
}

function detectDefaultRunRuntime(): RunRuntime {
  const preferredBackends = detectTerminalEnvironment().preferredRuntimeBackends;
  if (preferredBackends.includes("tmux")) return "tmux";
  return "managed";
}

function normalizeRunRuntime(value: string): RunRuntime {
  if (value === "managed" || value === "tmux" || value === "ssh-tmux") return value;
  throw new Error(`unsupported runtime '${value}'`);
}

function normalizeOpenTarget(value: string): RunOpenTarget {
  const normalized = value === "wt" ? "windows-terminal" : value;
  if (
    normalized === "ghostty" ||
    normalized === "terminal.app" ||
    normalized === "windows-terminal" ||
    normalized === "powershell" ||
    normalized === "cmd" ||
    normalized === "wsl" ||
    normalized === "console"
  ) {
    return normalized;
  }
  throw new Error(`unsupported open target '${value}'`);
}

function toBackend(openTarget: RunOpenTarget): Backend {
  if (!isBackend(openTarget)) {
    throw new Error(`unsupported backend '${openTarget}'`);
  }
  return openTarget;
}

function parseRunDirectoryOption(argv: string[]): string | undefined {
  if (argv.length === 0) return undefined;
  if (argv.length === 2 && argv[0] === "--run-dir") {
    return argv[1];
  }
  if (argv.length > 0) {
    throw new Error(`unknown option '${argv[0]}'`);
  }
  return undefined;
}

function writeRunRecordSummary(record: RunLedgerRecord, writeLine: (text: string) => void): void {
  writeLine(`run started: ${record.runId}`);
  writeLine(`runtime: ${record.runtime}`);
  writeLine(`status: ${record.status}`);
  writeLine(`title: ${record.title}`);
  writeLine(`cwd: ${path.resolve(record.cwd)}`);
  writeLine(`pane: ${record.paneId}`);
  writeLine(`attach: ${record.attachCommand}`);
  writeLine(`run-dir: ${record.runDirectory}`);
  writeLine(`ledger: ${record.ledgerPath}`);
}

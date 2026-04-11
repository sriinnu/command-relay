import process from "node:process";

import { RunOrchestrator } from "@commandrelay/run-orchestrator";
import { ManagedRuntimeAdapter } from "@commandrelay/runtime-managed";
import { SshTmuxRuntimeAdapter } from "@commandrelay/runtime-ssh";
import { detectTerminalEnvironment } from "@commandrelay/terminal-discovery";
import { TmuxRuntimeAdapter } from "@commandrelay/runtime-tmux";

import { canLaunchBackend, isBackend, launchLocalTerminal, type Backend } from "./backend.js";
import type { RunCliExecutionDependencies } from "./run-cli.js";

/**
 * Resolves the dependency set used by `run` and `runs` CLI actions.
 *
 * @param overrides Test overrides for the dependency surface.
 * @param runDirectory Optional durable run directory override.
 * @returns Fully realized execution dependencies.
 */
export function createRunCliExecutionDependencies(
  overrides: Partial<RunCliExecutionDependencies>,
  runDirectory?: string
): RunCliExecutionDependencies {
  return {
    orchestrator:
      overrides.orchestrator ??
      new RunOrchestrator({
        managedRuntime: new ManagedRuntimeAdapter(),
        tmuxRuntime: new TmuxRuntimeAdapter(),
        sshTmuxRuntime: resolveSshTmuxRuntime(),
        runDirectory
      }),
    launchLocalTerminal: overrides.launchLocalTerminal ?? launchLocalTerminal,
    detectOpenBackend: overrides.detectOpenBackend ?? (() => detectInteractiveOpenBackend()),
    canLaunchBackend: overrides.canLaunchBackend ?? ((backend) => canLaunchBackend(backend))
  };
}

/**
 * Throws when an explicit open target is unavailable on the current host.
 *
 * @param backend Explicit requested open backend.
 * @param dependencies Execution dependency subset providing launch checks.
 */
export function assertLaunchableOpenBackend(
  backend: Backend,
  dependencies: Pick<RunCliExecutionDependencies, "canLaunchBackend">
): void {
  if (backend !== "console" && !dependencies.canLaunchBackend(backend)) {
    throw new Error(`requested open target is unavailable on this host: ${backend}`);
  }
}

function resolveSshTmuxRuntime(): SshTmuxRuntimeAdapter | undefined {
  const sshTarget = process.env.COMMANDRELAY_SSH_TARGET?.trim();
  if (!sshTarget) {
    return undefined;
  }
  const sshPort = parseOptionalInteger(process.env.COMMANDRELAY_SSH_PORT);
  const connectTimeoutSeconds = parseOptionalInteger(process.env.COMMANDRELAY_SSH_CONNECT_TIMEOUT_SECONDS);
  return new SshTmuxRuntimeAdapter({
    sshTarget,
    sshPort: sshPort ?? undefined,
    sshCommand: process.env.COMMANDRELAY_SSH_COMMAND?.trim() || undefined,
    strictHostKeyChecking: parseOptionalBoolean(process.env.COMMANDRELAY_SSH_STRICT_HOST_KEY_CHECKING) ?? true,
    knownHostsFile: process.env.COMMANDRELAY_SSH_KNOWN_HOSTS_FILE?.trim() || null,
    expectedFingerprintSha256: process.env.COMMANDRELAY_SSH_EXPECTED_FINGERPRINT_SHA256?.trim() || null,
    connectTimeoutSeconds: connectTimeoutSeconds ?? undefined
  });
}

function parseOptionalInteger(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseOptionalBoolean(value: string | undefined): boolean | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "1" || normalized === "true" || normalized === "yes") return true;
  if (normalized === "0" || normalized === "false" || normalized === "no") return false;
  return null;
}

function detectInteractiveOpenBackend(): Backend {
  const backend = normalizeDetectedOpenBackend(detectTerminalEnvironment().terminalKind);
  if (!backend || !isBackend(backend)) {
    return "console";
  }
  return backend;
}

function normalizeDetectedOpenBackend(value: string): Backend | null {
  if (value === "windows-terminal") return value;
  if (value === "ghostty") return value;
  if (value === "terminal.app") return value;
  if (value === "powershell") return value;
  if (value === "cmd") return value;
  if (value === "wsl") return value;
  if (value === "console") return value;
  return null;
}

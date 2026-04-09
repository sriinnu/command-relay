/**
 * @file Launch contracts and shell invocation helpers for runtime backends.
 */

import path from "node:path";
import process from "node:process";

import type { RuntimeBackend, RuntimePane } from "./runtime-backend.js";

/**
 * Supported shell execution families for launched runtime commands.
 */
export type RuntimeShellFamily = "posix" | "cmd" | "powershell";

/**
 * One concrete shell invocation built from a shell executable and command text.
 */
export interface RuntimeShellInvocation {
  command: string;
  args: string[];
  shellFamily: RuntimeShellFamily;
}

/**
 * Launch request used by runtime backends that can create new panes or sessions.
 */
export interface RuntimeLaunchRequest {
  title: string;
  cwd: string;
  command: string;
  shell?: string;
}

/**
 * Started pane metadata returned by launch-capable runtime backends.
 */
export interface RuntimeStartedPane extends RuntimePane {
  sessionName: string;
  paneId: string;
  attachCommand: string;
}

/**
 * Extension of {@link RuntimeBackend} for backends that can launch new commands.
 */
export interface RunnableRuntimeBackend extends RuntimeBackend {
  /**
   * Starts a new long-lived runtime command and returns its pane metadata.
   *
   * @param request Launch specification.
   * @returns Started pane metadata.
   */
  startCommand(request: RuntimeLaunchRequest): Promise<RuntimeStartedPane>;

  /**
   * Stops a long-lived runtime command for the supplied pane or session handle.
   *
   * @param pane Existing pane metadata.
   * @returns Completes when the stop signal has been dispatched.
   */
  stopCommand(pane: RuntimePane): Promise<void>;

  /**
   * Builds a human-usable attach command for an existing pane.
   *
   * @param pane Existing pane metadata.
   * @returns Attach command text for a local shell.
   */
  buildAttachCommand(pane: RuntimePane): string;
}

/**
 * Returns true when a backend supports new-command launch operations.
 *
 * @param backend Runtime backend candidate.
 * @returns True when the backend implements the runnable contract.
 */
export function isRunnableRuntimeBackend(backend: RuntimeBackend): backend is RunnableRuntimeBackend {
  return (
    typeof backend === "object" &&
    backend !== null &&
    "startCommand" in backend &&
    typeof backend.startCommand === "function" &&
    "stopCommand" in backend &&
    typeof backend.stopCommand === "function" &&
    "buildAttachCommand" in backend &&
    typeof backend.buildAttachCommand === "function"
  );
}

/**
 * Resolves the default shell executable for the current host.
 *
 * @returns Absolute or bare executable name.
 */
export function resolveDefaultRuntimeShell(): string {
  if (process.platform === "win32") {
    return process.env.COMSPEC?.trim() || "cmd.exe";
  }
  return process.env.SHELL?.trim() || "sh";
}

/**
 * Builds a shell invocation that executes the provided command string.
 *
 * @param commandText Command text to execute inside the shell.
 * @param shell Optional shell executable override.
 * @returns Shell executable plus argv.
 */
export function buildRuntimeShellInvocation(
  commandText: string,
  shell = resolveDefaultRuntimeShell()
): RuntimeShellInvocation {
  const resolvedShell = shell.trim() || resolveDefaultRuntimeShell();
  const shellFamily = resolveRuntimeShellFamily(resolvedShell);

  if (shellFamily === "cmd") {
    return {
      command: resolvedShell,
      args: ["/d", "/s", "/c", commandText],
      shellFamily
    };
  }

  if (shellFamily === "powershell") {
    return {
      command: resolvedShell,
      args: ["-NoLogo", "-Command", commandText],
      shellFamily
    };
  }

  return {
    command: resolvedShell,
    args: ["-lc", commandText],
    shellFamily
  };
}

/**
 * Resolves the shell-family classifier for wrapper generation.
 *
 * @param shell Shell executable path or name.
 * @returns Normalized shell family.
 */
export function resolveRuntimeShellFamily(shell = resolveDefaultRuntimeShell()): RuntimeShellFamily {
  const resolvedShell = shell.trim() || resolveDefaultRuntimeShell();
  const shellName = path.basename(resolvedShell).toLowerCase();

  if (shellName === "cmd" || shellName === "cmd.exe") {
    return "cmd";
  }

  if (shellName === "pwsh" || shellName === "pwsh.exe" || shellName === "powershell" || shellName === "powershell.exe") {
    return "powershell";
  }

  return "posix";
}

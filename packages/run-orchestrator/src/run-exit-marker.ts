/**
 * @file Launch-time exit marker helpers for durable run completion reconciliation.
 */

import { readFile } from "node:fs/promises";

import { resolveRuntimeShellFamily } from "@commandrelay/runtime-core";

/**
 * Exit marker schema written by wrapped durable commands.
 */
export interface RunExitMarker {
  exitCode: number;
  endedAt: string | null;
}

/**
 * Builds a wrapped command string that records the process exit code to disk.
 *
 * @param command Original user command.
 * @param shell Shell executable used to launch the command.
 * @param exitMarkerPath Absolute path to the exit marker file.
 * @returns Wrapped command text for the selected shell family.
 */
export function buildRunWrappedCommand(command: string, shell: string, exitMarkerPath: string): string {
  const shellFamily = resolveRuntimeShellFamily(shell);
  if (shellFamily === "cmd") {
    return buildCmdWrappedCommand(command, exitMarkerPath);
  }
  if (shellFamily === "powershell") {
    return buildPowerShellWrappedCommand(command, exitMarkerPath);
  }
  return buildPosixWrappedCommand(command, exitMarkerPath);
}

/**
 * Loads and validates one exit marker file.
 *
 * @param exitMarkerPath Absolute path to the exit marker.
 * @returns Parsed marker or `null` when unavailable or invalid.
 */
export async function loadRunExitMarker(exitMarkerPath: string): Promise<RunExitMarker | null> {
  try {
    const raw = await readFile(exitMarkerPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return normalizeRunExitMarker(parsed);
  } catch {
    return null;
  }
}

function buildPosixWrappedCommand(command: string, exitMarkerPath: string): string {
  const marker = shellQuotePosix(exitMarkerPath);
  return [
    "{",
    command,
    "};",
    "__cr_exit=$?;",
    `printf '{\"exitCode\":%s,\"endedAt\":\"%s\"}\\n' \"$__cr_exit\" \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\" > ${marker};`,
    "exit $__cr_exit"
  ].join(" ");
}

function buildPowerShellWrappedCommand(command: string, exitMarkerPath: string): string {
  const marker = shellQuotePowerShell(exitMarkerPath);
  return [
    "$__crExit = 0;",
    "try {",
    "& {",
    command,
    "};",
    "if ($LASTEXITCODE -ne $null) { $__crExit = [int]$LASTEXITCODE }",
    "} catch {",
    "$__crExit = 1",
    "};",
    "$__crPayload = @{ exitCode = $__crExit; endedAt = [DateTime]::UtcNow.ToString('o') } | ConvertTo-Json -Compress;",
    `Set-Content -LiteralPath ${marker} -Value $__crPayload -Encoding utf8;`,
    "exit $__crExit"
  ].join(" ");
}

function buildCmdWrappedCommand(command: string, exitMarkerPath: string): string {
  const marker = shellQuoteCmd(exitMarkerPath);
  return [
    "(",
    command,
    ")",
    "&",
    'set "__CR_EXIT=%ERRORLEVEL%"',
    "&",
    `> ${marker} echo {"exitCode":%__CR_EXIT%}`,
    "&",
    "exit /b %__CR_EXIT%"
  ].join(" ");
}

function normalizeRunExitMarker(value: unknown): RunExitMarker | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const exitCode = readExitCode(record.exitCode);
  if (exitCode === null) {
    return null;
  }

  return {
    exitCode,
    endedAt: typeof record.endedAt === "string" ? record.endedAt : null
  };
}

function readExitCode(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value.trim(), 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function shellQuotePosix(value: string): string {
  if (!value.includes("'")) return `'${value}'`;
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

function shellQuotePowerShell(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function shellQuoteCmd(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

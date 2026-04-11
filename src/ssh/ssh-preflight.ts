/**
 * @file SSH client preflight helper for deterministic binary availability checks.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { runCommand } from "../utils/run-command.js";

const DEFAULT_SSH_COMMAND = "ssh";
const DEFAULT_TIMEOUT_MS = 5000;
const execFileAsync = promisify(execFile);

/**
 * Configuration for SSH client preflight checks.
 */
export interface SshPreflightOptions {
  sshCommand: string;
  timeoutMs?: number;
  runCommandImpl?: typeof runCommand;
}

/**
 * SSH client preflight check outcome.
 */
export interface SshPreflightResult {
  available: boolean;
  version: string | null;
  reason: string | null;
}

/**
 * Checks local SSH client availability by running `<sshCommand> -V`.
 *
 * @param options Optional command, timeout, and command runner overrides.
 * @returns Deterministic availability result that never throws for command failures.
 */
export async function checkSshClientAvailability(
  options: Partial<SshPreflightOptions> = {}
): Promise<SshPreflightResult> {
  const sshCommand = normalizeSshCommand(options.sshCommand);
  const timeoutMs = normalizeTimeoutMs(options.timeoutMs);
  const runCommandImpl = options.runCommandImpl ?? runCommand;

  try {
    const stdout = await runCommandImpl(sshCommand, ["-V"], timeoutMs);
    let version = extractSshVersion(stdout);
    if (!version && runCommandImpl === runCommand) {
      version = await readVersionFromExecFile(sshCommand, timeoutMs);
    }

    if (!version) {
      return {
        available: false,
        version: null,
        reason: "ssh_version_check_failed"
      };
    }

    return {
      available: true,
      version,
      reason: null
    };
  } catch (error) {
    const errorText = readErrorText(error);
    const version = extractSshVersion(errorText);

    if (version) {
      return {
        available: true,
        version,
        reason: null
      };
    }

    return {
      available: false,
      version: null,
      reason: classifyFailureReason(error, errorText)
    };
  }
}

/**
 * Reads SSH version text directly from stdout/stderr via execFile.
 * OpenSSH commonly emits `-V` output on stderr, so this fallback is required.
 *
 * @param sshCommand SSH executable path or command name.
 * @param timeoutMs Command timeout in milliseconds.
 * @returns Parsed SSH version token.
 */
async function readVersionFromExecFile(sshCommand: string, timeoutMs: number): Promise<string | null> {
  try {
    const { stdout, stderr } = await execFileAsync(sshCommand, ["-V"], {
      timeout: timeoutMs,
      windowsHide: true,
      encoding: "utf8",
      maxBuffer: 1024 * 1024
    });
    return extractSshVersion(`${stdout}\n${stderr}`);
  } catch (error) {
    const errorText = readErrorText(error);
    const version = extractSshVersion(errorText);
    if (version) {
      return version;
    }
    return null;
  }
}

/**
 * Normalizes configured SSH command with a safe default.
 *
 * @param sshCommand Optional SSH command value.
 * @returns Usable command string.
 */
function normalizeSshCommand(sshCommand: string | undefined): string {
  const trimmed = typeof sshCommand === "string" ? sshCommand.trim() : "";
  return trimmed.length > 0 ? trimmed : DEFAULT_SSH_COMMAND;
}

/**
 * Normalizes timeout values to positive integer milliseconds.
 *
 * @param timeoutMs Optional timeout value.
 * @returns Safe timeout value.
 */
function normalizeTimeoutMs(timeoutMs: number | undefined): number {
  if (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return DEFAULT_TIMEOUT_MS;
  }
  return Math.max(1, Math.trunc(timeoutMs));
}

/**
 * Extracts an SSH version token from process output text.
 *
 * @param rawText Output text from command stdout/stderr/error message.
 * @returns Normalized version token when available.
 */
function extractSshVersion(rawText: string): string | null {
  const normalized = String(rawText ?? "").replace(/\0/g, " ").trim();
  if (!normalized) {
    return null;
  }

  const openSshMatch = normalized.match(/\bOpenSSH[^\s,]*\d[^\s,]*/i);
  if (openSshMatch?.[0]) {
    return openSshMatch[0];
  }

  const dropbearMatch = normalized.match(/\bdropbear[^\s,]*\d[^\s,]*/i);
  if (dropbearMatch?.[0]) {
    return dropbearMatch[0];
  }

  const sshVersionLabelMatch = normalized.match(/\bssh(?:\.exe)?\s+version\s+[^\s,]+/i);
  if (sshVersionLabelMatch?.[0]) {
    return sshVersionLabelMatch[0];
  }

  const sshBannerMatch = normalized.match(/\bSSH-\d\.\d-[^\s,]+/);
  return sshBannerMatch?.[0] ?? null;
}

/**
 * Creates a joined text blob from unknown command errors.
 *
 * @param error Unknown command error.
 * @returns Combined error text with stderr/stdout fallbacks.
 */
function readErrorText(error: unknown): string {
  const segments: string[] = [];

  if (typeof error === "string") {
    segments.push(error);
  }

  if (error instanceof Error) {
    segments.push(error.message);
  }

  const record = asRecord(error);
  if (record) {
    const stdout = readText(record.stdout);
    const stderr = readText(record.stderr);
    const message = readText(record.message);

    if (message) {
      segments.push(message);
    }
    if (stdout) {
      segments.push(stdout);
    }
    if (stderr) {
      segments.push(stderr);
    }
  }

  return segments.join("\n");
}

/**
 * Classifies command failure reasons into deterministic keys.
 *
 * @param error Unknown command error.
 * @param errorText Combined command error text.
 * @returns Stable reason key.
 */
function classifyFailureReason(error: unknown, errorText: string): string {
  if (isMissingBinary(error, errorText)) {
    return "ssh_command_not_found";
  }

  if (isTimedOut(error, errorText)) {
    return "ssh_version_check_timeout";
  }

  return "ssh_version_check_failed";
}

/**
 * Checks if a command failed because the binary was not found.
 *
 * @param error Unknown command error.
 * @param errorText Combined command error text.
 * @returns True when the command appears missing.
 */
function isMissingBinary(error: unknown, errorText: string): boolean {
  const code = readText(asRecord(error)?.code).toUpperCase();
  if (code === "ENOENT") {
    return true;
  }

  const normalized = errorText.toLowerCase();
  return (
    normalized.includes("enoent") ||
    normalized.includes("not found") ||
    normalized.includes("is not recognized as an internal or external command")
  );
}

/**
 * Checks if command failure indicates a timeout.
 *
 * @param error Unknown command error.
 * @param errorText Combined command error text.
 * @returns True when timeout is detected.
 */
function isTimedOut(error: unknown, errorText: string): boolean {
  const code = readText(asRecord(error)?.code).toUpperCase();
  if (code === "ETIMEDOUT") {
    return true;
  }

  const normalized = errorText.toLowerCase();
  return normalized.includes("timed out") || normalized.includes("timeout");
}

/**
 * Reads unknown values as strings.
 *
 * @param value Unknown value.
 * @returns String value, or empty string.
 */
function readText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Narrows unknown values into object records.
 *
 * @param value Unknown value.
 * @returns Object record when object-like.
 */
function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

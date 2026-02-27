/**
 * @file Runtime backend adapter that executes tmux commands over SSH.
 */

import type { RuntimeBackend, RuntimePane } from "./runtime-backend.js";
import { runCommand } from "../utils/run-command.js";

const DEFAULT_SSH_COMMAND = "ssh";
const DEFAULT_TIMEOUT_MS = 6000;
const DEFAULT_CONNECT_TIMEOUT_SECONDS = 8;
const PANE_FORMAT = [
  "#{session_name}",
  "#{window_index}",
  "#{window_name}",
  "#{pane_index}",
  "#{pane_id}",
  "#{pane_title}",
  "#{pane_current_command}"
].join("\t");

type RunCommand = typeof runCommand;

/**
 * One tmux pane row returned by `list-panes`, normalized for runtime usage.
 */
export interface SshTmuxPane extends RuntimePane {
  sessionName: string;
  windowIndex: number;
  windowName: string;
  paneIndex: number;
  paneId: string;
  paneTitle: string;
  currentCommand: string;
}

/**
 * Constructor options for {@link SshTmuxAdapter}.
 */
export interface SshTmuxAdapterOptions {
  /**
   * SSH destination such as `user@host` or host alias from SSH config.
   */
  sshTarget: string;
  /**
   * Optional SSH TCP port.
   */
  sshPort?: number;
  /**
   * Local SSH client command or absolute executable path.
   */
  sshCommand?: string;
  /**
   * Controls `StrictHostKeyChecking` SSH option. Defaults to `true`.
   */
  strictHostKeyChecking?: boolean;
  /**
   * Command timeout in milliseconds. Defaults to 6000.
   */
  commandTimeoutMs?: number;
  /**
   * SSH connect timeout in seconds. Defaults to 8.
   */
  connectTimeoutSeconds?: number;
  /**
   * Optional command execution implementation for testing.
   */
  runCommandImpl?: RunCommand;
}

/**
 * Runtime backend that proxies tmux operations through SSH.
 */
export class SshTmuxAdapter implements RuntimeBackend {
  readonly backendId = "ssh-tmux";

  private readonly sshTarget: string;
  private readonly sshPort: number | null;
  private readonly sshCommand: string;
  private readonly strictHostKeyChecking: boolean;
  private readonly commandTimeoutMs: number;
  private readonly connectTimeoutSeconds: number;
  private readonly runCommandImpl: RunCommand;

  /**
   * @param options SSH target and optional execution settings.
   */
  constructor(options: SshTmuxAdapterOptions) {
    this.sshTarget = normalizeTarget(options.sshTarget);
    this.sshPort = normalizePort(options.sshPort);
    this.sshCommand = normalizeSshCommand(options.sshCommand);
    this.strictHostKeyChecking = options.strictHostKeyChecking ?? true;
    this.commandTimeoutMs = normalizeTimeoutMs(options.commandTimeoutMs);
    this.connectTimeoutSeconds = normalizeConnectTimeoutSeconds(options.connectTimeoutSeconds);
    this.runCommandImpl = options.runCommandImpl ?? runCommand;
  }

  /**
   * Checks whether remote tmux is reachable over SSH.
   *
   * @returns True when `tmux -V` succeeds remotely.
   */
  async isAvailable(): Promise<boolean> {
    try {
      await this.runTmux(["-V"]);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Lists panes across all remote tmux sessions.
   *
   * @returns Parsed pane metadata rows.
   */
  async listPanes(): Promise<SshTmuxPane[]> {
    let stdout = "";
    try {
      stdout = await this.runTmux(["list-panes", "-a", "-F", PANE_FORMAT]);
    } catch (error) {
      if (isNoServerError(error)) return [];
      throw error;
    }

    const lines = stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    return lines
      .map((line): SshTmuxPane | null => {
        const [sessionName, windowIndex, windowName, paneIndex, paneId, paneTitle, currentCommand] =
          line.split("\t");
        if (!paneId) return null;
        return {
          sessionName,
          windowIndex: Number.parseInt(windowIndex, 10) || 0,
          windowName,
          paneIndex: Number.parseInt(paneIndex, 10) || 0,
          paneId,
          paneTitle: paneTitle || "",
          currentCommand: currentCommand || ""
        };
      })
      .filter((pane): pane is SshTmuxPane => pane !== null);
  }

  /**
   * Captures remote pane output from tmux scrollback and screen.
   *
   * @param paneId tmux pane id.
   * @param lines Number of lines to capture from the end.
   * @returns Captured pane text.
   */
  async capturePane(paneId: string, lines: number): Promise<string> {
    const fromLine = Math.min(-1, -Math.abs(lines));
    return await this.runTmux(["capture-pane", "-p", "-J", "-S", String(fromLine), "-t", paneId]);
  }

  /**
   * Sends text to a remote pane while preserving newline boundaries.
   *
   * @param paneId tmux pane id.
   * @param rawInput Input text to send.
   * @returns Completes when all input segments are sent.
   */
  async sendInput(paneId: string, rawInput: string): Promise<void> {
    const normalized = String(rawInput ?? "");
    const lines = normalized.split("\n");

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (line.length > 0) {
        await this.runTmux(["send-keys", "-t", paneId, "-l", "--", line]);
      }
      if (i < lines.length - 1) {
        await this.runTmux(["send-keys", "-t", paneId, "C-m"]);
      }
    }
  }

  /**
   * Builds and executes an SSH command that runs a tmux subcommand remotely.
   *
   * @param tmuxArgs tmux command arguments.
   * @returns Command stdout.
   */
  private async runTmux(tmuxArgs: string[]): Promise<string> {
    const remoteCommand = buildRemoteCommand(["tmux", ...tmuxArgs]);
    const args = buildSshArgs(
      this.sshTarget,
      remoteCommand,
      this.sshPort,
      this.strictHostKeyChecking,
      this.connectTimeoutSeconds
    );
    return await this.runCommandImpl(this.sshCommand, args, this.commandTimeoutMs);
  }
}

/**
 * Builds SSH args including host key policy, destination, and remote command.
 *
 * @param sshTarget SSH destination.
 * @param remoteCommand Remote shell command string.
 * @param sshPort Optional SSH TCP port.
 * @param strictHostKeyChecking Strict host key policy.
 * @param connectTimeoutSeconds SSH connect timeout in seconds.
 * @returns SSH command arguments.
 */
function buildSshArgs(
  sshTarget: string,
  remoteCommand: string,
  sshPort: number | null,
  strictHostKeyChecking: boolean,
  connectTimeoutSeconds: number
): string[] {
  const args: string[] = [];
  if (sshPort !== null) {
    args.push("-p", String(sshPort));
  }
  args.push("-T");
  args.push("-o", "BatchMode=yes");
  args.push("-o", `ConnectTimeout=${connectTimeoutSeconds}`);
  args.push("-o", `StrictHostKeyChecking=${strictHostKeyChecking ? "yes" : "no"}`);
  if (!strictHostKeyChecking) {
    args.push("-o", "UserKnownHostsFile=/dev/null");
  }
  args.push(sshTarget, remoteCommand);
  return args;
}

/**
 * Safely composes a remote shell command from argv-like parts.
 *
 * @param parts Command parts.
 * @returns Shell-escaped remote command string.
 */
function buildRemoteCommand(parts: string[]): string {
  return parts.map((part) => shellEscape(String(part))).join(" ");
}

/**
 * Escapes one shell argument using single-quote escaping.
 *
 * @param value Raw argument value.
 * @returns Shell-safe token.
 */
function shellEscape(value: string): string {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) {
    return value;
  }
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

/**
 * Detects tmux no-server failures from command errors.
 *
 * @param error Command error object.
 * @returns True when no remote tmux server is active.
 */
function isNoServerError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as Record<string, unknown>;
  const stderr = typeof record.stderr === "string" ? record.stderr : "";
  const message = typeof record.message === "string" ? record.message : "";
  const combined = `${stderr}\n${message}`;
  return /no server running/i.test(combined) || /error connecting to .*default/i.test(combined);
}

/**
 * Validates and normalizes required SSH destination.
 *
 * @param sshTarget Raw SSH target.
 * @returns Trimmed target.
 */
function normalizeTarget(sshTarget: string): string {
  const normalized = typeof sshTarget === "string" ? sshTarget.trim() : "";
  if (!normalized) {
    throw new TypeError("sshTarget must be a non-empty string");
  }
  return normalized;
}

/**
 * Normalizes SSH command with a safe default.
 *
 * @param sshCommand Optional SSH command.
 * @returns Normalized command.
 */
function normalizeSshCommand(sshCommand: string | undefined): string {
  const normalized = typeof sshCommand === "string" ? sshCommand.trim() : "";
  return normalized || DEFAULT_SSH_COMMAND;
}

/**
 * Normalizes optional SSH port.
 *
 * @param sshPort Optional SSH port.
 * @returns Integer port number, or null when unset.
 */
function normalizePort(sshPort: number | undefined): number | null {
  if (typeof sshPort === "undefined") return null;
  if (!Number.isFinite(sshPort) || sshPort <= 0) {
    throw new TypeError("sshPort must be a positive number when provided");
  }
  return Math.trunc(sshPort);
}

/**
 * Normalizes command timeout.
 *
 * @param timeoutMs Optional timeout value.
 * @returns Positive timeout in milliseconds.
 */
function normalizeTimeoutMs(timeoutMs: number | undefined): number {
  if (!Number.isFinite(timeoutMs) || typeof timeoutMs !== "number" || timeoutMs <= 0) {
    return DEFAULT_TIMEOUT_MS;
  }
  return Math.max(1, Math.trunc(timeoutMs));
}

/**
 * Normalizes SSH connect timeout.
 *
 * @param timeoutSeconds Optional timeout in seconds.
 * @returns Connect timeout in seconds, constrained to 1..60.
 */
function normalizeConnectTimeoutSeconds(timeoutSeconds: number | undefined): number {
  if (typeof timeoutSeconds === "undefined") {
    return DEFAULT_CONNECT_TIMEOUT_SECONDS;
  }
  if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 1 || timeoutSeconds > 60) {
    throw new TypeError("connectTimeoutSeconds must be an integer between 1 and 60 when provided");
  }
  return timeoutSeconds;
}

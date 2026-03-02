/**
 * @file Runtime backend adapter that executes tmux commands over SSH.
 */

import { spawn } from "node:child_process";
import type { RuntimeBackend, RuntimePane } from "./runtime-backend.js";
import { runCommand } from "../utils/run-command.js";

const DEFAULT_SSH_COMMAND = "ssh";
const DEFAULT_SSH_KEYSCAN_COMMAND = "ssh-keyscan";
const DEFAULT_SSH_KEYGEN_COMMAND = "ssh-keygen";
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
type RunCommandWithInput = (
  command: string,
  args: string[],
  input: string,
  timeoutMs?: number
) => Promise<string>;

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
   * Optional known hosts file path passed via `UserKnownHostsFile`.
   */
  knownHostsFile?: string | null;
  /**
   * Optional expected SHA256 host fingerprint. Enables preflight verification.
   */
  expectedFingerprintSha256?: string | null;
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
  /**
   * Optional command runner that pipes UTF-8 stdin to the subprocess.
   */
  runCommandWithInputImpl?: RunCommandWithInput;
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
  private readonly knownHostsFile: string | null;
  private readonly expectedFingerprintSha256: string | null;
  private readonly commandTimeoutMs: number;
  private readonly connectTimeoutSeconds: number;
  private readonly runCommandImpl: RunCommand;
  private readonly runCommandWithInputImpl: RunCommandWithInput;
  private hostFingerprintVerified = false;

  constructor(options: SshTmuxAdapterOptions) {
    this.sshTarget = normalizeTarget(options.sshTarget);
    this.sshPort = normalizePort(options.sshPort);
    this.sshCommand = normalizeSshCommand(options.sshCommand);
    this.strictHostKeyChecking = options.strictHostKeyChecking ?? true;
    this.knownHostsFile = normalizeOptionalString(options.knownHostsFile);
    this.expectedFingerprintSha256 = normalizeFingerprint(options.expectedFingerprintSha256);
    this.commandTimeoutMs = normalizeTimeoutMs(options.commandTimeoutMs);
    this.connectTimeoutSeconds = normalizeConnectTimeoutSeconds(options.connectTimeoutSeconds);
    this.runCommandImpl = options.runCommandImpl ?? runCommand;
    this.runCommandWithInputImpl = options.runCommandWithInputImpl ?? runCommandWithInput;
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.runTmux(["-V"]);
      return true;
    } catch {
      return false;
    }
  }

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

  async capturePane(paneId: string, lines: number): Promise<string> {
    const fromLine = Math.min(-1, -Math.abs(lines));
    return await this.runTmux(["capture-pane", "-p", "-J", "-S", String(fromLine), "-t", paneId]);
  }

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

  private async runTmux(tmuxArgs: string[]): Promise<string> {
    if (this.expectedFingerprintSha256 !== null && !this.hostFingerprintVerified) {
      await this.verifyExpectedHostFingerprint();
      this.hostFingerprintVerified = true;
    }

    const remoteCommand = buildRemoteCommand(["tmux", ...tmuxArgs]);
    const args = buildSshArgs(
      this.sshTarget,
      remoteCommand,
      this.sshPort,
      this.strictHostKeyChecking,
      this.connectTimeoutSeconds,
      this.knownHostsFile
    );
    return await this.runCommandImpl(this.sshCommand, args, this.commandTimeoutMs);
  }

  private async verifyExpectedHostFingerprint(): Promise<void> {
    const expectedFingerprint = this.expectedFingerprintSha256;
    if (!expectedFingerprint) return;

    const keyscanArgs = buildKeyscanArgs(this.sshTarget, this.sshPort, this.connectTimeoutSeconds);
    let keyscanOutput = "";
    try {
      keyscanOutput = await this.runCommandImpl(
        DEFAULT_SSH_KEYSCAN_COMMAND,
        keyscanArgs,
        this.commandTimeoutMs
      );
    } catch (error) {
      throw new Error(
        `Unable to resolve SSH host fingerprint for ${this.sshTarget}: ssh-keyscan failed (${toErrorMessage(error)})`
      );
    }
    if (!keyscanOutput.trim()) {
      throw new Error(
        `Unable to resolve SSH host fingerprint for ${this.sshTarget}: ssh-keyscan returned no host keys`
      );
    }

    let keygenOutput = "";
    try {
      keygenOutput = await this.runCommandWithInputImpl(
        DEFAULT_SSH_KEYGEN_COMMAND,
        ["-lf", "-"],
        keyscanOutput,
        this.commandTimeoutMs
      );
    } catch (error) {
      throw new Error(
        `Unable to resolve SSH host fingerprint for ${this.sshTarget}: ssh-keygen failed (${toErrorMessage(error)})`
      );
    }

    const fingerprints = parseSha256Fingerprints(keygenOutput);
    if (fingerprints.length === 0) {
      throw new Error(
        `Unable to resolve SSH host fingerprint for ${this.sshTarget}: ssh-keygen output did not contain SHA256 fingerprints`
      );
    }
    if (!fingerprints.includes(expectedFingerprint)) {
      throw new Error(
        `SSH host fingerprint mismatch for ${this.sshTarget}: expected ${expectedFingerprint}, resolved ${fingerprints.join(", ")}`
      );
    }
  }
}

function buildSshArgs(
  sshTarget: string,
  remoteCommand: string,
  sshPort: number | null,
  strictHostKeyChecking: boolean,
  connectTimeoutSeconds: number,
  knownHostsFile: string | null
): string[] {
  const args: string[] = [];
  if (sshPort !== null) {
    args.push("-p", String(sshPort));
  }
  args.push("-T");
  args.push("-o", "BatchMode=yes");
  args.push("-o", `ConnectTimeout=${connectTimeoutSeconds}`);
  args.push("-o", `StrictHostKeyChecking=${strictHostKeyChecking ? "yes" : "no"}`);
  if (knownHostsFile !== null) {
    args.push("-o", `UserKnownHostsFile=${knownHostsFile}`);
  } else if (!strictHostKeyChecking) {
    args.push("-o", "UserKnownHostsFile=/dev/null");
  }
  args.push(sshTarget, remoteCommand);
  return args;
}

function buildKeyscanArgs(sshTarget: string, sshPort: number | null, connectTimeoutSeconds: number): string[] {
  const args: string[] = ["-T", String(connectTimeoutSeconds)];
  if (sshPort !== null) {
    args.push("-p", String(sshPort));
  }
  args.push(extractKeyscanHost(sshTarget));
  return args;
}

function extractKeyscanHost(sshTarget: string): string {
  const atIndex = sshTarget.lastIndexOf("@");
  const host = atIndex >= 0 ? sshTarget.slice(atIndex + 1) : sshTarget;
  if (host.startsWith("[") && host.endsWith("]")) {
    return host.slice(1, -1);
  }
  return host;
}

function parseSha256Fingerprints(output: string): string[] {
  const matches = output.match(/SHA256:[A-Za-z0-9+/=]+/g);
  if (!matches) return [];
  return [...new Set(matches)];
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return String(error);
}

function buildRemoteCommand(parts: string[]): string {
  return parts.map((part) => shellEscape(String(part))).join(" ");
}

function shellEscape(value: string): string {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) {
    return value;
  }
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

function isNoServerError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as Record<string, unknown>;
  const stderr = typeof record.stderr === "string" ? record.stderr : "";
  const message = typeof record.message === "string" ? record.message : "";
  const combined = `${stderr}\n${message}`;
  return /no server running/i.test(combined) || /error connecting to .*default/i.test(combined);
}

function normalizeTarget(sshTarget: string): string {
  const normalized = typeof sshTarget === "string" ? sshTarget.trim() : "";
  if (!normalized) {
    throw new TypeError("sshTarget must be a non-empty string");
  }
  return normalized;
}

function normalizeSshCommand(sshCommand: string | undefined): string {
  const normalized = typeof sshCommand === "string" ? sshCommand.trim() : "";
  return normalized || DEFAULT_SSH_COMMAND;
}

function normalizeOptionalString(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized ? normalized : null;
}

function normalizeFingerprint(value: string | null | undefined): string | null {
  const normalized = normalizeOptionalString(value);
  if (normalized === null) return null;
  if (normalized.toUpperCase().startsWith("SHA256:")) {
    return `SHA256:${normalized.slice(7)}`;
  }
  return `SHA256:${normalized}`;
}

function normalizePort(sshPort: number | undefined): number | null {
  if (typeof sshPort === "undefined") return null;
  if (!Number.isFinite(sshPort) || sshPort <= 0) {
    throw new TypeError("sshPort must be a positive number when provided");
  }
  return Math.trunc(sshPort);
}

function normalizeTimeoutMs(timeoutMs: number | undefined): number {
  if (!Number.isFinite(timeoutMs) || typeof timeoutMs !== "number" || timeoutMs <= 0) {
    return DEFAULT_TIMEOUT_MS;
  }
  return Math.max(1, Math.trunc(timeoutMs));
}

function normalizeConnectTimeoutSeconds(timeoutSeconds: number | undefined): number {
  if (typeof timeoutSeconds === "undefined") {
    return DEFAULT_CONNECT_TIMEOUT_SECONDS;
  }
  if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 1 || timeoutSeconds > 60) {
    throw new TypeError("connectTimeoutSeconds must be an integer between 1 and 60 when provided");
  }
  return timeoutSeconds;
}

async function runCommandWithInput(
  command: string,
  args: string[],
  input: string,
  timeoutMs = 5000
): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    let done = false;

    const finish = (callback: () => void): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      callback();
    };

    const timer = setTimeout(() => {
      child.kill();
      finish(() => reject(new Error(`Command timed out after ${timeoutMs}ms: ${command}`)));
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    child.on("error", (error) => {
      finish(() => reject(error));
    });

    child.on("close", (code, signal) => {
      finish(() => {
        if (code === 0) {
          resolve(stdout);
          return;
        }
        const signalSuffix = signal ? ` signal=${signal}` : "";
        const stderrSuffix = stderr.trim() ? ` stderr=${stderr.trim()}` : "";
        reject(new Error(`Command failed (${code})${signalSuffix}: ${command}${stderrSuffix}`));
      });
    });

    child.stdin.on("error", () => {
      // Ignore stream-closure races on process exit.
    });
    child.stdin.end(input);
  });
}

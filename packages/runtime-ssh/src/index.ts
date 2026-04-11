/**
 * @file Runtime backend adapter that executes tmux commands over SSH.
 */

import {
  buildRuntimeShellInvocation,
  execRuntimeCommand,
  execRuntimeCommandWithInput,
  normalizeRuntimeLineCount,
  type RunnableRuntimeBackend,
  type RuntimeLaunchRequest,
  type RuntimePane,
  type RuntimeStartedPane,
  type RuntimeCommandRunner,
  type RuntimeCommandRunnerWithInput
} from "@commandrelay/runtime-core";

const DEFAULT_TIMEOUT_MS = 6_000;
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

/**
 * One tmux pane row returned by `list-panes`, normalized for runtime usage.
 */
export interface SshTmuxRuntimePane extends RuntimePane {
  sessionName: string;
  windowIndex: number;
  windowName: string;
  paneIndex: number;
  paneId: string;
  paneTitle: string;
  currentCommand: string;
}

/**
 * Constructor options for {@link SshTmuxRuntimeAdapter}.
 */
export interface SshTmuxRuntimeAdapterOptions {
  sshTarget: string;
  sshPort?: number;
  sshCommand?: string;
  strictHostKeyChecking?: boolean;
  knownHostsFile?: string | null;
  expectedFingerprintSha256?: string | null;
  commandTimeoutMs?: number;
  connectTimeoutSeconds?: number;
  runCommandImpl?: RuntimeCommandRunner;
  runCommandWithInputImpl?: RuntimeCommandRunnerWithInput;
}

/**
 * Runtime backend that proxies tmux operations through SSH.
 */
export class SshTmuxRuntimeAdapter implements RunnableRuntimeBackend {
  readonly backendId = "ssh-tmux";

  private readonly sshTarget: string;
  private readonly sshPort: number | null;
  private readonly sshCommand: string;
  private readonly strictHostKeyChecking: boolean;
  private readonly knownHostsFile: string | null;
  private readonly expectedFingerprintSha256: string | null;
  private readonly commandTimeoutMs: number;
  private readonly connectTimeoutSeconds: number;
  private readonly runCommandImpl: RuntimeCommandRunner;
  private readonly runCommandWithInputImpl: RuntimeCommandRunnerWithInput;
  private hostFingerprintVerified = false;

  /**
   * @param options SSH runtime adapter settings.
   */
  constructor(options: SshTmuxRuntimeAdapterOptions) {
    this.sshTarget = normalizeTarget(options.sshTarget);
    this.sshPort = normalizePort(options.sshPort);
    this.sshCommand = normalizeSshCommand(options.sshCommand);
    this.strictHostKeyChecking = options.strictHostKeyChecking ?? true;
    this.knownHostsFile = normalizeOptionalString(options.knownHostsFile);
    this.expectedFingerprintSha256 = normalizeFingerprint(options.expectedFingerprintSha256);
    this.commandTimeoutMs = normalizeTimeoutMs(options.commandTimeoutMs);
    this.connectTimeoutSeconds = normalizeConnectTimeoutSeconds(options.connectTimeoutSeconds);
    this.runCommandImpl = options.runCommandImpl ?? execRuntimeCommand;
    this.runCommandWithInputImpl = options.runCommandWithInputImpl ?? execRuntimeCommandWithInput;
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.runTmux(["-V"]);
      return true;
    } catch {
      return false;
    }
  }

  async listPanes(): Promise<SshTmuxRuntimePane[]> {
    let stdout = "";
    try {
      stdout = await this.runTmux(["list-panes", "-a", "-F", PANE_FORMAT]);
    } catch (error) {
      if (isNoServerError(error)) return [];
      throw error;
    }

    return stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line): SshTmuxRuntimePane | null => {
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
      .filter((pane): pane is SshTmuxRuntimePane => pane !== null);
  }

  async capturePane(paneId: string, lines: number): Promise<string> {
    const fromLine = Math.min(-1, -normalizeRuntimeLineCount(lines));
    return await this.runTmux(["capture-pane", "-p", "-J", "-S", String(fromLine), "-t", paneId]);
  }

  async sendInput(paneId: string, rawInput: string): Promise<void> {
    const lines = String(rawInput ?? "").split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (line.length > 0) {
        await this.runTmux(["send-keys", "-t", paneId, "-l", "--", line]);
      }
      if (index < lines.length - 1) {
        await this.runTmux(["send-keys", "-t", paneId, "C-m"]);
      }
    }
  }

  /**
   * Starts a detached tmux session on the remote host and returns attach metadata.
   *
   * @param request Runtime launch request.
   * @returns Started remote pane metadata.
   */
  async startCommand(request: RuntimeLaunchRequest): Promise<RuntimeStartedPane> {
    const sessionName = normalizeTmuxSessionName(request.title);
    const windowName = normalizeTmuxWindowName(request.title);
    const invocation = buildRuntimeShellInvocation(request.command, request.shell);
    const stdout = await this.runTmux([
      "new-session",
      "-d",
      "-P",
      "-F",
      PANE_FORMAT,
      "-s",
      sessionName,
      "-n",
      windowName,
      "-c",
      request.cwd,
      buildShellCommandText(invocation.command, invocation.args)
    ]);
    const pane = parsePaneRow(stdout.trim());
    if (!pane) {
      throw new Error("ssh-tmux did not return pane metadata after launch");
    }
    return {
      ...pane,
      attachCommand: this.buildAttachCommand(pane)
    };
  }

  /**
   * Stops a remote tmux session or pane over SSH.
   *
   * @param pane Existing pane metadata.
   */
  async stopCommand(pane: RuntimePane): Promise<void> {
    const sessionName = typeof pane.sessionName === "string" ? pane.sessionName.trim() : "";
    if (sessionName) {
      await this.runTmux(["kill-session", "-t", sessionName]);
      return;
    }

    const paneId = typeof pane.paneId === "string" ? pane.paneId.trim() : "";
    if (!paneId) {
      throw new Error("ssh-tmux stop requires sessionName or paneId metadata");
    }
    await this.runTmux(["kill-pane", "-t", paneId]);
  }

  /**
   * Builds a human-usable local attach command for a remote tmux session.
   *
   * @param pane Existing pane metadata.
   * @returns SSH command that attaches to the remote tmux session.
   */
  buildAttachCommand(pane: RuntimePane): string {
    const sessionName = typeof pane.sessionName === "string" ? pane.sessionName.trim() : "";
    if (!sessionName) {
      throw new Error("ssh-tmux attach requires sessionName metadata");
    }
    const remoteCommand = buildRemoteCommand(["tmux", "attach-session", "-t", sessionName]);
    return buildSshCommandLine(
      this.sshCommand,
      buildSshArgs(
        this.sshTarget,
        remoteCommand,
        this.sshPort,
        this.strictHostKeyChecking,
        this.connectTimeoutSeconds,
        this.knownHostsFile,
        true
      )
    );
  }

  private async runTmux(tmuxArgs: string[]): Promise<string> {
    if (this.expectedFingerprintSha256 !== null && !this.hostFingerprintVerified) {
      await this.verifyExpectedHostFingerprint();
      this.hostFingerprintVerified = true;
    }

    return await this.runCommandImpl(
      this.sshCommand,
      buildSshArgs(
        this.sshTarget,
        buildRemoteCommand(["tmux", ...tmuxArgs]),
        this.sshPort,
        this.strictHostKeyChecking,
        this.connectTimeoutSeconds,
        this.knownHostsFile,
        false
      ),
      { timeoutMs: this.commandTimeoutMs }
    );
  }

  private async verifyExpectedHostFingerprint(): Promise<void> {
    if (!this.expectedFingerprintSha256) return;
    const keyscanOutput = await this.runCommandImpl(
      "ssh-keyscan",
      buildKeyscanArgs(this.sshTarget, this.sshPort, this.connectTimeoutSeconds),
      { timeoutMs: this.commandTimeoutMs }
    );
    if (!keyscanOutput.trim()) {
      throw new Error(`Unable to resolve SSH host fingerprint for ${this.sshTarget}: ssh-keyscan returned no host keys`);
    }

    const keygenOutput = await this.runCommandWithInputImpl(
      "ssh-keygen",
      ["-lf", "-"],
      keyscanOutput,
      { timeoutMs: this.commandTimeoutMs }
    );
    const fingerprints = parseSha256Fingerprints(keygenOutput);
    if (fingerprints.length === 0) {
      throw new Error(
        `Unable to resolve SSH host fingerprint for ${this.sshTarget}: ssh-keygen output did not contain SHA256 fingerprints`
      );
    }
    if (!fingerprints.includes(this.expectedFingerprintSha256)) {
      throw new Error(
        `SSH host fingerprint mismatch for ${this.sshTarget}: expected ${this.expectedFingerprintSha256}, resolved ${fingerprints.join(", ")}`
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
  knownHostsFile: string | null,
  allocateTty: boolean
): string[] {
  const args: string[] = [];
  if (sshPort !== null) args.push("-p", String(sshPort));
  args.push(allocateTty ? "-t" : "-T", "-o", "BatchMode=yes", "-o", `ConnectTimeout=${connectTimeoutSeconds}`);
  args.push("-o", `StrictHostKeyChecking=${strictHostKeyChecking ? "yes" : "no"}`);
  if (knownHostsFile !== null) {
    args.push("-o", `UserKnownHostsFile=${knownHostsFile}`);
  } else if (!strictHostKeyChecking) {
    args.push("-o", "UserKnownHostsFile=/dev/null");
  }
  args.push(sshTarget, remoteCommand);
  return args;
}

function buildSshCommandLine(command: string, args: string[]): string {
  return [command, ...args].map((part) => shellEscape(part)).join(" ");
}

function buildKeyscanArgs(sshTarget: string, sshPort: number | null, connectTimeoutSeconds: number): string[] {
  const args: string[] = ["-T", String(connectTimeoutSeconds)];
  if (sshPort !== null) args.push("-p", String(sshPort));
  args.push(extractKeyscanHost(sshTarget));
  return args;
}

function extractKeyscanHost(sshTarget: string): string {
  const atIndex = sshTarget.lastIndexOf("@");
  const host = atIndex >= 0 ? sshTarget.slice(atIndex + 1) : sshTarget;
  return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
}

function parseSha256Fingerprints(output: string): string[] {
  const matches = output.match(/SHA256:[A-Za-z0-9+/=]+/g);
  return matches ? [...new Set(matches)] : [];
}

function buildRemoteCommand(parts: string[]): string {
  return parts.map((part) => shellEscape(String(part))).join(" ");
}

function buildShellCommandText(command: string, args: string[]): string {
  return [command, ...args].map((part) => shellEscape(part)).join(" ");
}

function shellEscape(value: string): string {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

function isNoServerError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as Record<string, unknown>;
  const stderr = typeof record.stderr === "string" ? record.stderr : "";
  const message = typeof record.message === "string" ? record.message : "";
  return /no server running/i.test(`${stderr}\n${message}`) || /error connecting to .*default/i.test(`${stderr}\n${message}`);
}

function parsePaneRow(line: string): SshTmuxRuntimePane | null {
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
}

function normalizeTmuxSessionName(title: string): string {
  const normalized = title.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return (normalized || "commandrelay").slice(0, 48);
}

function normalizeTmuxWindowName(title: string): string {
  const trimmed = title.trim();
  return trimmed ? trimmed.slice(0, 32) : "commandrelay";
}

function normalizeTarget(sshTarget: string): string {
  const normalized = typeof sshTarget === "string" ? sshTarget.trim() : "";
  if (!normalized) throw new TypeError("sshTarget must be a non-empty string");
  return normalized;
}

function normalizeSshCommand(sshCommand: string | undefined): string {
  const normalized = typeof sshCommand === "string" ? sshCommand.trim() : "";
  return normalized || "ssh";
}

function normalizeOptionalString(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized ? normalized : null;
}

function normalizeFingerprint(value: string | null | undefined): string | null {
  const normalized = normalizeOptionalString(value);
  if (normalized === null) return null;
  return normalized.toUpperCase().startsWith("SHA256:") ? `SHA256:${normalized.slice(7)}` : `SHA256:${normalized}`;
}

function normalizePort(sshPort: number | undefined): number | null {
  if (typeof sshPort === "undefined") return null;
  if (!Number.isFinite(sshPort) || sshPort <= 0) throw new TypeError("sshPort must be a positive number when provided");
  return Math.trunc(sshPort);
}

function normalizeTimeoutMs(timeoutMs: number | undefined): number {
  if (!Number.isFinite(timeoutMs) || typeof timeoutMs !== "number" || timeoutMs <= 0) return DEFAULT_TIMEOUT_MS;
  return Math.max(1, Math.trunc(timeoutMs));
}

function normalizeConnectTimeoutSeconds(timeoutSeconds: number | undefined): number {
  if (typeof timeoutSeconds === "undefined") return DEFAULT_CONNECT_TIMEOUT_SECONDS;
  if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 1 || timeoutSeconds > 60) {
    throw new TypeError("connectTimeoutSeconds must be an integer between 1 and 60 when provided");
  }
  return timeoutSeconds;
}

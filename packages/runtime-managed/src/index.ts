/**
 * @file Managed runtime adapter for daemon-backed session discovery, capture, and input dispatch.
 */

import {
  buildRuntimeShellInvocation,
  execRuntimeCommand,
  normalizeRuntimeLineCount,
  type RunnableRuntimeBackend,
  type RuntimeLaunchRequest,
  type RuntimePane,
  type RuntimeCommandOptions,
  type RuntimeCommandRunner,
  type RuntimeStartedPane
} from "@commandrelay/runtime-core";

interface ManagedListResponse {
  items?: unknown[];
}

/**
 * One managed runtime session row normalized to the bridge pane shape.
 */
export interface ManagedRuntimePane extends RuntimePane {
  sessionName: string;
  windowIndex: number;
  windowName: string;
  paneIndex: number;
  paneId: string;
  paneTitle: string;
  currentCommand: string;
  status: string;
  inputNeeded: boolean;
  notificationsEnabled: boolean;
  cwd: string;
  createdAt: string;
  lastTotalBytes: number;
}

/**
 * Constructor options for {@link ManagedRuntimeAdapter}.
 */
export interface ManagedRuntimeAdapterOptions {
  command?: string;
  stateDir?: string | null;
  commandTimeoutMs?: number;
  autoStartDaemon?: boolean;
  pollAttempts?: number;
  pollDelayMs?: number;
  runCommandImpl?: RuntimeCommandRunner;
}

/**
 * Adapter around the managed runtime CLI for direct PTY-owned session management.
 */
export class ManagedRuntimeAdapter implements RunnableRuntimeBackend {
  readonly backendId = "managed";

  private readonly command: string;
  private readonly stateDir: string | null;
  private readonly commandTimeoutMs: number;
  private readonly autoStartDaemon: boolean;
  private readonly pollAttempts: number;
  private readonly pollDelayMs: number;
  private readonly runCommandImpl: RuntimeCommandRunner;
  private daemonReady = false;
  private daemonStatusFlight: Promise<boolean> | null = null;
  private daemonStartFlight: Promise<void> | null = null;

  /**
   * @param options Optional adapter settings.
   */
  constructor(options: ManagedRuntimeAdapterOptions = {}) {
    this.command = options.command ?? "oly";
    this.stateDir = options.stateDir ?? null;
    this.commandTimeoutMs = options.commandTimeoutMs ?? 8_000;
    this.autoStartDaemon = options.autoStartDaemon ?? true;
    this.pollAttempts = normalizePollAttempts(options.pollAttempts);
    this.pollDelayMs = normalizePollDelayMs(options.pollDelayMs);
    this.runCommandImpl = options.runCommandImpl ?? execRuntimeCommand;
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.ensureDaemonRunning();
      return true;
    } catch {
      return false;
    }
  }

  async listPanes(): Promise<ManagedRuntimePane[]> {
    await this.ensureDaemonRunning();
    return this.readPanes();
  }

  async capturePane(paneId: string, lines: number): Promise<string> {
    await this.ensureDaemonRunning();
    return await this.runManaged([
      "logs",
      paneId,
      "--tail",
      String(normalizeRuntimeLineCount(lines)),
      "--no-truncate"
    ]);
  }

  async sendInput(paneId: string, rawInput: string): Promise<void> {
    await this.ensureDaemonRunning();
    const lines = String(rawInput ?? "").replace(/\r\n/g, "\n").split("\n");

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (line.length > 0) {
        await this.runManaged(["send", paneId, line]);
      }
      if (index < lines.length - 1) {
        await this.runManaged(["send", paneId, "key:enter"]);
      }
    }
  }

  /**
   * Starts a detached managed-runtime session and returns the created pane.
   *
   * @param request Runtime launch request.
   * @returns Started pane metadata.
   */
  async startCommand(request: RuntimeLaunchRequest): Promise<RuntimeStartedPane> {
    await this.ensureDaemonRunning();
    const beforeIds = new Set((await this.readPanes()).map((pane) => pane.paneId));
    const invocation = buildRuntimeShellInvocation(request.command, request.shell);
    await this.runManaged([
      "start",
      "--detach",
      "--title",
      request.title,
      "--cwd",
      request.cwd,
      invocation.command,
      ...invocation.args
    ]);

    for (let attempt = 0; attempt < this.pollAttempts; attempt += 1) {
      const panes = await this.readPanes();
      const pane = resolveManagedStartedPane(panes, beforeIds, request.title);
      if (pane) {
        return {
          ...pane,
          attachCommand: this.buildAttachCommand(pane)
        };
      }
      if (attempt < this.pollAttempts - 1) {
        await sleep(this.pollDelayMs);
      }
    }

    throw new Error(`managed runtime did not expose a new pane for "${request.title}" after launch`);
  }

  /**
   * Stops a managed runtime session by pane id.
   *
   * @param pane Existing pane metadata.
   */
  async stopCommand(pane: RuntimePane): Promise<void> {
    await this.ensureDaemonRunning();
    const paneId = typeof pane.paneId === "string" ? pane.paneId.trim() : "";
    if (!paneId) {
      throw new Error("managed stop requires paneId metadata");
    }
    await this.runManaged(["stop", paneId]);
  }

  /**
   * Builds a local attach command for an existing managed pane.
   *
   * @param pane Existing pane metadata.
   * @returns `oly attach` command text.
   */
  buildAttachCommand(pane: RuntimePane): string {
    const paneId = typeof pane.paneId === "string" ? pane.paneId.trim() : "";
    if (!paneId) {
      throw new Error("managed attach requires paneId metadata");
    }
    return `${this.command} attach ${paneId}`;
  }

  private async ensureDaemonRunning(): Promise<void> {
    const daemonRunning = await this.checkDaemonStatus();
    if (daemonRunning) {
      this.daemonReady = true;
      return;
    }

    this.daemonReady = false;
    if (!this.autoStartDaemon) {
      throw new Error("managed runtime daemon is unavailable");
    }

    await this.startDaemon();
    if (!(await this.checkDaemonStatus())) {
      throw new Error("managed runtime daemon did not become ready after startup");
    }
    this.daemonReady = true;
  }

  private async checkDaemonStatus(): Promise<boolean> {
    if (this.daemonStatusFlight) {
      return this.daemonStatusFlight;
    }

    const flight = (async (): Promise<boolean> => {
      try {
        await this.runManaged(["daemon", "status"]);
        return true;
      } catch {
        return false;
      }
    })();

    this.daemonStatusFlight = flight;
    try {
      return await flight;
    } finally {
      if (this.daemonStatusFlight === flight) {
        this.daemonStatusFlight = null;
      }
    }
  }

  private async startDaemon(): Promise<void> {
    if (this.daemonStartFlight) {
      return this.daemonStartFlight;
    }

    const flight = (async (): Promise<void> => {
      await this.runManaged(["daemon", "start", "--detach", "--no-http", "--no-auth"]);
    })();
    this.daemonStartFlight = flight;
    try {
      await flight;
    } finally {
      if (this.daemonStartFlight === flight) {
        this.daemonStartFlight = null;
      }
    }
  }

  private async runManaged(args: string[]): Promise<string> {
    return await this.runCommandImpl(this.command, args, buildCommandOptions(this.commandTimeoutMs, this.stateDir));
  }

  private async readPanes(): Promise<ManagedRuntimePane[]> {
    const stdout = await this.runManaged(["ls", "--json", "--limit", "500"]);
    const payload = parseListResponse(stdout);
    return payload.items?.map((item) => toPane(item)).filter((pane): pane is ManagedRuntimePane => pane !== null) ?? [];
  }
}

function buildCommandOptions(timeoutMs: number, stateDir: string | null): RuntimeCommandOptions {
  if (!stateDir) {
    return { timeoutMs };
  }
  return {
    timeoutMs,
    env: { ...process.env, OLY_STATE_DIR: stateDir }
  };
}

function parseListResponse(stdout: string): ManagedListResponse {
  const trimmed = String(stdout ?? "").trim();
  if (!trimmed) return {};
  const parsed = JSON.parse(trimmed) as unknown;
  const record = asRecord(parsed);
  return { items: asArray(record?.items) ?? [] };
}

function toPane(value: unknown): ManagedRuntimePane | null {
  const record = asRecord(value);
  const paneId = readString(record?.id);
  if (!paneId) return null;

  const title = readString(record?.title);
  const command = readString(record?.command);
  const args = asArray(record?.arguments)?.map((entry) => readString(entry)).filter(Boolean) ?? [];

  return {
    sessionName: title ? `${title} [${paneId}]` : paneId,
    windowIndex: 0,
    windowName: readString(record?.status) || "managed",
    paneIndex: 0,
    paneId,
    paneTitle: title,
    currentCommand: [command, ...args].filter(Boolean).join(" ").trim(),
    status: readString(record?.status),
    inputNeeded: record?.input_needed === true,
    notificationsEnabled: record?.notifications_enabled === true,
    cwd: readString(record?.current_working_directory),
    createdAt: readString(record?.created_at),
    lastTotalBytes: readNumber(record?.last_total_bytes)
  };
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function readNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value !== "string") return 0;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
}

function resolveManagedStartedPane(
  panes: ManagedRuntimePane[],
  beforeIds: Set<string>,
  title: string
): ManagedRuntimePane | null {
  for (const pane of panes) {
    if (!beforeIds.has(pane.paneId) && pane.paneTitle === title) {
      return pane;
    }
  }

  for (const pane of panes) {
    if (!beforeIds.has(pane.paneId)) {
      return pane;
    }
  }

  return null;
}

function normalizePollAttempts(value: number | undefined): number {
  if (!Number.isInteger(value) || typeof value !== "number" || value < 1) return 8;
  return Math.min(20, value);
}

function normalizePollDelayMs(value: number | undefined): number {
  if (!Number.isFinite(value) || typeof value !== "number" || value < 0) return 100;
  return Math.min(2_000, Math.trunc(value));
}

async function sleep(durationMs: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, durationMs));
}

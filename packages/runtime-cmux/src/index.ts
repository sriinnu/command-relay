/**
 * @file cmux adapter for surface discovery, screen capture, and input dispatch.
 */

import {
  execRuntimeCommand,
  normalizeRuntimeLineCount,
  type RuntimeBackend,
  type RuntimePane,
  type RuntimeCommandRunner
} from "@commandrelay/runtime-core";

/**
 * One cmux terminal surface row normalized to the bridge pane shape.
 */
export interface CmuxRuntimePane extends RuntimePane {
  sessionName: string;
  windowIndex: number;
  windowName: string;
  paneIndex: number;
  paneId: string;
  paneTitle: string;
  currentCommand: string;
}

/**
 * Constructor options for {@link CmuxRuntimeAdapter}.
 */
export interface CmuxRuntimeAdapterOptions {
  cmuxCommand?: string;
  commandTimeoutMs?: number;
  runCommandImpl?: RuntimeCommandRunner;
}

/**
 * Adapter around cmux CLI commands.
 */
export class CmuxRuntimeAdapter implements RuntimeBackend {
  readonly backendId = "cmux";

  private readonly cmuxCommand: string;
  private readonly commandTimeoutMs: number;
  private readonly runCommandImpl: RuntimeCommandRunner;

  /**
   * @param options Optional adapter settings.
   */
  constructor(options: CmuxRuntimeAdapterOptions = {}) {
    this.cmuxCommand = options.cmuxCommand ?? "cmux";
    this.commandTimeoutMs = options.commandTimeoutMs ?? 6_000;
    this.runCommandImpl = options.runCommandImpl ?? execRuntimeCommand;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const stdout = await this.runCommandImpl(
        this.cmuxCommand,
        ["capabilities", "--json"],
        { timeoutMs: this.commandTimeoutMs }
      );
      return parseJsonOutput(stdout) !== null;
    } catch {
      return false;
    }
  }

  async listPanes(): Promise<CmuxRuntimePane[]> {
    const stdout = await this.runCommandImpl(
      this.cmuxCommand,
      ["list-surfaces", "--json"],
      { timeoutMs: this.commandTimeoutMs }
    );
    const payload = parseJsonOutput(stdout);
    if (!payload) return [];

    return extractSurfaces(payload)
      .map((surface) => toPaneRow(surface))
      .filter((pane): pane is CmuxRuntimePane => pane !== null);
  }

  async capturePane(paneId: string, lines: number): Promise<string> {
    const safeLines = normalizeRuntimeLineCount(lines);
    return await this.runCommandImpl(
      this.cmuxCommand,
      ["read-screen", "--surface", paneId, "--scrollback", "--lines", String(safeLines)],
      { timeoutMs: this.commandTimeoutMs }
    );
  }

  async sendInput(paneId: string, text: string): Promise<void> {
    await this.runCommandImpl(
      this.cmuxCommand,
      ["send", "--surface", paneId, String(text ?? "")],
      { timeoutMs: this.commandTimeoutMs }
    );
  }
}

function parseJsonOutput(stdout: string): unknown | null {
  const trimmed = String(stdout ?? "").trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    const start = trimmed.search(/[{\[]/);
    const end = Math.max(trimmed.lastIndexOf("}"), trimmed.lastIndexOf("]"));
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(trimmed.slice(start, end + 1)) as unknown;
    } catch {
      return null;
    }
  }
}

function extractSurfaces(payload: unknown): unknown[] {
  const root = asRecord(payload);
  if (!root) return [];

  const fromPayload = asRecord(root.payload);
  const resultFromPayload = asRecord(fromPayload?.result);
  const fromRootResult = asRecord(root.result);

  return (
    asArray(fromPayload?.surfaces) ??
    asArray(resultFromPayload?.surfaces) ??
    asArray(root.surfaces) ??
    asArray(fromRootResult?.surfaces) ??
    []
  );
}

function toPaneRow(surface: unknown): CmuxRuntimePane | null {
  const record = asRecord(surface);
  if (!record) return null;

  const surfaceType = readString(record.type).toLowerCase();
  if (surfaceType !== "terminal") return null;

  const paneId = readString(record.id) || readString(record.surfaceId);
  if (!paneId) return null;

  const windowRecord = asRecord(record.window);
  const windowName = readString(record.windowName) || readString(windowRecord?.name) || "cmux";

  return {
    sessionName: readString(record.sessionName) || readString(record.session) || "default",
    windowIndex: toNumber(record.windowIndex) || toNumber(windowRecord?.index),
    windowName,
    paneIndex: toNumber(record.paneIndex) || toNumber(record.index),
    paneId,
    paneTitle: readString(record.title) || readString(record.name),
    currentCommand: readString(record.currentCommand) || readString(record.command)
  };
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function toNumber(value: unknown): number {
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

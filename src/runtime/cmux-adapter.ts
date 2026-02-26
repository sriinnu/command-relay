/**
 * @file cmux adapter for surface discovery, screen capture, and input dispatch.
 */

import { runCommand } from "../utils/run-command.js";

type RunCommand = (command: string, args: string[], timeoutMs?: number) => Promise<string>;

/**
 * One cmux terminal surface row normalized to the bridge pane shape.
 */
export interface CmuxPane {
  sessionName: string;
  windowIndex: number;
  windowName: string;
  paneIndex: number;
  paneId: string;
  paneTitle: string;
  currentCommand: string;
}

interface CmuxAdapterOptions {
  cmuxCommand?: string;
  commandTimeoutMs?: number;
  runCommandImpl?: RunCommand;
}

/**
 * Adapter around cmux CLI commands.
 */
export class CmuxAdapter {
  private readonly cmuxCommand: string;
  private readonly commandTimeoutMs: number;
  private readonly runCommandImpl: RunCommand;

  /**
   * @param options Optional adapter settings.
   */
  constructor(options: CmuxAdapterOptions = {}) {
    this.cmuxCommand = options.cmuxCommand ?? "cmux";
    this.commandTimeoutMs = options.commandTimeoutMs ?? 6000;
    this.runCommandImpl = options.runCommandImpl ?? runCommand;
  }

  /**
   * Checks whether cmux is reachable and supports JSON capabilities output.
   *
   * @returns True when the command succeeds with parseable JSON output.
   */
  async isAvailable(): Promise<boolean> {
    try {
      const stdout = await this.runCommandImpl(
        this.cmuxCommand,
        ["capabilities", "--json"],
        this.commandTimeoutMs
      );
      return parseJsonOutput(stdout) !== null;
    } catch {
      return false;
    }
  }

  /**
   * Lists terminal surfaces and normalizes them to pane rows.
   *
   * @returns Parsed pane metadata.
   */
  async listPanes(): Promise<CmuxPane[]> {
    const stdout = await this.runCommandImpl(
      this.cmuxCommand,
      ["list-surfaces", "--json"],
      this.commandTimeoutMs
    );
    const payload = parseJsonOutput(stdout);
    if (!payload) return [];

    const surfaces = extractSurfaces(payload);
    return surfaces
      .map((surface) => toPaneRow(surface))
      .filter((pane): pane is CmuxPane => pane !== null);
  }

  /**
   * Captures terminal output for a specific cmux surface.
   *
   * @param paneId Surface identifier.
   * @param lines Number of tail lines to include.
   * @returns Captured surface text.
   */
  async capturePane(paneId: string, lines: number): Promise<string> {
    const safeLines = normalizeLineCount(lines);
    return await this.runCommandImpl(
      this.cmuxCommand,
      ["read-screen", "--surface", paneId, "--scrollback", "--lines", String(safeLines)],
      this.commandTimeoutMs
    );
  }

  /**
   * Sends raw input text to a surface.
   *
   * @param paneId Surface identifier.
   * @param text Input text to send.
   * @returns Completes when cmux acknowledges the send.
   */
  async sendInput(paneId: string, text: string): Promise<void> {
    await this.runCommandImpl(
      this.cmuxCommand,
      ["send", "--surface", paneId, String(text ?? "")],
      this.commandTimeoutMs
    );
  }
}

/**
 * Parses json with a fallback extraction path for prefixed logging noise.
 *
 * @param stdout Command stdout.
 * @returns Parsed payload object/array, or null when parsing fails.
 */
function parseJsonOutput(stdout: string): unknown | null {
  const trimmed = String(stdout ?? "").trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    // Some CLIs prepend log lines before JSON payloads; recover by slicing.
    const start = trimmed.search(/[{\[]/);
    const endObject = trimmed.lastIndexOf("}");
    const endArray = trimmed.lastIndexOf("]");
    const end = Math.max(endObject, endArray);
    if (start < 0 || end <= start) return null;
    const candidate = trimmed.slice(start, end + 1);
    try {
      return JSON.parse(candidate) as unknown;
    } catch {
      return null;
    }
  }
}

/**
 * Extracts surface arrays from known cmux json envelope shapes.
 *
 * @param payload Parsed cmux JSON payload.
 * @returns Surface records.
 */
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

/**
 * Maps a surface object into the bridge pane row shape.
 *
 * @param surface Raw cmux surface object.
 * @returns Normalized pane row or null when surface should be skipped.
 */
function toPaneRow(surface: unknown): CmuxPane | null {
  const record = asRecord(surface);
  if (!record) return null;

  const surfaceType = readString(record.type).toLowerCase();
  if (surfaceType !== "terminal") return null;

  const paneId = readString(record.id) || readString(record.surfaceId);
  if (!paneId) return null;

  const windowRecord = asRecord(record.window);
  const windowName = readString(record.windowName) || readString(windowRecord?.name) || "cmux";
  const windowIndex = toNumber(record.windowIndex) || toNumber(windowRecord?.index);

  return {
    sessionName: readString(record.sessionName) || readString(record.session) || "default",
    windowIndex,
    windowName,
    paneIndex: toNumber(record.paneIndex) || toNumber(record.index),
    paneId,
    paneTitle: readString(record.title) || readString(record.name),
    currentCommand: readString(record.currentCommand) || readString(record.command)
  };
}

/**
 * Ensures capture line counts are positive integers.
 *
 * @param lines Requested line count.
 * @returns A safe, non-zero integer line count.
 */
function normalizeLineCount(lines: number): number {
  const normalized = Math.trunc(Math.abs(Number(lines)));
  return Math.max(1, normalized);
}

/**
 * Reads a string property from unknown values.
 *
 * @param value Candidate value.
 * @returns Normalized string, or empty string.
 */
function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Converts unknown values into integer numbers with 0 fallback.
 *
 * @param value Candidate value.
 * @returns Integer representation or 0.
 */
function toNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value !== "string") return 0;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Narrows unknown values into records.
 *
 * @param value Candidate value.
 * @returns Record when object-like, otherwise null.
 */
function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Narrows unknown values into arrays.
 *
 * @param value Candidate value.
 * @returns Array when valid, otherwise null.
 */
function asArray(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
}

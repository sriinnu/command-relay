/**
 * @file tmux adapter for session discovery, pane capture, and input dispatch.
 */

import { runCommand } from "../utils/run-command.js";

const PANE_FORMAT = [
  "#{session_name}",
  "#{window_index}",
  "#{window_name}",
  "#{pane_index}",
  "#{pane_id}",
  "#{pane_title}",
  "#{pane_current_command}"
].join("\t");

/** One tmux pane row returned by `list-panes`. */
export interface TmuxPane {
  sessionName: string;
  windowIndex: number;
  windowName: string;
  paneIndex: number;
  paneId: string;
  paneTitle: string;
  currentCommand: string;
}

interface TmuxAdapterOptions {
  commandTimeoutMs?: number;
  runCommandImpl?: typeof runCommand;
}

/**
 * Adapter around tmux shell commands.
 */
export class TmuxAdapter {
  private readonly commandTimeoutMs: number;
  private readonly runCommandImpl: typeof runCommand;

  /**
   * @param options Optional adapter settings.
   */
  constructor(options: TmuxAdapterOptions = {}) {
    this.commandTimeoutMs = options.commandTimeoutMs ?? 6000;
    this.runCommandImpl = options.runCommandImpl ?? runCommand;
  }

  /**
   * Checks whether tmux is reachable.
   *
   * @returns True when tmux command returns successfully.
   */
  async isAvailable(): Promise<boolean> {
    try {
      await this.runCommandImpl("tmux", ["-V"], this.commandTimeoutMs);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Lists panes across all sessions.
   *
   * @returns Parsed pane metadata.
   */
  async listPanes(): Promise<TmuxPane[]> {
    let stdout = "";
    try {
      stdout = await this.runCommandImpl(
        "tmux",
        ["list-panes", "-a", "-F", PANE_FORMAT],
        this.commandTimeoutMs
      );
    } catch (error) {
      if (isNoServerError(error)) return [];
      throw error;
    }

    const lines = stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    return lines
      .map((line): TmuxPane | null => {
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
      .filter((pane): pane is TmuxPane => pane !== null);
  }

  /**
   * Captures pane output from tmux scrollback and screen.
   *
   * @param paneId tmux pane id.
   * @param lines Number of lines to capture from the end.
   * @returns Captured pane text.
   */
  async capturePane(paneId: string, lines: number): Promise<string> {
    const fromLine = Math.min(-1, -Math.abs(lines));
    const stdout = await this.runCommandImpl(
      "tmux",
      ["capture-pane", "-p", "-J", "-S", String(fromLine), "-t", paneId],
      this.commandTimeoutMs
    );
    return stdout;
  }

  /**
   * Sends input text to a target pane, preserving newlines.
   *
   * @param paneId tmux pane id.
   * @param rawInput Input text to send.
   * @returns Completes when all segments are sent.
   */
  async sendInput(paneId: string, rawInput: string): Promise<void> {
    const normalized = String(rawInput ?? "");
    const lines = normalized.split("\n");

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (line.length > 0) {
        await this.runCommandImpl(
          "tmux",
          ["send-keys", "-t", paneId, "-l", "--", line],
          this.commandTimeoutMs
        );
      }
      if (i < lines.length - 1) {
        await this.runCommandImpl("tmux", ["send-keys", "-t", paneId, "C-m"], this.commandTimeoutMs);
      }
    }
  }
}

/**
 * Detects the tmux "no server running" error family.
 *
 * @param error Command error object.
 * @returns True when no tmux server is currently active.
 */
function isNoServerError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const stderr = "stderr" in error ? String(error.stderr ?? "") : "";
  return /no server running/i.test(stderr) || /error connecting to .*default/i.test(stderr);
}

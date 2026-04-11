/**
 * @file tmux adapter for session discovery, pane capture, and input dispatch.
 */

import {
  buildRuntimeShellInvocation,
  execRuntimeCommand,
  normalizeRuntimeLineCount,
  type RunnableRuntimeBackend,
  type RuntimeLaunchRequest,
  type RuntimePane,
  type RuntimeStartedPane,
  type RuntimeCommandRunner
} from "@commandrelay/runtime-core";

const PANE_FORMAT = [
  "#{session_name}",
  "#{window_index}",
  "#{window_name}",
  "#{pane_index}",
  "#{pane_id}",
  "#{pane_title}",
  "#{pane_current_command}"
].join("\t");
const START_PANE_FORMAT = PANE_FORMAT;

/**
 * One tmux pane row returned by `list-panes`.
 */
export interface TmuxRuntimePane extends RuntimePane {
  sessionName: string;
  windowIndex: number;
  windowName: string;
  paneIndex: number;
  paneId: string;
  paneTitle: string;
  currentCommand: string;
}

/**
 * Constructor options for {@link TmuxRuntimeAdapter}.
 */
export interface TmuxRuntimeAdapterOptions {
  commandTimeoutMs?: number;
  runCommandImpl?: RuntimeCommandRunner;
}

/**
 * Adapter around tmux shell commands.
 */
export class TmuxRuntimeAdapter implements RunnableRuntimeBackend {
  readonly backendId = "tmux";

  private readonly commandTimeoutMs: number;
  private readonly runCommandImpl: RuntimeCommandRunner;

  /**
   * @param options Optional adapter settings.
   */
  constructor(options: TmuxRuntimeAdapterOptions = {}) {
    this.commandTimeoutMs = options.commandTimeoutMs ?? 6_000;
    this.runCommandImpl = options.runCommandImpl ?? execRuntimeCommand;
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.runCommandImpl("tmux", ["-V"], { timeoutMs: this.commandTimeoutMs });
      return true;
    } catch {
      return false;
    }
  }

  async listPanes(): Promise<TmuxRuntimePane[]> {
    let stdout = "";
    try {
      stdout = await this.runCommandImpl(
        "tmux",
        ["list-panes", "-a", "-F", PANE_FORMAT],
        { timeoutMs: this.commandTimeoutMs }
      );
    } catch (error) {
      if (isNoServerError(error)) return [];
      throw error;
    }

    return stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line): TmuxRuntimePane | null => {
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
      .filter((pane): pane is TmuxRuntimePane => pane !== null);
  }

  async capturePane(paneId: string, lines: number): Promise<string> {
    const safeLines = normalizeRuntimeLineCount(lines);
    const fromLine = Math.min(-1, -safeLines);
    return await this.runCommandImpl(
      "tmux",
      ["capture-pane", "-p", "-J", "-S", String(fromLine), "-t", paneId],
      { timeoutMs: this.commandTimeoutMs }
    );
  }

  async sendInput(paneId: string, rawInput: string): Promise<void> {
    const lines = String(rawInput ?? "").split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (line.length > 0) {
        await this.runCommandImpl(
          "tmux",
          ["send-keys", "-t", paneId, "-l", "--", line],
          { timeoutMs: this.commandTimeoutMs }
        );
      }
      if (index < lines.length - 1) {
        await this.runCommandImpl("tmux", ["send-keys", "-t", paneId, "C-m"], {
          timeoutMs: this.commandTimeoutMs
        });
      }
    }
  }

  /**
   * Starts a detached tmux session for a long-lived command.
   *
   * @param request Runtime launch request.
   * @returns Started pane metadata.
   */
  async startCommand(request: RuntimeLaunchRequest): Promise<RuntimeStartedPane> {
    const sessionName = normalizeTmuxSessionName(request.title);
    const windowName = normalizeTmuxWindowName(request.title);
    const invocation = buildRuntimeShellInvocation(request.command, request.shell);
    const stdout = await this.runCommandImpl(
      "tmux",
      [
        "new-session",
        "-d",
        "-P",
        "-F",
        START_PANE_FORMAT,
        "-s",
        sessionName,
        "-n",
        windowName,
        "-c",
        request.cwd,
        buildShellCommandText(invocation.command, invocation.args)
      ],
      { timeoutMs: this.commandTimeoutMs }
    );
    const pane = parsePaneRow(stdout.trim());
    if (!pane) {
      throw new Error("tmux did not return pane metadata after launch");
    }
    return {
      ...pane,
      attachCommand: this.buildAttachCommand(pane)
    };
  }

  /**
   * Stops a tmux session or pane for a durable run.
   *
   * @param pane Existing pane metadata.
   */
  async stopCommand(pane: RuntimePane): Promise<void> {
    const sessionName = typeof pane.sessionName === "string" ? pane.sessionName.trim() : "";
    if (sessionName) {
      await this.runCommandImpl("tmux", ["kill-session", "-t", sessionName], {
        timeoutMs: this.commandTimeoutMs
      });
      return;
    }

    const paneId = typeof pane.paneId === "string" ? pane.paneId.trim() : "";
    if (!paneId) {
      throw new Error("tmux stop requires sessionName or paneId metadata");
    }
    await this.runCommandImpl("tmux", ["kill-pane", "-t", paneId], {
      timeoutMs: this.commandTimeoutMs
    });
  }

  /**
   * Builds a local attach command for an existing tmux pane.
   *
   * @param pane Existing pane metadata.
   * @returns `tmux attach-session` command text.
   */
  buildAttachCommand(pane: RuntimePane): string {
    const sessionName = typeof pane.sessionName === "string" ? pane.sessionName.trim() : "";
    if (!sessionName) {
      throw new Error("tmux attach requires sessionName metadata");
    }
    return `tmux attach-session -t ${sessionName}`;
  }
}

function isNoServerError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const stderr = "stderr" in error ? String(error.stderr ?? "") : "";
  return /no server running/i.test(stderr) || /error connecting to .*default/i.test(stderr);
}

function parsePaneRow(line: string): TmuxRuntimePane | null {
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

function buildShellCommandText(command: string, args: string[]): string {
  return [command, ...args].map((part) => shellEscape(part)).join(" ");
}

function shellEscape(value: string): string {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

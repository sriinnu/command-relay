/**
 * @file Durable run contracts shared by CommandRelay orchestration packages.
 */

/**
 * Supported runtime authorities for durable local runs.
 */
export type RunRuntime = "managed" | "tmux" | "ssh-tmux";

/**
 * Supported host openers for attaching to an existing run.
 */
export type RunOpenTarget =
  | "ghostty"
  | "terminal.app"
  | "windows-terminal"
  | "powershell"
  | "cmd"
  | "wsl"
  | "console";

/**
 * Run lifecycle state persisted to disk.
 */
export type RunStatus = "starting" | "running" | "completed" | "stopped" | "failed" | "lost";

/**
 * Input specification used to start a new durable run.
 */
export interface RunSpec {
  runtime: RunRuntime;
  command: string;
  title?: string;
  cwd?: string;
  shell?: string;
  detach?: boolean;
  openTarget?: RunOpenTarget | null;
}

/**
 * Durable ledger record persisted for each started run.
 */
export interface RunLedgerRecord {
  runId: string;
  runtime: RunRuntime;
  title: string;
  command: string;
  cwd: string;
  shell: string;
  detach: boolean;
  status: RunStatus;
  statusReason: string | null;
  paneId: string;
  sessionName: string;
  attachCommand: string;
  openTarget: RunOpenTarget | null;
  runDirectory: string;
  createdAt: string;
  updatedAt: string;
  lastSeenAt: string | null;
  endedAt: string | null;
  exitCode: number | null;
  ledgerPath: string;
}

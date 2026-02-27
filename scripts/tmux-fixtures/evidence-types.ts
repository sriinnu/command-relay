/** Supported fixture emission profiles. */
export type FixtureProfile = "replay" | "load";

/** CLI options for running fixture evidence. */
export interface Options {
  session: string;
  window: string;
  panes: number;
  profile: FixtureProfile;
  cycles: number;
  linesPerCycle: number;
  delayMs: number;
  outputPath: string | null;
  keepFixture: boolean;
  help: boolean;
}

/** Result of a command invoked by the evidence harness. */
export interface CommandResult {
  command: string;
  args: string[];
  stdout: string;
  stderr: string;
  durationMs: number;
  success: boolean;
}

/** Parsed pane row from `tmux list-panes`. */
export interface PaneRow {
  paneIndex: number;
  paneId: string;
}

/** Parsed fixture event line from pane capture output. */
export interface FixtureEvent {
  profile: string;
  seq: number;
  pane: number;
  cycle: number;
  line: number;
  raw: string;
}

/** Event capture summary for one pane. */
export interface PaneCapture {
  paneIndex: number;
  paneId: string;
  fixtureEventCount: number;
  events: FixtureEvent[];
}

/** Single assertion result emitted by the harness. */
export interface AssertionResult {
  name: string;
  passed: boolean;
  detail: string;
}

/** Per-stage command execution results. */
export interface CommandResults {
  create?: CommandResult;
  emit?: CommandResult;
  teardown?: CommandResult;
}

/** Input object for checkpoint markdown generation. */
export interface CheckpointMarkdownInput {
  checkpointDate: string;
  checkpointPath: string;
  options: Options;
  commandResults: CommandResults;
  paneCaptures: PaneCapture[];
  assertionResults: AssertionResult[];
  overallPassed: boolean;
  failureSummary: string;
}

import assert from "node:assert/strict";
import test from "node:test";
import { TmuxRuntimeAdapter } from "../src/index.js";
import type { RuntimeCommandOptions } from "@commandrelay/runtime-core";

interface RunCommandMockCall {
  command: string;
  args: string[];
  timeoutMs?: number;
}

function createRunCommandMock(outcomes: Array<{ stdout?: string; error?: unknown }>) {
  const queue = [...outcomes];
  const calls: RunCommandMockCall[] = [];

  return {
    calls,
    async runCommandImpl(
      command: string,
      args: string[],
      options: RuntimeCommandOptions | number = {}
    ): Promise<string> {
      const normalizedOptions = typeof options === "number" ? { timeoutMs: options } : options;
      calls.push({ command, args, timeoutMs: normalizedOptions.timeoutMs });
      const next = queue.shift();
      if (!next) throw new Error("runCommand called with no queued outcome");
      if (next.error) throw next.error;
      return next.stdout ?? "";
    }
  };
}

test("listPanes parses tmux output rows and normalizes numeric values", async () => {
  const mock = createRunCommandMock([
    { stdout: ["dev\t1\teditor\t0\t%1\t\tbash", "prod\tx\tserver\ty\t%2\tOps\tzsh"].join("\n") }
  ]);
  const adapter = new TmuxRuntimeAdapter({
    commandTimeoutMs: 1234,
    runCommandImpl: mock.runCommandImpl
  });

  const panes = await adapter.listPanes();

  assert.deepEqual(mock.calls[0], {
    command: "tmux",
    args: ["list-panes", "-a", "-F", "#{session_name}\t#{window_index}\t#{window_name}\t#{pane_index}\t#{pane_id}\t#{pane_title}\t#{pane_current_command}"],
    timeoutMs: 1234
  });
  assert.deepEqual(panes, [
    {
      sessionName: "dev",
      windowIndex: 1,
      windowName: "editor",
      paneIndex: 0,
      paneId: "%1",
      paneTitle: "",
      currentCommand: "bash"
    },
    {
      sessionName: "prod",
      windowIndex: 0,
      windowName: "server",
      paneIndex: 0,
      paneId: "%2",
      paneTitle: "Ops",
      currentCommand: "zsh"
    }
  ]);
});

test("startCommand launches a detached tmux session and returns attach metadata", async () => {
  const mock = createRunCommandMock([
    { stdout: "feature-branch\t0\tFix tests\t0\t%9\t\tbash" }
  ]);
  const adapter = new TmuxRuntimeAdapter({
    commandTimeoutMs: 900,
    runCommandImpl: mock.runCommandImpl
  });

  const pane = await adapter.startCommand({
    title: "Feature Branch",
    cwd: "/tmp/work",
    command: "npm test",
    shell: "/bin/bash"
  });

  assert.deepEqual(mock.calls[0], {
    command: "tmux",
    args: [
      "new-session",
      "-d",
      "-P",
      "-F",
      "#{session_name}\t#{window_index}\t#{window_name}\t#{pane_index}\t#{pane_id}\t#{pane_title}\t#{pane_current_command}",
      "-s",
      "feature-branch",
      "-n",
      "Feature Branch",
      "-c",
      "/tmp/work",
      "/bin/bash -lc 'npm test'"
    ],
    timeoutMs: 900
  });
  assert.deepEqual(pane, {
    sessionName: "feature-branch",
    windowIndex: 0,
    windowName: "Fix tests",
    paneIndex: 0,
    paneId: "%9",
    paneTitle: "",
    currentCommand: "bash",
    attachCommand: "tmux attach-session -t feature-branch"
  });
});

test("stopCommand prefers killing the tmux session when session metadata is present", async () => {
  const mock = createRunCommandMock([{ stdout: "" }]);
  const adapter = new TmuxRuntimeAdapter({
    commandTimeoutMs: 900,
    runCommandImpl: mock.runCommandImpl
  });

  await adapter.stopCommand({ paneId: "%9", sessionName: "feature-branch" });

  assert.deepEqual(mock.calls[0], {
    command: "tmux",
    args: ["kill-session", "-t", "feature-branch"],
    timeoutMs: 900
  });
});

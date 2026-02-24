/**
 * @file Unit tests for tmux adapter parsing and error handling.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { TmuxAdapter } from "./tmux-adapter.js";

interface RunCommandMockCall {
  command: string;
  args: string[];
  timeoutMs: number;
}

interface RunCommandMock {
  calls: RunCommandMockCall[];
  runCommandImpl: (command: string, args: string[], timeoutMs?: number) => Promise<string>;
}

/**
 * Creates a deterministic async command runner mock with queued outcomes.
 */
function createRunCommandMock(outcomes: Array<{ stdout?: string; error?: unknown }>): RunCommandMock {
  const queue = [...outcomes];
  const calls: RunCommandMockCall[] = [];

  return {
    calls,
    async runCommandImpl(command: string, args: string[], timeoutMs = 5000): Promise<string> {
      calls.push({ command, args, timeoutMs });
      const next = queue.shift();
      if (!next) {
        throw new Error("runCommand called with no queued outcome");
      }
      if (next.error) {
        throw next.error;
      }
      return next.stdout ?? "";
    }
  };
}

test("listPanes parses tmux output rows and normalizes numeric values", async () => {
  const mock = createRunCommandMock([
    {
      stdout: [
        "dev\t1\teditor\t0\t%1\t\tbash",
        "prod\tnot-number\tserver\tnan\t%2\tOps\tzsh",
        "incomplete-row"
      ].join("\n")
    }
  ]);

  const adapter = new TmuxAdapter({
    commandTimeoutMs: 1234,
    runCommandImpl: mock.runCommandImpl
  });

  const panes = await adapter.listPanes();

  assert.equal(mock.calls.length, 1);
  assert.deepEqual(mock.calls[0], {
    command: "tmux",
    args: [
      "list-panes",
      "-a",
      "-F",
      "#{session_name}\t#{window_index}\t#{window_name}\t#{pane_index}\t#{pane_id}\t#{pane_title}\t#{pane_current_command}"
    ],
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

test("listPanes returns an empty list when tmux server is not running", async () => {
  const mock = createRunCommandMock([
    {
      error: {
        stderr: "no server running on /tmp/tmux-1000/default"
      }
    }
  ]);

  const adapter = new TmuxAdapter({ runCommandImpl: mock.runCommandImpl });
  const panes = await adapter.listPanes();

  assert.deepEqual(panes, []);
});

test("listPanes rethrows non-no-server errors", async () => {
  const expectedError = new Error("permission denied");
  const mock = createRunCommandMock([{ error: expectedError }]);

  const adapter = new TmuxAdapter({ runCommandImpl: mock.runCommandImpl });

  await assert.rejects(async () => adapter.listPanes(), expectedError);
});

test("capturePane clamps start line to at most -1", async () => {
  const mock = createRunCommandMock([{ stdout: "content" }, { stdout: "content-again" }]);
  const adapter = new TmuxAdapter({ runCommandImpl: mock.runCommandImpl });

  await adapter.capturePane("%9", 0);
  await adapter.capturePane("%9", 120);

  assert.equal(mock.calls.length, 2);
  assert.deepEqual(mock.calls[0].args, ["capture-pane", "-p", "-J", "-S", "-1", "-t", "%9"]);
  assert.deepEqual(mock.calls[1].args, ["capture-pane", "-p", "-J", "-S", "-120", "-t", "%9"]);
});

test("sendInput preserves newline boundaries and skips empty literal sends", async () => {
  const mock = createRunCommandMock([
    { stdout: "" },
    { stdout: "" },
    { stdout: "" },
    { stdout: "" }
  ]);
  const adapter = new TmuxAdapter({ runCommandImpl: mock.runCommandImpl });

  await adapter.sendInput("%3", "echo hello\n\npwd");

  assert.equal(mock.calls.length, 4);
  assert.deepEqual(mock.calls.map((call) => call.args), [
    ["send-keys", "-t", "%3", "-l", "--", "echo hello"],
    ["send-keys", "-t", "%3", "C-m"],
    ["send-keys", "-t", "%3", "C-m"],
    ["send-keys", "-t", "%3", "-l", "--", "pwd"]
  ]);
});

/**
 * @file Unit tests for oly adapter daemon management and command dispatch behavior.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { OlyAdapter } from "./oly-adapter.js";

interface RunCommandMockCall {
  command: string;
  args: string[];
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
}

interface RunCommandMock {
  calls: RunCommandMockCall[];
  runCommandImpl: (
    command: string,
    args: string[],
    options?: { timeoutMs?: number; env?: NodeJS.ProcessEnv }
  ) => Promise<string>;
}

/**
 * Creates a deterministic async command runner mock with queued outcomes.
 *
 * @param outcomes Ordered command outcomes.
 * @returns Mock runner and call log.
 */
function createRunCommandMock(outcomes: Array<{ stdout?: string; error?: unknown }>): RunCommandMock {
  const queue = [...outcomes];
  const calls: RunCommandMockCall[] = [];

  return {
    calls,
    async runCommandImpl(command, args, options = {}): Promise<string> {
      calls.push({
        command,
        args,
        timeoutMs: options.timeoutMs,
        env: options.env
      });
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

test("isAvailable returns true when daemon status succeeds", async () => {
  const mock = createRunCommandMock([{ stdout: "running" }]);
  const adapter = new OlyAdapter({
    olyCommand: "oly-bin",
    commandTimeoutMs: 4444,
    runCommandImpl: mock.runCommandImpl
  });

  const available = await adapter.isAvailable();

  assert.equal(available, true);
  assert.deepEqual(mock.calls, [
    {
      command: "oly-bin",
      args: ["daemon", "status"],
      timeoutMs: 4444,
      env: undefined
    }
  ]);
});

test("isAvailable starts daemon when initial status check fails", async () => {
  const mock = createRunCommandMock([
    { error: new Error("not running") },
    { stdout: "started" },
    { stdout: "running" }
  ]);
  const adapter = new OlyAdapter({ runCommandImpl: mock.runCommandImpl });

  const available = await adapter.isAvailable();

  assert.equal(available, true);
  assert.deepEqual(mock.calls.map((call) => call.args), [
    ["daemon", "status"],
    ["daemon", "start", "--detach", "--no-http", "--no-auth"],
    ["daemon", "status"]
  ]);
});

test("listPanes parses oly ls output into runtime panes", async () => {
  const mock = createRunCommandMock([
    { stdout: "running" },
    {
      stdout: JSON.stringify({
        items: [
          {
            id: "sess-1",
            title: "agent",
            command: "bash",
            arguments: ["-lc", "npm test"],
            current_working_directory: "/tmp/project",
            status: "running",
            input_needed: true,
            notifications_enabled: false,
            created_at: "2026-04-09T08:00:00Z",
            last_total_bytes: 1234
          },
          {
            id: "",
            title: "skip-me"
          }
        ]
      })
    }
  ]);
  const adapter = new OlyAdapter({ runCommandImpl: mock.runCommandImpl });

  const panes = await adapter.listPanes();

  assert.deepEqual(mock.calls.map((call) => call.args), [
    ["daemon", "status"],
    ["ls", "--json", "--limit", "500"]
  ]);
  assert.deepEqual(panes, [
    {
      sessionName: "agent [sess-1]",
      windowIndex: 0,
      windowName: "running",
      paneIndex: 0,
      paneId: "sess-1",
      paneTitle: "agent",
      currentCommand: "bash -lc npm test",
      status: "running",
      inputNeeded: true,
      notificationsEnabled: false,
      cwd: "/tmp/project",
      createdAt: "2026-04-09T08:00:00Z",
      lastTotalBytes: 1234
    }
  ]);
});

test("capturePane uses logs --tail with a safe line count", async () => {
  const mock = createRunCommandMock([{ stdout: "running" }, { stdout: "log output" }]);
  const adapter = new OlyAdapter({ runCommandImpl: mock.runCommandImpl });

  const output = await adapter.capturePane("sess-9", 0);

  assert.equal(output, "log output");
  assert.deepEqual(mock.calls.map((call) => call.args), [
    ["daemon", "status"],
    ["logs", "sess-9", "--tail", "1", "--no-truncate"]
  ]);
});

test("sendInput preserves newline boundaries with repeated send calls", async () => {
  const mock = createRunCommandMock([
    { stdout: "running" },
    { stdout: "" },
    { stdout: "" },
    { stdout: "" },
    { stdout: "" }
  ]);
  const adapter = new OlyAdapter({
    olyStateDir: "/tmp/oly-state",
    runCommandImpl: mock.runCommandImpl
  });

  await adapter.sendInput("sess-5", "echo hello\r\n\npwd");

  assert.deepEqual(mock.calls.map((call) => call.args), [
    ["daemon", "status"],
    ["send", "sess-5", "echo hello"],
    ["send", "sess-5", "key:enter"],
    ["send", "sess-5", "key:enter"],
    ["send", "sess-5", "pwd"]
  ]);
  for (const call of mock.calls) {
    assert.equal(call.env?.OLY_STATE_DIR, "/tmp/oly-state");
  }
});

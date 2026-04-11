import assert from "node:assert/strict";
import test from "node:test";
import { ManagedRuntimeAdapter } from "../src/index.js";
import type { RuntimeCommandOptions } from "@commandrelay/runtime-core";

function createRunCommandMock(outcomes: Array<{ stdout?: string; error?: unknown }>) {
  const queue = [...outcomes];
  const calls: Array<{ command: string; args: string[]; timeoutMs?: number; env?: NodeJS.ProcessEnv }> = [];

  return {
    calls,
    async runCommandImpl(
      command: string,
      args: string[],
      options: RuntimeCommandOptions | number = {}
    ): Promise<string> {
      const normalizedOptions = typeof options === "number" ? { timeoutMs: options } : options;
      calls.push({ command, args, timeoutMs: normalizedOptions.timeoutMs, env: normalizedOptions.env });
      const next = queue.shift();
      if (!next) throw new Error("runCommand called with no queued outcome");
      if (next.error) throw next.error;
      return next.stdout ?? "";
    }
  };
}

test("isAvailable starts daemon when initial status check fails", async () => {
  const mock = createRunCommandMock([
    { error: new Error("not running") },
    { stdout: "started" },
    { stdout: "running" }
  ]);
  const adapter = new ManagedRuntimeAdapter({ runCommandImpl: mock.runCommandImpl });

  assert.equal(await adapter.isAvailable(), true);
  assert.deepEqual(mock.calls.map((call) => call.args), [
    ["daemon", "status"],
    ["daemon", "start", "--detach", "--no-http", "--no-auth"],
    ["daemon", "status"]
  ]);
});

test("listPanes refreshes daemon readiness after a stale ready probe", async () => {
  const mock = createRunCommandMock([
    { stdout: "running" },
    { error: new Error("daemon stopped") },
    { stdout: "started" },
    { stdout: "running" },
    { stdout: JSON.stringify({ items: [] }) }
  ]);
  const adapter = new ManagedRuntimeAdapter({ runCommandImpl: mock.runCommandImpl });

  assert.equal(await adapter.isAvailable(), true);
  await adapter.listPanes();

  assert.deepEqual(mock.calls.map((call) => call.args), [
    ["daemon", "status"],
    ["daemon", "status"],
    ["daemon", "start", "--detach", "--no-http", "--no-auth"],
    ["daemon", "status"],
    ["ls", "--json", "--limit", "500"]
  ]);
});

test("startCommand launches a detached managed session and returns attach metadata", async () => {
  const mock = createRunCommandMock([
    { error: new Error("not running") },
    { stdout: "started" },
    { stdout: "running" },
    { stdout: JSON.stringify({ items: [{ id: "existing", title: "Existing", status: "running" }] }) },
    { stdout: "launch accepted" },
    {
      stdout: JSON.stringify({
        items: [
          { id: "existing", title: "Existing", status: "running" },
          {
            id: "sess-9",
            title: "Fix flaky test",
            command: "bash",
            arguments: ["-lc", "npm test"],
            status: "running",
            current_working_directory: "/tmp/work",
            created_at: "2026-04-09T00:00:00.000Z",
            last_total_bytes: 12
          }
        ]
      })
    }
  ]);
  const adapter = new ManagedRuntimeAdapter({
    runCommandImpl: mock.runCommandImpl,
    pollAttempts: 1,
    pollDelayMs: 0
  });

  const pane = await adapter.startCommand({
    title: "Fix flaky test",
    cwd: "/tmp/work",
    command: "npm test",
    shell: "/bin/bash"
  });

  assert.deepEqual(mock.calls.map((call) => call.args), [
    ["daemon", "status"],
    ["daemon", "start", "--detach", "--no-http", "--no-auth"],
    ["daemon", "status"],
    ["ls", "--json", "--limit", "500"],
    ["start", "--detach", "--title", "Fix flaky test", "--cwd", "/tmp/work", "/bin/bash", "-lc", "npm test"],
    ["ls", "--json", "--limit", "500"]
  ]);
  assert.deepEqual(pane, {
    sessionName: "Fix flaky test [sess-9]",
    windowIndex: 0,
    windowName: "running",
    paneIndex: 0,
    paneId: "sess-9",
    paneTitle: "Fix flaky test",
    currentCommand: "bash -lc npm test",
    status: "running",
    inputNeeded: false,
    notificationsEnabled: false,
    cwd: "/tmp/work",
    createdAt: "2026-04-09T00:00:00.000Z",
    lastTotalBytes: 12,
    attachCommand: "oly attach sess-9"
  });
});

test("stopCommand stops a managed pane by pane id", async () => {
  const mock = createRunCommandMock([
    { error: new Error("not running") },
    { stdout: "started" },
    { stdout: "running" },
    { stdout: "stopped" }
  ]);
  const adapter = new ManagedRuntimeAdapter({ runCommandImpl: mock.runCommandImpl });

  await adapter.stopCommand({ paneId: "sess-9" });

  assert.deepEqual(mock.calls.map((call) => call.args), [
    ["daemon", "status"],
    ["daemon", "start", "--detach", "--no-http", "--no-auth"],
    ["daemon", "status"],
    ["stop", "sess-9"]
  ]);
});

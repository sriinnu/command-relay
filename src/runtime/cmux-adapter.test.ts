/**
 * @file Unit tests for cmux adapter parsing and command dispatch behavior.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { CmuxAdapter } from "./cmux-adapter.js";

interface RunCommandMockCall {
  command: string;
  args: string[];
  options: number | { timeoutMs?: number } | undefined;
}

interface RunCommandMock {
  calls: RunCommandMockCall[];
  runCommandImpl: (
    command: string,
    args: string[],
    options?: number | { timeoutMs?: number }
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
    async runCommandImpl(command: string, args: string[], options = 5000): Promise<string> {
      calls.push({ command, args, options });
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

test("isAvailable checks cmux capabilities --json", async () => {
  const mock = createRunCommandMock([{ stdout: '{"payload":{"name":"cmux"}}' }]);
  const adapter = new CmuxAdapter({ commandTimeoutMs: 1111, runCommandImpl: mock.runCommandImpl });

  const available = await adapter.isAvailable();

  assert.equal(available, true);
  assert.deepEqual(mock.calls[0], {
    command: "cmux",
    args: ["capabilities", "--json"],
    options: { timeoutMs: 1111 }
  });
});

test("isAvailable returns false for command failures or non-json output", async () => {
  const commandError = createRunCommandMock([{ error: new Error("spawn ENOENT") }]);
  const invalidJson = createRunCommandMock([{ stdout: "not json" }]);

  const unavailableAdapter = new CmuxAdapter({ runCommandImpl: commandError.runCommandImpl });
  const invalidAdapter = new CmuxAdapter({ runCommandImpl: invalidJson.runCommandImpl });

  assert.equal(await unavailableAdapter.isAvailable(), false);
  assert.equal(await invalidAdapter.isAvailable(), false);
});

test("listPanes parses payload.surfaces and filters non-terminal rows", async () => {
  const stdout = JSON.stringify({
    payload: {
      surfaces: [
        {
          type: "terminal",
          id: "surface-1",
          sessionName: "dev",
          windowIndex: "2",
          windowName: "editor",
          paneIndex: "4",
          title: "shell",
          command: "bash"
        },
        {
          type: "browser",
          id: "surface-2",
          sessionName: "dev"
        },
        {
          type: "terminal",
          surfaceId: "surface-3",
          session: "prod",
          window: { index: 8, name: "ops" },
          index: "9",
          name: "ops-shell",
          currentCommand: "zsh"
        }
      ]
    }
  });
  const mock = createRunCommandMock([{ stdout }]);
  const adapter = new CmuxAdapter({ runCommandImpl: mock.runCommandImpl });

  const panes = await adapter.listPanes();

  assert.deepEqual(mock.calls[0], {
    command: "cmux",
    args: ["list-surfaces", "--json"],
    options: { timeoutMs: 6000 }
  });
  assert.deepEqual(panes, [
    {
      sessionName: "dev",
      windowIndex: 2,
      windowName: "editor",
      paneIndex: 4,
      paneId: "surface-1",
      paneTitle: "shell",
      currentCommand: "bash"
    },
    {
      sessionName: "prod",
      windowIndex: 8,
      windowName: "ops",
      paneIndex: 9,
      paneId: "surface-3",
      paneTitle: "ops-shell",
      currentCommand: "zsh"
    }
  ]);
});

test("listPanes parses payload.result.surfaces and tolerates prefixed log lines", async () => {
  const stdout = [
    "cmux: using profile default",
    JSON.stringify({
      payload: {
        result: {
          surfaces: [{ type: "terminal", id: "surface-42", sessionName: "main" }]
        }
      }
    })
  ].join("\n");
  const mock = createRunCommandMock([{ stdout }]);
  const adapter = new CmuxAdapter({ runCommandImpl: mock.runCommandImpl });

  const panes = await adapter.listPanes();

  assert.deepEqual(panes, [
    {
      sessionName: "main",
      windowIndex: 0,
      windowName: "cmux",
      paneIndex: 0,
      paneId: "surface-42",
      paneTitle: "",
      currentCommand: ""
    }
  ]);
});

test("capturePane uses read-screen with scrollback and a safe line count", async () => {
  const mock = createRunCommandMock([{ stdout: "first" }, { stdout: "second" }]);
  const adapter = new CmuxAdapter({ runCommandImpl: mock.runCommandImpl });

  await adapter.capturePane("surface-1", 0);
  await adapter.capturePane("surface-1", -30);

  assert.deepEqual(mock.calls.map((call) => call.args), [
    ["read-screen", "--surface", "surface-1", "--scrollback", "--lines", "1"],
    ["read-screen", "--surface", "surface-1", "--scrollback", "--lines", "30"]
  ]);
});

test("sendInput passes text as a single send command argument", async () => {
  const mock = createRunCommandMock([{ stdout: "" }]);
  const adapter = new CmuxAdapter({ cmuxCommand: "cmux-bin", runCommandImpl: mock.runCommandImpl });

  await adapter.sendInput("surface-7", "echo hello && pwd");

  assert.deepEqual(mock.calls, [
    {
      command: "cmux-bin",
      args: ["send", "--surface", "surface-7", "echo hello && pwd"],
      options: { timeoutMs: 6000 }
    }
  ]);
});

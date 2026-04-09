import assert from "node:assert/strict";
import test from "node:test";
import { CmuxRuntimeAdapter } from "../src/index.js";

function createRunCommandMock(outcomes: Array<{ stdout?: string; error?: unknown }>) {
  const queue = [...outcomes];
  const calls: Array<{ command: string; args: string[]; timeoutMs?: number }> = [];

  return {
    calls,
    async runCommandImpl(
      command: string,
      args: string[],
      options: { timeoutMs?: number } = {}
    ): Promise<string> {
      calls.push({ command, args, timeoutMs: options.timeoutMs });
      const next = queue.shift();
      if (!next) throw new Error("runCommand called with no queued outcome");
      if (next.error) throw next.error;
      return next.stdout ?? "";
    }
  };
}

test("listPanes parses terminal surfaces and filters non-terminal rows", async () => {
  const mock = createRunCommandMock([
    {
      stdout: JSON.stringify({
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
            { type: "browser", id: "skip-me" }
          ]
        }
      })
    }
  ]);
  const adapter = new CmuxRuntimeAdapter({ runCommandImpl: mock.runCommandImpl });

  const panes = await adapter.listPanes();

  assert.deepEqual(panes, [
    {
      sessionName: "dev",
      windowIndex: 2,
      windowName: "editor",
      paneIndex: 4,
      paneId: "surface-1",
      paneTitle: "shell",
      currentCommand: "bash"
    }
  ]);
});

import assert from "node:assert/strict";
import test from "node:test";
import { RuntimeMultiplexer } from "../src/index.js";
import type { RuntimeBackend, RuntimePane } from "../src/index.js";

interface BackendCallRecord {
  capturePane: Array<{ paneId: string; lines: number }>;
  sendInput: Array<{ paneId: string; input: string }>;
  listPanes: number;
  isAvailable: number;
}

interface BackendHarness {
  backend: RuntimeBackend;
  calls: BackendCallRecord;
}

interface BackendHarnessOptions {
  backendId: string;
  available?: boolean;
  panes?: RuntimePane[];
  throwOnIsAvailable?: boolean;
}

function createBackendHarness(options: BackendHarnessOptions): BackendHarness {
  const calls: BackendCallRecord = {
    capturePane: [],
    sendInput: [],
    listPanes: 0,
    isAvailable: 0
  };
  const available = options.available ?? true;
  const panes = options.panes ?? [];

  return {
    calls,
    backend: {
      backendId: options.backendId,
      async isAvailable(): Promise<boolean> {
        calls.isAvailable += 1;
        if (options.throwOnIsAvailable) {
          throw new Error(`isAvailable failed for ${options.backendId}`);
        }
        return available;
      },
      async listPanes(): Promise<RuntimePane[]> {
        calls.listPanes += 1;
        return panes;
      },
      async capturePane(paneId: string, lines: number): Promise<string> {
        calls.capturePane.push({ paneId, lines });
        return `${options.backendId}:${paneId}:${lines}`;
      },
      async sendInput(paneId: string, input: string): Promise<void> {
        calls.sendInput.push({ paneId, input });
      }
    }
  };
}

test("single backend keeps pane ids un-namespaced and routes directly", async () => {
  const tmux = createBackendHarness({
    backendId: "tmux",
    panes: [{ paneId: "%1", sessionName: "main" }]
  });

  const mux = new RuntimeMultiplexer({ backends: [tmux.backend] });
  const panes = await mux.listPanes();
  const capture = await mux.capturePane("%1", 50);
  await mux.sendInput("%1", "echo hi");

  assert.deepEqual(panes, [{ paneId: "%1", sessionName: "main" }]);
  assert.equal(capture, "tmux:%1:50");
  assert.deepEqual(tmux.calls.capturePane, [{ paneId: "%1", lines: 50 }]);
  assert.deepEqual(tmux.calls.sendInput, [{ paneId: "%1", input: "echo hi" }]);
});

test("multiple backends namespace pane ids and route by backend prefix", async () => {
  const tmux = createBackendHarness({
    backendId: "tmux",
    panes: [{ paneId: "%1", sessionName: "main" }]
  });
  const managed = createBackendHarness({
    backendId: "managed",
    panes: [{ paneId: "session-1", sessionName: "ops" }]
  });

  const mux = new RuntimeMultiplexer({ backends: [tmux.backend, managed.backend] });
  const panes = await mux.listPanes();
  const capture = await mux.capturePane("managed:session-1", 15);
  await mux.sendInput("tmux:%1", "ls -la");

  assert.deepEqual(panes, [
    { paneId: "tmux:%1", sessionName: "main", backendId: "tmux", rawPaneId: "%1" },
    {
      paneId: "managed:session-1",
      sessionName: "ops",
      backendId: "managed",
      rawPaneId: "session-1"
    }
  ]);
  assert.equal(capture, "managed:session-1:15");
  assert.deepEqual(managed.calls.capturePane, [{ paneId: "session-1", lines: 15 }]);
  assert.deepEqual(tmux.calls.sendInput, [{ paneId: "%1", input: "ls -la" }]);
});

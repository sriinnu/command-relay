/**
 * @file Unit tests for runtime multiplexer pane namespacing and routing.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { RuntimeMultiplexer } from "./runtime-multiplexer.js";
import type { RuntimeBackend, RuntimePane } from "./runtime-backend.js";

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

/**
 * Creates a deterministic runtime backend test double with call recorders.
 *
 * @param options Backend behavior options.
 * @returns Backend and call recorders.
 */
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
  const screen = createBackendHarness({
    backendId: "screen",
    panes: [{ paneId: "0.1", sessionName: "ops" }]
  });

  const mux = new RuntimeMultiplexer({ backends: [tmux.backend, screen.backend] });
  const panes = await mux.listPanes();
  const capture = await mux.capturePane("screen:0.1", 15);
  await mux.sendInput("tmux:%1", "ls -la");

  assert.deepEqual(panes, [
    { paneId: "tmux:%1", sessionName: "main", backendId: "tmux", rawPaneId: "%1" },
    { paneId: "screen:0.1", sessionName: "ops", backendId: "screen", rawPaneId: "0.1" }
  ]);
  assert.equal(capture, "screen:0.1:15");
  assert.deepEqual(screen.calls.capturePane, [{ paneId: "0.1", lines: 15 }]);
  assert.deepEqual(tmux.calls.sendInput, [{ paneId: "%1", input: "ls -la" }]);
});

test("multiple backends require namespaced pane ids for routed operations", async () => {
  const tmux = createBackendHarness({ backendId: "tmux" });
  const screen = createBackendHarness({ backendId: "screen" });
  const mux = new RuntimeMultiplexer({ backends: [tmux.backend, screen.backend] });

  await assert.rejects(
    async () => mux.capturePane("%1", 10),
    /must be namespaced as "<backendId>:<rawPaneId>"/
  );
  await assert.rejects(
    async () => mux.sendInput("missing:%1", "pwd"),
    /Unknown runtime backend "missing"/
  );
});

test("backend introspection returns ids and safe availability map", async () => {
  const failing = createBackendHarness({ backendId: "failing", throwOnIsAvailable: true });
  const offline = createBackendHarness({ backendId: "offline", available: false });
  const online = createBackendHarness({
    backendId: "online",
    available: true,
    panes: [{ paneId: "pane-1", sessionName: "prod" }]
  });

  const mux = new RuntimeMultiplexer({
    backends: [failing.backend, offline.backend, online.backend]
  });

  assert.deepEqual(mux.getBackendIds(), ["failing", "offline", "online"]);
  assert.deepEqual(await mux.checkBackendAvailability(), {
    failing: false,
    offline: false,
    online: true
  });
  assert.equal(await mux.isAvailable(), true);
  const panes = await mux.listPanes();

  assert.deepEqual(panes, [
    {
      paneId: "online:pane-1",
      sessionName: "prod",
      backendId: "online",
      rawPaneId: "pane-1"
    }
  ]);
  assert.equal(failing.calls.listPanes, 0);
  assert.equal(offline.calls.listPanes, 0);
  assert.equal(online.calls.listPanes, 1);
});

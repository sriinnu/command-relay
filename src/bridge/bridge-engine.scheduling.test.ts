/**
 * @file Scheduling and backoff tests for bridge engine polling.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { BridgeEngine, type BridgePaneEvent } from "./bridge-engine.js";

interface CapturePaneMock {
  calls: Array<{ paneId: string; lines: number }>;
  capturePane: (paneId: string, lines: number) => Promise<string>;
}

interface MultiPaneCaptureMock {
  calls: Array<{ paneId: string; lines: number }>;
  capturePane: (paneId: string, lines: number) => Promise<string>;
}

/**
 * Creates a deterministic tmux capture mock with queued outputs.
 */
function createCapturePaneMock(outputs: string[]): CapturePaneMock {
  const queue = [...outputs];
  const calls: Array<{ paneId: string; lines: number }> = [];

  return {
    calls,
    async capturePane(paneId: string, lines: number): Promise<string> {
      calls.push({ paneId, lines });
      const next = queue.shift();
      if (next === undefined) {
        throw new Error("capturePane called with an empty output queue");
      }
      return next;
    }
  };
}

/**
 * Creates a deterministic capture mock with independent queues per pane.
 */
function createMultiPaneCaptureMock(outputsByPane: Record<string, string[]>): MultiPaneCaptureMock {
  const calls: Array<{ paneId: string; lines: number }> = [];
  const state = new Map(
    Object.entries(outputsByPane).map(([paneId, outputs]) => [paneId, { outputs: [...outputs], index: 0 }])
  );

  return {
    calls,
    async capturePane(paneId: string, lines: number): Promise<string> {
      calls.push({ paneId, lines });
      const paneState = state.get(paneId);
      if (!paneState) {
        throw new Error(`capturePane called for unknown pane: ${paneId}`);
      }
      const boundedIndex = Math.min(paneState.index, paneState.outputs.length - 1);
      const next = paneState.outputs[boundedIndex] ?? "";
      paneState.index += 1;
      return next;
    }
  };
}

test("pollOnce backs off unchanged panes and skips polls until they are due again", async (t) => {
  t.mock.method(globalThis, "setInterval", () => ({}) as NodeJS.Timeout);
  t.mock.method(globalThis, "clearInterval", () => undefined);

  let nowMs = 0;
  const captureMock = createCapturePaneMock(["steady", "steady", "steady", "steady"]);
  const engine = new BridgeEngine({
    tmux: { capturePane: captureMock.capturePane },
    replayLines: 40,
    pollIntervalMs: 25,
    now: () => nowMs,
    onOutput: () => undefined,
    onError: () => assert.fail("onError should not be called")
  });

  await engine.attach("client-a", "%backoff");

  nowMs = 10;
  await engine.pollOnce(false);
  assert.equal(captureMock.calls.length, 1);

  nowMs = 25;
  await engine.pollOnce(false);
  assert.equal(captureMock.calls.length, 2);

  nowMs = 50;
  await engine.pollOnce(false);
  assert.equal(captureMock.calls.length, 2);

  nowMs = 75;
  await engine.pollOnce(false);
  assert.equal(captureMock.calls.length, 3);

  nowMs = 150;
  await engine.pollOnce(false);
  assert.equal(captureMock.calls.length, 3);

  nowMs = 175;
  await engine.pollOnce(false);
  assert.equal(captureMock.calls.length, 4);
});

test("pollOnce resets to base cadence immediately after fresh activity", async (t) => {
  t.mock.method(globalThis, "setInterval", () => ({}) as NodeJS.Timeout);
  t.mock.method(globalThis, "clearInterval", () => undefined);

  let nowMs = 0;
  const captureMock = createCapturePaneMock(["a", "a", "ab", "abc"]);
  const outputEvents: Array<{ clientId: string; event: BridgePaneEvent }> = [];
  const engine = new BridgeEngine({
    tmux: { capturePane: captureMock.capturePane },
    replayLines: 40,
    pollIntervalMs: 25,
    now: () => nowMs,
    onOutput: (clientId, event) => outputEvents.push({ clientId, event }),
    onError: () => assert.fail("onError should not be called")
  });

  await engine.attach("client-a", "%resume");

  nowMs = 25;
  await engine.pollOnce(false);
  assert.equal(captureMock.calls.length, 2);

  nowMs = 75;
  await engine.pollOnce(false);
  assert.equal(captureMock.calls.length, 3);
  assert.deepEqual(outputEvents.at(-1)?.event, {
    mode: "delta",
    paneId: "%resume",
    chunk: "b",
    streamSeq: 2
  });

  nowMs = 99;
  await engine.pollOnce(false);
  assert.equal(captureMock.calls.length, 3);

  nowMs = 100;
  await engine.pollOnce(false);
  assert.equal(captureMock.calls.length, 4);
});

test("pollOnce only captures panes whose adaptive deadlines are due", async (t) => {
  t.mock.method(globalThis, "setInterval", () => ({}) as NodeJS.Timeout);
  t.mock.method(globalThis, "clearInterval", () => undefined);

  let nowMs = 0;
  const captureMock = createMultiPaneCaptureMock({
    "%1": ["alpha", "alpha", "alpha", "alpha"],
    "%2": ["beta", "beta", "beta", "beta"],
    "%3": ["gamma", "gamma+", "gamma++", "gamma+++"]
  });
  const engine = new BridgeEngine({
    tmux: { capturePane: captureMock.capturePane },
    replayLines: 40,
    pollIntervalMs: 25,
    now: () => nowMs,
    onOutput: () => undefined,
    onError: () => assert.fail("onError should not be called")
  });

  await engine.attach("client-a", "%1");
  await engine.attach("client-a", "%2");
  await engine.attach("client-a", "%3");

  nowMs = 25;
  await engine.pollOnce(false);
  assert.equal(captureMock.calls.length, 6);

  nowMs = 50;
  await engine.pollOnce(false);
  assert.equal(captureMock.calls.length, 7);

  nowMs = 75;
  await engine.pollOnce(false);
  assert.equal(captureMock.calls.length, 10);

  nowMs = 100;
  await engine.pollOnce(false);
  assert.equal(captureMock.calls.length, 11);
});

test("pollOnce applies exponential backoff for unchanged panes", async (t) => {
  t.mock.method(globalThis, "setInterval", () => ({}) as NodeJS.Timeout);
  t.mock.method(globalThis, "clearInterval", () => undefined);

  const outputEvents: Array<{ clientId: string; event: BridgePaneEvent }> = [];
  const captureMock = createCapturePaneMock(["idle", "idle", "idle", "idle", "idle", "idle"]);

  let now = 0;
  const engine = new BridgeEngine({
    tmux: { capturePane: captureMock.capturePane },
    replayLines: 80,
    pollIntervalMs: 10,
    maxPollIntervalMs: 80,
    now: () => now,
    onOutput: (clientId, event) => outputEvents.push({ clientId, event }),
    onError: () => assert.fail("onError should not be called")
  });

  await engine.attach("client-a", "%1");
  assert.equal(captureMock.calls.length, 1);
  assert.equal(outputEvents.length, 1);

  now += 10;
  await engine.pollOnce(false);
  assert.equal(captureMock.calls.length, 2);
  assert.equal(outputEvents.length, 1);

  const watcher = (
    engine as unknown as {
      panes: Map<string, { nextPollAt: number }>;
    }
  ).panes.get("%1");
  assert.ok(watcher);
  assert.equal(watcher.nextPollAt, 30);

  now += 10;
  await engine.pollOnce(false);
  assert.equal(captureMock.calls.length, 2);

  now += 10;
  await engine.pollOnce(false);
  assert.equal(captureMock.calls.length, 3);
  assert.equal(outputEvents.length, 1);

  now += 40;
  await engine.pollOnce(false);
  assert.equal(captureMock.calls.length, 4);
});

test("backoff resets to base interval after pane output changes", async (t) => {
  t.mock.method(globalThis, "setInterval", () => ({}) as NodeJS.Timeout);
  t.mock.method(globalThis, "clearInterval", () => undefined);

  const outputEvents: Array<{ clientId: string; event: BridgePaneEvent }> = [];
  const captureMock = createCapturePaneMock(["idle", "idle", "idle++", "idle+++", "idle+++"]);

  let now = 0;
  const engine = new BridgeEngine({
    tmux: { capturePane: captureMock.capturePane },
    replayLines: 80,
    pollIntervalMs: 10,
    maxPollIntervalMs: 80,
    now: () => now,
    onOutput: (clientId, event) => outputEvents.push({ clientId, event }),
    onError: () => assert.fail("onError should not be called")
  });

  await engine.attach("client-a", "%1");
  now += 10;
  await engine.pollOnce(false);
  now += 20;
  await engine.pollOnce(false);

  const watcher = (
    engine as unknown as {
      panes: Map<string, { nextPollAt: number }>;
    }
  ).panes.get("%1");
  assert.ok(watcher);
  assert.equal(watcher.nextPollAt, 40);

  now += 10;
  await engine.pollOnce(false);
  assert.equal(watcher.nextPollAt, 50);
  assert.equal(captureMock.calls.length, 4);
  assert.equal(outputEvents.filter((item) => item.clientId === "client-a").length, 3);

  now += 9;
  await engine.pollOnce(false);
  assert.equal(captureMock.calls.length, 4);
});

test("many idle panes reduce capture churn with adaptive backoff", async (t) => {
  t.mock.method(globalThis, "setInterval", () => ({}) as NodeJS.Timeout);
  t.mock.method(globalThis, "clearInterval", () => undefined);

  const paneIds = Array.from({ length: 20 }, (_, index) => `%${index + 1}`);
  const captureMock = {
    calls: [] as Array<{ paneId: string; lines: number }>,
    async capturePane(paneId: string, lines: number): Promise<string> {
      this.calls.push({ paneId, lines });
      return "idle";
    }
  };

  const outputEvents: Array<{ clientId: string; event: BridgePaneEvent }> = [];
  let now = 0;

  const engine = new BridgeEngine({
    tmux: { capturePane: captureMock.capturePane.bind(captureMock) },
    replayLines: 80,
    pollIntervalMs: 10,
    maxPollIntervalMs: 80,
    now: () => now,
    onOutput: (clientId, event) => outputEvents.push({ clientId, event }),
    onError: () => assert.fail("onError should not be called")
  });

  for (const paneId of paneIds) {
    await engine.attach(`client-${paneId}`, paneId);
  }

  assert.equal(captureMock.calls.length, paneIds.length);
  assert.equal(outputEvents.length, paneIds.length);

  const tickSchedule = [10, 10, 10, 10, 10, 10, 10, 10, 10];
  for (const tick of tickSchedule) {
    now += tick;
    await engine.pollOnce(false);
  }

  assert.equal(captureMock.calls.length, 80);
  assert.equal(outputEvents.length, paneIds.length);
});

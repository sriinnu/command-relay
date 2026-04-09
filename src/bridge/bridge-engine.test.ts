/**
 * @file Unit tests for bridge replay and delta behavior.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { BridgeEngine, type BridgePaneEvent } from "./bridge-engine.js";

interface CapturePaneMock {
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

test("attach emits initial snapshot and starts polling", async (t) => {
  const setIntervalMock = t.mock.method(globalThis, "setInterval", () => ({}) as NodeJS.Timeout);
  const clearIntervalMock = t.mock.method(globalThis, "clearInterval", () => undefined);

  const outputEvents: Array<{ clientId: string; event: BridgePaneEvent }> = [];
  const captureMock = createCapturePaneMock(["line-1\nline-2\n"]);

  const engine = new BridgeEngine({
    tmux: { capturePane: captureMock.capturePane },
    replayLines: 100,
    pollIntervalMs: 25,
    onOutput: (clientId, event) => outputEvents.push({ clientId, event }),
    onError: () => assert.fail("onError should not be called")
  });

  await engine.attach("client-a", "%1");

  assert.equal(captureMock.calls.length, 1);
  assert.deepEqual(captureMock.calls[0], { paneId: "%1", lines: 100 });
  assert.equal(outputEvents.length, 1);
  assert.deepEqual(outputEvents[0], {
    clientId: "client-a",
    event: {
      mode: "snapshot",
      paneId: "%1",
      chunk: "line-1\nline-2\n",
      streamSeq: 1
    }
  });
  assert.equal(setIntervalMock.mock.calls.length, 1);

  engine.detach("client-a", "%1");
  assert.equal(clearIntervalMock.mock.calls.length, 1);
});

test("pollOnce emits delta when output is appended", async (t) => {
  t.mock.method(globalThis, "setInterval", () => ({}) as NodeJS.Timeout);
  t.mock.method(globalThis, "clearInterval", () => undefined);

  const outputEvents: Array<{ clientId: string; event: BridgePaneEvent }> = [];
  const captureMock = createCapturePaneMock(["build...", "build...done"]);

  const engine = new BridgeEngine({
    tmux: { capturePane: captureMock.capturePane },
    replayLines: 80,
    pollIntervalMs: 25,
    onOutput: (clientId, event) => outputEvents.push({ clientId, event }),
    onError: () => assert.fail("onError should not be called")
  });

  await engine.attach("client-a", "%2");
  await engine.pollOnce();

  assert.equal(outputEvents.length, 2);
  assert.deepEqual(outputEvents[1], {
    clientId: "client-a",
    event: {
      mode: "delta",
      paneId: "%2",
      chunk: "done",
      streamSeq: 2
    }
  });
});

test("pollOnce emits snapshot when output diverges", async (t) => {
  t.mock.method(globalThis, "setInterval", () => ({}) as NodeJS.Timeout);
  t.mock.method(globalThis, "clearInterval", () => undefined);

  const outputEvents: Array<{ clientId: string; event: BridgePaneEvent }> = [];
  const captureMock = createCapturePaneMock(["old output", "replacement"]);

  const engine = new BridgeEngine({
    tmux: { capturePane: captureMock.capturePane },
    replayLines: 80,
    pollIntervalMs: 25,
    onOutput: (clientId, event) => outputEvents.push({ clientId, event }),
    onError: () => assert.fail("onError should not be called")
  });

  await engine.attach("client-a", "%3");
  await engine.pollOnce();

  assert.equal(outputEvents.length, 2);
  assert.deepEqual(outputEvents[1], {
    clientId: "client-a",
    event: {
      mode: "snapshot",
      paneId: "%3",
      chunk: "replacement",
      streamSeq: 2
    }
  });
});

test("attach replays only events newer than sinceSeq", async (t) => {
  t.mock.method(globalThis, "setInterval", () => ({}) as NodeJS.Timeout);
  t.mock.method(globalThis, "clearInterval", () => undefined);

  const outputEvents: Array<{ clientId: string; event: BridgePaneEvent }> = [];
  const captureMock = createCapturePaneMock(["a", "ab", "abc"]);

  const engine = new BridgeEngine({
    tmux: { capturePane: captureMock.capturePane },
    replayLines: 80,
    pollIntervalMs: 25,
    onOutput: (clientId, event) => outputEvents.push({ clientId, event }),
    onError: () => assert.fail("onError should not be called")
  });

  await engine.attach("client-a", "%4");
  await engine.pollOnce();
  await engine.pollOnce();
  await engine.attach("client-b", "%4", 1);

  const replayed = outputEvents.filter((item) => item.clientId === "client-b");
  assert.equal(replayed.length, 2);
  assert.deepEqual(replayed.map((item) => item.event), [
    { mode: "delta", paneId: "%4", chunk: "b", streamSeq: 2 },
    { mode: "delta", paneId: "%4", chunk: "c", streamSeq: 3 }
  ]);

  assert.equal(captureMock.calls.length, 3);
});

test("pollOnce does not emit an event when pane output is unchanged", async (t) => {
  t.mock.method(globalThis, "setInterval", () => ({}) as NodeJS.Timeout);
  t.mock.method(globalThis, "clearInterval", () => undefined);

  const outputEvents: Array<{ clientId: string; event: BridgePaneEvent }> = [];
  const captureMock = createCapturePaneMock(["steady", "steady"]);

  const engine = new BridgeEngine({
    tmux: { capturePane: captureMock.capturePane },
    replayLines: 40,
    pollIntervalMs: 25,
    onOutput: (clientId, event) => outputEvents.push({ clientId, event }),
    onError: () => assert.fail("onError should not be called")
  });

  await engine.attach("client-a", "%5");
  await engine.pollOnce();

  assert.equal(outputEvents.length, 1);
  assert.deepEqual(outputEvents[0].event, {
    mode: "snapshot",
    paneId: "%5",
    chunk: "steady",
    streamSeq: 1
  });
});

test("attach propagates capture failures and does not invoke poll error callback", async (t) => {
  t.mock.method(globalThis, "setInterval", () => ({}) as NodeJS.Timeout);
  t.mock.method(globalThis, "clearInterval", () => undefined);

  const captureError = new Error("no server running on /tmp/tmux-1000/default");
  const captureMock: CapturePaneMock = {
    calls: [],
    capturePane: async (paneId: string, lines: number) => {
      captureMock.calls.push({ paneId, lines });
      throw captureError;
    }
  };
  let onErrorCalls = 0;
  const engine = new BridgeEngine({
    tmux: { capturePane: captureMock.capturePane },
    replayLines: 40,
    pollIntervalMs: 25,
    onOutput: () => assert.fail("onOutput should not be called"),
    onError: () => { onErrorCalls += 1; }
  });

  await assert.rejects(async () => {
    await engine.attach("client-a", "%6");
  }, captureError);
  assert.equal(onErrorCalls, 0);
  assert.equal(engine.getStats().watchedPanes, 0);
});

test("getReplayOffsetsSnapshot returns empty rows before any pane attaches", () => {
  const engine = new BridgeEngine({
    tmux: { capturePane: async () => "" },
    replayLines: 40,
    pollIntervalMs: 25,
    onOutput: () => undefined,
    onError: () => undefined
  });

  assert.deepEqual(engine.getReplayOffsetsSnapshot(), []);
});

test("getReplayOffsetsSnapshot reports latest replay offset per watched pane", async (t) => {
  t.mock.method(globalThis, "setInterval", () => ({}) as NodeJS.Timeout);
  t.mock.method(globalThis, "clearInterval", () => undefined);

  const captureMock = createCapturePaneMock(["a", "ab", "abc", "abcd"]);
  const engine = new BridgeEngine({
    tmux: { capturePane: captureMock.capturePane },
    replayLines: 40,
    pollIntervalMs: 25,
    maxHistoryEvents: 2,
    onOutput: () => undefined,
    onError: () => assert.fail("onError should not be called")
  });

  await engine.attach("client-a", "%1");
  await engine.attach("client-b", "%1");
  await engine.pollOnce();
  await engine.pollOnce();
  await engine.pollOnce();

  assert.deepEqual(engine.getReplayOffsetsSnapshot(), [{ paneId: "%1", replayOffset: 4 }]);
});

test("getReplayOffsetsSnapshot rows are sorted by paneId", async (t) => {
  t.mock.method(globalThis, "setInterval", () => ({}) as NodeJS.Timeout);
  t.mock.method(globalThis, "clearInterval", () => undefined);

  const captureMock = createCapturePaneMock(["a", "b"]);
  const engine = new BridgeEngine({
    tmux: { capturePane: captureMock.capturePane },
    replayLines: 40,
    pollIntervalMs: 25,
    onOutput: () => undefined,
    onError: () => assert.fail("onError should not be called")
  });

  await engine.attach("client-a", "%2");
  await engine.attach("client-a", "%1");

  assert.deepEqual(engine.getReplayOffsetsSnapshot(), [
    { paneId: "%1", replayOffset: 1 },
    { paneId: "%2", replayOffset: 1 }
  ]);
});

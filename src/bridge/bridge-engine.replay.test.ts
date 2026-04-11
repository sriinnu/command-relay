/**
 * @file Replay-focused unit tests for bridge engine reconnect behavior.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  BridgeEngine,
  type BridgeAttachReplayMetadata,
  type BridgePaneEvent
} from "./bridge-engine.js";

interface CapturePaneMock {
  calls: Array<{ paneId: string; lines: number }>;
  capturePane: (paneId: string, lines: number) => Promise<string>;
}

interface MultiPaneCaptureMock {
  calls: Array<{ paneId: string; lines: number }>;
  capturePane: (paneId: string, lines: number) => Promise<string>;
}

interface RecordedOutput {
  clientId: string;
  event: BridgePaneEvent;
}

/**
 * Creates a deterministic capturePane mock from queued snapshots.
 *
 * @param outputs Ordered pane outputs returned on each call.
 * @returns Capture mock and call records.
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
 * Creates a deterministic per-pane capturePane mock.
 *
 * Each pane consumes its own output queue, and then stays at its last frame.
 *
 * @param outputsByPane Ordered outputs per pane id.
 * @returns Capture mock and call records.
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
      if (paneState.outputs.length === 0) {
        return "";
      }

      const boundedIndex = Math.min(paneState.index, paneState.outputs.length - 1);
      const next = paneState.outputs[boundedIndex];
      paneState.index += 1;
      return next;
    }
  };
}

/**
 * Asserts that sequence numbers are strictly increasing.
 *
 * @param seqs Sequence list to validate.
 */
function assertStrictlyIncreasing(seqs: number[]): void {
  for (let i = 1; i < seqs.length; i += 1) {
    assert.ok(seqs[i] > seqs[i - 1], `expected strictly increasing replay seqs, got ${seqs}`);
  }
}

test("attach(lastSeq) replays only missing events with no duplicates", async (t) => {
  t.mock.method(globalThis, "setInterval", () => ({}) as NodeJS.Timeout);
  t.mock.method(globalThis, "clearInterval", () => undefined);

  const capture = createCapturePaneMock(["a", "ab", "abc", "abcd"]);
  const outputEvents: RecordedOutput[] = [];

  const engine = new BridgeEngine({
    tmux: { capturePane: capture.capturePane },
    replayLines: 80,
    pollIntervalMs: 25,
    maxHistoryEvents: 20,
    onOutput: (clientId, event) => outputEvents.push({ clientId, event }),
    onError: () => assert.fail("onError should not be called")
  });

  await engine.attach("seed-client", "%1");
  await engine.pollOnce();
  await engine.pollOnce();
  await engine.pollOnce();

  const metadata = await engine.attach("reconnect-client", "%1", 2);

  const replayed = outputEvents
    .filter((entry) => entry.clientId === "reconnect-client")
    .map((entry) => entry.event);

  assert.deepEqual(replayed.map((event) => event.streamSeq), [3, 4]);
  assert.deepEqual(replayed.map((event) => event.chunk), ["c", "d"]);
  assert.ok(replayed.every((event) => event.streamSeq > 2));
  assert.equal(new Set(replayed.map((event) => event.streamSeq)).size, replayed.length);
  assertStrictlyIncreasing(replayed.map((event) => event.streamSeq));
  assert.deepEqual(metadata, {
    paneId: "%1",
    requestedLastSeq: 2,
    latestSeq: 4,
    oldestHistorySeq: 1,
    latestHistorySeq: 4,
    replayedCount: 2,
    replayUsed: true,
    fallbackToSnapshot: false,
    replayGapDetected: false
  } satisfies BridgeAttachReplayMetadata);
});

test("replay output stays ordered even if watcher history storage is out-of-order", async (t) => {
  t.mock.method(globalThis, "setInterval", () => ({}) as NodeJS.Timeout);
  t.mock.method(globalThis, "clearInterval", () => undefined);

  const capture = createCapturePaneMock(["x", "xy", "xyz", "xyzz"]);
  const outputEvents: RecordedOutput[] = [];

  const engine = new BridgeEngine({
    tmux: { capturePane: capture.capturePane },
    replayLines: 80,
    pollIntervalMs: 25,
    maxHistoryEvents: 20,
    onOutput: (clientId, event) => outputEvents.push({ clientId, event }),
    onError: () => assert.fail("onError should not be called")
  });

  await engine.attach("seed-client", "%9");
  await engine.pollOnce();
  await engine.pollOnce();
  await engine.pollOnce();

  const panes = (
    engine as unknown as {
      panes: Map<string, { history: BridgePaneEvent[] }>;
    }
  ).panes;
  const watcher = panes.get("%9");
  assert.ok(watcher);
  assert.equal(watcher.history.length, 4);

  // Emulate a corrupted internal ordering and verify replay re-sorts by seq.
  watcher.history = [watcher.history[3], watcher.history[1], watcher.history[2], watcher.history[0]];

  const metadata = await engine.attach("reconnect-client", "%9", 1);
  const replayed = outputEvents
    .filter((entry) => entry.clientId === "reconnect-client")
    .map((entry) => entry.event);
  const seqs = replayed.map((event) => event.streamSeq);

  assert.deepEqual(seqs, [2, 3, 4]);
  assert.ok(replayed.every((event) => event.streamSeq > 1));
  assert.equal(new Set(seqs).size, seqs.length);
  assertStrictlyIncreasing(seqs);
  assert.deepEqual(metadata, {
    paneId: "%9",
    requestedLastSeq: 1,
    latestSeq: 4,
    oldestHistorySeq: 1,
    latestHistorySeq: 4,
    replayedCount: 3,
    replayUsed: true,
    fallbackToSnapshot: false,
    replayGapDetected: false
  } satisfies BridgeAttachReplayMetadata);
});

test("attach(lastSeq) falls back to snapshot metadata when replay history has a gap", async (t) => {
  t.mock.method(globalThis, "setInterval", () => ({}) as NodeJS.Timeout);
  t.mock.method(globalThis, "clearInterval", () => undefined);

  const capture = createCapturePaneMock(["a", "ab", "abc", "abcd"]);
  const outputEvents: RecordedOutput[] = [];

  const engine = new BridgeEngine({
    tmux: { capturePane: capture.capturePane },
    replayLines: 80,
    pollIntervalMs: 25,
    maxHistoryEvents: 2,
    onOutput: (clientId, event) => outputEvents.push({ clientId, event }),
    onError: () => assert.fail("onError should not be called")
  });

  await engine.attach("seed-client", "%2");
  await engine.pollOnce();
  await engine.pollOnce();
  await engine.pollOnce();

  const metadata = await engine.attach("reconnect-client", "%2", 1);
  const reconnectEvents = outputEvents
    .filter((entry) => entry.clientId === "reconnect-client")
    .map((entry) => entry.event);

  assert.deepEqual(reconnectEvents, [
    {
      mode: "snapshot",
      paneId: "%2",
      chunk: "abcd",
      streamSeq: 4
    }
  ]);
  assert.deepEqual(metadata, {
    paneId: "%2",
    requestedLastSeq: 1,
    latestSeq: 4,
    oldestHistorySeq: 3,
    latestHistorySeq: 4,
    replayedCount: 0,
    replayUsed: false,
    fallbackToSnapshot: true,
    replayGapDetected: true
  } satisfies BridgeAttachReplayMetadata);
});

test("repeated reconnect replay from the same lastSeq is deterministic", async (t) => {
  t.mock.method(globalThis, "setInterval", () => ({}) as NodeJS.Timeout);
  t.mock.method(globalThis, "clearInterval", () => undefined);

  const capture = createCapturePaneMock(["a", "ab", "abc", "abcd"]);
  const outputEvents: RecordedOutput[] = [];

  const engine = new BridgeEngine({
    tmux: { capturePane: capture.capturePane },
    replayLines: 80,
    pollIntervalMs: 25,
    maxHistoryEvents: 20,
    onOutput: (clientId, event) => outputEvents.push({ clientId, event }),
    onError: () => assert.fail("onError should not be called")
  });

  await engine.attach("seed-client", "%7");
  await engine.pollOnce();
  await engine.pollOnce();
  await engine.pollOnce();

  await engine.attach("reconnect-one", "%7", 2);
  await engine.attach("reconnect-two", "%7", 2);

  const replayOne = outputEvents
    .filter((entry) => entry.clientId === "reconnect-one")
    .map((entry) => entry.event);
  const replayTwo = outputEvents
    .filter((entry) => entry.clientId === "reconnect-two")
    .map((entry) => entry.event);

  assert.deepEqual(replayOne, replayTwo);
  assert.deepEqual(replayOne.map((event) => event.streamSeq), [3, 4]);
  assert.deepEqual(replayOne.map((event) => event.chunk), ["c", "d"]);
  assertStrictlyIncreasing(replayOne.map((event) => event.streamSeq));
});

test("reconnect replay stays ordered after idle backoff periods", async (t) => {
  t.mock.method(globalThis, "setInterval", () => ({}) as NodeJS.Timeout);
  t.mock.method(globalThis, "clearInterval", () => undefined);

  let nowMs = 0;
  const capture = createCapturePaneMock(["a", "a", "ab", "abc"]);
  const outputEvents: RecordedOutput[] = [];

  const engine = new BridgeEngine({
    tmux: { capturePane: capture.capturePane },
    replayLines: 80,
    pollIntervalMs: 25,
    maxHistoryEvents: 20,
    now: () => nowMs,
    onOutput: (clientId, event) => outputEvents.push({ clientId, event }),
    onError: () => assert.fail("onError should not be called")
  });

  await engine.attach("seed-client", "%11");

  nowMs = 25;
  await engine.pollOnce(false);
  nowMs = 75;
  await engine.pollOnce(false);
  nowMs = 100;
  await engine.pollOnce(false);

  const metadata = await engine.attach("reconnect-client", "%11", 1);
  const replayed = outputEvents
    .filter((entry) => entry.clientId === "reconnect-client")
    .map((entry) => entry.event);

  assert.deepEqual(replayed.map((event) => event.streamSeq), [2, 3]);
  assert.deepEqual(replayed.map((event) => event.chunk), ["b", "c"]);
  assertStrictlyIncreasing(replayed.map((event) => event.streamSeq));
  assert.deepEqual(metadata, {
    paneId: "%11",
    requestedLastSeq: 1,
    latestSeq: 3,
    oldestHistorySeq: 1,
    latestHistorySeq: 3,
    replayedCount: 2,
    replayUsed: true,
    fallbackToSnapshot: false,
    replayGapDetected: false
  } satisfies BridgeAttachReplayMetadata);
});

test("replay works correctly after backoff-only unchanged polls", async (t) => {
  t.mock.method(globalThis, "setInterval", () => ({}) as NodeJS.Timeout);
  t.mock.method(globalThis, "clearInterval", () => undefined);

  const capture = createCapturePaneMock(["a", "ab", "abc", "abc", "abcd"]);
  const outputEvents: RecordedOutput[] = [];

  let now = 0;
  const engine = new BridgeEngine({
    tmux: { capturePane: capture.capturePane },
    replayLines: 80,
    pollIntervalMs: 10,
    maxPollIntervalMs: 40,
    now: () => now,
    onOutput: (clientId, event) => outputEvents.push({ clientId, event }),
    onError: () => assert.fail("onError should not be called")
  });

  await engine.attach("seed-client", "%1");

  now += 10;
  await engine.pollOnce(false);
  now += 10;
  await engine.pollOnce(false);
  now += 10;
  await engine.pollOnce(false);

  now += 10;
  await engine.pollOnce(false);

  const metadata = await engine.attach("reconnect-client", "%1", 2);
  const replayed = outputEvents
    .filter((entry) => entry.clientId === "reconnect-client")
    .map((entry) => entry.event);

  assert.deepEqual(replayed.map((event) => event.streamSeq), [3]);
  assert.deepEqual(replayed.map((event) => event.chunk), ["c"]);
  assert.deepEqual(metadata, {
    paneId: "%1",
    requestedLastSeq: 2,
    latestSeq: 3,
    oldestHistorySeq: 1,
    latestHistorySeq: 3,
    replayedCount: 1,
    replayUsed: true,
    fallbackToSnapshot: false,
    replayGapDetected: false
  } satisfies BridgeAttachReplayMetadata);
});

test("multi-pane replay preserves per-pane ordering with deterministic fixture output", async (t) => {
  t.mock.method(globalThis, "setInterval", () => ({}) as NodeJS.Timeout);
  t.mock.method(globalThis, "clearInterval", () => undefined);

  const capture = createMultiPaneCaptureMock({
    "%1": ["alpha", "alpha+", "alpha++"],
    "%2": ["beta", "beta+", "beta++"]
  });
  const outputEvents: RecordedOutput[] = [];

  const engine = new BridgeEngine({
    tmux: { capturePane: capture.capturePane },
    replayLines: 80,
    pollIntervalMs: 25,
    maxHistoryEvents: 20,
    onOutput: (clientId, event) => outputEvents.push({ clientId, event }),
    onError: () => assert.fail("onError should not be called")
  });

  await engine.attach("seed-client", "%1");
  await engine.attach("seed-client", "%2");
  await engine.pollOnce();
  await engine.pollOnce();

  await engine.attach("reconnect-client", "%1", 1);
  await engine.attach("reconnect-client", "%2", 1);

  const replayed = outputEvents
    .filter((entry) => entry.clientId === "reconnect-client")
    .map((entry) => entry.event);
  const paneOneReplay = replayed.filter((event) => event.paneId === "%1");
  const paneTwoReplay = replayed.filter((event) => event.paneId === "%2");

  assert.deepEqual(
    replayed.map((event) => [event.paneId, event.streamSeq, event.chunk]),
    [
      ["%1", 2, "+"],
      ["%1", 3, "+"],
      ["%2", 2, "+"],
      ["%2", 3, "+"]
    ]
  );
  assert.deepEqual(paneOneReplay.map((event) => event.streamSeq), [2, 3]);
  assert.deepEqual(paneTwoReplay.map((event) => event.streamSeq), [2, 3]);
  assertStrictlyIncreasing(paneOneReplay.map((event) => event.streamSeq));
  assertStrictlyIncreasing(paneTwoReplay.map((event) => event.streamSeq));
  assert.ok(paneOneReplay.every((event) => event.paneId === "%1"));
  assert.ok(paneTwoReplay.every((event) => event.paneId === "%2"));
});

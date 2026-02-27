/**
 * @file End-to-end reconnect/replay tests for bridge server websocket flows.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { startBridgeServer } from "./bridge-server.js";
import {
  HOST,
  assertStrictlyIncreasing,
  canBindLoopback,
  closeWs,
  createReplayTmux,
  createWsProbe,
  isPaneOutput,
  reservePort,
  streamSeq
} from "./bridge-server.replay.e2e.helpers.js";

type CapturedAuditEvent = {
  action: string;
  clientId: string;
  details: Record<string, unknown>;
  ts: number;
};

test("attach(lastSeq) replays only missing sequence events without duplicates", async (t) => {
  if (!(await canBindLoopback())) {
    t.skip("loopback bind not permitted in this runtime");
    return;
  }

  const tmux = createReplayTmux(["a", "ab", "abc", "abcd"]);
  const port = await reservePort();
  const auditEvents: CapturedAuditEvent[] = [];
  const runtime = await startBridgeServer({
    config: {
      host: HOST,
      port,
      strictProtocolParsing: true,
      pollIntervalMs: 70,
      replayLines: 200,
      maxHistoryEvents: 100,
      maxInputBytes: 512,
      maxAttachedPanes: 4,
      maxMessagesPerMinute: 1_000,
      maxInputsPerMinute: 1_000,
      globalInputDisabled: false,
      authToken: null,
      auditLogPath: null
    },
    tmux,
    logger: {
      info: () => {},
      warn: () => {},
      error: () => {},
      audit: (event: CapturedAuditEvent) => {
        auditEvents.push(event);
      }
    }
  });

  const anchor = await createWsProbe(`ws://${HOST}:${port}/ws`);
  const reconnect = await createWsProbe(`ws://${HOST}:${port}/ws`);

  try {
    await anchor.next((message) => message.type === "hello");
    const reconnectHello = await reconnect.next((message) => message.type === "hello");

    anchor.sendRequest("attach", "anchor-attach", { paneId: "%1" });
    await anchor.next((message) => isPaneOutput(message, "%1") && streamSeq(message) === 1);
    await anchor.next(
      (message) => message.type === "ack" && message.requestId === "anchor-attach"
    );

    const liveSeq2 = await anchor.next(
      (message) => isPaneOutput(message, "%1") && streamSeq(message) === 2
    );
    const liveSeq3 = await anchor.next(
      (message) => isPaneOutput(message, "%1") && streamSeq(message) === 3
    );
    const liveSeq4 = await anchor.next(
      (message) => isPaneOutput(message, "%1") && streamSeq(message) === 4
    );
    assert.deepEqual(
      [liveSeq2.payload.chunk, liveSeq3.payload.chunk, liveSeq4.payload.chunk],
      ["b", "c", "d"]
    );

    reconnect.sendRequest("attach", "reconnect-attach", {
      paneId: "%1",
      lastSeq: 2
    });

    const replayed = await reconnect.collect(
      (message) => isPaneOutput(message, "%1") && streamSeq(message) > 2,
      2
    );
    await reconnect.next(
      (message) => message.type === "ack" && message.requestId === "reconnect-attach"
    );

    const replaySeqs = replayed.map((message) => streamSeq(message));
    assert.deepEqual(replaySeqs, [3, 4]);
    assert.ok(replaySeqs.every((seq) => seq > 2));
    assert.equal(new Set(replaySeqs).size, replaySeqs.length);
    assertStrictlyIncreasing(replaySeqs);
    const replayResumeAudit = auditEvents.find(
      (event) => event.action === "replay_resume" && event.clientId === reconnectHello.payload.clientId
    );
    assert.ok(replayResumeAudit);
    assert.equal(replayResumeAudit.details.paneId, "%1");
    assert.equal(replayResumeAudit.details.lastSeq, 2);
    assert.equal(replayResumeAudit.details.replayedCount, 2);
    assert.equal(replayResumeAudit.details.latestSeq, 4);
    await reconnect.expectNone((message) => isPaneOutput(message, "%1"), 180);
  } finally {
    await closeWs(reconnect.socket);
    await closeWs(anchor.socket);
    await runtime.close();
  }
});

test("attach with ahead-of-stream lastSeq falls back to latest snapshot without out-of-order replay", async (t) => {
  if (!(await canBindLoopback())) {
    t.skip("loopback bind not permitted in this runtime");
    return;
  }

  const tmux = createReplayTmux(["seed", "seed-2", "seed-3"]);
  const port = await reservePort();
  const auditEvents: CapturedAuditEvent[] = [];
  const runtime = await startBridgeServer({
    config: {
      host: HOST,
      port,
      strictProtocolParsing: true,
      pollIntervalMs: 70,
      replayLines: 200,
      maxHistoryEvents: 100,
      maxInputBytes: 512,
      maxAttachedPanes: 4,
      maxMessagesPerMinute: 1_000,
      maxInputsPerMinute: 1_000,
      globalInputDisabled: false,
      authToken: null,
      auditLogPath: null
    },
    tmux,
    logger: {
      info: () => {},
      warn: () => {},
      error: () => {},
      audit: (event: CapturedAuditEvent) => {
        auditEvents.push(event);
      }
    }
  });

  const anchor = await createWsProbe(`ws://${HOST}:${port}/ws`);
  const reconnect = await createWsProbe(`ws://${HOST}:${port}/ws`);

  try {
    await anchor.next((message) => message.type === "hello");
    const reconnectHello = await reconnect.next((message) => message.type === "hello");

    anchor.sendRequest("attach", "anchor-attach", { paneId: "%1" });
    await anchor.next((message) => isPaneOutput(message, "%1") && streamSeq(message) === 1);
    await anchor.next(
      (message) => message.type === "ack" && message.requestId === "anchor-attach"
    );
    await anchor.next((message) => isPaneOutput(message, "%1") && streamSeq(message) === 2);
    await anchor.next((message) => isPaneOutput(message, "%1") && streamSeq(message) === 3);

    reconnect.sendRequest("attach", "reconnect-attach", {
      paneId: "%1",
      lastSeq: 99
    });

    const snapshot = await reconnect.next((message) => isPaneOutput(message, "%1"));
    await reconnect.next(
      (message) => message.type === "ack" && message.requestId === "reconnect-attach"
    );

    assert.equal(snapshot.payload.mode, "snapshot");
    assert.equal(streamSeq(snapshot), 3);
    assert.equal(snapshot.payload.chunk, "seed-3");
    const replayFallbackAudit = auditEvents.find(
      (event) => event.action === "replay_gap_snapshot_fallback" && event.clientId === reconnectHello.payload.clientId
    );
    assert.ok(replayFallbackAudit);
    assert.equal(replayFallbackAudit.details.paneId, "%1");
    assert.equal(replayFallbackAudit.details.lastSeq, 99);
    assert.equal(replayFallbackAudit.details.latestSeq, 3);
    assert.equal(
      auditEvents.some(
        (event) => event.action === "replay_resume" && event.clientId === reconnectHello.payload.clientId
      ),
      false
    );
    await reconnect.expectNone((message) => isPaneOutput(message, "%1"), 180);
  } finally {
    await closeWs(reconnect.socket);
    await closeWs(anchor.socket);
    await runtime.close();
  }
});

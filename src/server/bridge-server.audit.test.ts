/**
 * @file Audit-focused unit tests for bridge server message handling.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { handleClientMessage } from "./bridge-server.js";
import { SlidingWindowRateLimiter } from "./rate-limiter.js";
import type { BridgeAttachReplayMetadata } from "../bridge/bridge-engine.js";

interface SentEnvelope {
  type: string;
  requestId?: string;
  payload: Record<string, unknown>;
}

interface FakeSocket {
  OPEN: number;
  readyState: number;
  send: (message: string) => void;
}

interface AuditEvent {
  action: string;
  clientId: string;
  details: Record<string, unknown>;
}

interface AuditHarness {
  sent: SentEnvelope[];
  sentInputs: Array<{ paneId: string; input: string }>;
  detachedPanes: Array<{ clientId: string; paneId: string }>;
  detachedAllClients: string[];
  auditEvents: AuditEvent[];
  ctx: Parameters<typeof handleClientMessage>[0];
}

function createSocketRecorder(): { socket: FakeSocket; sent: SentEnvelope[] } {
  const sent: SentEnvelope[] = [];
  const socket: FakeSocket = {
    OPEN: 1,
    readyState: 1,
    send: (message: string) => {
      sent.push(JSON.parse(message) as SentEnvelope);
    }
  };
  return { socket, sent };
}

function createAuditHarness(): AuditHarness {
  const { socket, sent } = createSocketRecorder();
  const sentInputs: Array<{ paneId: string; input: string }> = [];
  const detachedPanes: Array<{ clientId: string; paneId: string }> = [];
  const detachedAllClients: string[] = [];
  const auditEvents: AuditEvent[] = [];
  const paneInputOwners = new Map<string, string>();

  return {
    sent,
    sentInputs,
    detachedPanes,
    detachedAllClients,
    auditEvents,
    ctx: {
      client: {
        id: "client-audit",
        socket,
        authenticated: true,
        inputEnabled: true,
        attachedPanes: new Set<string>(["pane-1"])
      },
      tmux: {
        listPanes: async () => [{ paneId: "pane-1", sessionName: "main" }],
        sendInput: async (paneId: string, input: string) => {
          sentInputs.push({ paneId, input });
        }
      },
      engine: {
        attach: async () => {},
        detach: (clientId: string, paneId: string) => {
          detachedPanes.push({ clientId, paneId });
        },
        detachAll: (clientId: string) => {
          detachedAllClients.push(clientId);
        }
      },
      config: {
        authToken: null,
        maxInputBytes: 4_096,
        maxAttachedPanes: 8,
        globalInputDisabled: false,
        allowInputOwnershipOverride: true
      },
      inputLimiter: new SlidingWindowRateLimiter({ maxEvents: 1_000, windowMs: 60_000 }),
      requestId: undefined,
      audit: {
        write: async (event: AuditEvent) => {
          auditEvents.push(event);
        }
      },
      paneInputOwners,
      paneInputOwnership: paneInputOwners
    } as unknown as Parameters<typeof handleClientMessage>[0]
  };
}

function createReplayMetadata(
  overrides: Partial<BridgeAttachReplayMetadata>
): BridgeAttachReplayMetadata {
  return {
    paneId: "pane-1",
    requestedLastSeq: null,
    latestSeq: 0,
    oldestHistorySeq: null,
    latestHistorySeq: null,
    replayedCount: 0,
    replayUsed: false,
    fallbackToSnapshot: false,
    replayGapDetected: false,
    ...overrides
  };
}

async function dispatch(
  harness: AuditHarness,
  type: string,
  requestId: string,
  payload: Record<string, unknown>
): Promise<SentEnvelope> {
  await handleClientMessage({
    ...harness.ctx,
    type,
    payload,
    requestId
  } as unknown as Parameters<typeof handleClientMessage>[0]);
  const message = harness.sent[harness.sent.length - 1];
  assert.ok(message, `expected response envelope for ${type}`);
  return message;
}

test("input audit captures bytes/hash/policy and excludes raw input fields", async () => {
  const harness = createAuditHarness();
  const command = "echo safe audit\n";

  const ack = await dispatch(harness, "input", "input-1", {
    paneId: "pane-1",
    data: command
  });

  assert.equal(ack.type, "ack");
  assert.equal(ack.payload.action, "input");
  assert.deepEqual(harness.sentInputs, [{ paneId: "pane-1", input: command }]);

  const inputEvent = harness.auditEvents.find(
    (event) => event.action === "input" && event.details.result === "allowed"
  );
  assert.ok(inputEvent);
  assert.equal(inputEvent.clientId, "client-audit");
  assert.equal(inputEvent.details.bytes, Buffer.byteLength(command, "utf8"));
  assert.equal(
    inputEvent.details.commandHash,
    createHash("sha256").update(command, "utf8").digest("hex")
  );
  assert.equal(inputEvent.details.previewPolicy, "sha256_only");
  assert.equal("data" in inputEvent.details, false);
  assert.equal("input" in inputEvent.details, false);
  assert.equal(JSON.stringify(inputEvent.details).includes(command), false);
});

test("detach emits lane_owner_released audit event when ownership existed", async () => {
  const harness = createAuditHarness();

  await dispatch(harness, "input", "input-claim", {
    paneId: "pane-1",
    data: "echo owner\n"
  });

  const detachAck = await dispatch(harness, "detach", "detach-1", {
    paneId: "pane-1"
  });

  assert.equal(detachAck.type, "ack");
  assert.equal(detachAck.payload.action, "detach");
  assert.deepEqual(harness.detachedPanes, [{ clientId: "client-audit", paneId: "pane-1" }]);

  const detachIndex = harness.auditEvents.findIndex((event) => event.action === "detach");
  const releaseIndex = harness.auditEvents.findIndex(
    (event) =>
      event.action === "lane_owner_released" &&
      event.details.reason === "detach"
  );
  assert.ok(detachIndex >= 0);
  assert.ok(releaseIndex > detachIndex);
  const laneReleasedEvent = harness.auditEvents[releaseIndex];
  assert.equal(laneReleasedEvent.clientId, "client-audit");
  assert.equal(laneReleasedEvent.details.paneId, "pane-1");
  assert.equal(laneReleasedEvent.details.result, "allowed");
});

test("disconnect emits lane_owner_released audit event when ownership existed", async () => {
  const harness = createAuditHarness();

  await dispatch(harness, "input", "input-claim", {
    paneId: "pane-1",
    data: "echo owner\n"
  });

  const disconnectAck = await dispatch(harness, "disconnect", "disconnect-1", {});
  assert.equal(disconnectAck.type, "ack");
  assert.equal(disconnectAck.payload.action, "disconnect");
  assert.deepEqual(harness.detachedAllClients, ["client-audit"]);

  const releaseIndex = harness.auditEvents.findIndex(
    (event) =>
      event.action === "lane_owner_released" &&
      event.details.reason === "disconnect"
  );
  const disconnectIndex = harness.auditEvents.findIndex((event) => event.action === "disconnect");
  assert.ok(releaseIndex >= 0);
  assert.ok(disconnectIndex > releaseIndex);
  const laneReleasedEvent = harness.auditEvents[releaseIndex];
  assert.equal(laneReleasedEvent.clientId, "client-audit");
  assert.equal(laneReleasedEvent.details.result, "allowed");
  assert.equal(laneReleasedEvent.details.releasedPanes, 1);
});

test("attach emits replay_resume audit action with explicit reason fields", async () => {
  const harness = createAuditHarness();
  harness.ctx.engine.attach = async () =>
    createReplayMetadata({
      requestedLastSeq: 2,
      latestSeq: 4,
      oldestHistorySeq: 1,
      latestHistorySeq: 4,
      replayedCount: 2,
      replayUsed: true
    });

  const ack = await dispatch(harness, "attach", "attach-resume", {
    paneId: "pane-1",
    lastSeq: 2
  });
  assert.equal(ack.type, "ack");
  assert.equal(ack.payload.action, "attach");

  const replayResumeEvent = harness.auditEvents.find((event) => event.action === "replay_resume");
  assert.ok(replayResumeEvent);
  assert.equal(replayResumeEvent.details.paneId, "pane-1");
  assert.equal(replayResumeEvent.details.lastSeq, 2);
  assert.equal(replayResumeEvent.details.replayedCount, 2);
  assert.equal(replayResumeEvent.details.replayStartSeq, 3);
  assert.equal(replayResumeEvent.details.replayEndSeq, 4);
  assert.equal(replayResumeEvent.details.latestSeq, 4);
  assert.equal(replayResumeEvent.details.result, "allowed");
  assert.equal(replayResumeEvent.details.reason, "resume");
});

const replayFallbackCases: Array<{
  name: string;
  lastSeq: number;
  metadata: BridgeAttachReplayMetadata;
  expectedReason: string;
}> = [
  {
    name: "ahead_of_stream",
    lastSeq: 99,
    metadata: createReplayMetadata({
      requestedLastSeq: 99,
      latestSeq: 3,
      oldestHistorySeq: 1,
      latestHistorySeq: 3,
      fallbackToSnapshot: true
    }),
    expectedReason: "ahead_of_stream"
  },
  {
    name: "outside_retained_window",
    lastSeq: 2,
    metadata: createReplayMetadata({
      requestedLastSeq: 2,
      latestSeq: 12,
      oldestHistorySeq: 6,
      latestHistorySeq: 12,
      fallbackToSnapshot: true,
      replayGapDetected: true
    }),
    expectedReason: "outside_retained_window"
  },
  {
    name: "empty_resume_window",
    lastSeq: 12,
    metadata: createReplayMetadata({
      requestedLastSeq: 12,
      latestSeq: 12,
      oldestHistorySeq: 6,
      latestHistorySeq: 12,
      fallbackToSnapshot: true
    }),
    expectedReason: "empty_resume_window"
  }
];

for (const fallbackCase of replayFallbackCases) {
  test(`attach emits replay_gap_snapshot_fallback with reason ${fallbackCase.name}`, async () => {
    const harness = createAuditHarness();
    harness.ctx.engine.attach = async () => fallbackCase.metadata;

    const ack = await dispatch(harness, "attach", `attach-fallback-${fallbackCase.name}`, {
      paneId: "pane-1",
      lastSeq: fallbackCase.lastSeq
    });
    assert.equal(ack.type, "ack");
    assert.equal(ack.payload.action, "attach");

    const fallbackEvent = harness.auditEvents.find(
      (event) => event.action === "replay_gap_snapshot_fallback"
    );
    assert.ok(fallbackEvent);
    assert.equal(fallbackEvent.details.paneId, "pane-1");
    assert.equal(fallbackEvent.details.lastSeq, fallbackCase.lastSeq);
    assert.equal(fallbackEvent.details.streamSeq, fallbackCase.metadata.latestSeq);
    assert.equal(fallbackEvent.details.result, "allowed");
    assert.equal(fallbackEvent.details.reason, fallbackCase.expectedReason);
  });
}

/**
 * @file Lifecycle logging coverage for bridge server core events.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { startBridgeServer, handleClientMessage } from "./bridge-server.js";
import type { BridgeAttachReplayMetadata } from "../bridge/bridge-engine.js";
import { SlidingWindowRateLimiter } from "./rate-limiter.js";
import {
  HOST,
  canBindLoopback,
  closeWs,
  createReplayTmux,
  createWsProbe,
  reservePort
} from "./bridge-server.replay.e2e.helpers.js";

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

interface CapturedAuditEvent {
  action: string;
  clientId: string;
  details: Record<string, unknown>;
}

interface LifecycleHarness {
  sent: SentEnvelope[];
  sentInputs: Array<{ paneId: string; input: string }>;
  auditEvents: CapturedAuditEvent[];
  paneInputOwners: Map<string, string>;
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

function createLifecycleHarness(): LifecycleHarness {
  const { socket, sent } = createSocketRecorder();
  const sentInputs: Array<{ paneId: string; input: string }> = [];
  const auditEvents: CapturedAuditEvent[] = [];
  const paneInputOwners = new Map<string, string>();

  return {
    sent,
    sentInputs,
    auditEvents,
    paneInputOwners,
    ctx: {
      client: {
        id: "client-lifecycle",
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
        detach: () => {},
        detachAll: () => {}
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
        write: async (event: CapturedAuditEvent) => {
          auditEvents.push(event);
        }
      },
      paneInputOwners,
      paneInputOwnership: paneInputOwners
    } as unknown as Parameters<typeof handleClientMessage>[0]
  };
}

async function dispatch(
  harness: LifecycleHarness,
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

test("websocket connect emits connect lifecycle audit event", async (t) => {
  if (!(await canBindLoopback())) {
    t.skip("loopback bind not permitted in this runtime");
    return;
  }

  const auditEvents: CapturedAuditEvent[] = [];
  const port = await reservePort();
  const runtime = await startBridgeServer({
    config: {
      host: HOST,
      port,
      strictProtocolParsing: true,
      pollIntervalMs: 100,
      replayLines: 200,
      maxHistoryEvents: 100,
      maxInputBytes: 512,
      maxAttachedPanes: 4,
      maxMessagesPerMinute: 1_000,
      maxInputsPerMinute: 1_000,
      globalInputDisabled: false,
      authToken: "token-1",
      auditLogPath: null
    },
    tmux: createReplayTmux(["seed"]),
    logger: {
      info: () => {},
      warn: () => {},
      error: () => {},
      audit: (event: CapturedAuditEvent) => {
        auditEvents.push(event);
      }
    }
  });

  const probe = await createWsProbe(`ws://${HOST}:${port}/ws`);
  try {
    const hello = await probe.next((message) => message.type === "hello");
    const connectEvent = auditEvents.find((event) => event.action === "connect" && event.clientId === hello.payload.clientId);
    assert.ok(connectEvent);
    assert.equal(connectEvent.details.result, "allowed");
    assert.equal(connectEvent.details.reason, "socket_open");
    assert.equal(connectEvent.details.requiresAuth, true);
    assert.equal(connectEvent.details.inputEnabled, false);
    assert.equal(connectEvent.details.globalInputDisabled, false);
  } finally {
    await closeWs(probe.socket);
    await runtime.close();
  }
});

test("attach lifecycle logs attach, replay resume, and replay fallback", async () => {
  const harness = createLifecycleHarness();
  harness.ctx.engine.attach = async () =>
    createReplayMetadata({
      requestedLastSeq: 3,
      latestSeq: 5,
      oldestHistorySeq: 2,
      latestHistorySeq: 5,
      replayedCount: 2,
      replayUsed: true
    });

  const resumeAck = await dispatch(harness, "attach", "attach-resume", {
    paneId: "pane-1",
    lastSeq: 3
  });
  assert.equal(resumeAck.type, "ack");
  assert.equal(resumeAck.payload.action, "attach");
  assert.ok(harness.auditEvents.find((event) => event.action === "attach"));
  const replayResume = harness.auditEvents.find((event) => event.action === "replay_resume");
  assert.ok(replayResume);
  assert.equal(replayResume.details.reason, "resume");

  harness.ctx.engine.attach = async () =>
    createReplayMetadata({
      requestedLastSeq: 99,
      latestSeq: 7,
      oldestHistorySeq: 1,
      latestHistorySeq: 7,
      fallbackToSnapshot: true
    });

  const fallbackAck = await dispatch(harness, "attach", "attach-fallback", {
    paneId: "pane-1",
    lastSeq: 99
  });
  assert.equal(fallbackAck.type, "ack");
  const fallbackEvent = harness.auditEvents.find((event) => event.action === "replay_gap_snapshot_fallback");
  assert.ok(fallbackEvent);
  assert.equal(fallbackEvent.details.reason, "ahead_of_stream");
});

test("input lifecycle logs enable/disable, takeover, and policy reject", async () => {
  const harness = createLifecycleHarness();
  harness.ctx.client.inputEnabled = false;
  harness.paneInputOwners.set("pane-1", "other-client");

  const enableResult = await dispatch(harness, "enable_input", "enable-1", {});
  assert.equal(enableResult.type, "policy_update");
  const enableAudit = harness.auditEvents.find((event) => event.action === "enable_input");
  assert.ok(enableAudit);
  assert.equal(enableAudit.details.result, "allowed");
  assert.equal(enableAudit.details.reason, "client_enabled");

  const takeoverResult = await dispatch(harness, "input", "input-takeover", {
    paneId: "pane-1",
    data: "echo takeover\n",
    override: true
  });
  assert.equal(takeoverResult.type, "ack");
  const takeoverAudit = harness.auditEvents.find((event) => event.action === "input_takeover");
  assert.ok(takeoverAudit);
  assert.equal(takeoverAudit.details.reason, "override");

  const disableResult = await dispatch(harness, "disable_input", "disable-1", {});
  assert.equal(disableResult.type, "policy_update");
  const disableAudit = harness.auditEvents.find((event) => event.action === "disable_input");
  assert.ok(disableAudit);
  assert.equal(disableAudit.details.reason, "client_disabled");

  const rejectedInput = await dispatch(harness, "input", "input-policy-reject", {
    paneId: "pane-1",
    data: "echo denied\n"
  });
  assert.equal(rejectedInput.type, "error");
  assert.equal(rejectedInput.payload.code, "input_disabled");
  const policyRejectAudit = harness.auditEvents.find(
    (event) => event.action === "input" && event.details.reason === "policy_blocked"
  );
  assert.ok(policyRejectAudit);
});

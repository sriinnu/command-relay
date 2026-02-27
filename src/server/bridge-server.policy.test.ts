/**
 * @file Conformance tests for bridge message policy behavior.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { SlidingWindowRateLimiter } from "./rate-limiter.js";
import { handleClientMessage, parseIncomingClientMessage } from "./bridge-server.js";

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

interface PolicyClientHarness {
  clientId: string;
  ctx: Parameters<typeof handleClientMessage>[0];
  sent: SentEnvelope[];
  auditEvents: AuditEvent[];
}

interface OwnershipHarness {
  sentInputs: Array<{ paneId: string; input: string }>;
  auditEvents: AuditEvent[];
  clientA: PolicyClientHarness;
  clientB: PolicyClientHarness;
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

function createAuditRecorder(): {
  events: AuditEvent[];
  audit: { write: (event: AuditEvent) => Promise<void> };
} {
  const events: AuditEvent[] = [];
  return {
    events,
    audit: { write: async (event: AuditEvent) => { events.push(event); } }
  };
}

function createContext(globalInputDisabled: boolean) {
  const recorder = createSocketRecorder();
  const sentInputs: Array<{ paneId: string; input: string }> = [];
  const auditRecorder = createAuditRecorder();

  return {
    sent: recorder.sent,
    sentInputs,
    auditEvents: auditRecorder.events,
    ctx: {
      client: {
        id: "client-1",
        socket: recorder.socket,
        authenticated: true,
        inputEnabled: false,
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
        globalInputDisabled
      },
      inputLimiter: new SlidingWindowRateLimiter({ maxEvents: 1_000, windowMs: 60_000 }),
      requestId: undefined,
      audit: auditRecorder.audit
    }
  };
}

function createOwnershipHarness(
  overrideEnabled: boolean,
  clientIds?: { clientA: string; clientB: string }
): OwnershipHarness {
  const sentInputs: Array<{ paneId: string; input: string }> = [];
  const auditRecorder = createAuditRecorder();
  const paneInputOwners = new Map<string, string>();
  const baseConfig = {
    authToken: null,
    maxInputBytes: 4_096,
    maxAttachedPanes: 8,
    globalInputDisabled: false,
    inputOwnershipEnforced: true,
    inputOwnershipOverrideEnabled: overrideEnabled,
    allowInputOwnershipOverride: overrideEnabled
  };

  const createClient = (clientId: string): PolicyClientHarness => {
    const recorder = createSocketRecorder();
    return {
      clientId,
      sent: recorder.sent,
      auditEvents: auditRecorder.events,
      ctx: {
        client: {
          id: clientId,
          socket: recorder.socket,
          authenticated: true,
          inputEnabled: false,
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
        config: baseConfig,
        inputLimiter: new SlidingWindowRateLimiter({ maxEvents: 1_000, windowMs: 60_000 }),
        requestId: undefined,
        audit: auditRecorder.audit,
        paneInputOwners,
        paneInputOwnership: paneInputOwners
      } as unknown as Parameters<typeof handleClientMessage>[0]
    };
  };

  return {
    sentInputs,
    auditEvents: auditRecorder.events,
    clientA: createClient(clientIds?.clientA ?? "client-a"),
    clientB: createClient(clientIds?.clientB ?? "client-b")
  };
}

async function dispatch(
  client: PolicyClientHarness,
  type: string,
  requestId: string,
  payload: Record<string, unknown> = {}
): Promise<SentEnvelope> {
  await handleClientMessage({
    ...client.ctx,
    type,
    payload,
    requestId
  } as unknown as Parameters<typeof handleClientMessage>[0]);
  const message = client.sent[client.sent.length - 1];
  assert.ok(message, `expected response envelope for ${type}`);
  return message;
}

function assertInputLaneConflict(message: SentEnvelope, ownerClientId: string): void {
  assert.equal(message.type, "error");
  assert.equal(message.payload.code, "input_lane_conflict");
  assert.equal(message.payload.ownerClientId, ownerClientId);
}

test("enables and accepts input when global kill switch is off", async () => {
  const { ctx, sent, sentInputs, auditEvents } = createContext(false);

  await handleClientMessage({
    ...ctx,
    type: "enable_input",
    payload: {},
    requestId: "enable"
  } as any);

  const policyUpdate = sent[sent.length - 1];
  assert.equal(policyUpdate.type, "policy_update");
  assert.equal(policyUpdate.requestId, "enable");
  assert.equal(policyUpdate.payload.inputEnabled, true);
  assert.equal(policyUpdate.payload.globalInputDisabled, false);

  await handleClientMessage({
    ...ctx,
    type: "input",
    payload: { paneId: "pane-1", data: "echo ok\n" },
    requestId: "input"
  } as any);

  const inputAck = sent[sent.length - 1];
  assert.equal(inputAck.type, "ack");
  assert.equal(inputAck.requestId, "input");
  assert.equal(inputAck.payload.action, "input");
  assert.equal(sentInputs.length, 1);
  const inputEvent = auditEvents.find((event) => event.action === "input" && event.details.result === "allowed");
  assert.ok(inputEvent);
  assert.equal(inputEvent.details.bytes, Buffer.byteLength("echo ok\n", "utf8"));
  assert.equal("data" in inputEvent.details, false);
});

test("keeps read-only policy and blocks input when global kill switch is on", async () => {
  const { ctx, sent, sentInputs, auditEvents } = createContext(true);

  await handleClientMessage({
    ...ctx,
    type: "enable_input",
    payload: {},
    requestId: "enable"
  } as any);

  const policyUpdate = sent[sent.length - 1];
  assert.equal(policyUpdate.type, "policy_update");
  assert.equal(policyUpdate.requestId, "enable");
  assert.equal(policyUpdate.payload.inputEnabled, false);
  assert.equal(policyUpdate.payload.globalInputDisabled, true);

  await handleClientMessage({
    ...ctx,
    type: "input",
    payload: { paneId: "pane-1", data: "echo blocked\n" },
    requestId: "input"
  } as any);

  const inputError = sent[sent.length - 1];
  assert.equal(inputError.type, "error");
  assert.equal(inputError.requestId, "input");
  assert.equal(inputError.payload.code, "input_disabled");
  assert.equal(sentInputs.length, 0);
  assert.ok(auditEvents.find((event) => event.action === "input" && event.details.reason === "policy_blocked"));
});

test("parses and executes legacy policy command envelopes when strict parsing is disabled", async () => {
  const parsed = parseIncomingClientMessage(
    JSON.stringify({
      type: "enable_input",
      requestId: "legacy-enable",
      payload: {}
    }),
    false
  );

  assert.equal(parsed.ok, true);
  if (!parsed.ok) {
    return;
  }

  const { ctx, sent } = createContext(false);
  await handleClientMessage({
    ...ctx,
    type: parsed.message.type,
    payload: parsed.message.payload,
    requestId: parsed.message.requestId
  } as Parameters<typeof handleClientMessage>[0]);

  const policyUpdate = sent[sent.length - 1];
  assert.equal(policyUpdate.type, "policy_update");
  assert.equal(policyUpdate.requestId, "legacy-enable");
  assert.equal(policyUpdate.payload.inputEnabled, true);
});

test("arbitration establishes first input owner and blocks conflicting client input", async () => {
  const harness = createOwnershipHarness(false);
  await dispatch(harness.clientA, "enable_input", "enable-a");
  await dispatch(harness.clientB, "enable_input", "enable-b");

  const firstAck = await dispatch(harness.clientA, "input", "input-a-1", {
    paneId: "pane-1",
    data: "echo owner-a\n"
  });
  assert.equal(firstAck.type, "ack");
  assert.equal(harness.sentInputs.length, 1);

  const conflictingResult = await dispatch(harness.clientB, "input", "input-b-1", {
    paneId: "pane-1",
    data: "echo owner-b\n"
  });
  assert.equal(conflictingResult.type, "error");
  assert.equal(conflictingResult.payload.code, "input_lane_conflict");
  assert.equal(harness.sentInputs.length, 1);
  assert.equal(harness.auditEvents.filter((event) => event.action === "input_takeover").length, 0);
  assert.ok(harness.auditEvents.find((event) => event.action === "input" && event.details.reason === "ownership_conflict"));
});

test("arbitration override takes pane ownership when override path is enabled", async () => {
  const harness = createOwnershipHarness(true);
  const takeoverInput = "echo owner-b\n";
  await dispatch(harness.clientA, "enable_input", "enable-a");
  await dispatch(harness.clientB, "enable_input", "enable-b");

  await dispatch(harness.clientA, "input", "input-a-1", {
    paneId: "pane-1",
    data: "echo owner-a\n"
  });

  const overrideResult = await dispatch(harness.clientB, "input", "input-b-override", {
    paneId: "pane-1",
    data: takeoverInput,
    override: true,
    takeOwnership: true
  });
  assert.equal(overrideResult.type, "ack");
  assert.equal(harness.sentInputs.length, 2);
  const takeoverEvents = harness.auditEvents.filter((event) => event.action === "input_takeover");
  assert.equal(takeoverEvents.length, 1);
  assert.equal(takeoverEvents[0]?.clientId, harness.clientB.clientId);
  assert.deepEqual(takeoverEvents[0]?.details, {
    paneId: "pane-1",
    result: "allowed",
    reason: "override",
    bytes: Buffer.byteLength(takeoverInput, "utf8")
  });

  const oldOwnerBlocked = await dispatch(harness.clientA, "input", "input-a-2", {
    paneId: "pane-1",
    data: "echo blocked\n"
  });
  assert.equal(oldOwnerBlocked.type, "error");
  assert.equal(oldOwnerBlocked.payload.code, "input_lane_conflict");
  assert.equal(harness.sentInputs.length, 2);
  assert.equal(harness.auditEvents.filter((event) => event.action === "input_takeover").length, 1);
  assert.ok(harness.auditEvents.find((event) => event.action === "input" && event.details.reason === "ownership_conflict"));
});

test("disconnect expires lane lease and reconnect defaults client to read-only", async () => {
  const harness = createOwnershipHarness(false);
  await dispatch(harness.clientA, "enable_input", "enable-a");
  await dispatch(harness.clientB, "enable_input", "enable-b");

  await dispatch(harness.clientA, "input", "input-a-1", {
    paneId: "pane-1",
    data: "echo owner-a\n"
  });
  const blockedBeforeDisconnect = await dispatch(harness.clientB, "input", "input-b-1", {
    paneId: "pane-1",
    data: "echo blocked\n"
  });
  assert.equal(blockedBeforeDisconnect.type, "error");

  const ownerDisconnectAck = await dispatch(harness.clientA, "disconnect", "disconnect-a");
  assert.equal(ownerDisconnectAck.type, "ack");
  assert.equal(ownerDisconnectAck.payload.action, "disconnect");

  const afterLeaseExpiry = await dispatch(harness.clientB, "input", "input-b-2", {
    paneId: "pane-1",
    data: "echo owner-b\n"
  });
  assert.equal(afterLeaseExpiry.type, "ack");

  const reconnectDisconnectAck = await dispatch(harness.clientB, "disconnect", "disconnect-b");
  assert.equal(reconnectDisconnectAck.type, "ack");
  assert.equal(reconnectDisconnectAck.payload.action, "disconnect");

  await dispatch(harness.clientB, "attach", "attach-b", { paneId: "pane-1" });
  const reconnectBlocked = await dispatch(harness.clientB, "input", "input-b-reconnect-blocked", {
    paneId: "pane-1",
    data: "echo blocked-after-reconnect\n"
  });
  assert.equal(reconnectBlocked.type, "error");
  assert.equal(reconnectBlocked.payload.code, "input_disabled");

  await dispatch(harness.clientB, "enable_input", "enable-b-reconnect");
  const afterReconnectEnable = await dispatch(harness.clientB, "input", "input-b-reconnect-enabled", {
    paneId: "pane-1",
    data: "echo owner-b-again\n"
  });
  assert.equal(afterReconnectEnable.type, "ack");
});

test("fixture scenario iOS writer -> web takeover enforces explicit lane handoff", async () => {
  const harness = createOwnershipHarness(true, {
    clientA: "ios-client",
    clientB: "web-client"
  });
  const ios = harness.clientA;
  const web = harness.clientB;
  await dispatch(ios, "enable_input", "ios-enable");
  await dispatch(web, "enable_input", "web-enable");

  assert.equal(
    (await dispatch(ios, "input", "ios-input-1", { paneId: "pane-1", data: "ios writer\n" })).type,
    "ack"
  );
  assertInputLaneConflict(
    await dispatch(web, "input", "web-input-conflict", { paneId: "pane-1", data: "web blocked\n" }),
    ios.clientId
  );

  assert.equal(
    (await dispatch(web, "input", "web-input-takeover", { paneId: "pane-1", data: "web takeover\n", override: true })).type,
    "ack"
  );
  assertInputLaneConflict(
    await dispatch(ios, "input", "ios-input-after-handoff", { paneId: "pane-1", data: "ios blocked\n" }),
    web.clientId
  );
  assert.deepEqual(harness.sentInputs.map(({ input }) => input), ["ios writer\n", "web takeover\n"]);
});

test("fixture scenario web writer -> iOS takeover enforces explicit lane handoff", async () => {
  const harness = createOwnershipHarness(true, {
    clientA: "web-client",
    clientB: "ios-client"
  });
  const web = harness.clientA;
  const ios = harness.clientB;
  await dispatch(web, "enable_input", "web-enable");
  await dispatch(ios, "enable_input", "ios-enable");

  assert.equal(
    (await dispatch(web, "input", "web-input-1", { paneId: "pane-1", data: "web writer\n" })).type,
    "ack"
  );
  assertInputLaneConflict(
    await dispatch(ios, "input", "ios-input-conflict", { paneId: "pane-1", data: "ios blocked\n" }),
    web.clientId
  );

  assert.equal(
    (await dispatch(ios, "input", "ios-input-takeover", { paneId: "pane-1", data: "ios takeover\n", override: true })).type,
    "ack"
  );
  assertInputLaneConflict(
    await dispatch(web, "input", "web-input-after-handoff", { paneId: "pane-1", data: "web blocked again\n" }),
    ios.clientId
  );
  assert.deepEqual(harness.sentInputs.map(({ input }) => input), ["web writer\n", "ios takeover\n"]);
});

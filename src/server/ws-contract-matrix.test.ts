/**
 * @file Gateway WebSocket contract matrix tests derived from protocol v1.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  PROTOCOL_V1,
  PROTOCOL_V1_REQUIRED_EVENT_TYPES,
  type ProtocolV1RequiredEventType,
  parseMessage
} from "../protocol.js";
import { handleClientMessage } from "./bridge-server.js";
import { AuditLogger } from "./audit-log.js";
import { SlidingWindowRateLimiter } from "./rate-limiter.js";

interface SentEnvelope {
  v: number;
  type: string;
  requestId?: string;
  timestamp: number;
  payload: Record<string, unknown>;
}

interface FakeSocket {
  OPEN: number;
  readyState: number;
  send: (message: string) => void;
}

interface GatewayContext {
  ctx: Parameters<typeof handleClientMessage>[0];
  sent: SentEnvelope[];
  sentInputs: Array<{ paneId: string; input: string }>;
}

const STRICT_TS = 1_771_934_131_735;
const REQUIRED_REQUEST_ID_TYPES = new Set<ProtocolV1RequiredEventType>([
  "auth",
  "list_sessions",
  "attach",
  "input",
  "ack",
  "error"
]);

/**
 * Builds a strict v1 envelope JSON string for parser tests.
 *
 * @param type v1 event type.
 * @param requestId Optional request identifier.
 * @param payload Optional payload value.
 * @returns Strict v1 json envelope.
 */
function buildStrictRaw(
  type: string,
  requestId?: string,
  payload: unknown = {}
): string {
  return JSON.stringify({
    v: PROTOCOL_V1,
    type,
    requestId,
    timestamp: STRICT_TS,
    payload
  });
}

/**
 * Creates a fake socket and captures sent envelopes.
 *
 * @returns Socket recorder values.
 */
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

/**
 * Creates a baseline gateway context for policy transition tests.
 *
 * @param globalInputDisabled Global input kill switch state.
 * @returns Context plus outbound capture records.
 */
function createGatewayContext(globalInputDisabled: boolean): GatewayContext {
  const { socket, sent } = createSocketRecorder();
  const sentInputs: Array<{ paneId: string; input: string }> = [];

  return {
    sent,
    sentInputs,
    ctx: {
      client: {
        id: "client-1",
        socket,
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
        maxInputBytes: 4096,
        maxAttachedPanes: 4,
        globalInputDisabled
      },
      inputLimiter: new SlidingWindowRateLimiter({
        maxEvents: 1000,
        windowMs: 60_000
      }),
      type: "heartbeat",
      payload: {},
      requestId: undefined,
      audit: new AuditLogger({ path: null, logger: console })
    }
  };
}

test("strict parsing matrix accepts all required v1 message types", () => {
  for (const type of PROTOCOL_V1_REQUIRED_EVENT_TYPES) {
    const requestId = REQUIRED_REQUEST_ID_TYPES.has(type)
      ? `req-${type}`
      : undefined;
    const parsed = parseMessage(buildStrictRaw(type, requestId), {
      strictV1: true
    });

    assert.equal(parsed.ok, true, `expected ${type} to parse in strict mode`);
    if (!parsed.ok) {
      continue;
    }

    assert.equal(parsed.message.type, type);
    assert.equal(parsed.message.v, PROTOCOL_V1);
    assert.equal(parsed.message.timestamp, STRICT_TS);
    assert.equal(parsed.message.requestId, requestId);
  }
});

test("strict parsing matrix enforces requestId requirements by message type", () => {
  for (const type of PROTOCOL_V1_REQUIRED_EVENT_TYPES) {
    const parsed = parseMessage(buildStrictRaw(type), {
      strictV1: true
    });

    if (REQUIRED_REQUEST_ID_TYPES.has(type)) {
      assert.deepEqual(parsed, { ok: false, error: "missing_request_id" });
      continue;
    }

    assert.equal(parsed.ok, true, `expected ${type} to allow omitted requestId`);
  }
});

test("strict parsing matrix rejects malformed envelopes", () => {
  const invalidCases: Array<{ name: string; raw: string; error: string }> = [
    {
      name: "unsupported type",
      raw: JSON.stringify({
        v: PROTOCOL_V1,
        type: "disconnect",
        requestId: "req-disconnect",
        timestamp: STRICT_TS,
        payload: {}
      }),
      error: "unsupported_type"
    },
    {
      name: "invalid version",
      raw: JSON.stringify({
        v: 2,
        type: "auth",
        requestId: "req-auth",
        timestamp: STRICT_TS,
        payload: {}
      }),
      error: "invalid_version"
    },
    {
      name: "invalid timestamp",
      raw: JSON.stringify({
        v: PROTOCOL_V1,
        type: "auth",
        requestId: "req-auth",
        timestamp: "1",
        payload: {}
      }),
      error: "invalid_timestamp"
    },
    {
      name: "invalid payload type",
      raw: buildStrictRaw("input", "req-input", []),
      error: "invalid_payload"
    },
    {
      name: "invalid requestId trimming",
      raw: buildStrictRaw("input", " req-input", {}),
      error: "invalid_request_id"
    },
    {
      name: "invalid requestId non-ascii",
      raw: buildStrictRaw("input", "req-ñ", {}),
      error: "invalid_request_id"
    },
    {
      name: "invalid requestId max length",
      raw: buildStrictRaw("input", "r".repeat(129), {}),
      error: "invalid_request_id"
    }
  ];

  for (const invalidCase of invalidCases) {
    const parsed = parseMessage(invalidCase.raw, { strictV1: true });
    assert.deepEqual(
      parsed,
      { ok: false, error: invalidCase.error },
      `expected strict parser rejection for ${invalidCase.name}`
    );
  }
});

test("strict parsing matrix rejects envelopes above 64KiB", () => {
  const raw = JSON.stringify({
    v: PROTOCOL_V1,
    type: "auth",
    requestId: "req-auth",
    timestamp: STRICT_TS,
    payload: { blob: "x".repeat(70 * 1024) }
  });

  const parsed = parseMessage(raw, { strictV1: true });
  assert.deepEqual(parsed, { ok: false, error: "message_too_large" });
});

test("policy transition matrix applies enable -> input -> disable flow", async () => {
  const { ctx, sent, sentInputs } = createGatewayContext(false);

  await handleClientMessage({
    ...ctx,
    type: "enable_input",
    payload: {},
    requestId: "req-enable"
  } as Parameters<typeof handleClientMessage>[0]);

  const enabledPolicy = sent[sent.length - 1];
  assert.equal(enabledPolicy.type, "policy_update");
  assert.equal(enabledPolicy.requestId, "req-enable");
  assert.equal(enabledPolicy.payload.inputEnabled, true);
  assert.equal(enabledPolicy.payload.globalInputDisabled, false);

  await handleClientMessage({
    ...ctx,
    type: "input",
    payload: { paneId: "pane-1", data: "echo ok\n" },
    requestId: "req-input-ok"
  } as Parameters<typeof handleClientMessage>[0]);

  const allowedInputAck = sent[sent.length - 1];
  assert.equal(allowedInputAck.type, "ack");
  assert.equal(allowedInputAck.requestId, "req-input-ok");
  assert.equal(allowedInputAck.payload.action, "input");

  await handleClientMessage({
    ...ctx,
    type: "disable_input",
    payload: {},
    requestId: "req-disable"
  } as Parameters<typeof handleClientMessage>[0]);

  const disabledPolicy = sent[sent.length - 1];
  assert.equal(disabledPolicy.type, "policy_update");
  assert.equal(disabledPolicy.requestId, "req-disable");
  assert.equal(disabledPolicy.payload.inputEnabled, false);

  await handleClientMessage({
    ...ctx,
    type: "input",
    payload: { paneId: "pane-1", data: "echo blocked\n" },
    requestId: "req-input-blocked"
  } as Parameters<typeof handleClientMessage>[0]);

  const blockedInputError = sent[sent.length - 1];
  assert.equal(blockedInputError.type, "error");
  assert.equal(blockedInputError.requestId, "req-input-blocked");
  assert.equal(blockedInputError.payload.code, "input_disabled");
  assert.equal(sentInputs.length, 1);
});

test("policy transition matrix enforces global kill switch", async () => {
  const { ctx, sent, sentInputs } = createGatewayContext(true);

  await handleClientMessage({
    ...ctx,
    type: "enable_input",
    payload: {},
    requestId: "req-enable"
  } as Parameters<typeof handleClientMessage>[0]);

  const blockedPolicy = sent[sent.length - 1];
  assert.equal(blockedPolicy.type, "policy_update");
  assert.equal(blockedPolicy.requestId, "req-enable");
  assert.equal(blockedPolicy.payload.inputEnabled, false);
  assert.equal(blockedPolicy.payload.globalInputDisabled, true);

  await handleClientMessage({
    ...ctx,
    type: "input",
    payload: { paneId: "pane-1", data: "echo blocked\n" },
    requestId: "req-input"
  } as Parameters<typeof handleClientMessage>[0]);

  const blockedInputError = sent[sent.length - 1];
  assert.equal(blockedInputError.type, "error");
  assert.equal(blockedInputError.requestId, "req-input");
  assert.equal(blockedInputError.payload.code, "input_disabled");
  assert.equal(sentInputs.length, 0);
});

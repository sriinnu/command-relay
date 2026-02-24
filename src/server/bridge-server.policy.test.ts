/**
 * @file Conformance tests for bridge message policy behavior.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { AuditLogger } from "./audit-log.js";
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

/**
 * Creates a writable fake socket that records emitted envelopes.
 *
 * @returns Socket and captured envelopes.
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
 * Creates a baseline message context with injectable policy settings.
 *
 * @param globalInputDisabled Global kill switch state.
 * @returns Test context and sendInput call recorder.
 */
function createContext(globalInputDisabled: boolean) {
  const recorder = createSocketRecorder();
  const sentInputs: Array<{ paneId: string; input: string }> = [];

  return {
    sent: recorder.sent,
    sentInputs,
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
      audit: new AuditLogger({ path: null, logger: console })
    }
  };
}

test("enables and accepts input when global kill switch is off", async () => {
  const { ctx, sent, sentInputs } = createContext(false);

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
});

test("keeps read-only policy and blocks input when global kill switch is on", async () => {
  const { ctx, sent, sentInputs } = createContext(true);

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

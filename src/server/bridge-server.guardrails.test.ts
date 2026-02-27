/**
 * @file Guardrail error payload coverage for handleClientMessage.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { handleClientMessage } from "./bridge-server.js";
import { SlidingWindowRateLimiter } from "./rate-limiter.js";
import { AuditLogger } from "./audit-log.js";

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

function createSocketRecorder(): { socket: FakeSocket; sent: SentEnvelope[] } {
  const sent: SentEnvelope[] = [];
  const socket: FakeSocket = {
    OPEN: 1,
    readyState: 1,
    send: (message: string) => sent.push(JSON.parse(message) as SentEnvelope)
  };
  return { socket, sent };
}

function createBaseContext() {
  const { socket, sent } = createSocketRecorder();
  const sentInputs: Array<{ paneId: string; input: string }> = [];

  return {
    sent,
    sentInputs,
    ctx: {
      client: {
        id: "client-guardrail",
        socket,
        authenticated: true,
        inputEnabled: true,
        attachedPanes: new Set<string>(["pane-1"])
      },
      tmux: {
        listPanes: async () => [{ paneId: "pane-1", sessionName: "main" }],
        sendInput: async (paneId: string, input: string) => sentInputs.push({ paneId, input })
      },
      engine: { attach: async () => {}, detach: () => {}, detachAll: () => {} },
      config: {
        authToken: null,
        maxInputBytes: 8,
        maxAttachedPanes: 4,
        globalInputDisabled: false
      },
      inputLimiter: new SlidingWindowRateLimiter({ maxEvents: 1, windowMs: 60_000 }),
      type: "input",
      payload: {},
      requestId: undefined,
      audit: new AuditLogger({ path: null, logger: console })
    } as Parameters<typeof handleClientMessage>[0]
  };
}

test("input_rate_limited returns retry metadata and requestId", async () => {
  const { ctx, sent, sentInputs } = createBaseContext();

  await handleClientMessage({
    ...ctx,
    type: "input",
    payload: { paneId: "pane-1", data: "ok\n" },
    requestId: "req-input-ok"
  });
  assert.equal(sent[sent.length - 1]?.type, "ack");

  await handleClientMessage({
    ...ctx,
    type: "input",
    payload: { paneId: "pane-1", data: "blocked\n" },
    requestId: "req-input-rate"
  });

  const rateError = sent[sent.length - 1];
  assert.equal(rateError.type, "error");
  assert.equal(rateError.requestId, "req-input-rate");
  assert.equal(rateError.payload.code, "input_rate_limited");
  assert.equal(typeof rateError.payload.retryAfterMs, "number");
  assert.equal(rateError.payload.limit, 1);
  assert.equal(rateError.payload.windowMs, 60_000);
  assert.equal(sentInputs.length, 1);
});

test("input_too_large returns size metadata and requestId", async () => {
  const { ctx, sent, sentInputs } = createBaseContext();
  ctx.inputLimiter = new SlidingWindowRateLimiter({ maxEvents: 100, windowMs: 60_000 });

  await handleClientMessage({
    ...ctx,
    type: "input",
    payload: { paneId: "pane-1", data: "0123456789" },
    requestId: "req-input-too-large"
  });

  const sizeError = sent[sent.length - 1];
  assert.equal(sizeError.type, "error");
  assert.equal(sizeError.requestId, "req-input-too-large");
  assert.equal(sizeError.payload.code, "input_too_large");
  assert.equal(sizeError.payload.maxInputBytes, 8);
  assert.equal(sizeError.payload.receivedBytes, 10);
  assert.equal(sentInputs.length, 0);
});

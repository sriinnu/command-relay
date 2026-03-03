/**
 * @file Conformance test for kill-switch enforcement after lane ownership is already active.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { SlidingWindowRateLimiter } from "./rate-limiter.js";
import { handleClientMessage } from "./bridge-server.js";

interface SentEnvelope {
  type: string;
  requestId?: string;
  payload: Record<string, unknown>;
}

interface AuditEvent {
  action: string;
  clientId: string;
  details: Record<string, unknown>;
}

/**
 * Creates a minimal bridge message context used to validate policy transitions.
 *
 * @returns Context, sent envelope recorder, and audit/input sinks.
 */
function createContext(): {
  ctx: Parameters<typeof handleClientMessage>[0];
  sent: SentEnvelope[];
  sentInputs: Array<{ paneId: string; input: string }>;
  auditEvents: AuditEvent[];
} {
  const sent: SentEnvelope[] = [];
  const sentInputs: Array<{ paneId: string; input: string }> = [];
  const auditEvents: AuditEvent[] = [];

  const socket = {
    OPEN: 1,
    readyState: 1,
    send: (message: string): void => {
      sent.push(JSON.parse(message) as SentEnvelope);
    }
  };

  const ctx = {
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
      maxInputBytes: 4_096,
      maxAttachedPanes: 8,
      globalInputDisabled: false
    },
    inputLimiter: new SlidingWindowRateLimiter({ maxEvents: 1_000, windowMs: 60_000 }),
    requestId: undefined,
    audit: {
      write: async (event: AuditEvent) => {
        auditEvents.push(event);
      }
    }
  } as unknown as Parameters<typeof handleClientMessage>[0];

  return {
    ctx,
    sent,
    sentInputs,
    auditEvents
  };
}

test("active lane input is blocked when global kill switch flips on mid-session", async () => {
  const { ctx, sent, sentInputs, auditEvents } = createContext();

  await handleClientMessage({
    ...ctx,
    type: "enable_input",
    payload: {},
    requestId: "enable-1"
  } as unknown as Parameters<typeof handleClientMessage>[0]);

  const enabledPolicy = sent[sent.length - 1];
  assert.equal(enabledPolicy.type, "policy_update");
  assert.equal(enabledPolicy.requestId, "enable-1");
  assert.equal(enabledPolicy.payload.inputEnabled, true);
  assert.equal(enabledPolicy.payload.globalInputDisabled, false);

  await handleClientMessage({
    ...ctx,
    type: "input",
    payload: { paneId: "pane-1", data: "echo allowed\n" },
    requestId: "input-1"
  } as unknown as Parameters<typeof handleClientMessage>[0]);

  const allowedAck = sent[sent.length - 1];
  assert.equal(allowedAck.type, "ack");
  assert.equal(allowedAck.requestId, "input-1");
  assert.equal(sentInputs.length, 1);

  ctx.config.globalInputDisabled = true;

  await handleClientMessage({
    ...ctx,
    type: "input",
    payload: { paneId: "pane-1", data: "echo blocked\n" },
    requestId: "input-2"
  } as unknown as Parameters<typeof handleClientMessage>[0]);

  const blockedError = sent[sent.length - 1];
  assert.equal(blockedError.type, "error");
  assert.equal(blockedError.requestId, "input-2");
  assert.equal(blockedError.payload.code, "input_disabled");
  assert.equal(sentInputs.length, 1);

  const blockedAudit = auditEvents.find(
    (event) => event.action === "input" && event.details.reason === "policy_blocked"
  );
  assert.ok(blockedAudit);
});


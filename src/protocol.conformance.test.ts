/**
 * @file Strict conformance tests for protocol v1 envelope parsing.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  PROTOCOL_V1,
  PROTOCOL_V1_REQUIRED_EVENT_TYPES,
  envelope,
  parseMessage
} from "./protocol.js";

/**
 * Builds a strict v1 envelope for tests.
 *
 * @param type Event type.
 * @param requestId Optional request id.
 * @returns Serialized envelope JSON.
 */
function buildStrictRaw(type: string, requestId?: string): string {
  return JSON.stringify({
    v: PROTOCOL_V1,
    type,
    requestId,
    timestamp: 1_771_934_131_735,
    payload: {}
  });
}

test("envelope creates v1 envelope with timestamp and payload", () => {
  const startedAt = Date.now();
  const message = envelope("ack", { status: "ok" }, "req-1");

  assert.equal(message.v, PROTOCOL_V1);
  assert.equal(message.type, "ack");
  assert.equal(message.requestId, "req-1");
  assert.deepEqual(message.payload, { status: "ok" });
  assert.equal(Number.isSafeInteger(message.timestamp), true);
  assert.equal(message.timestamp >= startedAt, true);
});

test("parseMessage rejects invalid json and non-object json", () => {
  const invalidJson = parseMessage("{bad-json");
  const nonObject = parseMessage(JSON.stringify(["not", "an", "object"]));

  assert.deepEqual(invalidJson, { ok: false, error: "invalid_json" });
  assert.deepEqual(nonObject, { ok: false, error: "invalid_json_object" });
});

test("parseMessage rejects empty type", () => {
  const parsed = parseMessage(JSON.stringify({ type: "   ", payload: {} }));
  assert.deepEqual(parsed, { ok: false, error: "missing_type" });
});

test("parseMessage loose mode keeps unknown type and normalizes invalid payload", () => {
  const parsed = parseMessage(JSON.stringify({ type: "custom_event", payload: "x" }));

  assert.equal(parsed.ok, true);
  if (!parsed.ok) {
    return;
  }
  assert.equal(parsed.message.type, "custom_event");
  assert.deepEqual(parsed.message.payload, {});
});

test("strict v1 parser accepts all required event types", () => {
  for (const type of PROTOCOL_V1_REQUIRED_EVENT_TYPES) {
    const requestId =
      type === "output" || type === "heartbeat" || type === "policy_update"
        ? undefined
        : `req-${type}`;

    const parsed = parseMessage(buildStrictRaw(type, requestId), { strictV1: true });
    assert.equal(parsed.ok, true, `expected type ${type} to parse successfully`);
    if (!parsed.ok) {
      continue;
    }
    assert.equal(parsed.message.v, PROTOCOL_V1);
    assert.equal(parsed.message.type, type);
    assert.equal(parsed.message.timestamp, 1_771_934_131_735);
    assert.equal(parsed.message.requestId, requestId);
    assert.deepEqual(parsed.message.payload, {});
  }
});

test("strict v1 parser rejects unsupported type", () => {
  const parsed = parseMessage(buildStrictRaw("detach", "req-detach"), {
    strictV1: true
  });
  assert.deepEqual(parsed, { ok: false, error: "unsupported_type" });
});

test("strict v1 parser rejects missing or invalid v and timestamp", () => {
  const missingV = parseMessage(
    JSON.stringify({
      type: "auth",
      requestId: "req-auth",
      timestamp: 100,
      payload: {}
    }),
    { strictV1: true }
  );
  const invalidVersion = parseMessage(
    JSON.stringify({
      v: 2,
      type: "auth",
      requestId: "req-auth",
      timestamp: 100,
      payload: {}
    }),
    { strictV1: true }
  );
  const invalidTimestamp = parseMessage(
    JSON.stringify({
      v: PROTOCOL_V1,
      type: "auth",
      requestId: "req-auth",
      timestamp: "100",
      payload: {}
    }),
    { strictV1: true }
  );

  assert.deepEqual(missingV, { ok: false, error: "invalid_version" });
  assert.deepEqual(invalidVersion, { ok: false, error: "invalid_version" });
  assert.deepEqual(invalidTimestamp, { ok: false, error: "invalid_timestamp" });
});

test("strict v1 parser rejects invalid payload and requestId formats", () => {
  const invalidPayload = parseMessage(
    JSON.stringify({
      v: PROTOCOL_V1,
      type: "input",
      requestId: "req-input",
      timestamp: 100,
      payload: []
    }),
    { strictV1: true }
  );
  const invalidRequestIdWhitespace = parseMessage(
    JSON.stringify({
      v: PROTOCOL_V1,
      type: "input",
      requestId: " req-input",
      timestamp: 100,
      payload: {}
    }),
    { strictV1: true }
  );
  const invalidRequestIdUnicode = parseMessage(
    JSON.stringify({
      v: PROTOCOL_V1,
      type: "input",
      requestId: "req-\u00f1",
      timestamp: 100,
      payload: {}
    }),
    { strictV1: true }
  );
  const invalidRequestIdLength = parseMessage(
    JSON.stringify({
      v: PROTOCOL_V1,
      type: "input",
      requestId: "r".repeat(129),
      timestamp: 100,
      payload: {}
    }),
    { strictV1: true }
  );

  assert.deepEqual(invalidPayload, { ok: false, error: "invalid_payload" });
  assert.deepEqual(invalidRequestIdWhitespace, {
    ok: false,
    error: "invalid_request_id"
  });
  assert.deepEqual(invalidRequestIdUnicode, {
    ok: false,
    error: "invalid_request_id"
  });
  assert.deepEqual(invalidRequestIdLength, {
    ok: false,
    error: "invalid_request_id"
  });
});

test("strict v1 parser requires requestId for request-response correlated event types", () => {
  const requiredRequestIdTypes = ["auth", "list_sessions", "attach", "input", "ack", "error"];

  for (const type of requiredRequestIdTypes) {
    const parsed = parseMessage(buildStrictRaw(type), { strictV1: true });
    assert.deepEqual(parsed, { ok: false, error: "missing_request_id" });
  }

  const heartbeat = parseMessage(buildStrictRaw("heartbeat"), { strictV1: true });
  const output = parseMessage(buildStrictRaw("output"), { strictV1: true });
  const policy = parseMessage(buildStrictRaw("policy_update"), { strictV1: true });

  assert.equal(heartbeat.ok, true);
  assert.equal(output.ok, true);
  assert.equal(policy.ok, true);
});

test("strict v1 parser rejects events larger than 64KiB", () => {
  const oversizedPayload = "x".repeat(70 * 1024);
  const raw = JSON.stringify({
    v: PROTOCOL_V1,
    type: "auth",
    requestId: "req-auth",
    timestamp: 100,
    payload: { blob: oversizedPayload }
  });
  const parsed = parseMessage(raw, { strictV1: true });

  assert.deepEqual(parsed, { ok: false, error: "message_too_large" });
});

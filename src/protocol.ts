/**
 * @file Protocol helpers for CommandRelay WebSocket envelopes.
 */

/**
 * v1 protocol version value.
 */
export const PROTOCOL_V1 = 1;

/**
 * Strictly required v1 event types.
 */
export const PROTOCOL_V1_REQUIRED_EVENT_TYPES = [
  "auth",
  "list_sessions",
  "attach",
  "output",
  "input",
  "ack",
  "error",
  "heartbeat",
  "policy_update"
] as const;

/**
 * Additional event types allowed by the current bridge runtime.
 */
export const PROTOCOL_V1_RUNTIME_EVENT_TYPES = [
  "detach",
  "enable_input",
  "disable_input",
  "disconnect",
  "hello",
  "session_list",
  "auth_ok",
  "auth_error",
  "heartbeat_ack"
] as const;

/**
 * Strict parser allow-list for v1 envelopes.
 */
export const PROTOCOL_V1_ALLOWED_EVENT_TYPES = [
  ...PROTOCOL_V1_REQUIRED_EVENT_TYPES,
  ...PROTOCOL_V1_RUNTIME_EVENT_TYPES
] as const;

/**
 * v1 event type union.
 */
export type ProtocolV1RequiredEventType = (typeof PROTOCOL_V1_REQUIRED_EVENT_TYPES)[number];
export type ProtocolV1AllowedEventType = (typeof PROTOCOL_V1_ALLOWED_EVENT_TYPES)[number];

/**
 * A websocket protocol envelope.
 */
export interface Envelope {
  v: number;
  type: string;
  requestId: string | undefined;
  timestamp: number;
  payload: Record<string, unknown>;
}

/**
 * Parse options for incoming messages.
 */
export interface ParseMessageOptions {
  strictV1?: boolean;
}

/**
 * Parse result union for incoming messages.
 */
export type ParseMessageResult =
  | { ok: true; message: Envelope }
  | { ok: false; error: string };

const MAX_V1_ENVELOPE_BYTES = 64 * 1024;
const REQUEST_ID_MAX_LENGTH = 128;

const V1_ALLOWED_TYPES = new Set<string>(PROTOCOL_V1_ALLOWED_EVENT_TYPES);
const V1_REQUEST_ID_REQUIRED_TYPES = new Set<string>([
  "auth",
  "list_sessions",
  "attach",
  "detach",
  "enable_input",
  "disable_input",
  "disconnect",
  "input",
  "ack",
  "error"
]);

/**
 * Builds a protocol envelope.
 *
 * @param {string} type Event type.
 * @param {Record<string, unknown>} payload Event payload.
 * @param {string | undefined} requestId Optional request identifier.
 * @returns {Envelope} Serialized envelope object.
 */
export function envelope(
  type: string,
  payload: Record<string, unknown> = {},
  requestId: string | undefined = undefined
): Envelope {
  return {
    v: PROTOCOL_V1,
    type,
    requestId,
    timestamp: Date.now(),
    payload
  };
}

/**
 * Parses raw JSON text into an envelope candidate.
 *
 * @param {string} raw Raw incoming text.
 * @param {ParseMessageOptions | undefined} options Parse behavior options.
 * @returns {ParseMessageResult} Parse result.
 */
export function parseMessage(
  raw: string,
  options: ParseMessageOptions | undefined = undefined
): ParseMessageResult {
  try {
    if (options?.strictV1 && Buffer.byteLength(raw, "utf8") > MAX_V1_ENVELOPE_BYTES) {
      return { ok: false, error: "message_too_large" };
    }

    const parsed = JSON.parse(raw);
    if (!isRecord(parsed)) {
      return { ok: false, error: "invalid_json_object" };
    }
    if (typeof parsed.type !== "string" || parsed.type.trim().length === 0) {
      return { ok: false, error: "missing_type" };
    }

    if (options?.strictV1) {
      return parseStrictV1(parsed);
    }

    const payload = isRecord(parsed.payload) ? parsed.payload : {};
    const requestId = typeof parsed.requestId === "string" ? parsed.requestId : undefined;
    return {
      ok: true,
      message: envelope(parsed.type, payload, requestId)
    };
  } catch {
    return { ok: false, error: "invalid_json" };
  }
}

/**
 * Validates a parsed json envelope against strict v1 constraints.
 *
 * @param {Record<string, unknown>} parsed Parsed json candidate.
 * @returns {ParseMessageResult} Parse result.
 */
function parseStrictV1(parsed: Record<string, unknown>): ParseMessageResult {
  if (parsed.v !== PROTOCOL_V1) {
    return { ok: false, error: "invalid_version" };
  }

  if (!V1_ALLOWED_TYPES.has(parsed.type as string)) {
    return { ok: false, error: "unsupported_type" };
  }

  if (!Number.isSafeInteger(parsed.timestamp) || (parsed.timestamp as number) < 0) {
    return { ok: false, error: "invalid_timestamp" };
  }

  if (!isRecord(parsed.payload)) {
    return { ok: false, error: "invalid_payload" };
  }

  const requestId = validateRequestId(parsed.requestId);
  if (!requestId.valid) {
    return { ok: false, error: "invalid_request_id" };
  }
  if (V1_REQUEST_ID_REQUIRED_TYPES.has(parsed.type as string) && !requestId.value) {
    return { ok: false, error: "missing_request_id" };
  }

  return {
    ok: true,
    message: {
      v: PROTOCOL_V1,
      type: parsed.type as string,
      requestId: requestId.value,
      timestamp: parsed.timestamp as number,
      payload: parsed.payload
    }
  };
}

/**
 * Checks whether a value is a plain object record.
 *
 * @param {unknown} value Candidate value.
 * @returns {value is Record<string, unknown>} Whether the value is object-like.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validates optional request identifiers.
 *
 * @param {unknown} value Incoming request identifier.
 * @returns {{ valid: boolean; value: string | undefined }} Validation result.
 */
function validateRequestId(value: unknown): { valid: boolean; value: string | undefined } {
  if (value === undefined) {
    return { valid: true, value: undefined };
  }
  if (typeof value !== "string") {
    return { valid: false, value: undefined };
  }
  if (value.length < 1 || value.length > REQUEST_ID_MAX_LENGTH) {
    return { valid: false, value: undefined };
  }
  if (value.trim() !== value) {
    return { valid: false, value: undefined };
  }

  for (const ch of value) {
    const code = ch.charCodeAt(0);
    if (code < 0x20 || code > 0x7e) {
      return { valid: false, value: undefined };
    }
  }

  return { valid: true, value };
}

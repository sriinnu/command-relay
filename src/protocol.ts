/**
 * @file Protocol helpers for CommandRelay WebSocket envelopes.
 */

/**
 * @typedef {object} Envelope
 * @property {string} type Event type.
 * @property {string | undefined} requestId Optional request identifier.
 * @property {number} timestamp Epoch milliseconds.
 * @property {Record<string, unknown>} payload Event payload.
 */

/**
 * Builds a protocol envelope.
 *
 * @param {string} type Event type.
 * @param {Record<string, unknown>} payload Event payload.
 * @param {string | undefined} requestId Optional request identifier.
 * @returns {Envelope} Serialized envelope object.
 */
export function envelope(type, payload = {}, requestId = undefined) {
  return {
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
 * @returns {{ ok: true, message: Envelope } | { ok: false, error: string }} Parse result.
 */
export function parseMessage(raw) {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return { ok: false, error: "invalid_json_object" };
    }
    if (typeof parsed.type !== "string" || !parsed.type.trim()) {
      return { ok: false, error: "missing_type" };
    }
    const payload =
      parsed.payload && typeof parsed.payload === "object" ? parsed.payload : {};
    return {
      ok: true,
      message: envelope(parsed.type, payload, parsed.requestId)
    };
  } catch {
    return { ok: false, error: "invalid_json" };
  }
}

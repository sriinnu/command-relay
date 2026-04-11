/**
 * @file Runtime failure classifiers for bridge server error envelopes and audit metadata.
 */

import type { BridgeAttachReplayMetadata } from "../bridge/bridge-engine.js";

/**
 * Normalized runtime failure payload returned to websocket clients.
 */
export interface BridgeRuntimeFailure {
  code: "auth_rejected" | "transport_drop" | "runtime_session_unavailable" | "invalid_pane_target" | "handler_failed";
  reason:
  | "invalid_token"
  | "transport_closed"
  | "tmux_session_unavailable"
  | "unknown_runtime_backend"
  | "invalid_namespaced_pane_id"
  | "internal_error";
  recoverable: boolean;
  message: string;
}

export interface BridgeConnectionCloseFailure {
  code: "auth_rejected" | "transport_closed" | "normal";
  reason: string;
  recoverable: boolean;
}

/**
 * Classifies runtime handler exceptions into stable client-facing error codes.
 *
 * @param error Unknown handler exception.
 * @returns Normalized runtime failure details.
 */
export function classifyBridgeRuntimeFailure(error: unknown): BridgeRuntimeFailure {
  const details = extractErrorDetails(error);
  const combined = `${details.message}\n${details.stderr}\n${details.code}`.toLowerCase();

  if (combined.includes("invalid_token") || combined.includes("auth_required")) {
    return {
      code: "auth_rejected",
      reason: "invalid_token",
      recoverable: true,
      message: details.message
    };
  }
  if (isTmuxSessionUnavailable(combined)) {
    return {
      code: "runtime_session_unavailable",
      reason: "tmux_session_unavailable",
      recoverable: true,
      message: details.message
    };
  }
  if (isTransportDrop(combined)) {
    return {
      code: "transport_drop",
      reason: "transport_closed",
      recoverable: true,
      message: details.message
    };
  }
  if (combined.includes("unknown runtime backend")) {
    return {
      code: "invalid_pane_target",
      reason: "unknown_runtime_backend",
      recoverable: false,
      message: details.message
    };
  }
  if (combined.includes("must be namespaced")) {
    return {
      code: "invalid_pane_target",
      reason: "invalid_namespaced_pane_id",
      recoverable: false,
      message: details.message
    };
  }
  return {
    code: "handler_failed",
    reason: "internal_error",
    recoverable: false,
    message: details.message
  };
}

/**
 * Classifies websocket close reasons into retry categories.
 *
 * @param code Close code from WS stack.
 * @param reason Human-readable close reason.
 * @returns Classified close classification.
 */
export function classifyBridgeCloseFailure(code: number, reason: string): BridgeConnectionCloseFailure {
  const normalizedReason = reason.toLowerCase();
  if (code === 1008 && /auth|token|credential|permission/.test(normalizedReason)) {
    return {
      code: "auth_rejected",
      reason: normalizedReason || "authentication rejected",
      recoverable: false
    };
  }
  if (code >= 1001 && code <= 1011) {
    return {
      code: "transport_closed",
      reason: normalizedReason || "transport closed",
      recoverable: true
    };
  }
  if (code >= 3000 && code <= 3999) {
    return {
      code: "transport_closed",
      reason: normalizedReason || "application close",
      recoverable: true
    };
  }
  return {
    code: "normal",
    reason: normalizedReason || "normal close",
    recoverable: false
  };
}

/**
 * Classifies why replay resume fell back to snapshot semantics.
 *
 * @param replayMetadata Attach replay metadata from bridge engine.
 * @returns Snapshot fallback reason label.
 */
export function classifyReplaySnapshotFallbackReason(
  replayMetadata: BridgeAttachReplayMetadata
): "ahead_of_stream" | "outside_retained_window" | "empty_resume_window" {
  const { requestedLastSeq, latestSeq, oldestHistorySeq, replayGapDetected } = replayMetadata;
  if (requestedLastSeq === null) return "empty_resume_window";
  if (requestedLastSeq > latestSeq) return "ahead_of_stream";
  if (replayGapDetected || (oldestHistorySeq !== null && requestedLastSeq < oldestHistorySeq - 1)) return "outside_retained_window";
  return "empty_resume_window";
}

/**
 * Detects whether an error indicates tmux session/server unavailability.
 *
 * @param value Lowercased concatenated error content.
 * @returns True when tmux session is unavailable.
 */
function isTmuxSessionUnavailable(value: string): boolean {
  return value.includes("no server running") || value.includes("error connecting to") || value.includes("failed to connect to server");
}

/**
 * Detects whether an error indicates transport connection closure/drop.
 *
 * @param value Lowercased concatenated error content.
 * @returns True when transport appears dropped.
 */
function isTransportDrop(value: string): boolean {
  return value.includes("broken pipe")
    || value.includes("connection reset")
    || value.includes("connection closed")
    || value.includes("econnreset")
    || value.includes("ehostunreach")
    || value.includes("econnrefused")
    || value.includes("etimedout")
    || value.includes("timed out");
}

/**
 * Extracts string-safe message/stderr/code fields from unknown errors.
 *
 * @param error Unknown throwable.
 * @returns Flattened details for classification.
 */
function extractErrorDetails(error: unknown): { message: string; stderr: string; code: string } {
  if (!error || typeof error !== "object") {
    return { message: String(error), stderr: "", code: "" };
  }
  const record = error as Record<string, unknown>;
  const message = typeof record.message === "string" && record.message.length > 0
    ? record.message
    : String(error);
  const stderr = typeof record.stderr === "string" ? record.stderr : "";
  const code = typeof record.code === "string" ? record.code : "";
  return { message, stderr, code };
}

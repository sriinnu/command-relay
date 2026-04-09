import type { ProtocolV1AllowedEventType } from "@commandrelay/protocol";
import type {
  GatewayErrorPayload,
  GatewayPayload,
  HelloPayload,
  AuthOkPayload,
  AuthErrorPayload,
  SessionListPayload,
  OutputPayload,
  PolicyUpdatePayload
} from "./client-types.js";

export function isResponsePayloadValid(
  type: string,
  payload: GatewayPayload
): boolean {
  if (type === "error" || type === "auth_error") return isGatewayErrorPayload(payload);
  if (type === "hello") return isHelloPayload(payload);
  if (type === "auth_ok") return isAuthOkPayload(payload);
  if (type === "auth_error") return isAuthErrorPayload(payload);
  if (type === "session_list") return isSessionListPayload(payload);
  if (type === "output") return isOutputPayload(payload);
  if (type === "policy_update") return isPolicyUpdatePayload(payload);
  if (type === "heartbeat_ack") return isRecord(payload);
  return true;
}

export function isGatewayErrorPayload(value: GatewayPayload): value is GatewayErrorPayload {
  return isRecord(value) && isString(value.code);
}

export function isHelloPayload(value: GatewayPayload): value is HelloPayload {
  if (!isRecord(value)) return false;
  if (!isString(value.clientId)) return false;
  if (!isBoolean(value.requiresAuth)) return false;
  if (!isBoolean(value.inputEnabled)) return false;
  if (!isBoolean(value.globalInputDisabled)) return false;
  if (value.maxInputBytes !== undefined && !isNonNegativeInteger(value.maxInputBytes)) return false;
  if (value.maxAttachedPanes !== undefined && !isNonNegativeInteger(value.maxAttachedPanes)) return false;
  return true;
}

export function isAuthOkPayload(value: GatewayPayload): value is AuthOkPayload {
  return isRecord(value) && (value.mode === "open" || value.mode === "token");
}

export function isAuthErrorPayload(value: GatewayPayload): value is AuthErrorPayload {
  return isRecord(value) && isString(value.code) && (value.recoverable === undefined || isBoolean(value.recoverable));
}

export function isSessionListPayload(value: GatewayPayload): value is SessionListPayload {
  return isRecord(value) && Array.isArray(value.panes) && Array.isArray(value.sessions);
}

export function isOutputPayload(value: GatewayPayload): value is OutputPayload {
  if (!isRecord(value)) return false;
  if (value.mode !== "snapshot" && value.mode !== "delta") return false;
  if (!isString(value.paneId)) return false;
  if (!isString(value.chunk)) return false;
  return isNonNegativeInteger(value.streamSeq);
}

export function isPolicyUpdatePayload(value: GatewayPayload): value is PolicyUpdatePayload {
  return isRecord(value) && isBoolean(value.inputEnabled) && isBoolean(value.globalInputDisabled);
}

export function isUnknownResponseTypeAllowed(
  expectedResponseTypes: ReadonlySet<ProtocolV1AllowedEventType | "auth_error" | "error">,
  actualType: string
): boolean {
  return expectedResponseTypes.has(actualType as ProtocolV1AllowedEventType | "error" | "auth_error");
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

function isRecord(value: unknown): value is GatewayPayload {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

import { type ProtocolV1AllowedEventType } from "@commandrelay/protocol";

interface ClientOptions {
  strictProtocolParsing?: boolean;
  requestTimeoutMs?: number;
}

export interface PendingRequest {
  expectedResponseTypes: ReadonlySet<ProtocolV1AllowedEventType | "auth_error" | "error">;
  timeoutAt: ReturnType<typeof setTimeout>;
  resolve: (value: { requestId: string | undefined; type: string; payload: Record<string, unknown>; v: number; timestamp: number }) => void;
  reject: (error: Error) => void;
}

export type ClientCommand =
  | "auth"
  | "list_sessions"
  | "attach"
  | "detach"
  | "enable_input"
  | "disable_input"
  | "input"
  | "heartbeat"
  | "disconnect";

export const DEFAULT_REQUEST_TIMEOUT_MS = 8_000;

export const EXPECTED_RESPONSE_TYPES_BY_COMMAND: Record<
  ClientCommand,
  ReadonlySet<ProtocolV1AllowedEventType | "auth_error" | "error">
> = {
  auth: new Set(["auth_ok", "auth_error", "error"]),
  list_sessions: new Set(["session_list", "error"]),
  attach: new Set(["ack", "error"]),
  detach: new Set(["ack", "error"]),
  enable_input: new Set(["policy_update", "error"]),
  disable_input: new Set(["policy_update", "error"]),
  input: new Set(["ack", "error"]),
  heartbeat: new Set(["heartbeat_ack", "error"]),
  disconnect: new Set(["ack", "error"])
};

export { ClientOptions };

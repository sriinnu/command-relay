import type { AuthErrorPayload, GatewayErrorPayload } from "./client-types.js";

export type CommandRelayProtocolErrorKind = "error" | "auth_error";

/**
 * Structured protocol error surfaced from request-response frames.
 */
export class CommandRelayProtocolError extends Error {
  public readonly kind: CommandRelayProtocolErrorKind;
  public readonly code: string;
  public readonly recoverable: boolean;
  public readonly payload: GatewayErrorPayload | AuthErrorPayload;

  /**
   * @param kind Envelope event type that carried the error.
   * @param payload Payload for the protocol error.
   */
  public constructor(kind: CommandRelayProtocolErrorKind, payload: GatewayErrorPayload | AuthErrorPayload) {
    const code = typeof payload.code === "string" ? payload.code : "error";
    const message = String(payload.message ?? payload.code ?? kind);
    super(message);
    this.name = "CommandRelayProtocolError";
    this.kind = kind;
    this.code = code;
    this.recoverable = Boolean((payload as { recoverable?: unknown }).recoverable);
    this.payload = payload;
  }
}

/**
 * Check whether an error is an authentication failure response.
 *
 * @param error Error instance from client protocol interactions.
 */
export function isAuthenticationError(error: unknown): error is CommandRelayProtocolError {
  if (!(error instanceof CommandRelayProtocolError)) return false;
  return error.kind === "auth_error" || error.code === "invalid_token" || error.code === "invalid_access_token";
}

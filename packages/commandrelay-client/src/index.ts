import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { WebSocket } from "ws";
import { type ParseMessageOptions, envelope, parseMessage, type ProtocolV1AllowedEventType } from "@commandrelay/protocol";
export { 
  type AuthErrorPayload,
  type AuthOkPayload,
  type CommandRelayClientEvents,
  type GatewayEnvelope,
  type GatewayPayload,
  type GatewayErrorPayload,
  type HelloPayload,
  type OutputPayload,
  type PolicyUpdatePayload,
  type SessionListPayload
} from "./client-types.js";
import type {
  AuthErrorPayload,
  AuthOkPayload,
  CommandRelayClientEvents,
  GatewayEnvelope,
  GatewayPayload,
  GatewayErrorPayload,
  HelloPayload,
  OutputPayload,
  PolicyUpdatePayload,
  SessionListPayload
} from "./client-types.js";
import {
  isAuthErrorPayload,
  isAuthOkPayload,
  isGatewayErrorPayload,
  isHelloPayload,
  isOutputPayload,
  isPolicyUpdatePayload,
  isResponsePayloadValid,
  isSessionListPayload,
  isUnknownResponseTypeAllowed
} from "./validation.js";
import {
  ClientOptions,
  DEFAULT_REQUEST_TIMEOUT_MS,
  PendingRequest,
  EXPECTED_RESPONSE_TYPES_BY_COMMAND
} from "./commandrelay-client-types.js";

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
  if (!(error instanceof Error)) return false;
  if (!(error instanceof CommandRelayProtocolError)) return false;
  if (error.code === "invalid_token") return true;
  return error.kind === "auth_error";
}

export class CommandRelayClient extends EventEmitter {
  private socket: WebSocket | null;
  private helloPayload: HelloPayload | null;
  private readonly parseOptions: ParseMessageOptions;
  private readonly pendingRequests: Map<string, PendingRequest>;
  private readonly requestPrefixCounter: Map<string, number>;

  constructor(
    private readonly url: string,
    options: ClientOptions = {}
  ) {
    super();
    this.socket = null;
    this.helloPayload = null;
    this.parseOptions = { strictV1: options.strictProtocolParsing ?? true };
    this.pendingRequests = new Map();
    this.requestPrefixCounter = new Map();
    const timeout = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.requestTimeoutMs = timeout;
  }

  private readonly requestTimeoutMs: number;

  /**
   * Returns whether the websocket is currently open.
   */
  public isOpen(): boolean {
    return this.socket?.readyState === this.socket?.OPEN;
  }

  /**
   * Last received hello payload.
   */
  public get hello(): HelloPayload | null {
    return this.helloPayload;
  }

  /**
   * Open websocket transport and resolve once hello is received.
   * @returns Hello payload from gateway.
   */
  public async connect(): Promise<HelloPayload> {
    if (this.socket) throw new Error("connection already exists");
    return new Promise<HelloPayload>((resolve, reject) => {
      const socket = new WebSocket(this.url);
      this.socket = socket;
      let handshakeResolved = false;
      let handshakeRejected = false;
      let handshakeTimeout: ReturnType<typeof setTimeout> | null = null;
      const clearHandshakeTimeout = (): void => { if (handshakeTimeout) { clearTimeout(handshakeTimeout); handshakeTimeout = null; } };
      const settleError = (error: Error): void => {
        if (handshakeResolved || handshakeRejected) return;
        clearHandshakeTimeout();
        handshakeRejected = true;
        this.clearSocket();
        reject(error);
      };

      socket.once("open", () => this.emit("open"));
      socket.once("error", (event) => settleError(event instanceof Error ? event : new Error("websocket error")));
      socket.once("close", (code, reasonBuffer: Buffer) => {
        const reason = reasonBuffer.toString("utf8") || "socket closed";
        this.emit("close", code, reason);
        if (!handshakeResolved) {
          settleError(new Error(`socket closed before hello: ${reason}`));
          return;
        }
        this.clearPendingRequests(new Error(`socket closed (${code}): ${reason}`));
        this.clearSocket();
      });

      const handleMessage = (data: unknown): void => {
        const parsedMessage = this.parseIncomingMessage(normalizeIncomingFrame(data));
        if (!parsedMessage) return;
      if (!handshakeResolved && parsedMessage.type === "hello") {
          const helloPayload = parsedMessage.payload;
          if (!isHelloPayload(helloPayload)) {
            settleError(new Error("invalid hello payload"));
            return;
          }
          handshakeResolved = true;
          clearHandshakeTimeout();
          this.helloPayload = helloPayload;
          this.emit("hello", parsedMessage as GatewayEnvelope<HelloPayload>);
          resolve(helloPayload);
        }
        this.dispatchIncoming(parsedMessage);
      };

      if (this.requestTimeoutMs > 0) {
        handshakeTimeout = setTimeout(() => {
          if (!handshakeResolved && !handshakeRejected) {
            socket.terminate?.();
            settleError(new Error(`connect timeout after ${this.requestTimeoutMs}ms`));
          }
        }, this.requestTimeoutMs);
      }

      socket.on("message", handleMessage);
    });
  }

  /**
   * Close websocket transport.
   * @param code Close code.
   * @param reason Human-readable close reason.
   */
  public close(code = 1000, reason = ""): void {
    this.socket?.close(code, reason);
    this.clearSocket();
  }

  /**
   * Register event listeners with strongly-typed event names.
   */
  public on<K extends keyof CommandRelayClientEvents>(event: K, listener: CommandRelayClientEvents[K]): this {
    return super.on(event as string | symbol, listener as (...args: unknown[]) => void) as this;
  }

  /**
   * Authenticate with bearer token.
   * @param token Token string.
   * @returns Auth confirmation payload.
   */
  public async authenticate(token: string): Promise<AuthOkPayload> {
    const response = await this.sendRequest("auth", { token });
    if (response.type !== "auth_ok") throw new Error(`unexpected response: ${response.type}`);
    return response.payload as AuthOkPayload;
  }

  /**
   * Request latest session and pane snapshot.
   */
  public async listSessions(): Promise<SessionListPayload> {
    const response = await this.sendRequest("list_sessions");
    if (response.type !== "session_list") throw new Error(`unexpected response: ${response.type}`);
    return response.payload as SessionListPayload;
  }

  /**
   * Attach to a pane stream.
   * @param paneId Target pane identifier.
   * @param lastSeq Optional last stream sequence to request delta recovery.
   */
  public async attach(paneId: string, lastSeq?: number): Promise<void> {
    const payload: Record<string, unknown> = { paneId };
    if (typeof lastSeq === "number") payload.lastSeq = lastSeq;
    const response = await this.sendRequest("attach", payload);
    if (response.type !== "ack") throw new Error(`unexpected response: ${response.type}`);
  }

  /**
   * Detach from an attached pane.
   * @param paneId Target pane identifier.
   */
  public async detach(paneId: string): Promise<void> {
    const response = await this.sendRequest("detach", { paneId });
    if (response.type !== "ack") throw new Error(`unexpected response: ${response.type}`);
  }

  /**
   * Enable remote input flow control.
   * @returns Updated input policy.
   */
  public async enableInput(): Promise<PolicyUpdatePayload> {
    const response = await this.sendRequest("enable_input");
    if (response.type !== "policy_update") throw new Error(`unexpected response: ${response.type}`);
    return response.payload as PolicyUpdatePayload;
  }

  /**
   * Disable remote input flow control.
   * @returns Updated input policy.
   */
  public async disableInput(): Promise<PolicyUpdatePayload> {
    const response = await this.sendRequest("disable_input");
    if (response.type !== "policy_update") throw new Error(`unexpected response: ${response.type}`);
    return response.payload as PolicyUpdatePayload;
  }

  /**
   * Send input bytes to attached pane.
   * @param paneId Target pane identifier.
   * @param data Input payload.
   * @param override Replace previous pending data if set by server.
   */
  public async sendInput(paneId: string, data: string, override = false): Promise<void> {
    const response = await this.sendRequest("input", {
      paneId,
      data,
      ...(override ? { override: true } : {})
    });
    if (response.type !== "ack") throw new Error(`unexpected response: ${response.type}`);
  }

  /**
   * Send protocol heartbeat.
   */
  public async heartbeat(): Promise<GatewayEnvelope<GatewayPayload>> {
    const response = await this.sendRequest("heartbeat");
    if (response.type !== "heartbeat_ack") throw new Error(`unexpected response: ${response.type}`);
    return response;
  }

  /**
   * Request graceful server-side disconnect.
   */
  public async disconnect(): Promise<void> {
    try {
      const response = await this.sendRequest("disconnect");
      if (response.type !== "ack") throw new Error(`unexpected response: ${response.type}`);
    } finally {
      this.close(1000, "client disconnect");
    }
  }

  private async sendRequest(
    type: ClientCommand,
    payload: Record<string, unknown> = {}
  ): Promise<GatewayEnvelope<GatewayPayload>> {
    const socket = this.socket;
    if (!socket || !this.isOpen()) throw new Error("socket not connected");
    const requestId = this.nextRequestId(type);
    const request = envelope(type, payload, requestId);
    const response = this.promiseForRequest(requestId, EXPECTED_RESPONSE_TYPES_BY_COMMAND[type]);
    try {
      socket.send(JSON.stringify(request));
    } catch (error) {
      this.cancelPendingRequest(requestId);
      throw error instanceof Error ? error : new Error(String(error));
    }
    return response;
  }

  private parseIncomingMessage(raw: string): GatewayEnvelope<GatewayPayload> | null {
    const parsed = parseMessage(raw, this.parseOptions);
    if (!parsed.ok) {
      this.emit("parse_error", new Error(parsed.error), raw);
      return null;
    }
    return parsed.message as GatewayEnvelope<GatewayPayload>;
  }

  private dispatchIncoming(message: GatewayEnvelope<GatewayPayload>): void {
    const requestId = message.requestId;
    if (requestId === undefined) {
      return;
    }
    const pending = this.pendingRequests.get(requestId);
    if (pending) {
      if (!isUnknownResponseTypeAllowed(pending.expectedResponseTypes, message.type)) {
        pending.reject(new Error(`unexpected response type: ${message.type}`));
        clearTimeout(pending.timeoutAt);
        this.pendingRequests.delete(requestId);
        return;
      }

      if (!isResponsePayloadValid(message.type, message.payload)) {
        pending.reject(new Error(`invalid response payload for ${message.type}`));
        clearTimeout(pending.timeoutAt);
        this.pendingRequests.delete(requestId);
        return;
      }

      if (message.type === "error" || message.type === "auth_error") {
        pending.reject(new CommandRelayProtocolError(message.type, message.payload as GatewayErrorPayload | AuthErrorPayload));
      } else {
        pending.resolve(message);
      }
      clearTimeout(pending.timeoutAt);
      this.pendingRequests.delete(requestId);
      return;
    }

    switch (message.type) {
      case "hello": {
        if (!isHelloPayload(message.payload)) {
          this.emit("parse_error", new Error("invalid hello payload"), JSON.stringify(message.payload));
          return;
        }
        this.helloPayload = message.payload;
        this.emit("hello", message as GatewayEnvelope<HelloPayload>);
        break;
      }
      case "auth_ok":
        if (!isAuthOkPayload(message.payload)) {
          this.emit("parse_error", new Error("invalid auth_ok payload"), JSON.stringify(message.payload));
          return;
        }
        this.emit("auth_ok", message as GatewayEnvelope<AuthOkPayload>);
        break;
      case "auth_error":
        if (!isAuthErrorPayload(message.payload)) {
          this.emit("parse_error", new Error("invalid auth_error payload"), JSON.stringify(message.payload));
          return;
        }
        this.emit("auth_error", message as GatewayEnvelope<AuthErrorPayload>);
        break;
      case "session_list":
        if (!isSessionListPayload(message.payload)) {
          this.emit("parse_error", new Error("invalid session_list payload"), JSON.stringify(message.payload));
          return;
        }
        this.emit("session_list", message as GatewayEnvelope<SessionListPayload>);
        break;
      case "output":
        if (!isOutputPayload(message.payload)) {
          this.emit("parse_error", new Error("invalid output payload"), JSON.stringify(message.payload));
          return;
        }
        this.emit("output", message as GatewayEnvelope<OutputPayload>);
        break;
      case "policy_update":
        if (!isPolicyUpdatePayload(message.payload)) {
          this.emit("parse_error", new Error("invalid policy_update payload"), JSON.stringify(message.payload));
          return;
        }
        this.emit("policy_update", message as GatewayEnvelope<PolicyUpdatePayload>);
        break;
      case "heartbeat_ack":
        this.emit("heartbeat_ack", message);
        break;
      case "ack":
        this.emit("ack", message);
        break;
      case "error":
        if (!isGatewayErrorPayload(message.payload)) {
          this.emit("parse_error", new Error("invalid error payload"), JSON.stringify(message.payload));
          return;
        }
        this.emit("error", message as GatewayEnvelope<GatewayErrorPayload>);
        break;
      default:
        this.emit("unknown", message);
    }
  }

  private promiseForRequest(
    requestId: string,
    expectedResponseTypes: ReadonlySet<ProtocolV1AllowedEventType | "error" | "auth_error">
  ): Promise<GatewayEnvelope<GatewayPayload>> {
    return new Promise((resolve, reject) => {
      const timeoutAt = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`request timeout: ${requestId}`));
      }, this.requestTimeoutMs);
      this.pendingRequests.set(requestId, {
        expectedResponseTypes,
        timeoutAt,
        resolve,
        reject
      });
    });
  }

  private cancelPendingRequest(requestId: string): void {
    const pending = this.pendingRequests.get(requestId);
    if (!pending) return;
    clearTimeout(pending.timeoutAt);
    this.pendingRequests.delete(requestId);
  }

  private nextRequestId(prefix: string): string {
    const nextValue = (this.requestPrefixCounter.get(prefix) ?? 0) + 1;
    this.requestPrefixCounter.set(prefix, nextValue);
    return `${prefix}-${Date.now()}-${randomUUID()}-${nextValue}`;
  }

  private clearPendingRequests(error: Error): void {
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timeoutAt);
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }

  private clearSocket(): void {
    if (this.socket) {
      if (this.socket.readyState === this.socket.OPEN || this.socket.readyState === this.socket.CONNECTING) {
        this.socket.terminate?.();
      }
      this.socket.removeAllListeners();
      this.socket = null;
    }
    this.helloPayload = null;
    this.clearPendingRequests(new Error("connection closed"));
  }
}

function normalizeIncomingFrame(data: unknown): string {
  if (typeof data === "string") return data;
  if (data instanceof Buffer) return data.toString("utf8");
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("utf8");
  return String(data);
}

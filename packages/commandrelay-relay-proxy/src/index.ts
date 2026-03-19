import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer, type RawData } from "ws";

const MAX_WS_PAYLOAD_BYTES = 1024 * 1024 * 4;
const MAX_UPSTREAM_PENDING_MESSAGES = 64;
const MAX_UPSTREAM_PENDING_BYTES = MAX_WS_PAYLOAD_BYTES * 4;

export interface RelayProxyStats {
  activeConnections: number;
  totalConnections: number;
  peakActiveConnections: number;
  upstreamBytes: number;
  downstreamBytes: number;
}
export interface RelayBindOptions {
  listenHost: string;
  listenPort: number;
  relayPath: string;
  healthPath: string;
}
export interface RelayProxyRuntimeOptions {
  upstreamUrl: string;
  upstreamSubprotocols?: string | string[];
  allowedOrigins?: string[];
  requiredToken?: string;
  maxConnections: number;
  idleTimeoutMs: number;
  shutdownTimeoutMs: number;
}
export interface RelayProxyOptions extends RelayBindOptions, RelayProxyRuntimeOptions {}
export interface RelayProxyHandle {
  readonly started: Promise<void>;
  close: () => Promise<void>;
  getStats: () => RelayProxyStats & { startedAtMs: number; uptimeMs: number; config: RelayProxyHealthConfig };
}
export interface RelayProxyHealthConfig {
  listenHost: string;
  listenPort: number;
  relayPath: string;
  healthPath: string;
  upstreamUrl: string;
  maxConnections: number;
  upstreamSubprotocols: string[];
  originProtection: boolean;
  hasTokenRequired: boolean;
}
interface ParsedEnv {
  listenHost: string;
  listenPort: number;
  relayPath: string;
  healthPath: string;
  upstreamUrl: string;
  maxConnections: number;
  idleTimeoutMs: number;
  shutdownTimeoutMs: number;
  requiredToken: string;
  allowedOrigins: string;
  upstreamSubprotocols: string;
}
interface RelaySessionState {
  readonly id: string;
  readonly client: WebSocket;
  readonly upstream: WebSocket;
  lastActivityAtMs: number;
  upstreamBytes: number;
  downstreamBytes: number;
  idleTimer: NodeJS.Timeout;
  pendingUpstreamMessages: RawData[];
  pendingUpstreamQueuedBytes: number;
  isClosing: boolean;
}
/** Start and control a relay proxy instance. */
export async function createRelayProxyServer(options: RelayProxyOptions): Promise<RelayProxyHandle> {
  const normalized = normalizeRuntimeOptions(options);
  const startedAtMs = Date.now();
  const stats: RelayProxyStats = {
    activeConnections: 0,
    totalConnections: 0,
    peakActiveConnections: 0,
    upstreamBytes: 0,
    downstreamBytes: 0
  };
  const sessions = new Map<string, RelaySessionState>();
  const state = { shuttingDown: false };
  const httpServer = createServer((request, response) => {
    serveHealth(request, response, normalized, stats, startedAtMs);
  });
  const wsServer = new WebSocketServer({ noServer: true, maxPayload: MAX_WS_PAYLOAD_BYTES });
  let inFlightUpgrades = 0;
  const disposeSocketSafely = (socket: WebSocket, closeCall: () => void): void => {
    if (socket.readyState !== WebSocket.OPEN) {
      const transport = (socket as { _socket?: { destroy?: () => void } })._socket;
      transport?.destroy?.();
      return;
    }
    const onError = (): void => {};
    socket.once("error", onError);
    try {
      closeCall();
    } catch {
      const transport = (socket as { _socket?: { destroy?: () => void } })._socket;
      transport?.destroy?.();
    } finally {
      setImmediate(() => {
        socket.removeListener("error", onError);
      });
    }
  };
  const disposeSocket = (socket: WebSocket): void => {
    disposeSocketSafely(socket, () => {
      socket.close();
    });
  };
  const disposeSocketWithCode = (socket: WebSocket, code: number, reason: string): void => {
    disposeSocketSafely(socket, () => {
      socket.close(code, reason);
    });
  };
  const wireSession = (clientSocket: WebSocket): void => {
    const upstream = new WebSocket(
      normalized.upstreamUrl,
      normalized.upstreamSubprotocols.length ? normalized.upstreamSubprotocols : undefined
    );
    const resetIdleTimeout = (): void => {
      clearTimeout(session.idleTimer);
      session.idleTimer = setTimeout(() => checkIdleTimeout(), normalized.idleTimeoutMs);
    };
    const session: RelaySessionState = {
      id: randomUUID(),
      client: clientSocket,
      upstream,
      lastActivityAtMs: Date.now(),
      upstreamBytes: 0,
      downstreamBytes: 0,
      idleTimer: setTimeout(() => checkIdleTimeout(), normalized.idleTimeoutMs),
      pendingUpstreamMessages: [],
      pendingUpstreamQueuedBytes: 0,
      isClosing: false
    };
    const closeSession = (reason: string, immediate: boolean): void => {
      if (session.isClosing) return;
      session.isClosing = true;
      clearTimeout(session.idleTimer);
      sessions.delete(session.id);
      stats.activeConnections = sessions.size;
      clientSocket.off("message", onClientMessage);
      clientSocket.off("close", onClientClose);
      clientSocket.off("error", onClientError);
      upstream.off("open", onUpstreamOpen);
      upstream.off("message", onUpstreamMessage);
      upstream.off("close", onUpstreamClose);
      upstream.off("error", onUpstreamError);
      if (immediate) {
        disposeSocket(clientSocket);
        disposeSocket(upstream);
        return;
      }
      disposeSocketWithCode(clientSocket, 1000, reason);
      disposeSocketWithCode(upstream, 1000, reason);
      setTimeout(() => {
        disposeSocket(clientSocket);
        disposeSocket(upstream);
      }, 750);
    };
    const safeSend = (socket: WebSocket, data: RawData, reason: string): boolean => {
      if (socket.readyState !== WebSocket.OPEN) {
        closeSession(reason, true);
        return false;
      }
      try {
        socket.send(data);
        return true;
      } catch {
        closeSession(reason, true);
        return false;
      }
    };
    const onClientMessage = (data: RawData): void => {
      if (state.shuttingDown || session.isClosing) return;
      const bytes = getByteLength(data);
      session.lastActivityAtMs = Date.now();
      resetIdleTimeout();
      session.upstreamBytes += bytes;
      stats.upstreamBytes += bytes;
      if (upstream.readyState !== WebSocket.OPEN) {
        if (
          session.pendingUpstreamMessages.length >= MAX_UPSTREAM_PENDING_MESSAGES ||
          session.pendingUpstreamQueuedBytes + bytes > MAX_UPSTREAM_PENDING_BYTES
        ) {
          closeSession("upstream backlog full", true);
          return;
        }
        session.pendingUpstreamMessages.push(data);
        session.pendingUpstreamQueuedBytes += bytes;
        return;
      }
      void safeSend(upstream, data, "upstream send failed");
    };
    const onClientClose = (): void => {
      closeSession("client closed", false);
    };
    const onClientError = (): void => {
      closeSession("client error", true);
    };
    const onUpstreamOpen = (): void => {
      for (const queued of session.pendingUpstreamMessages) {
        if (!safeSend(upstream, queued, "upstream queued send failed")) {
          return;
        }
      }
      session.pendingUpstreamMessages.length = 0;
      session.pendingUpstreamQueuedBytes = 0;
      session.lastActivityAtMs = Date.now();
      resetIdleTimeout();
    };
    const onUpstreamMessage = (data: RawData): void => {
      if (state.shuttingDown || session.isClosing) return;
      if (clientSocket.readyState !== WebSocket.OPEN) return;
      const bytes = getByteLength(data);
      session.lastActivityAtMs = Date.now();
      resetIdleTimeout();
      session.downstreamBytes += bytes;
      stats.downstreamBytes += bytes;
      void safeSend(clientSocket, data, "client send failed");
    };
    const onUpstreamClose = (): void => {
      closeSession("upstream closed", false);
    };
    const onUpstreamError = (): void => {
      closeSession("upstream error", true);
    };
    const checkIdleTimeout = (): void => {
      if (state.shuttingDown || session.isClosing) return;
      if (Date.now() - session.lastActivityAtMs < normalized.idleTimeoutMs) return;
      closeSession("idle timeout", true);
    };
    sessions.set(session.id, session);
    stats.activeConnections += 1;
    stats.totalConnections += 1;
    if (stats.activeConnections > stats.peakActiveConnections) {
      stats.peakActiveConnections = stats.activeConnections;
    }
    clientSocket.on("message", onClientMessage);
    clientSocket.on("close", onClientClose);
    clientSocket.on("error", onClientError);
    upstream.on("open", onUpstreamOpen);
    upstream.on("message", onUpstreamMessage);
    upstream.on("close", onUpstreamClose);
    upstream.on("error", onUpstreamError);
  };
  const onUpgrade = (request: IncomingMessage, socket: Duplex, head: Buffer): void => {
    if (state.shuttingDown) {
      socket.end("HTTP/1.1 503 Service Unavailable\r\n\r\n");
      return;
    }
    if (request.method !== "GET") {
      socket.end("HTTP/1.1 405 Method Not Allowed\r\n\r\n");
      return;
    }
    if (!isRelayPath(request, normalized.relayPath)) {
      socket.end("HTTP/1.1 404 Not Found\r\n\r\n");
      return;
    }
    if (!isOriginAllowed(request.headers.origin, normalized.allowedOrigins)) {
      socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
      return;
    }
    if (!isTokenValidFromRequest(request, normalized.requiredToken)) {
      socket.end(
        "HTTP/1.1 401 Unauthorized\r\nWWW-Authenticate: Bearer realm=\"commandrelay-relay-proxy\"\r\nConnection: close\r\n\r\n"
      );
      return;
    }
    if (sessions.size + inFlightUpgrades >= normalized.maxConnections) {
      socket.end("HTTP/1.1 503 Too Many Connections\r\n\r\n");
      return;
    }

    inFlightUpgrades += 1;
    try {
      wsServer.handleUpgrade(request, socket, head, (clientSocket) => {
        try {
          wireSession(clientSocket);
        } finally {
          inFlightUpgrades -= 1;
        }
      });
    } catch (error) {
      void error;
      inFlightUpgrades -= 1;
      socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
    }
  };
  wsServer.on("connection", () => {
  });
  httpServer.on("upgrade", onUpgrade);
  const started = new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(normalized.listenPort, normalized.listenHost, () => {
      resolve();
    });
  });
  const close = async (): Promise<void> => {
    if (state.shuttingDown) return;
    state.shuttingDown = true;
    httpServer.removeListener("upgrade", onUpgrade);
    wsServer.close();
    for (const session of Array.from(sessions.values())) {
      session.client.removeAllListeners();
      session.upstream.removeAllListeners();
      disposeSocketWithCode(session.client, 1001, "server shutdown");
      disposeSocketWithCode(session.upstream, 1001, "server shutdown");
      clearTimeout(session.idleTimer);
      sessions.delete(session.id);
    }
    stats.activeConnections = 0;
    await Promise.race([
      new Promise<void>((resolve) => httpServer.close(() => resolve())),
      new Promise<void>((resolve) => setTimeout(resolve, normalized.shutdownTimeoutMs))
    ]);
  };
  return {
    started,
    close,
    getStats: () => ({
      ...stats,
      startedAtMs,
      uptimeMs: Date.now() - startedAtMs,
      config: {
        listenHost: normalized.listenHost,
        listenPort: normalized.listenPort,
        relayPath: normalized.relayPath,
        healthPath: normalized.healthPath,
        upstreamUrl: normalized.upstreamUrl,
        maxConnections: normalized.maxConnections,
        upstreamSubprotocols: [...normalized.upstreamSubprotocols],
        originProtection: normalized.allowedOrigins.length > 0,
        hasTokenRequired: Boolean(normalized.requiredToken)
      }
    })
  };
}
/** Parse relay proxy environment variables with validated defaults. */
export function parseRelayProxyEnv(env: NodeJS.ProcessEnv = process.env): ParsedEnv {
  return {
    listenHost: (env.COMMANDRELAY_RELAY_LISTEN_HOST ?? "127.0.0.1").trim() || "127.0.0.1",
    listenPort: parseBoundedInteger(env.COMMANDRELAY_RELAY_LISTEN_PORT, 8788, 1, 65535),
    relayPath: normalizePath(env.COMMANDRELAY_RELAY_PATH, "/ws"),
    healthPath: normalizePath(env.COMMANDRELAY_RELAY_HEALTH_PATH, "/health"),
    upstreamUrl: (env.COMMANDRELAY_RELAY_UPSTREAM_URL || "ws://127.0.0.1:8787/ws").trim(),
    maxConnections: parseBoundedInteger(env.COMMANDRELAY_RELAY_MAX_CONNECTIONS, 128, 1, 10_000),
    idleTimeoutMs: parseBoundedInteger(env.COMMANDRELAY_RELAY_IDLE_TIMEOUT_MS, 120_000, 1_000, 600_000),
    shutdownTimeoutMs: parseBoundedInteger(env.COMMANDRELAY_RELAY_SHUTDOWN_TIMEOUT_MS, 10_000, 1_000, 60_000),
    requiredToken: (env.COMMANDRELAY_RELAY_REQUIRED_TOKEN ?? "").trim(),
    allowedOrigins: (env.COMMANDRELAY_RELAY_ALLOWED_ORIGINS ?? "").trim(),
    upstreamSubprotocols: (env.COMMANDRELAY_RELAY_UPSTREAM_SUBPROTOCOLS ?? "").trim()
  };
}
/** Convert raw environment values into validated relay options. */
export function normalizeRelayOptions(values: ParsedEnv): RelayProxyOptions {
  const upstream = new URL(values.upstreamUrl);
  if (upstream.protocol !== "ws:" && upstream.protocol !== "wss:") {
    throw new Error(`upstreamUrl must use ws or wss, got ${upstream.protocol}`);
  }
  return {
    listenHost: values.listenHost,
    listenPort: values.listenPort,
    relayPath: values.relayPath,
    healthPath: values.healthPath,
    upstreamUrl: upstream.toString(),
    maxConnections: values.maxConnections,
    upstreamSubprotocols: splitCommaList(values.upstreamSubprotocols),
    allowedOrigins: splitCommaList(values.allowedOrigins),
    requiredToken: values.requiredToken,
    idleTimeoutMs: values.idleTimeoutMs,
    shutdownTimeoutMs: values.shutdownTimeoutMs
  };
}
function normalizeRuntimeOptions(raw: RelayProxyOptions): Required<RelayProxyOptions> {
  const upstream = new URL(raw.upstreamUrl);
  if (upstream.protocol !== "ws:" && upstream.protocol !== "wss:") {
    throw new Error(`upstreamUrl must use ws or wss, got ${upstream.protocol}`);
  }
  return {
    listenHost: raw.listenHost.trim() || "127.0.0.1",
    listenPort: Math.max(1, Math.floor(raw.listenPort)),
    relayPath: normalizePath(raw.relayPath, "/ws"),
    healthPath: normalizePath(raw.healthPath, "/health"),
    upstreamUrl: upstream.toString(),
    upstreamSubprotocols: normalizeSubprotocols(raw.upstreamSubprotocols),
    allowedOrigins: normalizeOrigins(raw.allowedOrigins),
    requiredToken: (raw.requiredToken ?? "").trim(),
    maxConnections: Math.max(1, Math.floor(raw.maxConnections)),
    idleTimeoutMs: Math.max(1_000, Math.floor(raw.idleTimeoutMs)),
    shutdownTimeoutMs: Math.max(1_000, Math.floor(raw.shutdownTimeoutMs))
  };
}
function isRelayPath(request: IncomingMessage, relayPath: string): boolean {
  const parsed = new URL(request.url || "", "http://localhost");
  return parsed.pathname === relayPath;
}
function isOriginAllowed(originHeader: string | undefined, allowedOrigins: string[]): boolean {
  if (!allowedOrigins.length) return true;
  return typeof originHeader === "string" && allowedOrigins.includes(originHeader);
}
function isTokenValidFromRequest(request: IncomingMessage, requiredToken: string): boolean {
  if (!requiredToken) return true;
  return constantTimeEquals(hashToken(requiredToken), hashToken(extractClientToken(request)));
}
function extractClientToken(request: IncomingMessage): string {
  const query = request.url ? new URL(request.url, "http://localhost").searchParams : new URLSearchParams();
  const bearer = request.headers.authorization;
  if (typeof bearer === "string" && bearer.toLowerCase().startsWith("bearer ")) {
    return bearer.slice(7).trim();
  }
  return query.get("token") ?? "";
}
function hashToken(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}
function constantTimeEquals(left: Buffer, right: Buffer): boolean {
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
function serveHealth(
  request: IncomingMessage,
  response: ServerResponse,
  options: Required<RelayProxyOptions>,
  stats: RelayProxyStats,
  startedAtMs: number
): void {
  if (request.method !== "GET" || !request.url) {
    response.writeHead(405, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "method_not_allowed" }));
    return;
  }
  const parsed = new URL(request.url, "http://localhost");
  if (parsed.pathname !== options.healthPath) {
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "not_found" }));
    return;
  }
  response.writeHead(200, { "content-type": "application/json" });
  response.end(
    JSON.stringify({
      status: "ok",
      startedAtMs,
      uptimeMs: Date.now() - startedAtMs,
      activeConnections: stats.activeConnections,
      peakActiveConnections: stats.peakActiveConnections,
      totalConnections: stats.totalConnections,
      upstreamBytes: stats.upstreamBytes,
      downstreamBytes: stats.downstreamBytes,
      upstreamUrl: options.upstreamUrl,
      relayPath: options.relayPath,
      healthPath: options.healthPath,
      nonce: randomBytes(8).toString("hex")
    })
  );
}
function parseBoundedInteger(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) return fallback;
  return parsed;
}
function splitCommaList(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}
function normalizePath(raw: string | undefined, fallback: string): string {
  const candidate = raw?.trim() ?? "";
  if (!candidate || candidate === "/") return fallback;
  return `/${candidate.replace(/^\/+/, "").replace(/\/+$/, "")}`;
}
function normalizeSubprotocols(raw: string | string[] | undefined): string[] {
  const values = Array.isArray(raw) ? raw : splitCommaList(raw ?? "");
  return values.map((entry) => entry.trim()).filter(Boolean);
}
function normalizeOrigins(raw: string[] | undefined): string[] {
  return raw?.map((entry) => entry.trim()).filter(Boolean) ?? [];
}
function getByteLength(data: RawData): number {
  const value = data as string | ArrayBuffer | ArrayBufferView;
  if (typeof value === "string") return value.length;
  if (ArrayBuffer.isView(value)) return value.byteLength;
  if (value instanceof ArrayBuffer) return value.byteLength;
  return 0;
}

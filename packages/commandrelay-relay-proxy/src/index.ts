import { createHash, randomUUID } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { SecureVersion } from "node:tls";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import { isOriginAllowed, isRelayPath, isTokenValidFromRequest } from "./request-guards.js";

const MAX_WS_PAYLOAD_BYTES = 1024 * 1024 * 4;
const MAX_UPSTREAM_PENDING_MESSAGES = 64;
const MAX_UPSTREAM_PENDING_BYTES = MAX_WS_PAYLOAD_BYTES * 4;
const RELAY_PROXY_TLS_REJECT_UNAUTHORIZED_DEFAULT = true;
const RELAY_PROXY_STATUS_PATH = "/status";
const RELAY_PROXY_STATUS_SCHEMA_VERSION = 2;
const RELAY_PROXY_TLS_WATCH_INTERVAL_MIN_MS = 250;
const SUPPORTED_TLS_VERSION_ORDER: readonly string[] = ["TLSv1.1", "TLSv1.2", "TLSv1.3"];

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
  upstreamTls: RelayProxyUpstreamTlsOptions;
  upstreamSubprotocols?: string | string[];
  allowedOrigins?: string[];
  requiredToken?: string;
  upstreamTlsWatchIntervalMs?: number;
  upstreamTlsRestartOnChange?: boolean;
  upstreamTlsSourcePaths?: string[];
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
  upstreamTls: {
    sourceMode: "file" | "memory";
    sourcePaths: string[];
    fingerprint: string;
    rejectUnauthorized: boolean;
    hasCustomCa: boolean;
    hasClientIdentity: boolean;
    rotation: RelayProxyTlsRotationState;
  };
  statusContractVersion: number;
  configFingerprint: string;
  originProtection: boolean;
  hasTokenRequired: boolean;
}
type RelayProxyTlsRotationStatus = "disabled" | "monitoring" | "restart_required" | "unavailable" | "unsupported";
interface RelayProxyTlsRotationState {
  status: RelayProxyTlsRotationStatus;
  enabled: boolean;
  intervalMs: number;
  autoRestartOnChange: boolean;
  lastCheckedAtMs: number;
  detectedAtMs: number | null;
  changedPaths: string[];
  reason?: string;
}
interface ParsedEnv {
  listenHost: string;
  listenPort: number;
  relayPath: string;
  healthPath: string;
  upstreamUrl: string;
  upstreamTlsRejectUnauthorized: string;
  upstreamTlsCaFile: string;
  upstreamTlsCertFile: string;
  upstreamTlsKeyFile: string;
  upstreamTlsPfxFile: string;
  upstreamTlsPassphrase: string;
  upstreamTlsServername: string;
  upstreamTlsMinVersion: string;
  upstreamTlsMaxVersion: string;
  upstreamTlsWatchIntervalMs: number;
  upstreamTlsRestartOnChange: string;
  maxConnections: number;
  idleTimeoutMs: number;
  shutdownTimeoutMs: number;
  requiredToken: string;
  allowedOrigins: string;
  upstreamSubprotocols: string;
}
export interface RelayProxyUpstreamTlsOptions {
  rejectUnauthorized: boolean;
  ca?: Buffer | string | Array<Buffer | string>;
  cert?: Buffer | string | Array<Buffer | string>;
  key?: Buffer | string | Array<Buffer | string>;
  pfx?: Buffer;
  passphrase?: string;
  servername?: string;
  minVersion?: SecureVersion;
  maxVersion?: SecureVersion;
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
interface UpstreamTlsSourceState {
  readonly path: string;
  readonly digest: string;
  readonly mtimeMs: number;
  readonly size: number;
}
interface UpstreamTlsWatchState {
  status: RelayProxyTlsRotationStatus;
  enabled: boolean;
  intervalMs: number;
  autoRestartOnChange: boolean;
  sourcePaths: string[];
  sourceMode: "file" | "memory";
  baselineFingerprint: string;
  lastCheckedAtMs: number;
  detectedAtMs: number | null;
  changedPaths: string[];
  lastError?: string;
  lastSnapshot: UpstreamTlsSourceState[];
}
/** Start and control a relay proxy instance. */
export async function createRelayProxyServer(options: RelayProxyOptions): Promise<RelayProxyHandle> {
  const normalized = normalizeRuntimeOptions(options);
  const startedAtMs = Date.now();
  const tlsWatchState = createUpstreamTlsWatchState(normalized);
  let tlsWatchTimer: NodeJS.Timeout | undefined;
  const stats: RelayProxyStats = {
    activeConnections: 0,
    totalConnections: 0,
    peakActiveConnections: 0,
    upstreamBytes: 0,
    downstreamBytes: 0
  };
  const sessions = new Map<string, RelaySessionState>();
  const state = { shuttingDown: false };
  const configFingerprint = buildProxyConfigFingerprint(normalized, tlsWatchState);
  const refreshTlsWatchState = async (): Promise<void> => {
    try {
      await updateUpstreamTlsWatchState(tlsWatchState);
    } catch {
      tlsWatchState.status = "unavailable";
      tlsWatchState.lastError = "Unable to validate TLS material";
      tlsWatchState.lastCheckedAtMs = Date.now();
    }
  };

  if (tlsWatchState.enabled) {
    tlsWatchTimer = setInterval(() => {
      void refreshTlsWatchState();
    }, tlsWatchState.intervalMs);
    void refreshTlsWatchState();
  } else if (tlsWatchState.status === "unsupported") {
    tlsWatchState.lastError = "Upstream TLS rotation is not enabled because no file material is configured";
  }

  const httpServer = createServer((request, response) => {
    serveHealth(request, response, normalized, stats, startedAtMs, configFingerprint, tlsWatchState);
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
      normalized.upstreamSubprotocols.length ? normalized.upstreamSubprotocols : undefined,
      normalized.upstreamTls
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
    let inFlightReserved = false;
    const releaseInFlightUpgrade = (): void => {
      if (!inFlightReserved) return;
      inFlightUpgrades = Math.max(0, inFlightUpgrades - 1);
      inFlightReserved = false;
    };

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
    inFlightReserved = true;
    try {
      wsServer.handleUpgrade(request, socket, head, (clientSocket) => {
        try {
          if (state.shuttingDown) {
            disposeSocketWithCode(clientSocket, 1001, "server shutdown");
            return;
          }
          wireSession(clientSocket);
        } catch (error) {
          void error;
          disposeSocketSafely(clientSocket, () => {
            clientSocket.close(1011, "upgrade failure");
          });
        } finally {
          releaseInFlightUpgrade();
        }
      });
    } catch (error) {
      void error;
      releaseInFlightUpgrade();
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
    if (tlsWatchTimer) {
      clearInterval(tlsWatchTimer);
      tlsWatchTimer = undefined;
    }
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
        statusContractVersion: RELAY_PROXY_STATUS_SCHEMA_VERSION,
        configFingerprint,
        upstreamUrl: normalized.upstreamUrl,
        maxConnections: normalized.maxConnections,
        upstreamSubprotocols: [...normalized.upstreamSubprotocols],
        upstreamTls: {
          sourceMode: tlsWatchState.sourceMode,
          sourcePaths: [...tlsWatchState.sourcePaths],
          fingerprint: tlsWatchState.baselineFingerprint,
          rejectUnauthorized: normalized.upstreamTls.rejectUnauthorized,
          hasCustomCa: normalized.upstreamTls.ca !== undefined,
          hasClientIdentity:
            normalized.upstreamTls.cert !== undefined ||
            normalized.upstreamTls.key !== undefined ||
            normalized.upstreamTls.pfx !== undefined,
          rotation: {
            status: tlsWatchState.status,
            enabled: tlsWatchState.enabled,
            intervalMs: tlsWatchState.intervalMs,
            autoRestartOnChange: tlsWatchState.autoRestartOnChange,
            lastCheckedAtMs: tlsWatchState.lastCheckedAtMs,
            detectedAtMs: tlsWatchState.detectedAtMs,
            changedPaths: [...tlsWatchState.changedPaths],
            reason: tlsWatchState.lastError
          }
        },
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
    upstreamTlsRejectUnauthorized: env.COMMANDRELAY_RELAY_UPSTREAM_TLS_REJECT_UNAUTHORIZED ?? "true",
    upstreamTlsCaFile: (env.COMMANDRELAY_RELAY_UPSTREAM_TLS_CA_FILE ?? "").trim(),
    upstreamTlsCertFile: (env.COMMANDRELAY_RELAY_UPSTREAM_TLS_CERT_FILE ?? "").trim(),
    upstreamTlsKeyFile: (env.COMMANDRELAY_RELAY_UPSTREAM_TLS_KEY_FILE ?? "").trim(),
    upstreamTlsPfxFile: (env.COMMANDRELAY_RELAY_UPSTREAM_TLS_PFX_FILE ?? "").trim(),
    upstreamTlsPassphrase: (env.COMMANDRELAY_RELAY_UPSTREAM_TLS_PASSPHRASE ?? "").trim(),
    upstreamTlsServername: (env.COMMANDRELAY_RELAY_UPSTREAM_TLS_SERVERNAME ?? "").trim(),
    upstreamTlsMinVersion: (env.COMMANDRELAY_RELAY_UPSTREAM_TLS_MIN_VERSION ?? "").trim(),
    upstreamTlsMaxVersion: (env.COMMANDRELAY_RELAY_UPSTREAM_TLS_MAX_VERSION ?? "").trim(),
    upstreamTlsWatchIntervalMs: normalizeWatchInterval(
      parseNonNegativeInteger(env.COMMANDRELAY_RELAY_UPSTREAM_TLS_WATCH_INTERVAL_MS ?? "", 0)
    ),
    upstreamTlsRestartOnChange: (env.COMMANDRELAY_RELAY_UPSTREAM_TLS_RESTART_ON_CHANGE ?? "false").trim(),
    maxConnections: parseBoundedInteger(env.COMMANDRELAY_RELAY_MAX_CONNECTIONS, 128, 1, 10_000),
    idleTimeoutMs: parseBoundedInteger(env.COMMANDRELAY_RELAY_IDLE_TIMEOUT_MS, 120_000, 1_000, 600_000),
    shutdownTimeoutMs: parseBoundedInteger(env.COMMANDRELAY_RELAY_SHUTDOWN_TIMEOUT_MS, 10_000, 1_000, 60_000),
    requiredToken: (env.COMMANDRELAY_RELAY_REQUIRED_TOKEN ?? "").trim(),
    allowedOrigins: (env.COMMANDRELAY_RELAY_ALLOWED_ORIGINS ?? "").trim(),
    upstreamSubprotocols: (env.COMMANDRELAY_RELAY_UPSTREAM_SUBPROTOCOLS ?? "").trim()
  };
}
/** Convert raw environment values into validated relay options. */
export function normalizeRelayOptions(values: ParsedEnv | RelayProxyOptions): RelayProxyOptions {
  const upstream = new URL(values.upstreamUrl);
  if (upstream.protocol !== "ws:" && upstream.protocol !== "wss:") {
    throw new Error(`upstreamUrl must use ws or wss, got ${upstream.protocol}`);
  }
  const upstreamTls = "upstreamTlsRejectUnauthorized" in values
    ? normalizeUpstreamTls(values)
    : normalizeUpstreamTls(values.upstreamTls);
  return {
    listenHost: values.listenHost,
    listenPort: values.listenPort,
    relayPath: values.relayPath,
    healthPath: values.healthPath,
    upstreamUrl: upstream.toString(),
    upstreamTls,
    upstreamTlsWatchIntervalMs: normalizeNonNegativeInteger(values.upstreamTlsWatchIntervalMs, 0),
    upstreamTlsRestartOnChange: normalizeBoolean(values.upstreamTlsRestartOnChange, false),
    upstreamTlsSourcePaths: collectUpstreamTlsSourcePaths(values),
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
    upstreamTls: normalizeUpstreamTls(raw.upstreamTls),
    upstreamSubprotocols: normalizeSubprotocols(raw.upstreamSubprotocols),
    allowedOrigins: normalizeOrigins(raw.allowedOrigins),
    requiredToken: (raw.requiredToken ?? "").trim(),
    upstreamTlsWatchIntervalMs: normalizeNonNegativeInteger(raw.upstreamTlsWatchIntervalMs, 0),
    upstreamTlsRestartOnChange: normalizeBoolean(raw.upstreamTlsRestartOnChange, false),
    upstreamTlsSourcePaths: normalizeUpstreamTlsSourcePaths(raw.upstreamTlsSourcePaths),
    maxConnections: Math.max(1, Math.floor(raw.maxConnections)),
    idleTimeoutMs: Math.max(1_000, Math.floor(raw.idleTimeoutMs)),
    shutdownTimeoutMs: Math.max(1_000, Math.floor(raw.shutdownTimeoutMs))
  };
}
function normalizeUpstreamTls(
  values: ParsedEnv | RelayProxyUpstreamTlsOptions | undefined
): RelayProxyUpstreamTlsOptions {
  if (!values) {
    return { rejectUnauthorized: RELAY_PROXY_TLS_REJECT_UNAUTHORIZED_DEFAULT };
  }

  if (isRelayProxyUpstreamTlsOptions(values)) {
    const normalized = {
      rejectUnauthorized: values.rejectUnauthorized ?? RELAY_PROXY_TLS_REJECT_UNAUTHORIZED_DEFAULT,
      ca: values.ca,
      cert: values.cert,
      key: values.key,
      pfx: values.pfx,
      passphrase: values.passphrase,
      servername: values.servername,
      minVersion: values.minVersion,
      maxVersion: values.maxVersion
    };
    validateUpstreamTlsConfig(normalized);
    return normalized;
  }

  const normalized = {
    rejectUnauthorized: parseBoolean(values.upstreamTlsRejectUnauthorized, RELAY_PROXY_TLS_REJECT_UNAUTHORIZED_DEFAULT),
    ca: loadTlsMaterialList(values.upstreamTlsCaFile, "upstream TLS CA"),
    cert: loadTlsMaterial(values.upstreamTlsCertFile, "upstream TLS cert"),
    key: loadTlsMaterial(values.upstreamTlsKeyFile, "upstream TLS key"),
    pfx: loadTlsMaterialAsBuffer(values.upstreamTlsPfxFile, "upstream TLS pfx"),
    passphrase: values.upstreamTlsPassphrase || undefined,
    servername: values.upstreamTlsServername || undefined,
    minVersion: (values.upstreamTlsMinVersion || undefined) as SecureVersion | undefined,
    maxVersion: (values.upstreamTlsMaxVersion || undefined) as SecureVersion | undefined
  };
  validateUpstreamTlsConfig(normalized);
  return normalized;
}

function validateUpstreamTlsConfig(options: RelayProxyUpstreamTlsOptions): void {
  const hasCert = options.cert !== undefined;
  const hasKey = options.key !== undefined;
  if (hasCert !== hasKey) {
    throw new Error("upstream TLS cert and key must be both provided together");
  }

  if (options.pfx !== undefined && (hasCert || hasKey)) {
    throw new Error("upstream TLS pfx cannot be used together with cert and key");
  }

  if (options.minVersion !== undefined && !SUPPORTED_TLS_VERSION_ORDER.includes(options.minVersion)) {
    throw new Error(`unsupported upstream tls minVersion: ${options.minVersion}`);
  }

  if (options.maxVersion !== undefined && !SUPPORTED_TLS_VERSION_ORDER.includes(options.maxVersion)) {
    throw new Error(`unsupported upstream tls maxVersion: ${options.maxVersion}`);
  }

  if (options.minVersion !== undefined && options.maxVersion !== undefined) {
    const minIndex = SUPPORTED_TLS_VERSION_ORDER.indexOf(options.minVersion);
    const maxIndex = SUPPORTED_TLS_VERSION_ORDER.indexOf(options.maxVersion);
    if (minIndex > maxIndex) {
      throw new Error(`upstream tls minVersion ${options.minVersion} must not exceed maxVersion ${options.maxVersion}`);
    }
  }
}

function isRelayProxyUpstreamTlsOptions(
  value: ParsedEnv | RelayProxyUpstreamTlsOptions
): value is RelayProxyUpstreamTlsOptions {
  return (
    typeof (value as RelayProxyUpstreamTlsOptions).rejectUnauthorized === "boolean" &&
    !("upstreamTlsRejectUnauthorized" in value)
  );
}

function loadTlsMaterialList(raw: string, label: string): undefined | Array<string | Buffer> {
  if (!raw.trim()) return undefined;
  const candidates = raw.split(",").map((entry) => entry.trim()).filter(Boolean);
  if (!candidates.length) return undefined;

  const loaded = candidates.map((entry) => loadTlsMaterial(entry, label));
  return loaded.filter((item): item is Buffer => item !== undefined);
}

function loadTlsMaterial(raw: string, label: string): Buffer | undefined {
  if (!raw.trim()) return undefined;
  try {
    return readFileSync(raw);
  } catch (error) {
    throw new Error(`failed to read ${label}: ${raw}: ${String((error as Error).message)}`);
  }
}

function loadTlsMaterialAsBuffer(raw: string, label: string): Buffer | undefined {
  return loadTlsMaterial(raw, label);
}
function serveHealth(
  request: IncomingMessage,
  response: ServerResponse,
  options: Required<RelayProxyOptions>,
  stats: RelayProxyStats,
  startedAtMs: number,
  configFingerprint: string,
  tlsWatchState: UpstreamTlsWatchState
): void {
  if (request.method !== "GET" || !request.url) {
    response.writeHead(405, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "method_not_allowed" }));
    return;
  }
  const parsed = new URL(request.url, "http://localhost");
  const path = parsed.pathname;
  if (path !== options.healthPath && path !== RELAY_PROXY_STATUS_PATH) {
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "not_found" }));
    return;
  }
  if (!isTokenValidFromRequest(request, options.requiredToken)) {
    response.writeHead(401, {
      "content-type": "application/json",
      "www-authenticate": "Bearer realm=\"commandrelay-relay-proxy\""
    });
    response.end(JSON.stringify({ error: "unauthorized" }));
    return;
  }

  if (path === RELAY_PROXY_STATUS_PATH) {
    const now = Date.now();
    response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    response.end(
      JSON.stringify({
        status: "open",
        statusContractVersion: RELAY_PROXY_STATUS_SCHEMA_VERSION,
        configFingerprint,
        heartbeat: {
          checkedAtMs: now,
          startedAtMs,
          uptimeMs: now - startedAtMs,
          ageMs: now - startedAtMs
        },
        listener: {
          host: options.listenHost,
          port: options.listenPort,
          relayPath: options.relayPath,
          healthPath: options.healthPath,
          statusPath: RELAY_PROXY_STATUS_PATH
        },
        upstream: {
          url: options.upstreamUrl,
          subprotocols: options.upstreamSubprotocols,
          watchIntervalMs: tlsWatchState.intervalMs,
          rotation: {
            status: tlsWatchState.status,
            enabled: tlsWatchState.enabled,
            intervalMs: tlsWatchState.intervalMs,
            autoRestartOnChange: tlsWatchState.autoRestartOnChange,
            lastCheckedAtMs: tlsWatchState.lastCheckedAtMs,
            detectedAtMs: tlsWatchState.detectedAtMs,
            changedPaths: [...tlsWatchState.changedPaths],
            reason: tlsWatchState.lastError
          },
          tls: {
            rejectUnauthorized: options.upstreamTls.rejectUnauthorized,
            hasCustomCa: options.upstreamTls.ca !== undefined,
            hasClientIdentity:
              options.upstreamTls.cert !== undefined ||
              options.upstreamTls.key !== undefined ||
              options.upstreamTls.pfx !== undefined
          }
        },
        activeConnections: stats.activeConnections,
        peakActiveConnections: stats.peakActiveConnections,
        totalConnections: stats.totalConnections,
        totals: {
          upstreamBytes: stats.upstreamBytes,
          downstreamBytes: stats.downstreamBytes
        }
      })
    );
    return;
  }
  response.writeHead(200, { "content-type": "application/json" });
  response.end(
    JSON.stringify({
      status: "ok",
      statusContractVersion: RELAY_PROXY_STATUS_SCHEMA_VERSION,
      configFingerprint,
      heartbeat: {
        checkedAtMs: Date.now(),
        startedAtMs,
        uptimeMs: Date.now() - startedAtMs,
        ageMs: Date.now() - startedAtMs
      },
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
      statusPath: RELAY_PROXY_STATUS_PATH,
      upstream: {
        url: options.upstreamUrl,
        subprotocols: options.upstreamSubprotocols,
        watchIntervalMs: tlsWatchState.intervalMs,
        rotation: {
          status: tlsWatchState.status,
          enabled: tlsWatchState.enabled,
          intervalMs: tlsWatchState.intervalMs,
          autoRestartOnChange: tlsWatchState.autoRestartOnChange,
          lastCheckedAtMs: tlsWatchState.lastCheckedAtMs,
          detectedAtMs: tlsWatchState.detectedAtMs,
          changedPaths: [...tlsWatchState.changedPaths],
          reason: tlsWatchState.lastError
        }
      }
    })
  );
}
function createUpstreamTlsWatchState(options: Required<RelayProxyOptions>): UpstreamTlsWatchState {
  const intervalMs = normalizeWatchInterval(options.upstreamTlsWatchIntervalMs);
  const sourcePaths = normalizeUpstreamTlsSourcePaths(options.upstreamTlsSourcePaths);
  const sourceMode: UpstreamTlsWatchState["sourceMode"] = sourcePaths.length > 0 ? "file" : "memory";
  const state: UpstreamTlsWatchState = {
    status: intervalMs > 0 ? (sourceMode === "file" ? "monitoring" : "unsupported") : "disabled",
    enabled: intervalMs > 0 && sourceMode === "file",
    intervalMs,
    autoRestartOnChange: options.upstreamTlsRestartOnChange,
    sourcePaths,
    sourceMode,
    baselineFingerprint: intervalMs > 0 ? "" : "disabled",
    lastCheckedAtMs: 0,
    detectedAtMs: null,
    changedPaths: [],
    lastSnapshot: []
  };

  if (!state.enabled) {
    return state;
  }

  try {
    const snapshot = snapshotUpstreamTlsSources(sourcePaths);
    state.lastSnapshot = snapshot;
    state.baselineFingerprint = computeUpstreamTlsFingerprint(snapshot);
    state.lastCheckedAtMs = Date.now();
  } catch (error) {
    state.status = "unavailable";
    state.lastError = String((error as Error).message);
    state.lastCheckedAtMs = Date.now();
    state.baselineFingerprint = "";
  }
  return state;
}
async function updateUpstreamTlsWatchState(state: UpstreamTlsWatchState): Promise<void> {
  if (!state.enabled || state.sourceMode !== "file") return;

  const snapshot = snapshotUpstreamTlsSources(state.sourcePaths);
  const changedPaths = computeChangedTlsMaterialPaths(state.lastSnapshot, snapshot);
  state.lastCheckedAtMs = Date.now();
  state.lastSnapshot = snapshot;

  if (changedPaths.length === 0) {
    if (state.status === "restart_required") {
      return;
    }
    state.status = "monitoring";
    state.changedPaths = [];
    state.lastError = undefined;
    state.detectedAtMs = null;
    state.baselineFingerprint = computeUpstreamTlsFingerprint(snapshot);
    return;
  }

  state.changedPaths = changedPaths;
  state.detectedAtMs = state.detectedAtMs ?? Date.now();
  state.lastError = "Upstream TLS material changed. Restart relay to apply updated certificate material.";
  state.status = "restart_required";
}
function normalizeWatchInterval(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Math.max(RELAY_PROXY_TLS_WATCH_INTERVAL_MIN_MS, Math.floor(value));
}
function normalizeNonNegativeInteger(raw: string | number | undefined, fallback: number): number {
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return fallback;
    return Math.max(0, Math.floor(raw));
  }
  if (typeof raw !== "string") {
    return fallback;
  }
  return parseNonNegativeInteger(raw, fallback);
}
function normalizeBoolean(raw: boolean | string | undefined, fallback: boolean): boolean {
  if (typeof raw === "boolean") {
    return raw;
  }
  if (raw === undefined) {
    return fallback;
  }
  return parseBoolean(raw, fallback);
}
function normalizeUpstreamTlsSourcePaths(sourcePaths?: string[]): string[] {
  if (!sourcePaths || !sourcePaths.length) return [];
  const result: string[] = [];
  const seen = new Set<string>();
  for (const path of sourcePaths) {
    const trimmed = path.trim();
    if (!trimmed) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}
function collectUpstreamTlsSourcePaths(values: ParsedEnv | RelayProxyOptions): string[] {
  if (isParsedEnv(values)) {
    const caSourcePaths = splitCommaList(values.upstreamTlsCaFile);
    const certSourcePath = values.upstreamTlsCertFile ? [values.upstreamTlsCertFile] : [];
    const keySourcePath = values.upstreamTlsKeyFile ? [values.upstreamTlsKeyFile] : [];
    const pfxSourcePath = values.upstreamTlsPfxFile ? [values.upstreamTlsPfxFile] : [];
    return normalizeUpstreamTlsSourcePaths([...caSourcePaths, ...certSourcePath, ...keySourcePath, ...pfxSourcePath]);
  }
  if (Array.isArray(values.upstreamTlsSourcePaths)) {
    return normalizeUpstreamTlsSourcePaths(values.upstreamTlsSourcePaths);
  }
  return [];
}
function snapshotUpstreamTlsSources(sourcePaths: readonly string[]): UpstreamTlsSourceState[] {
  return sourcePaths.map((sourcePath) => {
    const digest = safeReadFileDigest(sourcePath);
    const stats = statSync(sourcePath);
    return {
      path: sourcePath,
      digest,
      mtimeMs: stats.mtimeMs,
      size: stats.size
    };
  });
}
function safeReadFileDigest(path: string): string {
  const material = readFileSync(path);
  return createHash("sha256").update(material).digest("hex");
}
function computeUpstreamTlsFingerprint(sources: readonly UpstreamTlsSourceState[]): string {
  const snapshot = [...sources]
    .sort((left, right) => left.path.localeCompare(right.path))
    .map((source) => ({
      path: source.path,
      digest: source.digest,
      mtimeMs: source.mtimeMs,
      size: source.size
    }));
  return createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
}
function computeChangedTlsMaterialPaths(
  previous: readonly UpstreamTlsSourceState[],
  current: readonly UpstreamTlsSourceState[]
): string[] {
  const previousMap = new Map<string, UpstreamTlsSourceState>();
  for (const source of previous) {
    previousMap.set(source.path, source);
  }
  const changed: string[] = [];
  const currentPaths = new Set(current.map((source) => source.path));
  for (const source of current) {
    const prior = previousMap.get(source.path);
    if (!prior) {
      changed.push(source.path);
      continue;
    }
    if (prior.digest !== source.digest || prior.mtimeMs !== source.mtimeMs || prior.size !== source.size) {
      changed.push(source.path);
    }
  }
  for (const source of previous) {
    if (!currentPaths.has(source.path)) {
      changed.push(source.path);
    }
  }
  return changed;
}
function buildProxyConfigFingerprint(
  options: Required<RelayProxyOptions>,
  tlsWatchState: UpstreamTlsWatchState
): string {
  const normalized = {
    listenHost: options.listenHost,
    listenPort: options.listenPort,
    relayPath: options.relayPath,
    healthPath: options.healthPath,
    upstreamUrl: options.upstreamUrl,
    maxConnections: options.maxConnections,
    upstreamSubprotocols: [...options.upstreamSubprotocols].sort(),
    allowedOrigins: [...options.allowedOrigins].sort(),
    upstreamTls: {
      rejectUnauthorized: options.upstreamTls.rejectUnauthorized,
      hasCustomCa: options.upstreamTls.ca !== undefined,
      hasClientIdentity: options.upstreamTls.cert !== undefined || options.upstreamTls.key !== undefined,
      hasPfx: options.upstreamTls.pfx !== undefined,
      minVersion: options.upstreamTls.minVersion ?? "default",
      maxVersion: options.upstreamTls.maxVersion ?? "default",
      servername: options.upstreamTls.servername ?? "",
      watch: {
        enabled: tlsWatchState.enabled,
        intervalMs: tlsWatchState.intervalMs,
        autoRestartOnChange: tlsWatchState.autoRestartOnChange,
        sourceMode: tlsWatchState.sourceMode,
        sourcePaths: [...tlsWatchState.sourcePaths]
      }
    },
    idleTimeoutMs: options.idleTimeoutMs,
    shutdownTimeoutMs: options.shutdownTimeoutMs
  };
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}
function isParsedEnv(value: ParsedEnv | RelayProxyOptions): value is ParsedEnv {
  return typeof (value as ParsedEnv).upstreamTlsRejectUnauthorized === "string";
}
function parseNonNegativeInteger(value: string, fallback: number): number {
  const trimmed = value.trim();
  if (!/^-?\d+$/.test(trimmed)) {
    return fallback;
  }
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}
function parseBoundedInteger(value: string | undefined, fallback: number, min: number, max: number): number {
  const trimmed = (value ?? "").trim();
  if (!/^-?\d+$/.test(trimmed)) {
    return fallback;
  }
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) return fallback;
  return parsed;
}

function parseBoolean(raw: string, fallback: boolean): boolean {
  const value = raw.trim().toLowerCase();
  if (value === "") return fallback;
  if (value === "1" || value === "true" || value === "yes" || value === "on") return true;
  if (value === "0" || value === "false" || value === "no" || value === "off") return false;
  throw new Error(`invalid boolean value: ${raw}`);
}

function splitCommaList(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) {
    return value.map((entry) => entry.trim()).filter(Boolean);
  }
  if (!value) {
    return [];
  }
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
  if (typeof value === "string") return Buffer.byteLength(value, "utf8");
  if (ArrayBuffer.isView(value)) return value.byteLength;
  if (value instanceof ArrayBuffer) return value.byteLength;
  return 0;
}

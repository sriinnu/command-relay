import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname, normalize, resolve, sep } from "node:path";
import { WebSocketServer } from "ws";
import { envelope } from "../protocol.js";
import { BridgeEngine } from "../bridge/bridge-engine.js";
import { BridgeTelemetryCollector } from "../telemetry/bridge-telemetry.js";
import { SlidingWindowRateLimiter } from "./rate-limiter.js";
import { AuditLogger } from "./audit-log.js";
import { PaneInputOwnershipArbiter, clearClientAttachLag, releaseClientInputOwnership, sendEnvelope as send } from "./bridge-server-utils.js";
import { buildInputPolicyState, isInputAllowed } from "./input-policy.js";
import {
  classifyBridgeCloseFailure,
  classifyBridgeRuntimeFailure
} from "./bridge-runtime-failures.js";
import {
  createInitialBridgeAuthState,
  type BridgeClientAuthState,
  isBridgeAuthRequired,
  resolveBridgeAuthModes
} from "./bridge-auth.js";
import { TrustedDeviceAuthority } from "./trusted-device-authority.js";
import { handleTrustedDeviceHttpRequest } from "./trusted-device-http.js";
import { handleClientMessage, parseIncomingClientMessage } from "./bridge-message-handler.js";

interface ClientState extends BridgeClientAuthState {
  id: string;
  socket: import("ws").WebSocket;
  lastActivityAtMs: number;
  inputEnabled: boolean;
  attachedPanes: Set<string>;
}

interface CachedSessionList {
  createdAtMs: number;
  panes: Array<Record<string, unknown>>;
}

const STATIC_CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

const DEFAULT_MAX_WS_CLIENTS = 128;
const MIN_WS_CLIENTS = 1;
const MAX_WS_CLIENTS = 10_000;
const DEFAULT_WS_IDLE_TIMEOUT_MS = 120_000;
const MIN_WS_IDLE_TIMEOUT_MS = 1_000;
const MAX_WS_IDLE_TIMEOUT_MS = 600_000;

function normalizePositiveInt(
  value: unknown,
  fallback: number,
  min: number,
  max: number
): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

/** Starts the CommandRelay bridge server. @param {object} deps Runtime dependencies. @returns {Promise<{ close: () => Promise<void> }>} Close handle for shutdown. */
export async function startBridgeServer(deps) {
  const { config, tmux } = deps;
  const logger = deps.logger ?? console;
  if (!(await tmux.isAvailable())) {
    throw new Error("runtime backend is unavailable; bridge cannot start");
  }
  const trustedDeviceAuthority = deps.trustedDeviceAuthority ?? (
    config.trustedDeviceAuthEnabled
      ? new TrustedDeviceAuthority({
        pairingTtlMs: config.trustedDevicePairingTtlMs,
        accessTokenTtlMs: config.trustedDeviceAccessTokenTtlMs,
        refreshTokenTtlMs: config.trustedDeviceRefreshTokenTtlMs
      })
      : null
  );
  const startupTs = Date.now();
  const audit = new AuditLogger({ path: config.auditLogPath, logger });
  const telemetry = new BridgeTelemetryCollector();
  const pendingAttachLag = new Map<string, number>();
  const inputOwnershipArbiter = new PaneInputOwnershipArbiter({ leaseDurationMs: config.inputLaneLeaseMs });
  /** @type {Map<string, ClientState>} */
  const clients = new Map();
  const messageLimiter = new SlidingWindowRateLimiter({ maxEvents: config.maxMessagesPerMinute, windowMs: 60_000 });
  const inputLimiter = new SlidingWindowRateLimiter({ maxEvents: config.maxInputsPerMinute, windowMs: 60_000 });
  const maxConnectedClients = normalizePositiveInt(
    config.maxWsClients ?? process.env.COMMANDRELAY_WS_MAX_CLIENTS,
    DEFAULT_MAX_WS_CLIENTS,
    MIN_WS_CLIENTS,
    MAX_WS_CLIENTS
  );
  const wsIdleTimeoutMs = normalizePositiveInt(
    config.wsIdleTimeoutMs ?? process.env.COMMANDRELAY_WS_IDLE_TIMEOUT_MS,
    DEFAULT_WS_IDLE_TIMEOUT_MS,
    MIN_WS_IDLE_TIMEOUT_MS,
    MAX_WS_IDLE_TIMEOUT_MS
  );
  const wsIdleSweepIntervalMs = Math.max(1_000, Math.min(30_000, Math.floor(wsIdleTimeoutMs / 2)));
  const listSessionsCacheMs = 75;
  const sessionListCache: {
    current: CachedSessionList | null;
    inFlight: Promise<Array<Record<string, unknown>>> | null;
  } = {
    current: null,
    inFlight: null
  };
  const engine = new BridgeEngine({
    tmux,
    replayLines: config.replayLines,
    pollIntervalMs: config.pollIntervalMs,
    maxHistoryEvents: config.maxHistoryEvents,
    onOutput: (clientId, event) => {
      const client = clients.get(clientId);
      if (!client) return;
      const lagKey = `${clientId}:${event.paneId}`;
      const lagStart = pendingAttachLag.get(lagKey);
      if (lagStart !== undefined) {
        telemetry.recordStreamLag(Date.now() - lagStart);
        pendingAttachLag.delete(lagKey);
      }
      send(client.socket, envelope("output", event as unknown as Record<string, unknown>));
    },
    onError: (clientId, paneId, error) => {
      const client = clients.get(clientId);
      if (!client) return;
      const lagKey = `${clientId}:${paneId}`;
      pendingAttachLag.delete(lagKey);
      send(client.socket, envelope("error", {
        code: "pane_poll_failed",
        paneId,
        message: error instanceof Error ? error.message : String(error)
      }));
    }
  });
  const appStaticEnabled = config.appStaticEnabled ?? true;
  const appStaticRoot = resolve(config.appStaticDir ?? "apps/web");
  const httpServer = createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      const telemetrySnapshot = telemetry.getSafeSnapshot(clients.size);
      const payload = {
        status: telemetrySnapshot.status.overall,
        uptimeMs: Date.now() - startupTs,
        clients: clients.size,
        panesAttached: Array.from(clients.values()).reduce((sum, client) => sum + client.attachedPanes.size, 0),
        transportMode: config.transportMode,
        runtimeBackends: config.runtimeBackends,
        globalInputDisabled: config.globalInputDisabled,
        engine: engine.getStats(),
        telemetry: telemetrySnapshot,
        timestamp: Date.now()
      };
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(payload));
      return;
    }
    if (await handleTrustedDeviceHttpRequest(req, res, { config, authority: trustedDeviceAuthority })) {
      return;
    }
    if (appStaticEnabled && req.method === "GET" && req.url) {
      const requestPath = req.url.split("?")[0] ?? "";
      if (requestPath === "/" || requestPath === "/app") { res.writeHead(308, { location: "/app/" }); return void res.end(); }
      if (requestPath === "/app/" || requestPath.startsWith("/app/")) {
        const rawRelativePath = requestPath === "/app/" ? "index.html" : requestPath.slice(5);
        try {
          const safeRelativePath = normalize(decodeURIComponent(rawRelativePath)).replace(/^([/\\])+/, "");
          const targetPath = resolve(appStaticRoot, safeRelativePath);
          if (
            !safeRelativePath ||
            safeRelativePath.startsWith("..") ||
            (targetPath !== appStaticRoot && !targetPath.startsWith(`${appStaticRoot}${sep}`))
          ) {
            throw new Error("forbidden_path");
          }
          let filePath = targetPath;
          let body: Buffer;
          try {
            body = await readFile(filePath);
          } catch {
            filePath = resolve(filePath, "index.html");
            body = await readFile(filePath);
          }
          const extension = extname(filePath).toLowerCase();
          res.writeHead(200, {
            "content-type": STATIC_CONTENT_TYPES[extension] ?? "application/octet-stream",
            "cache-control": extension === ".html" ? "no-cache" : "public, max-age=3600",
            "x-content-type-options": "nosniff"
          });
          res.end(body);
          return;
        } catch {
          res.writeHead(404, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "not_found" }));
          return;
        }
      }
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not_found" }));
  });
  const wsServer = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });
  const idleSweepTimer = setInterval(() => {
    const now = Date.now();
    for (const client of clients.values()) {
      if (client.socket.readyState !== client.socket.OPEN) {
        continue;
      }
      if (now - client.lastActivityAtMs < wsIdleTimeoutMs) {
        continue;
      }
      try {
        client.socket.close(3001, "idle_timeout");
      } catch {
        client.socket.terminate?.();
      }
    }
  }, wsIdleSweepIntervalMs);
  idleSweepTimer.unref?.();

  const listRuntimePanes = async (): Promise<Array<Record<string, unknown>>> => {
    const nowMs = Date.now();
    if (sessionListCache.current && nowMs - sessionListCache.current.createdAtMs <= listSessionsCacheMs) {
      return sessionListCache.current.panes;
    }

    if (sessionListCache.inFlight) {
      return sessionListCache.inFlight;
    }

    const flight = (async () => {
      const panes = await tmux.listPanes();
      sessionListCache.current = { createdAtMs: Date.now(), panes };
      return panes;
    })();

    sessionListCache.inFlight = flight;
    try {
      return await flight;
    } finally {
      if (sessionListCache.inFlight === flight) {
        sessionListCache.inFlight = null;
      }
    }
  };

  httpServer.on("upgrade", (req, socket, head) => {
    if (req.url !== "/ws") {
      socket.destroy();
      return;
    }
    if (clients.size >= maxConnectedClients) {
      const body = JSON.stringify({ error: "too_many_connections" });
      const response = [
        "HTTP/1.1 503 Service Unavailable",
        "connection: close",
        "content-type: application/json",
        `content-length: ${Buffer.byteLength(body)}`,
        "",
        body
      ].join("\r\n");
      socket.write(response);
      socket.destroy();
      return;
    }
    wsServer.handleUpgrade(req, socket, head, (ws) => {
      wsServer.emit("connection", ws);
    });
  });
  wsServer.on("connection", (socket) => {
    if (clients.size >= maxConnectedClients) {
      socket.close(1013, "too many websocket connections");
      return;
    }
    const connectStartedAtMs = Date.now();
    const client: ClientState = {
      id: randomUUID(),
      socket,
      lastActivityAtMs: connectStartedAtMs,
      inputEnabled: false,
      attachedPanes: new Set(),
      ...createInitialBridgeAuthState(config)
    };
    clients.set(client.id, client);
    void audit.write({
      action: "connect",
      clientId: client.id,
      details: {
        result: "allowed",
        reason: "socket_open",
        requiresAuth: isBridgeAuthRequired(config),
        inputEnabled: false,
        globalInputDisabled: config.globalInputDisabled
      }
    });
    send(
      socket,
      envelope("hello", {
        clientId: client.id,
        requiresAuth: isBridgeAuthRequired(config),
        authModes: resolveBridgeAuthModes(config),
        ...(client.authChallenge ? { authChallenge: client.authChallenge } : {}),
        ...buildInputPolicyState({
          clientInputEnabled: false,
          globalInputDisabled: config.globalInputDisabled
        }),
        maxInputBytes: config.maxInputBytes,
        maxAttachedPanes: config.maxAttachedPanes
      })
    );
    telemetry.recordConnectLatency(Date.now() - connectStartedAtMs);
    socket.on("message", async (raw) => {
      client.lastActivityAtMs = Date.now();
      const requestStartedAtMs = Date.now();
      const messageRate = messageLimiter.consume(client.id); if (!messageRate.allowed) {
        send(client.socket, envelope("error", { code: "rate_limited", retryAfterMs: messageRate.retryAfterMs, limit: messageRate.limit, windowMs: messageRate.windowMs }));
        return;
      }
      const parsed = parseIncomingClientMessage(raw.toString(), config.strictProtocolParsing);
      if (parsed.ok === false) {
        send(client.socket, envelope("error", { code: parsed.error }));
        return;
      }
      const { type, payload, requestId } = parsed.message;
      try {
        await handleClientMessage({
          client,
          tmux,
          engine,
          config,
          inputLimiter,
          type,
          payload,
          requestId,
          audit,
          telemetry,
          requestStartedAtMs,
          inputOwnershipArbiter,
          trustedDeviceAuthority,
          allowInputOwnershipOverride: config.allowInputOwnershipOverride ?? true,
          listPanes: listRuntimePanes,
          trackAttachLag: (clientId, paneId, startedAtMs) => {
            const lagKey = `${clientId}:${paneId}`;
            pendingAttachLag.set(lagKey, startedAtMs);
          }
        });
      } catch (error) {
        const runtimeFailure = classifyBridgeRuntimeFailure(error);
        await audit.write({ action: "runtime_failure", clientId: client.id, details: { code: runtimeFailure.code, reason: runtimeFailure.reason, recoverable: runtimeFailure.recoverable } });
        send(client.socket, envelope("error", {
          code: runtimeFailure.code,
          reason: runtimeFailure.reason,
          recoverable: runtimeFailure.recoverable,
          message: runtimeFailure.message
        }, requestId));
      }
    });
    socket.on("close", (code, reasonBuffer) => {
      engine.detachAll(client.id);
      messageLimiter.clear(client.id);
      inputLimiter.clear(client.id);
      const releasedPanes = releaseClientInputOwnership(inputOwnershipArbiter, client.id);
      if (releasedPanes > 0) void audit.write({ action: "lane_owner_released", clientId: client.id, details: { result: "allowed", reason: "socket_close", releasedPanes } });
      const closeReason = reasonBuffer.toString("utf8");
      const closeFailure = classifyBridgeCloseFailure(code, closeReason);
      void audit.write({
        action: "transport_drop",
        clientId: client.id,
        details: {
          code,
          reason: closeReason || "socket_closed",
          closeFailureCode: closeFailure.code,
          closeFailureRecoverable: closeFailure.recoverable,
          closeFailureReason: closeFailure.reason,
          releasedPanes
        }
      });
      telemetry.recordConnectionClosed();
      clearClientAttachLag(pendingAttachLag, client.id);
      clients.delete(client.id);
    });
  });
  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(config.port, config.host, () => resolve());
  });
  logger.info(`[bridge] listening on http://${config.host}:${config.port} (ws path: /ws)`);
  return {
    close: async () => {
      engine.close();
      clearInterval(idleSweepTimer);
      for (const client of clients.values()) {
        try {
          client.socket.close();
        } catch {}
      }
      await new Promise<void>((resolve) => {
        wsServer.close(() => resolve());
      });
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    }
  };
}
export { handleClientMessage, parseIncomingClientMessage } from "./bridge-message-handler.js";

/**
 * @file HTTP/WebSocket bridge server for CommandRelay.
 */

import { createServer } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { WebSocketServer } from "ws";
import { envelope, parseMessage } from "../protocol.js";
import { BridgeEngine } from "../bridge/bridge-engine.js";
import { BridgeTelemetryCollector } from "../telemetry/bridge-telemetry.js";
import { SlidingWindowRateLimiter } from "./rate-limiter.js";
import { AuditLogger } from "./audit-log.js";
import { parseNonEmptyString, parseOptionalInt } from "./message-validation.js";
import { groupSessionsByName, sendEnvelope as send, tokenEquals } from "./bridge-server-utils.js";
import { buildInputPolicyState, isInputAllowed } from "./input-policy.js";

/**
 * @typedef {object} ClientState
 * @property {string} id Client identifier.
 * @property {import("ws").WebSocket} socket Client WebSocket instance.
 * @property {boolean} authenticated Whether auth is satisfied.
 * @property {boolean} inputEnabled Whether remote input is enabled.
 * @property {Set<string>} attachedPanes Subscribed tmux panes.
 */

/**
 * Starts the CommandRelay bridge server.
 *
 * @param {object} deps Runtime dependencies.
 * @returns {Promise<{ close: () => Promise<void> }>} Close handle for shutdown.
 */
export async function startBridgeServer(deps) {
  const { config, tmux } = deps;
  const logger = deps.logger ?? console;

  if (!(await tmux.isAvailable())) {
    throw new Error("tmux not available in PATH; bridge cannot start");
  }

  const startupTs = Date.now();
  const audit = new AuditLogger({ path: config.auditLogPath, logger });
  const telemetry = new BridgeTelemetryCollector();
  const pendingAttachLag = new Map<string, number>();

  /** @type {Map<string, ClientState>} */
  const clients = new Map();

  const messageLimiter = new SlidingWindowRateLimiter({
    maxEvents: config.maxMessagesPerMinute,
    windowMs: 60_000
  });
  const inputLimiter = new SlidingWindowRateLimiter({
    maxEvents: config.maxInputsPerMinute,
    windowMs: 60_000
  });

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
      pendingAttachLag.delete(`${clientId}:${paneId}`);
      send(client.socket, envelope("error", {
        code: "pane_poll_failed",
        paneId,
        message: error instanceof Error ? error.message : String(error)
      }));
    }
  });

  const httpServer = createServer((req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      const payload = {
        status: "ok",
        uptimeMs: Date.now() - startupTs,
        clients: clients.size,
        panesAttached: Array.from(clients.values()).reduce(
          (sum, client) => sum + client.attachedPanes.size,
          0
        ),
        engine: engine.getStats(),
        telemetry: telemetry.getSafeSnapshot(clients.size),
        timestamp: Date.now()
      };
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(payload));
      return;
    }

    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not_found" }));
  });

  const wsServer = new WebSocketServer({
    noServer: true,
    maxPayload: 256 * 1024
  });

  httpServer.on("upgrade", (req, socket, head) => {
    if (req.url !== "/ws") {
      socket.destroy();
      return;
    }

    wsServer.handleUpgrade(req, socket, head, (ws) => {
      wsServer.emit("connection", ws);
    });
  });

  wsServer.on("connection", (socket) => {
    const connectStartedAtMs = Date.now();
    const client = {
      id: randomUUID(),
      socket,
      authenticated: config.authToken ? false : true,
      inputEnabled: false,
      attachedPanes: new Set()
    };

    clients.set(client.id, client);

    send(
      socket,
      envelope("hello", {
        clientId: client.id,
        requiresAuth: Boolean(config.authToken),
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
      const requestStartedAtMs = Date.now();
      if (!messageLimiter.allow(client.id)) {
        send(client.socket, envelope("error", { code: "rate_limited" }));
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
          trackAttachLag: (clientId, paneId, startedAtMs) => {
            pendingAttachLag.set(`${clientId}:${paneId}`, startedAtMs);
          }
        });
      } catch (error) {
        send(client.socket, envelope("error", {
          code: "handler_failed",
          message: error instanceof Error ? error.message : String(error)
        }, requestId));
      }
    });

    socket.on("close", () => {
      engine.detachAll(client.id);
      messageLimiter.clear(client.id);
      inputLimiter.clear(client.id);
      telemetry.recordConnectionClosed();
      for (const key of pendingAttachLag.keys()) {
        if (key.startsWith(`${client.id}:`)) {
          pendingAttachLag.delete(key);
        }
      }
      clients.delete(client.id);
    });
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(config.port, config.host, () => resolve());
  });

  logger.info(
    `[bridge] listening on http://${config.host}:${config.port} (ws path: /ws)`
  );

  return {
    close: async () => {
      for (const client of clients.values()) {
        try {
          client.socket.close();
        } catch {
          // Ignore close race during shutdown.
        }
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

/**
 * Parses an incoming client websocket frame using configured protocol strictness.
 *
 * @param {string} raw UTF-8 JSON message text.
 * @param {boolean} strictProtocolParsing Whether strict v1 validation is enabled.
 * @returns {import("../protocol.js").ParseMessageResult} Parse result.
 */
export function parseIncomingClientMessage(raw, strictProtocolParsing) {
  return parseMessage(raw, strictProtocolParsing ? { strictV1: true } : undefined);
}

/**
 * Handles a single parsed client message.
 *
 * @param {object} ctx Message context.
 * @returns {Promise<void>} Completion signal.
 */
export async function handleClientMessage(ctx) {
  const {
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
    trackAttachLag
  } = ctx;
  const startedAtMs = requestStartedAtMs ?? Date.now();

  if (!client.authenticated && type !== "auth") {
    send(client.socket, envelope("error", { code: "auth_required" }, requestId));
    return;
  }

  switch (type) {
    case "auth": {
      if (!config.authToken) {
        client.authenticated = true;
        await audit.write({ action: "auth_ok", clientId: client.id, details: { mode: "open" } });
        send(client.socket, envelope("auth_ok", { mode: "open" }, requestId));
        return;
      }

      const token = parseNonEmptyString(payload.token) ?? "";
      if (!tokenEquals(config.authToken, token)) {
        await audit.write({ action: "auth_fail", clientId: client.id, details: { reason: "invalid_token" } });
        send(client.socket, envelope("auth_error", { code: "invalid_token" }, requestId));
        return;
      }

      client.authenticated = true;
      await audit.write({ action: "auth_ok", clientId: client.id, details: { mode: "token" } });
      send(client.socket, envelope("auth_ok", { mode: "token" }, requestId));
      return;
    }

    case "list_sessions": {
      const panes = await tmux.listPanes();
      const sessions = groupSessionsByName(panes);
      telemetry?.recordListLatency(Date.now() - startedAtMs);
      send(client.socket, envelope("session_list", { panes, sessions }, requestId));
      return;
    }

    case "attach": {
      const paneId = parseNonEmptyString(payload.paneId);
      if (!paneId) {
        send(client.socket, envelope("error", { code: "invalid_pane_id" }, requestId));
        return;
      }
      if (!client.attachedPanes.has(paneId) && client.attachedPanes.size >= config.maxAttachedPanes) {
        send(client.socket, envelope("error", { code: "max_attached_panes_exceeded" }, requestId));
        return;
      }
      const lastSeq = parseOptionalInt(payload.lastSeq);
      client.attachedPanes.add(paneId);
      trackAttachLag?.(client.id, paneId, startedAtMs);
      await engine.attach(client.id, paneId, lastSeq);
      await audit.write({ action: "attach", clientId: client.id, details: { paneId, lastSeq } });
      const attachLatencyMs = Date.now() - startedAtMs;
      telemetry?.recordAttachLatency(attachLatencyMs);
      if (lastSeq !== null) {
        telemetry?.recordReconnectLatency(attachLatencyMs);
      }
      send(client.socket, envelope("ack", { action: "attach", paneId }, requestId));
      return;
    }

    case "detach": {
      const paneId = parseNonEmptyString(payload.paneId);
      if (!paneId) {
        send(client.socket, envelope("error", { code: "invalid_pane_id" }, requestId));
        return;
      }
      client.attachedPanes.delete(paneId);
      engine.detach(client.id, paneId);
      await audit.write({ action: "detach", clientId: client.id, details: { paneId } });
      send(client.socket, envelope("ack", { action: "detach", paneId }, requestId));
      return;
    }

    case "enable_input": {
      const nextInputEnabled = !config.globalInputDisabled;
      client.inputEnabled = nextInputEnabled;
      await audit.write({
        action: nextInputEnabled ? "enable_input" : "enable_input_blocked",
        clientId: client.id,
        details: nextInputEnabled ? {} : { reason: "global_input_kill_switch" }
      });
      send(
        client.socket,
        envelope(
          "policy_update",
          buildInputPolicyState({
            clientInputEnabled: client.inputEnabled,
            globalInputDisabled: config.globalInputDisabled
          }) as unknown as Record<string, unknown>,
          requestId
        )
      );
      return;
    }

    case "disable_input": {
      client.inputEnabled = false;
      await audit.write({ action: "disable_input", clientId: client.id, details: {} });
      send(
        client.socket,
        envelope(
          "policy_update",
          buildInputPolicyState({
            clientInputEnabled: client.inputEnabled,
            globalInputDisabled: config.globalInputDisabled
          }) as unknown as Record<string, unknown>,
          requestId
        )
      );
      return;
    }

    case "input": {
      if (!inputLimiter.allow(client.id)) {
        send(client.socket, envelope("error", { code: "input_rate_limited" }, requestId));
        return;
      }
      if (
        !isInputAllowed({
          clientInputEnabled: client.inputEnabled,
          globalInputDisabled: config.globalInputDisabled
        })
      ) {
        send(client.socket, envelope("error", { code: "input_disabled" }, requestId));
        return;
      }

      const paneId = parseNonEmptyString(payload.paneId);
      const data = typeof payload.data === "string" ? payload.data : "";
      if (!paneId || !data) {
        send(client.socket, envelope("error", { code: "invalid_input" }, requestId));
        return;
      }
      if (!client.attachedPanes.has(paneId)) {
        send(client.socket, envelope("error", { code: "pane_not_attached" }, requestId));
        return;
      }
      if (Buffer.byteLength(data, "utf8") > config.maxInputBytes) {
        send(client.socket, envelope("error", { code: "input_too_large" }, requestId));
        return;
      }

      await tmux.sendInput(paneId, data);
      await audit.write({
        action: "input",
        clientId: client.id,
        details: {
          paneId,
          bytes: Buffer.byteLength(data, "utf8"),
          sha256: createHash("sha256").update(data).digest("hex")
        }
      });
      telemetry?.recordInputAckLatency(Date.now() - startedAtMs);
      send(client.socket, envelope("ack", { action: "input", paneId, bytes: data.length }, requestId));
      return;
    }

    case "heartbeat": {
      send(client.socket, envelope("heartbeat_ack", { clientId: client.id }, requestId));
      return;
    }

    case "disconnect": {
      engine.detachAll(client.id);
      client.attachedPanes.clear();
      client.inputEnabled = false;
      await audit.write({ action: "disconnect", clientId: client.id, details: {} });
      send(client.socket, envelope("ack", { action: "disconnect" }, requestId));
      return;
    }

    default:
      send(client.socket, envelope("error", { code: "unknown_type", type }, requestId));
  }
}

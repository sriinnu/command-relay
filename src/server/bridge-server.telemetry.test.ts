/**
 * @file Telemetry collector and /health integration tests for bridge server.
 */

import assert from "node:assert/strict";
import { createServer as createNetServer } from "node:net";
import test from "node:test";
import WebSocket from "ws";
import { BridgeTelemetryCollector, type BridgeTelemetrySnapshot } from "../telemetry/bridge-telemetry.js";
import { startBridgeServer } from "./bridge-server.js";

interface Envelope {
  type: string;
  requestId?: string;
  payload: Record<string, unknown>;
}

interface WsProbe {
  socket: WebSocket;
  sendRequest: (type: string, requestId: string, payload: Record<string, unknown>) => void;
  next: (predicate: (message: Envelope) => boolean, timeoutMs?: number) => Promise<Envelope>;
}

const HOST = "127.0.0.1";
const DEFAULT_TIMEOUT_MS = 3_000;

/**
 * Waits for a short duration.
 *
 * @param ms Sleep duration in milliseconds.
 * @returns Promise that resolves after the delay.
 */
async function sleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Reserves a free loopback TCP port.
 *
 * @returns Available port number.
 */
async function reservePort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = createNetServer();
    server.once("error", reject);
    server.listen(0, HOST, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("failed to resolve reserved port")));
        return;
      }
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(address.port);
      });
    });
  });
}

/**
 * Checks whether this runtime can bind loopback TCP ports for e2e tests.
 *
 * @returns True when loopback bind/listen is available.
 */
async function canBindLoopback(): Promise<boolean> {
  try {
    return (await reservePort()) > 0;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error) {
      if (String((error as { code?: unknown }).code) === "EPERM") {
        return false;
      }
    }
    throw error;
  }
}

/**
 * Creates a fake tmux adapter with deterministic pane capture output.
 *
 * @returns Fake tmux implementation.
 */
function createFakeTmux() {
  let captureCalls = 0;
  return {
    isAvailable: async () => true,
    listPanes: async () => [{ sessionName: "main", windowName: "editor", paneId: "%1", paneIndex: 0 }],
    sendInput: async () => undefined,
    capturePane: async () => {
      captureCalls += 1;
      return captureCalls === 1 ? "ready\n" : "ready\nok\n";
    }
  };
}

/**
 * Connects a websocket probe and records inbound envelopes.
 *
 * @param url WebSocket URL.
 * @returns Connected probe utilities.
 */
async function createWsProbe(url: string): Promise<WsProbe> {
  const socket = new WebSocket(url);
  const queue: Envelope[] = [];
  socket.on("message", (rawData) => {
    const raw = typeof rawData === "string" ? rawData : rawData.toString();
    queue.push(JSON.parse(raw) as Envelope);
  });

  await new Promise<void>((resolve, reject) => {
    const onOpen = () => {
      cleanup();
      resolve();
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      socket.off("open", onOpen);
      socket.off("error", onError);
    };
    socket.on("open", onOpen);
    socket.on("error", onError);
  });

  return {
    socket,
    sendRequest: (type, requestId, payload) => {
      socket.send(JSON.stringify({ v: 1, type, requestId, timestamp: Date.now(), payload }));
    },
    next: async (predicate, timeoutMs = DEFAULT_TIMEOUT_MS) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const index = queue.findIndex(predicate);
        if (index >= 0) {
          const [message] = queue.splice(index, 1);
          if (message) {
            return message;
          }
        }
        await sleep(10);
      }
      throw new Error(`timed out waiting for websocket event after ${timeoutMs}ms`);
    }
  };
}

/**
 * Closes a websocket probe safely.
 *
 * @param socket Probe socket.
 * @returns Resolves after socket closes.
 */
async function closeWs(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.CLOSED) {
    return;
  }
  await new Promise<void>((resolve) => {
    const onClose = () => {
      cleanup();
      resolve();
    };
    const timeout = setTimeout(() => {
      cleanup();
      resolve();
    }, 750);
    const cleanup = () => {
      clearTimeout(timeout);
      socket.off("close", onClose);
    };
    socket.on("close", onClose);
    socket.close();
  });
}

test("BridgeTelemetryCollector emits safe schema with aggregate-only data", () => {
  const collector = new BridgeTelemetryCollector(8);
  collector.recordConnectLatency(12);
  collector.recordListLatency(10);
  collector.recordAttachLatency(8);
  collector.recordReconnectLatency(6);
  collector.recordInputAckLatency(4);
  collector.recordStreamLag(5);
  collector.recordConnectionClosed();

  const snapshot = collector.getSafeSnapshot(1);
  assert.equal(snapshot.schema, "bridge.telemetry.v1");
  assert.equal(snapshot.windowSize, 8);
  assert.equal(snapshot.activeClients, 1);
  assert.equal(snapshot.counters.connectionsOpened, 1);
  assert.equal(snapshot.counters.connectionsClosed, 1);
  assert.equal(snapshot.latenciesMs.connect.count, 1);
  assert.equal(snapshot.latenciesMs.reconnect.count, 1);
  assert.equal(snapshot.latenciesMs.streamLag.count, 1);
  assert.equal(JSON.stringify(snapshot).includes("paneId"), false);
  assert.equal(JSON.stringify(snapshot).includes("clientId"), false);
});

test("health endpoint publishes telemetry counters/latencies for connect/reconnect/list/attach/input/lag", async (t) => {
  if (!(await canBindLoopback())) {
    t.skip("loopback bind not permitted in this runtime");
    return;
  }

  const port = await reservePort();
  const runtime = await startBridgeServer({
    config: {
      host: HOST,
      port,
      strictProtocolParsing: true,
      pollIntervalMs: 10_000,
      replayLines: 200,
      maxHistoryEvents: 100,
      maxInputBytes: 512,
      maxAttachedPanes: 4,
      maxMessagesPerMinute: 1_000,
      maxInputsPerMinute: 1_000,
      globalInputDisabled: false,
      authToken: null,
      auditLogPath: null
    },
    tmux: createFakeTmux(),
    logger: { info: () => {}, warn: () => {}, error: () => {} }
  });

  const first = await createWsProbe(`ws://${HOST}:${port}/ws`);
  const second = await createWsProbe(`ws://${HOST}:${port}/ws`);

  try {
    await first.next((message) => message.type === "hello");
    await second.next((message) => message.type === "hello");

    first.sendRequest("list_sessions", "list-1", {});
    await first.next((message) => message.type === "session_list" && message.requestId === "list-1");

    first.sendRequest("attach", "attach-1", { paneId: "%1" });
    await first.next((message) => message.type === "output");
    await first.next((message) => message.type === "ack" && message.requestId === "attach-1");

    first.sendRequest("enable_input", "enable-1", {});
    await first.next((message) => message.type === "policy_update" && message.requestId === "enable-1");

    first.sendRequest("input", "input-1", { paneId: "%1", data: "echo ok\n" });
    await first.next((message) => message.type === "ack" && message.requestId === "input-1");

    second.sendRequest("attach", "attach-2", { paneId: "%1", lastSeq: 1 });
    await second.next((message) => message.type === "output");
    await second.next((message) => message.type === "ack" && message.requestId === "attach-2");

    const healthResponse = await fetch(`http://${HOST}:${port}/health`);
    assert.equal(healthResponse.status, 200);
    const health = await healthResponse.json() as { telemetry: BridgeTelemetrySnapshot };

    assert.equal(health.telemetry.schema, "bridge.telemetry.v1");
    assert.equal(health.telemetry.activeClients, 2);
    assert.ok(health.telemetry.counters.connectionsOpened >= 2);
    assert.ok(health.telemetry.counters.listRequests >= 1);
    assert.ok(health.telemetry.counters.attachRequests >= 2);
    assert.ok(health.telemetry.counters.reconnectAttaches >= 1);
    assert.ok(health.telemetry.counters.inputAcks >= 1);
    assert.ok(health.telemetry.counters.streamLagSamples >= 2);

    assert.ok(health.telemetry.latenciesMs.connect.count >= 2);
    assert.ok(health.telemetry.latenciesMs.list.count >= 1);
    assert.ok(health.telemetry.latenciesMs.attach.count >= 2);
    assert.ok(health.telemetry.latenciesMs.reconnect.count >= 1);
    assert.ok(health.telemetry.latenciesMs.inputAck.count >= 1);
    assert.ok(health.telemetry.latenciesMs.streamLag.count >= 2);

    const telemetryText = JSON.stringify(health.telemetry);
    assert.equal(telemetryText.includes("paneId"), false);
    assert.equal(telemetryText.includes("clientId"), false);
    assert.equal(telemetryText.includes("%1"), false);
  } finally {
    await closeWs(second.socket);
    await closeWs(first.socket);
    await runtime.close();
  }
});

/**
 * @file End-to-end coverage for bridge websocket connection guardrails.
 */

import assert from "node:assert/strict";
import { createServer as createNetServer } from "node:net";
import test from "node:test";
import WebSocket from "ws";
import { startBridgeServer } from "./bridge-server.js";

interface Envelope {
  type: string;
  requestId?: string;
  payload: Record<string, unknown>;
}

const HOST = "127.0.0.1";

async function sleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

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
        if (error) reject(error);
        else resolve(address.port);
      });
    });
  });
}

async function canBindLoopback(): Promise<boolean> {
  try {
    return (await reservePort()) > 0;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && String((error as { code?: unknown }).code) === "EPERM") {
      return false;
    }
    throw error;
  }
}

async function createWsProbe(url: string): Promise<{
  socket: WebSocket;
  sendRequest: (type: string, requestId: string, payload: Record<string, unknown>) => void;
  next: (predicate: (message: Envelope) => boolean, timeoutMs?: number) => Promise<Envelope>;
}> {
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
    next: async (predicate, timeoutMs = 2_500) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const index = queue.findIndex(predicate);
        if (index >= 0) {
          return queue.splice(index, 1)[0] as Envelope;
        }
        await sleep(10);
      }
      throw new Error(`timed out waiting for websocket event after ${timeoutMs}ms`);
    }
  };
}

async function closeWs(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.CLOSED) return;
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, 750);
    socket.once("close", () => {
      clearTimeout(timeout);
      resolve();
    });
    socket.close();
  });
}

function createFakeTmux() {
  return {
    isAvailable: async () => true,
    listPanes: async () => [{ sessionName: "main", windowName: "editor", paneId: "%1", paneIndex: 0 }],
    sendInput: async () => undefined,
    capturePane: async () => "ready\n"
  };
}

test("startBridgeServer rejects websocket upgrades beyond maxWsClients", async (t) => {
  if (!(await canBindLoopback())) return void t.skip("loopback bind not permitted in this runtime");
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
      maxWsClients: 1,
      wsIdleTimeoutMs: 10_000,
      globalInputDisabled: false,
      authToken: null,
      auditLogPath: null
    },
    tmux: createFakeTmux(),
    logger: { info: () => {}, warn: () => {}, error: () => {} }
  });
  const first = await createWsProbe(`ws://${HOST}:${port}/ws`);
  try {
    await first.next((message) => message.type === "hello");
    const rejectedStatus = await new Promise<number>((resolve, reject) => {
      const second = new WebSocket(`ws://${HOST}:${port}/ws`);
      second.on("unexpected-response", (_request, response) => {
        response.resume();
        resolve(response.statusCode ?? 0);
      });
      second.on("open", () => reject(new Error("expected upgrade rejection")));
      second.on("error", () => {});
    });

    assert.equal(rejectedStatus, 503);
  } finally {
    await closeWs(first.socket);
    await runtime.close();
  }
});

test("startBridgeServer closes idle websocket sessions without heartbeats", async (t) => {
  if (!(await canBindLoopback())) return void t.skip("loopback bind not permitted in this runtime");
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
      maxWsClients: 4,
      wsIdleTimeoutMs: 1_000,
      globalInputDisabled: false,
      authToken: null,
      auditLogPath: null
    },
    tmux: createFakeTmux(),
    logger: { info: () => {}, warn: () => {}, error: () => {} }
  });
  const probe = await createWsProbe(`ws://${HOST}:${port}/ws`);
  try {
    await probe.next((message) => message.type === "hello");
    const closed = await new Promise<{ code: number; reason: string }>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("timed out waiting for idle close")), 3_000);
      probe.socket.once("close", (code, reason) => {
        clearTimeout(timeout);
        resolve({ code, reason: reason.toString("utf8") });
      });
    });

    assert.equal(closed.code, 3001);
    assert.equal(closed.reason, "idle_timeout");
  } finally {
    await runtime.close();
  }
});

test("startBridgeServer heartbeat traffic keeps websocket sessions alive", async (t) => {
  if (!(await canBindLoopback())) return void t.skip("loopback bind not permitted in this runtime");
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
      maxWsClients: 4,
      wsIdleTimeoutMs: 1_000,
      globalInputDisabled: false,
      authToken: null,
      auditLogPath: null
    },
    tmux: createFakeTmux(),
    logger: { info: () => {}, warn: () => {}, error: () => {} }
  });
  const probe = await createWsProbe(`ws://${HOST}:${port}/ws`);
  try {
    await probe.next((message) => message.type === "hello");
    const keepAliveUntil = Date.now() + 1_600;
    let heartbeatCount = 0;
    while (Date.now() < keepAliveUntil) {
      const requestId = `heartbeat-${heartbeatCount}`;
      probe.sendRequest("heartbeat", requestId, {});
      const ack = await probe.next((message) => message.type === "heartbeat_ack" && message.requestId === requestId);
      assert.equal(ack.requestId, requestId);
      heartbeatCount += 1;
      await sleep(250);
    }

    assert.equal(probe.socket.readyState, WebSocket.OPEN);
    assert.ok(heartbeatCount >= 4);
  } finally {
    await closeWs(probe.socket);
    await runtime.close();
  }
});

/**
 * @file End-to-end tests for bridge server websocket flows with a real ws client.
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

interface WsProbe {
  socket: WebSocket;
  sendRequest: (type: string, requestId: string, payload: Record<string, unknown>) => void;
  sendRaw: (raw: string) => void;
  next: (predicate: (message: Envelope) => boolean, timeoutMs?: number) => Promise<Envelope>;
}

interface FakeTmux {
  sentInputs: Array<{ paneId: string; input: string }>;
  listPanesCalls: number;
  captureCalls: number;
  isAvailable: () => Promise<boolean>;
  listPanes: () => Promise<Array<Record<string, unknown>>>;
  sendInput: (paneId: string, input: string) => Promise<void>;
  capturePane: (paneId: string, lines: number) => Promise<string>;
}

interface CapturedAuditEvent {
  action: string;
  clientId: string;
  details: Record<string, unknown>;
  ts: number;
}

const HOST = "127.0.0.1";
const DEFAULT_TIMEOUT_MS = 2_500;

async function sleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
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
        if (error) {
          reject(error);
          return;
        }
        resolve(address.port);
      });
    });
  });
}

async function canBindLoopback(): Promise<boolean> {
  try {
    const port = await reservePort();
    return port > 0;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error) {
      if (String((error as { code?: unknown }).code) === "EPERM") {
        return false;
      }
    }
    throw error;
  }
}

function createFakeTmux(): FakeTmux {
  const sentInputs: Array<{ paneId: string; input: string }> = [];

  return {
    sentInputs,
    listPanesCalls: 0,
    captureCalls: 0,
    isAvailable: async () => true,
    listPanes: async () => {
      return [
        {
          sessionName: "main",
          windowName: "editor",
          paneId: "%1",
          paneIndex: 0,
          paneCurrentCommand: "bash"
        }
      ];
    },
    sendInput: async (paneId: string, input: string) => {
      sentInputs.push({ paneId, input });
    },
    capturePane: async () => "ready\n"
  };
}

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
      socket.send(
        JSON.stringify({
          v: 1,
          type,
          requestId,
          timestamp: Date.now(),
          payload
        })
      );
    },
    sendRaw: (raw) => {
      socket.send(raw);
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

test("startBridgeServer e2e covers hello/auth/list/attach/enable-input/input/disable-input flow", async (t) => {
  if (!(await canBindLoopback())) {
    t.skip("loopback bind not permitted in this runtime");
    return;
  }

  const port = await reservePort();
  const tmux = createFakeTmux();
  const auditEvents: CapturedAuditEvent[] = [];
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
      authToken: "token-123",
      auditLogPath: null
    },
    tmux: {
      isAvailable: tmux.isAvailable,
      listPanes: async () => {
        tmux.listPanesCalls += 1;
        return await tmux.listPanes();
      },
      sendInput: tmux.sendInput,
      capturePane: async (paneId: string, lines: number) => {
        tmux.captureCalls += 1;
        return await tmux.capturePane(paneId, lines);
      }
    },
    logger: {
      info: () => {},
      warn: () => {},
      error: () => {},
      audit: (event: CapturedAuditEvent) => {
        auditEvents.push(event);
      }
    }
  });

  const probe = await createWsProbe(`ws://${HOST}:${port}/ws`);
  try {
    const rootRedirect = await fetch(`http://${HOST}:${port}/`, { redirect: "manual" });
    assert.equal(rootRedirect.status, 308);
    assert.equal(rootRedirect.headers.get("location"), "/app/");

    const appRedirect = await fetch(`http://${HOST}:${port}/app`, { redirect: "manual" });
    assert.equal(appRedirect.status, 308);
    assert.equal(appRedirect.headers.get("location"), "/app/");

    const webAppResponse = await fetch(`http://${HOST}:${port}/app/`);
    assert.equal(webAppResponse.status, 200);
    assert.match(webAppResponse.headers.get("content-type") ?? "", /^text\/html\b/i);
    const webAppBody = await webAppResponse.text();
    assert.equal(webAppBody.includes("<body"), true);
    const webAssetResponse = await fetch(`http://${HOST}:${port}/app/app.js`);
    assert.equal(webAssetResponse.status, 200);
    assert.match(webAssetResponse.headers.get("content-type") ?? "", /^text\/javascript\b/i);

    const hello = await probe.next((message) => message.type === "hello");
    assert.equal(typeof hello.payload.clientId, "string");
    assert.equal(hello.payload.requiresAuth, true);
    assert.equal(hello.payload.inputEnabled, false);
    assert.equal(hello.payload.globalInputDisabled, false);

    probe.sendRequest("auth", "auth-1", { token: "token-123" });
    const authOk = await probe.next((message) => message.type === "auth_ok");
    assert.equal(authOk.requestId, "auth-1");
    assert.equal(authOk.payload.mode, "token");

    probe.sendRequest("list_sessions", "list-1", {});
    const sessionList = await probe.next((message) => message.type === "session_list");
    assert.equal(sessionList.requestId, "list-1");
    assert.equal(Array.isArray(sessionList.payload.panes), true);
    assert.deepEqual(sessionList.payload.sessions, [
      {
        sessionName: "main",
        paneIds: ["%1"]
      }
    ]);

    probe.sendRequest("attach", "attach-1", { paneId: "%1" });

    const attachAck = await probe.next(
      (message) => message.type === "ack" && message.payload.action === "attach"
    );
    assert.equal(attachAck.requestId, "attach-1");
    assert.equal(attachAck.payload.paneId, "%1");

    const output = await probe.next((message) => message.type === "output");
    assert.equal(output.payload.paneId, "%1");
    assert.equal(output.payload.mode, "snapshot");
    assert.equal(output.payload.chunk, "ready\n");

    probe.sendRequest("enable_input", "policy-1", {});
    const policyUpdate = await probe.next((message) => message.type === "policy_update");
    assert.equal(policyUpdate.requestId, "policy-1");
    assert.equal(policyUpdate.payload.inputEnabled, true);
    assert.equal(policyUpdate.payload.globalInputDisabled, false);

    const inputPayload = "echo ok\n";
    probe.sendRequest("input", "input-1", { paneId: "%1", data: inputPayload });

    const inputAck = await probe.next(
      (message) => message.type === "ack" && message.payload.action === "input"
    );
    assert.equal(inputAck.requestId, "input-1");
    assert.equal(inputAck.payload.paneId, "%1");
    assert.equal(inputAck.payload.bytes, inputPayload.length);

    probe.sendRequest("disable_input", "policy-2", {});
    const disabledPolicyUpdate = await probe.next(
      (message) => message.type === "policy_update" && message.requestId === "policy-2"
    );
    assert.equal(disabledPolicyUpdate.payload.inputEnabled, false);
    assert.equal(disabledPolicyUpdate.payload.globalInputDisabled, false);

    const policyInputActions = auditEvents
      .filter((event) => event.action === "enable_input" || event.action === "input" || event.action === "disable_input")
      .map((event) => event.action);
    assert.deepEqual(policyInputActions, ["enable_input", "input", "disable_input"]);
    const inputAuditEvent = auditEvents.find((event) => event.action === "input");
    const inputAuditDetails = (inputAuditEvent?.details ?? {}) as Record<string, unknown>;
    assert.equal(inputAuditEvent?.clientId, hello.payload.clientId);
    assert.equal(inputAuditDetails.paneId, "%1");
    assert.equal(inputAuditDetails.bytes, inputPayload.length);
    assert.equal("data" in inputAuditDetails, false);
    assert.equal("input" in inputAuditDetails, false);
    assert.equal(JSON.stringify(inputAuditDetails).includes(inputPayload), false);

    assert.deepEqual(tmux.sentInputs, [{ paneId: "%1", input: inputPayload }]);
    assert.equal(tmux.listPanesCalls, 1);
    assert.equal(tmux.captureCalls, 1);
  } finally {
    await closeWs(probe.socket);
    await runtime.close();
  }
});

test("startBridgeServer e2e rejects strict-protocol-incompatible message type", async (t) => {
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

  const probe = await createWsProbe(`ws://${HOST}:${port}/ws`);
  try {
    await probe.next((message) => message.type === "hello");

    probe.sendRaw(
      JSON.stringify({
        v: 1,
        type: "strict_only_invalid_type",
        requestId: "strict-1",
        timestamp: 1,
        payload: {}
      })
    );

    const rejection = await probe.next((message) => message.type === "error");
    assert.equal(
      rejection.payload.code === "unsupported_type" || rejection.payload.code === "unknown_type",
      true
    );
  } finally {
    await closeWs(probe.socket);
    await runtime.close();
  }
});

test("startBridgeServer e2e arbitrates pane input ownership and releases on detach/disconnect", async (t) => {
  if (!(await canBindLoopback())) return void t.skip("loopback bind not permitted in this runtime");
  const port = await reservePort();
  const tmux = createFakeTmux();
  const runtime = await startBridgeServer({
    config: {
      host: HOST, port, strictProtocolParsing: true, pollIntervalMs: 10_000, replayLines: 200,
      maxHistoryEvents: 100, maxInputBytes: 512, maxAttachedPanes: 4, maxMessagesPerMinute: 1_000,
      maxInputsPerMinute: 1_000, globalInputDisabled: false, authToken: null, auditLogPath: null,
      inputOwnershipEnforced: true, inputOwnershipOverrideEnabled: true, allowInputOwnershipOverride: true
    } as any,
    tmux,
    logger: { info: () => {}, warn: () => {}, error: () => {} }
  });
  const probeA = await createWsProbe(`ws://${HOST}:${port}/ws`);
  const probeB = await createWsProbe(`ws://${HOST}:${port}/ws`);
  const attachAndEnable = async (probe: WsProbe, id: string) => {
    await probe.next((message) => message.type === "hello");
    probe.sendRequest("attach", `${id}-attach`, { paneId: "%1" });
    await probe.next((message) => message.type === "ack" && message.requestId === `${id}-attach`);
    await probe.next((message) => message.type === "output" && message.payload.paneId === "%1");
    probe.sendRequest("enable_input", `${id}-enable`, {});
    await probe.next((message) => message.type === "policy_update" && message.requestId === `${id}-enable`);
  };

  try {
    await attachAndEnable(probeA, "a");
    await attachAndEnable(probeB, "b");
    probeA.sendRequest("input", "a-input-1", { paneId: "%1", data: "echo a1\n" });
    assert.equal((await probeA.next((message) => message.requestId === "a-input-1")).type, "ack");
    probeB.sendRequest("input", "b-input-1", { paneId: "%1", data: "echo b1\n" });
    assert.equal((await probeB.next((message) => message.requestId === "b-input-1")).type, "error");
    probeB.sendRequest("input", "b-input-2", { paneId: "%1", data: "echo b2\n", override: true });
    assert.equal((await probeB.next((message) => message.requestId === "b-input-2")).type, "ack");
    probeB.sendRequest("detach", "b-detach", { paneId: "%1" });
    assert.equal((await probeB.next((message) => message.requestId === "b-detach")).payload.action, "detach");
    probeA.sendRequest("input", "a-input-2", { paneId: "%1", data: "echo a2\n" });
    assert.equal((await probeA.next((message) => message.requestId === "a-input-2")).type, "ack");
    probeA.sendRequest("disconnect", "a-disconnect", {});
    assert.equal((await probeA.next((message) => message.requestId === "a-disconnect")).payload.action, "disconnect");
    probeB.sendRequest("attach", "b-attach-2", { paneId: "%1" });
    await probeB.next((message) => message.type === "ack" && message.requestId === "b-attach-2");
    await probeB.next((message) => message.type === "output" && message.payload.paneId === "%1");
    probeB.sendRequest("input", "b-input-3", { paneId: "%1", data: "echo b3\n" });
    assert.equal((await probeB.next((message) => message.requestId === "b-input-3")).type, "ack");
    assert.deepEqual(tmux.sentInputs.map((entry) => entry.input), ["echo a1\n", "echo b2\n", "echo a2\n", "echo b3\n"]);
  } finally {
    await closeWs(probeA.socket);
    await closeWs(probeB.socket);
    await runtime.close();
  }
});

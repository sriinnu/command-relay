/**
 * @file End-to-end runtime failure-mode coverage for bridge server websocket flows.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { startBridgeServer } from "./bridge-server.js";
import { HOST, canBindLoopback, closeWs, createWsProbe, reservePort } from "./bridge-server.replay.e2e.helpers.js";

interface FakeTmux {
  sentInputs: Array<{ paneId: string; input: string }>;
  isAvailable: () => Promise<boolean>;
  listPanes: () => Promise<Array<Record<string, unknown>>>;
  sendInput: (paneId: string, input: string) => Promise<void>;
  capturePane: (paneId: string, lines: number) => Promise<string>;
}

/**
 * Waits for a short deterministic delay.
 *
 * @param ms Delay duration in milliseconds.
 * @returns Promise that resolves after delay.
 */
async function sleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Creates a fake tmux runtime with deterministic list/capture/input behavior.
 *
 * @param capturePane Capture implementation.
 * @returns Fake tmux adapter.
 */
function createFakeTmux(capturePane: (paneId: string, lines: number) => Promise<string>): FakeTmux {
  const sentInputs: Array<{ paneId: string; input: string }> = [];
  return {
    sentInputs,
    isAvailable: async () => true,
    listPanes: async () => [
      {
        sessionName: "main",
        windowName: "editor",
        paneId: "%1",
        paneIndex: 0,
        paneCurrentCommand: "bash"
      }
    ],
    sendInput: async (paneId: string, input: string) => {
      sentInputs.push({ paneId, input });
    },
    capturePane
  };
}

test("attach returns recoverable runtime_session_unavailable when tmux session is missing", async (t) => {
  if (!(await canBindLoopback())) {
    t.skip("loopback bind not permitted in this runtime");
    return;
  }
  const port = await reservePort();
  const tmux = createFakeTmux(async () => {
    throw new Error("no server running on /tmp/tmux-1000/default");
  });
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
    tmux,
    logger: { info: () => {}, warn: () => {}, error: () => {} }
  });
  const probe = await createWsProbe(`ws://${HOST}:${port}/ws`);
  try {
    await probe.next((message) => message.type === "hello");
    probe.sendRequest("attach", "attach-1", { paneId: "%1" });
    const rejection = await probe.next((message) => message.requestId === "attach-1" && message.type === "error");
    assert.equal(rejection.payload.code, "runtime_session_unavailable");
    assert.equal(rejection.payload.recoverable, true);
    assert.equal(rejection.payload.reason, "tmux_session_unavailable");
    await probe.expectNone((message) => message.requestId === "attach-1" && message.type === "ack", 350);
  } finally {
    await closeWs(probe.socket);
    await runtime.close();
  }
});

test("unexpected transport close releases lane ownership for the next client", async (t) => {
  if (!(await canBindLoopback())) {
    t.skip("loopback bind not permitted in this runtime");
    return;
  }
  const port = await reservePort();
  const tmux = createFakeTmux(async () => "ready\n");
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
      auditLogPath: null,
      inputOwnershipEnforced: true,
      inputOwnershipOverrideEnabled: true,
      allowInputOwnershipOverride: true
    } as const,
    tmux,
    logger: { info: () => {}, warn: () => {}, error: () => {} }
  });
  const probeA = await createWsProbe(`ws://${HOST}:${port}/ws`);
  const probeB = await createWsProbe(`ws://${HOST}:${port}/ws`);

  const attachAndEnable = async (probe: Awaited<ReturnType<typeof createWsProbe>>, id: string) => {
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

    probeA.sendRequest("input", "a-input", { paneId: "%1", data: "echo owner\n" });
    assert.equal((await probeA.next((message) => message.requestId === "a-input")).type, "ack");

    await closeWs(probeA.socket);
    await sleep(120);

    probeB.sendRequest("input", "b-input", { paneId: "%1", data: "echo recovery\n" });
    const recoveredInputAck = await probeB.next((message) => message.requestId === "b-input");
    assert.equal(recoveredInputAck.type, "ack");
    assert.deepEqual(tmux.sentInputs.map((entry) => entry.input), ["echo owner\n", "echo recovery\n"]);
  } finally {
    await closeWs(probeB.socket);
    await runtime.close();
  }
});

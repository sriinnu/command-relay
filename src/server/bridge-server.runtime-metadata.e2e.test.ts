/**
 * @file End-to-end coverage for host-authoritative runtime metadata in session_list.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { startBridgeServer } from "./bridge-server.js";
import {
  HOST,
  canBindLoopback,
  closeWs,
  createWsProbe,
  reservePort,
  type Envelope
} from "./bridge-server.replay.e2e.helpers.js";

interface FakeTmux {
  sentInputs: Array<{ paneId: string; input: string }>;
  isAvailable: () => Promise<boolean>;
  listPanes: () => Promise<Array<Record<string, unknown>>>;
  sendInput: (paneId: string, input: string) => Promise<void>;
  capturePane: (paneId: string, lines: number) => Promise<string>;
}

function createHostMetadataTmux(): FakeTmux {
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
        paneCurrentCommand: "bash",
        laneOwnerClientId: "pane-row-owner",
        replayOffset: 9_999,
        capabilities: {
          laneOwnership: false,
          replayOffset: false,
          inputOwnershipOverride: false
        }
      }
    ],
    sendInput: async (paneId: string, input: string) => {
      sentInputs.push({ paneId, input });
    },
    capturePane: async () => "ready\n"
  };
}

function readStreamSeq(output: Envelope): number {
  const value = output.payload.streamSeq;
  if (typeof value !== "number") {
    throw new Error(`expected numeric streamSeq in output envelope: ${JSON.stringify(output)}`);
  }
  return value;
}

test("list_sessions includes host runtime lane owner replay offset and capability flags", async (t) => {
  if (!(await canBindLoopback())) {
    t.skip("loopback bind not permitted in this runtime");
    return;
  }

  const port = await reservePort();
  const tmux = createHostMetadataTmux();
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
      allowInputOwnershipOverride: true
    } as const,
    tmux,
    logger: { info: () => {}, warn: () => {}, error: () => {} }
  });

  const probe = await createWsProbe(`ws://${HOST}:${port}/ws`);
  try {
    const hello = await probe.next((message) => message.type === "hello");
    const ownerClientId = hello.payload.clientId;
    assert.equal(typeof ownerClientId, "string");

    probe.sendRequest("attach", "attach-1", { paneId: "%1" });
    const outputPromise = probe.next((message) => message.type === "output" && message.payload.paneId === "%1");
    const attachAck = await probe.next((message) => message.type === "ack" && message.requestId === "attach-1");
    const output = await outputPromise;
    assert.equal(attachAck.payload.action, "attach");
    const replayOffset = readStreamSeq(output);

    probe.sendRequest("enable_input", "enable-1", {});
    await probe.next((message) => message.type === "policy_update" && message.requestId === "enable-1");

    probe.sendRequest("input", "input-1", { paneId: "%1", data: "echo owner\n" });
    const inputAck = await probe.next((message) => message.type === "ack" && message.requestId === "input-1");
    assert.equal(inputAck.payload.action, "input");
    assert.deepEqual(tmux.sentInputs, [{ paneId: "%1", input: "echo owner\n" }]);

    probe.sendRequest("list_sessions", "list-runtime-1", {});
    const sessionList = await probe.next(
      (message) => message.type === "session_list" && message.requestId === "list-runtime-1"
    );

    const runtimeMetadata = sessionList.payload.runtime as Record<string, unknown>;
    assert.equal(runtimeMetadata.source, "host");
    assert.equal(typeof runtimeMetadata.generatedAt, "number");
    assert.deepEqual(runtimeMetadata.capabilities, {
      laneOwnership: true,
      replayOffset: true,
      inputOwnershipOverride: true
    });

    const paneRuntimeEntries = Array.isArray(runtimeMetadata.panes)
      ? runtimeMetadata.panes as Array<Record<string, unknown>>
      : [];
    const paneRuntime = paneRuntimeEntries.find((entry) => entry.paneId === "%1");
    assert.ok(paneRuntime);
    assert.equal(paneRuntime?.laneOwnerClientId, ownerClientId);
    assert.equal(paneRuntime?.replayOffset, replayOffset);

    // listPanes intentionally reports stale/misleading values; runtime metadata must come from host snapshots.
    assert.notEqual(paneRuntime?.laneOwnerClientId, "pane-row-owner");
    assert.notEqual(paneRuntime?.replayOffset, 9_999);
  } finally {
    await closeWs(probe.socket);
    await runtime.close();
  }
});

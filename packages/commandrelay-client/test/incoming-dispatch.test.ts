import assert from "node:assert/strict";
import test from "node:test";
import { envelope } from "@commandrelay/protocol";
import { CommandRelayClient, CommandRelayProtocolError } from "../src/index.js";
import type { GatewayEnvelope, GatewayPayload, OutputPayload } from "../src/client-types.js";

interface ClientInternals {
  dispatchIncoming: (message: GatewayEnvelope<GatewayPayload>) => void;
  promiseForRequest: (
    requestId: string,
    expectedResponseTypes: ReadonlySet<string>
  ) => Promise<GatewayEnvelope<GatewayPayload>>;
}

function createInternalClient(): { client: CommandRelayClient; internals: ClientInternals } {
  const client = new CommandRelayClient("ws://127.0.0.1:8787/ws");
  return {
    client,
    internals: client as unknown as ClientInternals
  };
}

test("dispatchIncoming emits unsolicited output frames without a requestId", () => {
  const { client, internals } = createInternalClient();
  const received: GatewayEnvelope<OutputPayload>[] = [];

  client.on("output", (message: GatewayEnvelope<OutputPayload>) => {
    received.push(message);
  });

  internals.dispatchIncoming(
    envelope("output", {
      mode: "delta",
      paneId: "%1",
      chunk: "hello\n",
      streamSeq: 7
    }) as GatewayEnvelope<OutputPayload>
  );

  assert.equal(received.length, 1);
  assert.equal(received[0]?.payload.paneId, "%1");
  assert.equal(received[0]?.payload.streamSeq, 7);
});

test("dispatchIncoming emits unsolicited error frames without a requestId", () => {
  const { client, internals } = createInternalClient();
  const received: Array<GatewayEnvelope<GatewayPayload>> = [];

  client.on("error", (message: GatewayEnvelope<GatewayPayload>) => {
    received.push(message);
  });

  internals.dispatchIncoming(
    envelope("error", {
      code: "pane_poll_failed",
      paneId: "%1",
      message: "capture failed"
    }) as GatewayEnvelope<GatewayPayload>
  );

  assert.equal(received.length, 1);
  assert.equal(received[0]?.payload.code, "pane_poll_failed");
});

test("dispatchIncoming still rejects correlated request failures", async () => {
  const { internals } = createInternalClient();
  const responsePromise = internals.promiseForRequest("req-1", new Set(["ack", "error"]));

  internals.dispatchIncoming(
    envelope("error", { code: "invalid_pane_id" }, "req-1") as GatewayEnvelope<GatewayPayload>
  );

  await assert.rejects(responsePromise, (error: unknown) => {
    assert.ok(error instanceof CommandRelayProtocolError);
    assert.equal(error.kind, "error");
    assert.equal(error.payload.code, "invalid_pane_id");
    return true;
  });
});

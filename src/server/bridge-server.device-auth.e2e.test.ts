/**
 * @file End-to-end tests for trusted-device bridge auth and capability gating.
 */

import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { createServer as createNetServer } from "node:net";
import test from "node:test";
import WebSocket from "ws";
import { startBridgeServer } from "./bridge-server.js";
import { TrustedDeviceAuthority } from "./trusted-device-authority.js";

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

function createAuthority(): TrustedDeviceAuthority {
  return new TrustedDeviceAuthority({
    pairingTtlMs: 60_000,
    accessTokenTtlMs: 300_000,
    refreshTokenTtlMs: 900_000
  });
}

function createSigningPair(): { privateKeyPem: string; publicKeyPem: string } {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  return {
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString()
  };
}

function signChallenge(privateKeyPem: string, challenge: string): string {
  return sign("sha256", Buffer.from(challenge, "utf8"), privateKeyPem).toString("base64url");
}

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

async function createWsProbe(url: string): Promise<WsProbe> {
  const socket = new WebSocket(url);
  const queue: Envelope[] = [];
  socket.on("message", (rawData) => {
    const raw = typeof rawData === "string" ? rawData : rawData.toString();
    queue.push(JSON.parse(raw) as Envelope);
  });
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      socket.off("open", onOpen);
      socket.off("error", onError);
    };
    const onOpen = () => {
      cleanup();
      resolve();
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
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
  const sentInputs: Array<{ paneId: string; input: string }> = [];
  return {
    sentInputs,
    isAvailable: async () => true,
    listPanes: async () => [{ sessionName: "main", windowName: "editor", paneId: "%1", paneIndex: 0, paneCurrentCommand: "bash" }],
    sendInput: async (paneId: string, input: string) => {
      sentInputs.push({ paneId, input });
    },
    capturePane: async () => "ready\n"
  };
}

function pairTrustedDevice(
  authority: TrustedDeviceAuthority,
  accessLevel: "read_only" | "write" | "full_control"
) {
  const keys = createSigningPair();
  const session = authority.createPairingSession({
    apiBaseUrl: "https://relay.example.test",
    relayEndpoint: "wss://relay.example.test/ws",
    relayId: "relay-1"
  });
  const claim = authority.claimPairing({
    pairingSessionId: session.pairingSessionId,
    pairingToken: session.pairingToken,
    publicKey: keys.publicKeyPem,
    deviceName: `${accessLevel}-device`
  });
  authority.provePairing({
    claimId: claim.claimId,
    challengeProof: signChallenge(keys.privateKeyPem, claim.challenge)
  });
  const paired = authority.confirmPairing({
    claimId: claim.claimId,
    verificationCode: claim.verificationCode,
    accessLevel
  });
  return { ...paired, privateKeyPem: keys.privateKeyPem };
}

test("read-only trusted device auth succeeds and blocks enable_input", async (t) => {
  if (!(await canBindLoopback())) return void t.skip("loopback bind not permitted in this runtime");
  const port = await reservePort();
  const authority = createAuthority();
  const device = pairTrustedDevice(authority, "read_only");
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
      trustedDeviceAuthEnabled: true,
      trustedDevicePairingTtlMs: 60_000,
      trustedDeviceAccessTokenTtlMs: 300_000,
      trustedDeviceRefreshTokenTtlMs: 900_000,
      auditLogPath: null
    },
    trustedDeviceAuthority: authority,
    tmux: createFakeTmux(),
    logger: { info: () => {}, warn: () => {}, error: () => {} }
  });
  const probe = await createWsProbe(`ws://${HOST}:${port}/ws`);
  try {
    const hello = await probe.next((message) => message.type === "hello");
    assert.equal(hello.payload.requiresAuth, true);
    assert.deepEqual(hello.payload.authModes, ["device"]);
    assert.equal(typeof hello.payload.authChallenge, "string");

    probe.sendRequest("auth", "auth-device", {
      mode: "device",
      deviceId: device.deviceId,
      accessToken: device.accessToken,
      challengeProof: signChallenge(device.privateKeyPem, String(hello.payload.authChallenge))
    });
    const authOk = await probe.next((message) => message.type === "auth_ok");
    assert.equal(authOk.payload.mode, "device");
    assert.equal(authOk.payload.accessLevel, "read_only");

    probe.sendRequest("enable_input", "enable-read-only", {});
    const denied = await probe.next((message) => message.requestId === "enable-read-only");
    assert.equal(denied.type, "error");
    assert.equal(denied.payload.code, "insufficient_capability");
  } finally {
    await closeWs(probe.socket);
    await runtime.close();
  }
});

test("write and full-control trusted devices enforce input gating and override privileges", async (t) => {
  if (!(await canBindLoopback())) return void t.skip("loopback bind not permitted in this runtime");
  const port = await reservePort();
  const authority = createAuthority();
  const writer = pairTrustedDevice(authority, "write");
  const admin = pairTrustedDevice(authority, "full_control");
  const tmux = createFakeTmux();
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
      trustedDeviceAuthEnabled: true,
      trustedDevicePairingTtlMs: 60_000,
      trustedDeviceAccessTokenTtlMs: 300_000,
      trustedDeviceRefreshTokenTtlMs: 900_000,
      allowInputOwnershipOverride: true,
      auditLogPath: null
    },
    trustedDeviceAuthority: authority,
    tmux,
    logger: { info: () => {}, warn: () => {}, error: () => {} }
  });
  const writerProbe = await createWsProbe(`ws://${HOST}:${port}/ws`);
  const adminProbe = await createWsProbe(`ws://${HOST}:${port}/ws`);
  const authenticate = async (probe: WsProbe, device: typeof writer) => {
    const hello = await probe.next((message) => message.type === "hello");
    probe.sendRequest("auth", `${device.deviceId}-auth`, {
      mode: "device",
      deviceId: device.deviceId,
      accessToken: device.accessToken,
      challengeProof: signChallenge(device.privateKeyPem, String(hello.payload.authChallenge))
    });
    await probe.next((message) => message.type === "auth_ok" && message.requestId === `${device.deviceId}-auth`);
    probe.sendRequest("attach", `${device.deviceId}-attach`, { paneId: "%1" });
    await probe.next((message) => message.type === "ack" && message.requestId === `${device.deviceId}-attach`);
    await probe.next((message) => message.type === "output" && message.payload.paneId === "%1");
    probe.sendRequest("enable_input", `${device.deviceId}-enable`, {});
    await probe.next((message) => message.type === "policy_update" && message.requestId === `${device.deviceId}-enable`);
  };

  try {
    await authenticate(writerProbe, writer);
    await authenticate(adminProbe, admin);

    writerProbe.sendRequest("input", "writer-input-1", { paneId: "%1", data: "echo writer\n" });
    assert.equal((await writerProbe.next((message) => message.requestId === "writer-input-1")).type, "ack");

    adminProbe.sendRequest("input", "admin-input-1", { paneId: "%1", data: "echo admin\n" });
    assert.equal((await adminProbe.next((message) => message.requestId === "admin-input-1")).payload.code, "input_lane_conflict");

    adminProbe.sendRequest("input", "admin-input-2", { paneId: "%1", data: "echo admin override\n", override: true });
    assert.equal((await adminProbe.next((message) => message.requestId === "admin-input-2")).type, "ack");
    assert.deepEqual(
      tmux.sentInputs.map((entry) => entry.input),
      ["echo writer\n", "echo admin override\n"]
    );
  } finally {
    await closeWs(writerProbe.socket);
    await closeWs(adminProbe.socket);
    await runtime.close();
  }
});

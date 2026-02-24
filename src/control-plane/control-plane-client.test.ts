/**
 * @file Integration-style tests for outbound control-plane proxy behavior.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  createControlPlaneClientFromEnv,
  type DeviceAuthRequest
} from "./control-plane-client.js";
import type {
  JsonRequestFunction,
  JsonRequestOptions,
  ProxyResolution,
  ProxyResolver
} from "../net/outbound-http.js";

interface CapturedRequest {
  url: string;
  method: string;
  path: string;
  proxyUrl: string | null;
  viaProxy: boolean;
  hasAgent: boolean;
  body: unknown;
}

function createCaptureRequest(captured: CapturedRequest[]): JsonRequestFunction {
  return async <TBody = unknown>(url, options, proxyFactory = undefined) => {
    const target = url instanceof URL ? url : new URL(String(url));
    const resolution = resolveProxy(proxyFactory, target);

    captured.push({
      url: target.toString(),
      method: options.method,
      path: target.pathname,
      proxyUrl: resolution.proxyUrl,
      viaProxy: resolution.viaProxy,
      hasAgent: Boolean(resolution.agent),
      body: options.body
    });

    return {
      status: 200,
      headers: {},
      body: { ok: true } as TBody
    };
  };
}

function resolveProxy(
  proxyFactory: ProxyResolver | undefined,
  target: URL
): ProxyResolution & { proxyUrl: string | null; viaProxy: boolean } {
  const resolved = proxyFactory ? proxyFactory.resolve(target) : { agent: null };
  const withMetadata = resolved as ProxyResolution & {
    proxyUrl?: string | null;
    viaProxy?: boolean;
  };
  return {
    ...resolved,
    proxyUrl: withMetadata.proxyUrl ?? null,
    viaProxy: withMetadata.viaProxy ?? Boolean(resolved.agent)
  };
}

function buildAuthInput(): DeviceAuthRequest {
  return {
    deviceId: "device-123",
    accessToken: "access-abc",
    challengeProof: "proof-signature"
  };
}

test("uses HTTP_PROXY for auth endpoint over http", async () => {
  const captured: CapturedRequest[] = [];
  const client = createControlPlaneClientFromEnv({
    baseUrl: "http://control-plane.local",
    env: {
      HTTP_PROXY: "http://proxy-http.local:8080"
    },
    requestFn: createCaptureRequest(captured)
  });

  await client.authenticate(buildAuthInput());

  assert.equal(captured.length, 1);
  assert.equal(captured[0].path, "/auth/device");
  assert.equal(captured[0].proxyUrl, "http://proxy-http.local:8080/");
  assert.equal(captured[0].viaProxy, true);
});

test("uses HTTPS_PROXY over HTTP_PROXY for https endpoints", async () => {
  const captured: CapturedRequest[] = [];
  const client = createControlPlaneClientFromEnv({
    baseUrl: "https://secure-control-plane.local",
    env: {
      HTTP_PROXY: "http://proxy-http.local:8080",
      HTTPS_PROXY: "http://proxy-https.local:8443"
    },
    requestFn: createCaptureRequest(captured)
  });

  await client.claimPairing({
    pairingCode: "pair-001",
    publicKey: "pk-123",
    deviceName: "iPhone",
    platform: "ios"
  });

  assert.equal(captured.length, 1);
  assert.equal(captured[0].path, "/pair/claim");
  assert.equal(captured[0].proxyUrl, "http://proxy-https.local:8443/");
  assert.equal(captured[0].viaProxy, true);
});

test("falls back to ALL_PROXY when protocol-specific env vars are unset", async () => {
  const captured: CapturedRequest[] = [];
  const client = createControlPlaneClientFromEnv({
    baseUrl: "https://telemetry.control-plane.local",
    env: {
      ALL_PROXY: "socks5://127.0.0.1:1080"
    },
    requestFn: createCaptureRequest(captured)
  });

  await client.sendTelemetry({
    events: [{ name: "bridge.heartbeat", timestamp: Date.now() }]
  });

  assert.equal(captured.length, 1);
  assert.equal(captured[0].path, "/telemetry/events");
  assert.equal(captured[0].proxyUrl, "socks5://127.0.0.1:1080");
  assert.equal(captured[0].viaProxy, true);
});

test("honors NO_PROXY bypass for matching hosts", async () => {
  const captured: CapturedRequest[] = [];
  const client = createControlPlaneClientFromEnv({
    baseUrl: "https://control-plane.local",
    env: {
      HTTPS_PROXY: "http://proxy-https.local:8443",
      NO_PROXY: "control-plane.local"
    },
    requestFn: createCaptureRequest(captured)
  });

  await client.sendTelemetry({
    events: [{ name: "bridge.input_denied", timestamp: Date.now() }]
  });

  assert.equal(captured.length, 1);
  assert.equal(captured[0].proxyUrl, null);
  assert.equal(captured[0].viaProxy, false);
  assert.equal(captured[0].hasAgent, false);
});

test("includes bearer auth header when apiToken is configured", async () => {
  const headersSeen: JsonRequestOptions[] = [];
  const requestFn: JsonRequestFunction = async <TBody = unknown>(_url, options) => {
    headersSeen.push(options);
    return { status: 200, headers: {}, body: { ok: true } as TBody };
  };

  const client = createControlPlaneClientFromEnv({
    baseUrl: "https://control-plane.local",
    apiToken: "secret-token",
    env: {},
    requestFn
  });

  await client.authenticate(buildAuthInput());
  assert.equal(headersSeen.length, 1);
  assert.equal(headersSeen[0].headers?.authorization, "Bearer secret-token");
});

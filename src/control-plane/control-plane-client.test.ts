/**
 * @file Integration-style tests for outbound control-plane proxy behavior.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  ControlPlaneClient,
  ControlPlaneHttpError,
  ControlPlaneTransportError,
  createControlPlaneClientFromEnv,
  type ControlPlaneProxyResolution,
  type ControlPlaneProxyResolver,
  type ControlPlaneRequestFunction,
  type ControlPlaneRequestOptions,
  type DeviceAuthRequest
} from "./control-plane-client.js";
import {
  RequestAbortedError,
  RequestTimeoutError
} from "../../packages/proxy-http-client/src/index.js";

interface CapturedRequest {
  url: string;
  method: string;
  path: string;
  proxyUrl: string | null;
  viaProxy: boolean;
  hasAgent: boolean;
  body: unknown;
}

function createCaptureRequest(captured: CapturedRequest[]): ControlPlaneRequestFunction {
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
  proxyFactory: ControlPlaneProxyResolver | undefined,
  target: URL
): ControlPlaneProxyResolution & { proxyUrl: string | null; viaProxy: boolean } {
  const resolved: ControlPlaneProxyResolution = proxyFactory
    ? proxyFactory.resolve(target)
    : { agent: null };
  const withMetadata = resolved as ControlPlaneProxyResolution & {
    proxyUrl?: string | null;
    viaProxy?: boolean;
  };
  return {
    ...resolved,
    proxyUrl: withMetadata.proxyUrl ?? null,
    viaProxy: withMetadata.viaProxy ?? Boolean(resolved.agent)
  };
}

function createHeadersCaptureRequest(
  capturedOptions: ControlPlaneRequestOptions[]
): ControlPlaneRequestFunction {
  return async <TBody = unknown>(_url, options) => {
    capturedOptions.push(options);
    return { status: 200, headers: {}, body: { ok: true } as TBody };
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
  const headersSeen: ControlPlaneRequestOptions[] = [];
  const requestFn = createHeadersCaptureRequest(headersSeen);

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

test("throws ControlPlaneHttpError for non-2xx responses", async () => {
  const client = new ControlPlaneClient({
    baseUrl: "https://control-plane.local",
    requestFn: async <TBody = unknown>() => ({
      status: 503,
      headers: {},
      body: { code: "unavailable" } as TBody
    })
  });

  await assert.rejects(
    () => client.authenticate(buildAuthInput()),
    (error: unknown) => {
      assert.equal(error instanceof ControlPlaneHttpError, true);
      if (!(error instanceof ControlPlaneHttpError)) {
        return false;
      }
      assert.equal(error.status, 503);
      assert.equal(error.url, "https://control-plane.local/auth/device");
      assert.deepEqual(error.responseBody, { code: "unavailable" });
      return true;
    }
  );
});

test("wraps non-Error transport failures in ControlPlaneTransportError", async () => {
  const client = new ControlPlaneClient({
    baseUrl: "https://control-plane.local",
    requestFn: async () => {
      throw "request_timeout:2500";
    }
  });

  await assert.rejects(
    () => client.sendTelemetry({ events: [] }),
    (error: unknown) => {
      assert.equal(error instanceof ControlPlaneTransportError, true);
      if (!(error instanceof ControlPlaneTransportError)) {
        return false;
      }
      assert.equal(error.code, "request_timeout");
      assert.equal(error.url, "https://control-plane.local/telemetry/events");
      assert.equal(error.cause, "request_timeout:2500");
      return true;
    }
  );
});

test("maps RequestTimeoutError instances to ControlPlaneTransportError", async () => {
  const timeoutCause = new RequestTimeoutError(1800, "https://control-plane.local/telemetry/events");
  const client = new ControlPlaneClient({
    baseUrl: "https://control-plane.local",
    requestFn: async () => {
      throw timeoutCause;
    }
  });

  await assert.rejects(
    () => client.sendTelemetry({ events: [] }),
    (error: unknown) => {
      assert.equal(error instanceof ControlPlaneTransportError, true);
      if (!(error instanceof ControlPlaneTransportError)) {
        return false;
      }
      assert.equal(error.code, "request_timeout");
      assert.equal(error.url, "https://control-plane.local/telemetry/events");
      assert.equal(error.cause, timeoutCause);
      return true;
    }
  );
});

test("maps RequestAbortedError instances to ControlPlaneTransportError", async () => {
  const abortedCause = new RequestAbortedError(
    "https://control-plane.local/auth/device",
    "caller_cancelled"
  );
  const client = new ControlPlaneClient({
    baseUrl: "https://control-plane.local",
    requestFn: async () => {
      throw abortedCause;
    }
  });

  await assert.rejects(
    () => client.authenticate(buildAuthInput()),
    (error: unknown) => {
      assert.equal(error instanceof ControlPlaneTransportError, true);
      if (!(error instanceof ControlPlaneTransportError)) {
        return false;
      }
      assert.equal(error.code, "request_aborted");
      assert.equal(error.url, "https://control-plane.local/auth/device");
      assert.equal(error.cause, abortedCause);
      return true;
    }
  );
});

test("maps proxy resolver failures to ControlPlaneTransportError", async () => {
  const resolverCause = new Error("resolver_failed");
  const client = new ControlPlaneClient({
    baseUrl: "https://control-plane.local",
    proxyFactory: {
      resolve() {
        throw resolverCause;
      }
    }
  });

  await assert.rejects(
    () => client.authenticate(buildAuthInput()),
    (error: unknown) => {
      assert.equal(error instanceof ControlPlaneTransportError, true);
      if (!(error instanceof ControlPlaneTransportError)) {
        return false;
      }
      assert.equal(error.code, "transport_error");
      assert.equal(error.url, "https://control-plane.local/auth/device");
      assert.equal(error.cause instanceof Error, true);
      if (!(error.cause instanceof Error)) {
        return false;
      }
      assert.equal(error.cause.message, "proxy_resolution_error");
      assert.equal((error.cause as { cause?: unknown }).cause, resolverCause);
      return true;
    }
  );
});

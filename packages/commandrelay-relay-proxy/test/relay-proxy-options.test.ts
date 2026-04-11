import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createRelayProxyServer,
  normalizeRelayOptions,
  parseRelayProxyEnv,
  type RelayProxyOptions
} from "../src/index.js";

function createRelayOptions(overrides: Partial<RelayProxyOptions> = {}): RelayProxyOptions {
  return {
    listenHost: "127.0.0.1",
    listenPort: 8788,
    relayPath: "/ws",
    healthPath: "/health",
    upstreamUrl: "ws://127.0.0.1:8787/ws",
    upstreamTls: {
      rejectUnauthorized: true
    },
    maxConnections: 64,
    idleTimeoutMs: 120_000,
    shutdownTimeoutMs: 10_000,
    upstreamSubprotocols: [],
    allowedOrigins: [],
    requiredToken: "",
    ...overrides
  };
}

test("rejects certificate without private key", () => {
  assert.throws(
    () =>
      normalizeRelayOptions(
        createRelayOptions({
          upstreamTls: {
            rejectUnauthorized: true,
            cert: "temp-cert",
            key: undefined
          }
        })
      ),
    { message: "upstream TLS cert and key must be both provided together" }
  );
});

test("rejects pfx together with cert and key", () => {
  assert.throws(
    () =>
      normalizeRelayOptions(
        createRelayOptions({
          upstreamTls: {
            rejectUnauthorized: true,
            cert: "temp-cert",
            key: "temp-key",
            pfx: Buffer.from("temp-pfx")
          }
        })
      ),
    { message: "upstream TLS pfx cannot be used together with cert and key" }
  );
});

test("rejects TLS min version greater than max version", () => {
  assert.throws(
    () =>
      normalizeRelayOptions(
        createRelayOptions({
          upstreamTls: {
            rejectUnauthorized: true,
            minVersion: "TLSv1.3",
            maxVersion: "TLSv1.2"
          }
        })
      ),
    { message: "upstream tls minVersion TLSv1.3 must not exceed maxVersion TLSv1.2" }
  );
});

test("validates boolean and defaults from env parsing", () => {
  const parsed = parseRelayProxyEnv({
    COMMANDRELAY_RELAY_UPSTREAM_TLS_REJECT_UNAUTHORIZED: "false",
    COMMANDRELAY_RELAY_UPSTREAM_TLS_MIN_VERSION: "TLSv1.2",
    COMMANDRELAY_RELAY_UPSTREAM_TLS_MAX_VERSION: "TLSv1.3"
  });

  const options = normalizeRelayOptions(parsed);

  assert.equal(options.upstreamTls.rejectUnauthorized, false);
  assert.equal(options.upstreamTls.minVersion, "TLSv1.2");
  assert.equal(options.upstreamTls.maxVersion, "TLSv1.3");
});

test("uses fallback for non-numeric listen port", () => {
  const parsed = parseRelayProxyEnv({
    COMMANDRELAY_RELAY_LISTEN_PORT: "8788abc"
  });
  assert.equal(parsed.listenPort, 8788);
});

test("supports boolean on/off values", () => {
  const parsed = parseRelayProxyEnv({
    COMMANDRELAY_RELAY_UPSTREAM_TLS_REJECT_UNAUTHORIZED: "off"
  });
  const options = normalizeRelayOptions(parsed);
  assert.equal(options.upstreamTls.rejectUnauthorized, false);
});

test("normalizes TLS watch interval and restart flags from env", async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "commandrelay-relay-proxy-"));
  const caFile = path.join(tempDir, "ca.pem");
  const caBundleFile = path.join(tempDir, "ca-bundle.pem");
  const certFile = path.join(tempDir, "client.pem");
  const keyFile = path.join(tempDir, "client.key");

  writeFileSync(caFile, "ca");
  writeFileSync(caBundleFile, "ca-bundle");
  writeFileSync(certFile, "cert");
  writeFileSync(keyFile, "key");

  const parsed = parseRelayProxyEnv({
    COMMANDRELAY_RELAY_UPSTREAM_TLS_WATCH_INTERVAL_MS: "750",
    COMMANDRELAY_RELAY_UPSTREAM_TLS_RESTART_ON_CHANGE: "true",
    COMMANDRELAY_RELAY_UPSTREAM_TLS_CA_FILE: `${caFile},${caBundleFile}`,
    COMMANDRELAY_RELAY_UPSTREAM_TLS_CERT_FILE: certFile,
    COMMANDRELAY_RELAY_UPSTREAM_TLS_KEY_FILE: keyFile
  });

  try {
    const options = normalizeRelayOptions(parsed);

    assert.equal(options.upstreamTlsWatchIntervalMs, 750);
    assert.equal(options.upstreamTlsRestartOnChange, true);
    assert.deepEqual(options.upstreamTlsSourcePaths, [
      caFile,
      caBundleFile,
      certFile,
      keyFile
    ]);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("returns contract metadata in stats config", async () => {
  const handle = await createRelayProxyServer(
    createRelayOptions({
      upstreamUrl: "ws://127.0.0.1:9/ws"
    })
  );
  const stats = handle.getStats();
  assert.equal(stats.config.statusContractVersion, 2);
  assert.ok(stats.config.configFingerprint.length > 0);
  assert.equal(stats.config.upstreamTls.rotation.status, "disabled");
  assert.equal(stats.config.originProtection, false);
  assert.equal(stats.config.hasTokenRequired, false);
  await handle.close();
});

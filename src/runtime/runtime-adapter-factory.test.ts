/**
 * @file Unit tests for runtime adapter factory selection and availability logging.
 */

import assert from "node:assert/strict";
import test from "node:test";
import type { BridgeConfig } from "../config.js";
import { TmuxAdapter } from "../tmux/tmux-adapter.js";
import { ManagedAdapter } from "./managed-adapter.js";
import {
  checkRuntimeBackendAvailability,
  createManagedRuntimeAdapter,
  createRuntimeAdapter,
  createTmuxRuntimeAdapter,
  createRuntimeBackends,
  logRuntimeBackendAvailability,
  resolveStartupTransportConfig,
  type StartupTransportConfig
} from "./runtime-adapter-factory.js";
import { RuntimeMultiplexer } from "./runtime-multiplexer.js";
import { SshTmuxAdapter } from "./ssh-tmux-adapter.js";
import type { RuntimeBackend } from "./runtime-backend.js";

const SAMPLE_FINGERPRINT_SHA256 = "SHA256:47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU";

const BASE_TRANSPORT_CONFIG: StartupTransportConfig = {
  mode: "ws",
  sshProfile: "primary",
  sshTarget: null,
  sshPort: 22,
  sshCommand: "ssh",
  sshConnectTimeoutSeconds: 8,
  sshStrictHostKeyChecking: true,
  sshKnownHostsFile: null,
  sshExpectedFingerprintSha256: null
};

interface ConsolePatchResult {
  infoMessages: string[];
  warnMessages: string[];
  restore: () => void;
}

/**
 * Captures console info/warn messages for deterministic assertions.
 *
 * @returns Message buffers and restore callback.
 */
function patchConsole(): ConsolePatchResult {
  const originalInfo = console.info;
  const originalWarn = console.warn;
  const infoMessages: string[] = [];
  const warnMessages: string[] = [];

  console.info = (...args: unknown[]) => {
    infoMessages.push(args.map(String).join(" "));
  };
  console.warn = (...args: unknown[]) => {
    warnMessages.push(args.map(String).join(" "));
  };

  return {
    infoMessages,
    warnMessages,
    restore: () => {
      console.info = originalInfo;
      console.warn = originalWarn;
    }
  };
}

/**
 * Builds a minimal runtime backend stub for availability tests.
 *
 * @param backendId Stable runtime backend id.
 * @param available Availability result to return.
 * @param throwOnCheck Whether `isAvailable` should throw.
 * @returns Runtime backend stub.
 */
function createBackendStub(
  backendId: string,
  available: boolean,
  throwOnCheck = false
): RuntimeBackend {
  return {
    backendId,
    async isAvailable(): Promise<boolean> {
      if (throwOnCheck) {
        throw new Error(`isAvailable failed for ${backendId}`);
      }
      return available;
    },
    async listPanes(): Promise<[]> {
      return [];
    },
    async capturePane(): Promise<string> {
      return "";
    },
    async sendInput(): Promise<void> {
      return;
    }
  };
}

test("createTmuxRuntimeAdapter selects local tmux adapter for ws transport", () => {
  const adapter = createTmuxRuntimeAdapter({
    ...BASE_TRANSPORT_CONFIG,
    mode: "ws",
    sshTarget: null
  });

  assert.equal(adapter instanceof TmuxAdapter, true);
  assert.equal(adapter instanceof SshTmuxAdapter, false);
});

test("createTmuxRuntimeAdapter selects ssh tmux adapter for ssh transport", () => {
  const adapter = createTmuxRuntimeAdapter({
    ...BASE_TRANSPORT_CONFIG,
    mode: "ssh",
    sshTarget: "dev@host.example"
  });

  assert.equal(adapter instanceof SshTmuxAdapter, true);
});

test("createTmuxRuntimeAdapter passes host trust settings to ssh tmux adapter", () => {
  const adapter = createTmuxRuntimeAdapter({
    ...BASE_TRANSPORT_CONFIG,
    mode: "ssh",
    sshTarget: "dev@host.example",
    sshKnownHostsFile: "/tmp/known_hosts",
    sshExpectedFingerprintSha256: SAMPLE_FINGERPRINT_SHA256
  });

  const internals = adapter as unknown as {
    knownHostsFile: string | null;
    expectedFingerprintSha256: string | null;
  };

  assert.equal(adapter instanceof SshTmuxAdapter, true);
  assert.equal(internals.knownHostsFile, "/tmp/known_hosts");
  assert.equal(internals.expectedFingerprintSha256, SAMPLE_FINGERPRINT_SHA256);
});

test("resolveStartupTransportConfig includes optional host trust fields", () => {
  const config = {
    transportMode: "ssh",
    sshProfileName: "primary",
    sshTarget: "dev@host.example",
    sshPort: 2222,
    sshCommand: "ssh-custom",
    sshConnectTimeoutSeconds: 12,
    sshStrictHostKeyChecking: false,
    sshKnownHostsFile: " /tmp/known_hosts ",
    sshExpectedFingerprintSha256: ` ${SAMPLE_FINGERPRINT_SHA256} `
  } as BridgeConfig;

  const transport = resolveStartupTransportConfig(config);

  assert.deepEqual(transport, {
    mode: "ssh",
    sshProfile: "primary",
    sshTarget: "dev@host.example",
    sshPort: 2222,
    sshCommand: "ssh-custom",
    sshConnectTimeoutSeconds: 12,
    sshStrictHostKeyChecking: false,
    sshKnownHostsFile: "/tmp/known_hosts",
    sshExpectedFingerprintSha256: SAMPLE_FINGERPRINT_SHA256
  });
});

test("createTmuxRuntimeAdapter requires ssh target in ssh transport mode", () => {
  assert.throws(
    () =>
      createTmuxRuntimeAdapter({
        ...BASE_TRANSPORT_CONFIG,
        mode: "ssh",
        sshTarget: null
      }),
    /COMMANDRELAY_SSH_TARGET is required/
  );
});

test("createManagedRuntimeAdapter returns a managed adapter instance", () => {
  const adapter = createManagedRuntimeAdapter({
    managedCommand: "oly-custom",
    managedStateDir: "/tmp/oly",
    managedCommandTimeoutMs: 9000
  });

  assert.equal(adapter instanceof ManagedAdapter, true);
});

test("createRuntimeBackends wires configured managed backends", () => {
  const backends = createRuntimeBackends(["managed"], {
    cmuxCommand: "cmux",
    managedCommand: "oly",
    managedStateDir: null,
    managedCommandTimeoutMs: 8000,
    transportConfig: BASE_TRANSPORT_CONFIG
  });

  assert.equal(backends.length, 1);
  assert.equal(backends[0]?.backendId, "managed");
});

test("createRuntimeAdapter returns a single adapter directly", () => {
  const backend = createBackendStub("managed", true);
  const adapter = createRuntimeAdapter([backend]);

  assert.equal(adapter, backend);
  assert.equal(adapter instanceof RuntimeMultiplexer, false);
});

test("createRuntimeAdapter multiplexes when multiple backends are configured", () => {
  const adapter = createRuntimeAdapter([
    createBackendStub("tmux", true),
    createBackendStub("managed", true)
  ]);

  assert.equal(adapter instanceof RuntimeMultiplexer, true);
});

test("availability checks stay safe and availability logging returns correct count", async () => {
  const availability = await checkRuntimeBackendAvailability([
    createBackendStub("tmux", true),
    createBackendStub("managed", false, true)
  ]);

  const consolePatch = patchConsole();
  try {
    const count = logRuntimeBackendAvailability(availability);
    assert.equal(count, 1);
    assert.deepEqual(availability, [
      { backendId: "tmux", available: true },
      { backendId: "managed", available: false }
    ]);
    assert.equal(consolePatch.infoMessages.length, 1);
    assert.equal(consolePatch.warnMessages.length, 1);
    assert.equal(consolePatch.infoMessages[0], "[bridge] runtime backend available: tmux");
    assert.equal(consolePatch.warnMessages[0], "[bridge] runtime backend unavailable: managed");
  } finally {
    consolePatch.restore();
  }
});

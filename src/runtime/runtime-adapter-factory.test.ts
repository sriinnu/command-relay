/**
 * @file Unit tests for runtime adapter factory selection and availability logging.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { TmuxAdapter } from "../tmux/tmux-adapter.js";
import {
  checkRuntimeBackendAvailability,
  createTmuxRuntimeAdapter,
  logRuntimeBackendAvailability,
  type StartupTransportConfig
} from "./runtime-adapter-factory.js";
import { SshTmuxAdapter } from "./ssh-tmux-adapter.js";
import type { RuntimeBackend } from "./runtime-backend.js";

const BASE_TRANSPORT_CONFIG: StartupTransportConfig = {
  mode: "ws",
  sshProfile: "primary",
  sshTarget: null,
  sshPort: 22,
  sshCommand: "ssh",
  sshConnectTimeoutSeconds: 8,
  sshStrictHostKeyChecking: true
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

test("availability checks stay safe and availability logging returns correct count", async () => {
  const availability = await checkRuntimeBackendAvailability([
    createBackendStub("tmux", true),
    createBackendStub("cmux", false, true)
  ]);

  const consolePatch = patchConsole();
  try {
    const count = logRuntimeBackendAvailability(availability);
    assert.equal(count, 1);
    assert.deepEqual(availability, [
      { backendId: "tmux", available: true },
      { backendId: "cmux", available: false }
    ]);
    assert.equal(consolePatch.infoMessages.length, 1);
    assert.equal(consolePatch.warnMessages.length, 1);
    assert.equal(consolePatch.infoMessages[0], "[bridge] runtime backend available: tmux");
    assert.equal(consolePatch.warnMessages[0], "[bridge] runtime backend unavailable: cmux");
  } finally {
    consolePatch.restore();
  }
});

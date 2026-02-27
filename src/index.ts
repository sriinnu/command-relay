/**
 * @file CommandRelay bridge runtime entry point.
 */

import process from "node:process";
import {
  loadConfig,
  type BridgeConfig,
  type RuntimeBackend as RuntimeBackendId,
  type TransportMode,
  validateStartupConfig
} from "./config.js";
import { TmuxAdapter } from "./tmux/tmux-adapter.js";
import { CmuxAdapter } from "./runtime/cmux-adapter.js";
import { SshTmuxAdapter } from "./runtime/ssh-tmux-adapter.js";
import { RuntimeMultiplexer } from "./runtime/runtime-multiplexer.js";
import type { RuntimeBackend as RuntimeBackendContract } from "./runtime/runtime-backend.js";
import { startBridgeServer } from "./server/bridge-server.js";
import { loadProxySettings } from "./net/proxy-router.js";
import { ProxyAgentFactory } from "./net/proxy-agent-factory.js";
import { checkSshClientAvailability } from "./ssh/ssh-preflight.js";

interface RuntimeAdapter {
  isAvailable: () => Promise<boolean>;
  listPanes: () => Promise<unknown[]>;
  capturePane: (paneId: string, lines: number) => Promise<string>;
  sendInput: (paneId: string, rawInput: string) => Promise<void>;
}

interface RuntimeBackendAvailability {
  backendId: RuntimeBackendId;
  available: boolean;
}

interface StartupTransportConfig {
  mode: TransportMode;
  sshProfile: string;
  sshTarget: string | null;
  sshPort: number;
  sshCommand: string;
  sshConnectTimeoutSeconds: number;
  sshStrictHostKeyChecking: boolean;
}

interface RuntimeBackendFactoryConfig {
  cmuxCommand: string;
  transportConfig: StartupTransportConfig;
}

/**
 * Creates runtime backend adapters from configured backend ids.
 *
 * @param runtimeBackends Ordered backend list from config.
 * @param factoryConfig Runtime backend factory configuration.
 * @returns Runtime backend adapters with stable identifiers.
 */
function createRuntimeBackends(
  runtimeBackends: RuntimeBackendId[],
  factoryConfig: RuntimeBackendFactoryConfig
): RuntimeBackendContract[] {
  const { cmuxCommand, transportConfig } = factoryConfig;
  const adapters: RuntimeBackendContract[] = [];
  for (const backend of runtimeBackends) {
    if (backend === "tmux") {
      adapters.push(wrapRuntimeBackend(backend, createTmuxRuntimeAdapter(transportConfig)));
      continue;
    }
    adapters.push(wrapRuntimeBackend(backend, new CmuxAdapter({ cmuxCommand })));
  }
  return adapters;
}

/**
 * Creates the tmux runtime adapter for the configured transport mode.
 *
 * @param transportConfig Startup transport configuration.
 * @returns Local or SSH tmux runtime adapter.
 */
function createTmuxRuntimeAdapter(transportConfig: StartupTransportConfig): RuntimeAdapter {
  if (transportConfig.mode !== "ssh") {
    return new TmuxAdapter();
  }
  if (!transportConfig.sshTarget) {
    throw new Error("COMMANDRELAY_SSH_TARGET is required when COMMANDRELAY_TRANSPORT_MODE is ssh");
  }

  return new SshTmuxAdapter({
    sshTarget: transportConfig.sshTarget,
    sshPort: transportConfig.sshPort,
    sshCommand: transportConfig.sshCommand,
    commandTimeoutMs: transportConfig.sshConnectTimeoutSeconds * 1000,
    strictHostKeyChecking: transportConfig.sshStrictHostKeyChecking
  });
}

/**
 * Creates the selected runtime adapter set from configured backends.
 *
 * @param runtimeBackends Ordered backend list from config.
 * @param adapters Runtime backend adapters.
 * @returns Adapter used by the bridge runtime.
 */
function createRuntimeAdapter(
  runtimeBackends: RuntimeBackendId[],
  adapters: RuntimeBackendContract[]
): RuntimeAdapter {
  if (isTmuxOnly(runtimeBackends)) {
    return adapters[0];
  }

  return new RuntimeMultiplexer({ backends: adapters });
}

/**
 * Checks availability of each configured runtime backend.
 *
 * @param adapters Runtime backend adapters.
 * @returns Availability status for each backend.
 */
async function checkRuntimeBackendAvailability(
  adapters: RuntimeBackendContract[]
): Promise<RuntimeBackendAvailability[]> {
  return await Promise.all(
    adapters.map(async (adapter) => ({
      backendId: adapter.backendId as RuntimeBackendId,
      available: await safeIsBackendAvailable(adapter)
    }))
  );
}

/**
 * Checks runtime backend availability without throwing.
 *
 * @param adapter Runtime backend adapter.
 * @returns True when backend is reachable.
 */
async function safeIsBackendAvailable(adapter: RuntimeBackendContract): Promise<boolean> {
  try {
    return await adapter.isAvailable();
  } catch {
    return false;
  }
}

/**
 * Logs startup availability state for every configured backend.
 *
 * @param availability Availability rows.
 * @returns Number of available backends.
 */
function logRuntimeBackendAvailability(availability: RuntimeBackendAvailability[]): number {
  let availableCount = 0;
  for (const backend of availability) {
    if (backend.available) {
      availableCount += 1;
      console.info(`[bridge] runtime backend available: ${backend.backendId}`);
      continue;
    }
    console.warn(`[bridge] runtime backend unavailable: ${backend.backendId}`);
  }
  return availableCount;
}

/**
 * Checks if runtime configuration is legacy tmux-only mode.
 *
 * @param runtimeBackends Ordered backend ids from config.
 * @returns True when runtime is configured with tmux only.
 */
function isTmuxOnly(runtimeBackends: RuntimeBackendId[]): boolean {
  return runtimeBackends.length === 1 && runtimeBackends[0] === "tmux";
}

/**
 * Wraps a runtime adapter with a stable backend identifier.
 *
 * @param backendId Backend identifier from config.
 * @param adapter Runtime adapter implementation.
 * @returns Adapter with backend metadata for multiplexing.
 */
function wrapRuntimeBackend(
  backendId: RuntimeBackendId,
  adapter: RuntimeAdapter
): RuntimeBackendContract {
  return {
    backendId,
    isAvailable: async () => await adapter.isAvailable(),
    listPanes: async () => (await adapter.listPanes()) as any,
    capturePane: async (paneId: string, lines: number) => await adapter.capturePane(paneId, lines),
    sendInput: async (paneId: string, rawInput: string) => await adapter.sendInput(paneId, rawInput)
  };
}

/**
 * Resolves startup transport configuration from normalized runtime config.
 *
 * @param config Runtime bridge configuration.
 * @returns Normalized startup transport configuration.
 */
function resolveStartupTransportConfig(config: BridgeConfig): StartupTransportConfig {
  return {
    mode: config.transportMode,
    sshProfile: config.sshProfileName,
    sshTarget: config.sshTarget,
    sshPort: config.sshPort,
    sshCommand: config.sshCommand,
    sshConnectTimeoutSeconds: config.sshConnectTimeoutSeconds,
    sshStrictHostKeyChecking: config.sshStrictHostKeyChecking
  };
}

/**
 * Logs startup transport configuration.
 *
 * @param transportConfig Normalized startup transport configuration.
 * @returns Nothing.
 */
function logStartupTransportConfig(transportConfig: StartupTransportConfig): void {
  console.info(`[bridge] transport mode: ${transportConfig.mode}`);
  if (transportConfig.mode !== "ssh") {
    return;
  }

  console.info(`[bridge] ssh profile: ${transportConfig.sshProfile}`);
  console.info(`[bridge] ssh target: ${transportConfig.sshTarget ?? "(unset)"}`);
  console.info(`[bridge] ssh port: ${transportConfig.sshPort}`);
  console.info(`[bridge] ssh command: ${transportConfig.sshCommand}`);
  console.info(`[bridge] ssh connect timeout: ${transportConfig.sshConnectTimeoutSeconds}s`);
  console.info(`[bridge] ssh strict host key: ${transportConfig.sshStrictHostKeyChecking ? "enabled" : "disabled"}`);
}

/**
 * Runs SSH startup preflight checks for SSH transport mode.
 *
 * @param transportConfig Normalized startup transport configuration.
 * @returns Nothing.
 */
async function preflightSshTransport(transportConfig: StartupTransportConfig): Promise<void> {
  if (transportConfig.mode !== "ssh") {
    return;
  }

  const availability = await checkSshClientAvailability({
    sshCommand: transportConfig.sshCommand
  });
  if (!availability.available) {
    throw new Error(
      `SSH startup preflight failed: ${formatSshPreflightFailureReason(
        availability.reason,
        transportConfig.sshCommand
      )}`
    );
  }
  if (!availability.version) {
    throw new Error("SSH startup preflight failed: SSH client version was unavailable.");
  }

  console.info(`[bridge] ssh client version: ${availability.version}`);
}

/**
 * Maps SSH preflight reason keys to startup-safe error text.
 *
 * @param reason Preflight reason key.
 * @param sshCommand SSH executable command.
 * @returns Human-readable startup failure reason.
 */
function formatSshPreflightFailureReason(reason: string | null, sshCommand: string): string {
  switch (reason) {
    case "ssh_command_not_found":
      return `SSH client binary "${sshCommand}" was not found in PATH.`;
    case "ssh_version_check_timeout":
      return "SSH client version check timed out.";
    case "ssh_version_check_failed":
      return "SSH client version check failed.";
    default:
      return "unknown failure";
  }
}

/**
 * Boots the CommandRelay bridge runtime.
 *
 * @returns {Promise<void>} Completes when shutdown finishes.
 */
async function main() {
  const config = loadConfig();
  validateStartupConfig(config);
  const transportConfig = resolveStartupTransportConfig(config);

  if (config.globalInputDisabled) {
    console.warn("[bridge] COMMANDRELAY_INPUT_KILL_SWITCH is active; remote input is disabled");
  }
  if (config.appStaticEnabled) {
    console.info(`[bridge] static app hosting enabled at /app from ${config.appStaticDir}`);
  } else {
    console.info("[bridge] static app hosting disabled");
  }
  logStartupTransportConfig(transportConfig);
  await preflightSshTransport(transportConfig);
  console.info(`[bridge] runtime backends: ${config.runtimeBackends.join(",")}`);

  const runtimeBackends = createRuntimeBackends(config.runtimeBackends, {
    cmuxCommand: config.cmuxCommand,
    transportConfig
  });
  const backendAvailability = await checkRuntimeBackendAvailability(runtimeBackends);
  const availableBackends = logRuntimeBackendAvailability(backendAvailability);
  if (availableBackends === 0 && !isTmuxOnly(config.runtimeBackends)) {
    throw new Error(
      `No configured runtime backends are available (${config.runtimeBackends.join(",")})`
    );
  }

  const runtimeAdapter = createRuntimeAdapter(config.runtimeBackends, runtimeBackends);
  const proxySettings = loadProxySettings();
  const proxyFactory = new ProxyAgentFactory({ settings: proxySettings });

  if (proxySettings.httpProxy || proxySettings.httpsProxy || proxySettings.allProxy) {
    console.info("[bridge] outbound proxy settings detected");
  }
  void proxyFactory;

  const runtime = await startBridgeServer({
    config,
    tmux: runtimeAdapter,
    logger: console
  });

  const shutdown = async (signal) => {
    console.info(`[bridge] received ${signal}; shutting down`);
    await runtime.close();
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
}

main().catch((error) => {
  console.error("[bridge] fatal startup error", error);
  process.exit(1);
});

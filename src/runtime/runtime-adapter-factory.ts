/**
 * @file Runtime adapter factory and availability helpers.
 */

import type {
  BridgeConfig,
  RuntimeBackend as RuntimeBackendId,
  TransportMode
} from "../config.js";
import { TmuxAdapter } from "../tmux/tmux-adapter.js";
import { CmuxAdapter } from "./cmux-adapter.js";
import { ManagedAdapter } from "./managed-adapter.js";
import { RuntimeMultiplexer } from "./runtime-multiplexer.js";
import type { RuntimeBackend as RuntimeBackendContract, RuntimePane } from "./runtime-backend.js";
import { SshTmuxAdapter } from "./ssh-tmux-adapter.js";

/**
 * Shared runtime adapter operations used by bridge startup/server wiring.
 */
export interface RuntimeAdapter {
  /**
   * Checks whether the runtime adapter is reachable.
   *
   * @returns True when runtime operations are available.
   */
  isAvailable(): Promise<boolean>;

  /**
   * Lists panes from the runtime.
   *
   * @returns Runtime pane rows.
   */
  listPanes(): Promise<RuntimeAdapterPane[]>;

  /**
   * Captures pane output.
   *
   * @param paneId Runtime pane id.
   * @param lines Number of lines to capture.
   * @returns Captured pane output.
   */
  capturePane(paneId: string, lines: number): Promise<string>;

  /**
   * Sends input to a pane.
   *
   * @param paneId Runtime pane id.
   * @param rawInput Input payload.
   * @returns Completes when input is dispatched.
   */
  sendInput(paneId: string, rawInput: string): Promise<void>;
}

/**
 * Minimal pane shape required by startup/runtime factory wiring.
 */
export interface RuntimeAdapterPane {
  paneId: string;
}

/**
 * Runtime backend availability result row.
 */
export interface RuntimeBackendAvailability {
  backendId: RuntimeBackendId;
  available: boolean;
}

/**
 * Normalized startup transport settings.
 */
export interface StartupTransportConfig {
  mode: TransportMode;
  sshProfile: string;
  sshTarget: string | null;
  sshPort: number;
  sshCommand: string;
  sshConnectTimeoutSeconds: number;
  sshStrictHostKeyChecking: boolean;
  sshKnownHostsFile: string | null;
  sshExpectedFingerprintSha256: string | null;
}

/**
 * Runtime backend factory inputs.
 */
export interface RuntimeBackendFactoryConfig {
  cmuxCommand: string;
  managedCommand: string;
  managedStateDir: string | null;
  managedCommandTimeoutMs: number;
  transportConfig: StartupTransportConfig;
}

/**
 * Creates runtime backend adapters from configured backend ids.
 *
 * @param runtimeBackends Ordered backend list from config.
 * @param factoryConfig Runtime backend factory configuration.
 * @returns Runtime backend adapters with stable identifiers.
 */
export function createRuntimeBackends(
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
    if (backend === "managed") {
      adapters.push(wrapRuntimeBackend(backend, createManagedRuntimeAdapter(factoryConfig)));
      continue;
    }
    adapters.push(wrapRuntimeBackend(backend, new CmuxAdapter({ cmuxCommand })));
  }
  return adapters;
}

/**
 * Creates the selected runtime adapter set from configured backends.
 *
 * @param runtimeBackends Ordered backend list from config.
 * @param adapters Runtime backend adapters.
 * @returns Adapter used by the bridge runtime.
 */
export function createRuntimeAdapter(
  adapters: RuntimeBackendContract[]
): RuntimeAdapter {
  if (adapters.length === 0) {
    throw new Error("At least one runtime backend adapter is required");
  }
  if (adapters.length === 1) {
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
export async function checkRuntimeBackendAvailability(
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
 * Logs startup availability state for every configured backend.
 *
 * @param availability Availability rows.
 * @returns Number of available backends.
 */
export function logRuntimeBackendAvailability(availability: RuntimeBackendAvailability[]): number {
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
export function isTmuxOnly(runtimeBackends: RuntimeBackendId[]): boolean {
  return runtimeBackends.length === 1 && runtimeBackends[0] === "tmux";
}

/**
 * Resolves startup transport configuration from normalized runtime config.
 *
 * @param config Runtime bridge configuration.
 * @returns Normalized startup transport configuration.
 */
export function resolveStartupTransportConfig(config: BridgeConfig): StartupTransportConfig {
  return {
    mode: config.transportMode,
    sshProfile: config.sshProfileName,
    sshTarget: config.sshTarget,
    sshPort: config.sshPort,
    sshCommand: config.sshCommand,
    sshConnectTimeoutSeconds: config.sshConnectTimeoutSeconds,
    sshStrictHostKeyChecking: config.sshStrictHostKeyChecking,
    sshKnownHostsFile: normalizeOptionalTransportString(config.sshKnownHostsFile),
    sshExpectedFingerprintSha256: normalizeOptionalTransportString(config.sshExpectedFingerprintSha256)
  };
}

/**
 * Creates the tmux runtime adapter for the configured transport mode.
 *
 * @param transportConfig Startup transport configuration.
 * @returns Local or SSH tmux runtime adapter.
 */
export function createTmuxRuntimeAdapter(transportConfig: StartupTransportConfig): RuntimeAdapter {
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
    strictHostKeyChecking: transportConfig.sshStrictHostKeyChecking,
    knownHostsFile: transportConfig.sshKnownHostsFile,
    expectedFingerprintSha256: transportConfig.sshExpectedFingerprintSha256
  });
}

/**
 * Creates the managed runtime adapter for local daemon-backed process ownership.
 *
 * @param factoryConfig Runtime backend factory configuration.
 * @returns Configured managed runtime adapter.
 */
export function createManagedRuntimeAdapter(
  factoryConfig: Pick<
    RuntimeBackendFactoryConfig,
    "managedCommand" | "managedStateDir" | "managedCommandTimeoutMs"
  >
): RuntimeAdapter {
  return new ManagedAdapter({
    command: factoryConfig.managedCommand,
    stateDir: factoryConfig.managedStateDir,
    commandTimeoutMs: factoryConfig.managedCommandTimeoutMs
  });
}

/**
 * Legacy managed-runtime factory alias retained for `oly` references.
 *
 * @param factoryConfig Runtime backend factory configuration.
 * @returns Configured managed runtime adapter.
 */
export function createOlyRuntimeAdapter(
  factoryConfig: Pick<
    RuntimeBackendFactoryConfig,
    "managedCommand" | "managedStateDir" | "managedCommandTimeoutMs"
  >
): RuntimeAdapter {
  return createManagedRuntimeAdapter(factoryConfig);
}

function normalizeOptionalTransportString(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
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
    listPanes: async () => (await adapter.listPanes()) as RuntimePane[],
    capturePane: async (paneId: string, lines: number) => await adapter.capturePane(paneId, lines),
    sendInput: async (paneId: string, rawInput: string) => await adapter.sendInput(paneId, rawInput)
  };
}

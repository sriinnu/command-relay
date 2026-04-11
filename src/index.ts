/**
 * @file CommandRelay bridge runtime entry point.
 */

import process from "node:process";
import {
  loadConfig,
  validateStartupConfig
} from "./config.js";
import { startBridgeServer } from "./server/bridge-server.js";
import { loadProxySettings } from "./net/proxy-router.js";
import { ProxyAgentFactory } from "./net/proxy-agent-factory.js";
import { checkSshClientAvailability } from "./ssh/ssh-preflight.js";
import {
  checkRuntimeBackendAvailability,
  createRuntimeAdapter,
  createRuntimeBackends,
  isTmuxOnly,
  logRuntimeBackendAvailability,
  resolveStartupTransportConfig,
  type StartupTransportConfig
} from "./runtime/runtime-adapter-factory.js";
import {
  assertStartupProfilePass,
  evaluateStartupProfile,
  logStartupProfileReport
} from "./startup/startup-profile.js";

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
    managedCommand: config.managedCommand,
    managedStateDir: config.managedStateDir,
    managedCommandTimeoutMs: config.managedCommandTimeoutMs,
    transportConfig
  });
  const backendAvailability = await checkRuntimeBackendAvailability(runtimeBackends);
  const availableBackends = logRuntimeBackendAvailability(backendAvailability);
  if (availableBackends === 0 && !isTmuxOnly(config.runtimeBackends)) {
    throw new Error(
      `No configured runtime backends are available (${config.runtimeBackends.join(",")})`
    );
  }
  const startupProfile = await evaluateStartupProfile({
    config: {
      runtimeBackends: config.runtimeBackends,
      appStaticEnabled: config.appStaticEnabled,
      appStaticDir: config.appStaticDir,
      auditLogPath: config.auditLogPath
    },
    runtimeAvailability: backendAvailability
  });
  logStartupProfileReport(startupProfile);
  assertStartupProfilePass(startupProfile);

  const runtimeAdapter = createRuntimeAdapter(runtimeBackends);
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

  let shutdownFlight: Promise<void> | null = null;
  const shutdown = (signal: string): Promise<void> => {
    if (shutdownFlight) {
      console.info(`[bridge] received ${signal} during shutdown; ignoring`);
      return shutdownFlight;
    }

    console.info(`[bridge] received ${signal}; shutting down`);
    shutdownFlight = (async () => {
      try {
        await runtime.close();
        process.exit(0);
      } catch (error) {
        console.error("[bridge] shutdown failed", error);
        process.exit(1);
      }
    })();
    return shutdownFlight;
  };

  const onSigint = (): void => {
    void shutdown("SIGINT");
  };
  const onSigterm = (): void => {
    void shutdown("SIGTERM");
  };

  process.on("SIGINT", onSigint);
  process.on("SIGTERM", onSigterm);
}

main().catch((error) => {
  console.error("[bridge] fatal startup error", error);
  process.exit(1);
});

/**
 * @file CommandRelay bridge runtime entry point.
 */

import process from "node:process";
import { loadConfig, type RuntimeBackend as RuntimeBackendId, validateStartupConfig } from "./config.js";
import { TmuxAdapter } from "./tmux/tmux-adapter.js";
import { CmuxAdapter } from "./runtime/cmux-adapter.js";
import { RuntimeMultiplexer } from "./runtime/runtime-multiplexer.js";
import type { RuntimeBackend as RuntimeBackendContract } from "./runtime/runtime-backend.js";
import { startBridgeServer } from "./server/bridge-server.js";
import { loadProxySettings } from "./net/proxy-router.js";
import { ProxyAgentFactory } from "./net/proxy-agent-factory.js";

interface RuntimeAdapter {
  isAvailable: () => Promise<boolean>;
  listPanes: () => Promise<unknown[]>;
  capturePane: (paneId: string, lines: number) => Promise<string>;
  sendInput: (paneId: string, rawInput: string) => Promise<void>;
}

/**
 * Creates the selected runtime adapter set from configured backends.
 *
 * @param runtimeBackends Ordered backend list from config.
 * @returns Adapter used by the bridge runtime.
 */
async function createRuntimeAdapter(runtimeBackends: RuntimeBackendId[]): Promise<RuntimeAdapter> {
  const adapters: RuntimeBackendContract[] = [];
  for (const backend of runtimeBackends) {
    if (backend === "tmux") {
      adapters.push(wrapRuntimeBackend(backend, new TmuxAdapter()));
      continue;
    }
    adapters.push(wrapRuntimeBackend(backend, new CmuxAdapter()));
  }

  if (runtimeBackends.length === 1 && runtimeBackends[0] === "tmux") {
    return adapters[0];
  }

  return new RuntimeMultiplexer({ backends: adapters });
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
 * Boots the CommandRelay bridge runtime.
 *
 * @returns {Promise<void>} Completes when shutdown finishes.
 */
async function main() {
  const config = loadConfig();
  validateStartupConfig(config);

  if (config.globalInputDisabled) {
    console.warn("[bridge] COMMANDRELAY_INPUT_KILL_SWITCH is active; remote input is disabled");
  }
  if (config.appStaticEnabled) {
    console.info(`[bridge] static app hosting enabled at /app from ${config.appStaticDir}`);
  } else {
    console.info("[bridge] static app hosting disabled");
  }
  console.info(`[bridge] runtime backends: ${config.runtimeBackends.join(",")}`);

  const runtimeAdapter = await createRuntimeAdapter(config.runtimeBackends);
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

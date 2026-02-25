/**
 * @file CommandRelay bridge runtime entry point.
 */

import process from "node:process";
import { loadConfig, validateStartupConfig } from "./config.js";
import { TmuxAdapter } from "./tmux/tmux-adapter.js";
import { startBridgeServer } from "./server/bridge-server.js";
import { loadProxySettings } from "./net/proxy-router.js";
import { ProxyAgentFactory } from "./net/proxy-agent-factory.js";

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

  const tmux = new TmuxAdapter();
  const proxySettings = loadProxySettings();
  const proxyFactory = new ProxyAgentFactory({ settings: proxySettings });

  if (proxySettings.httpProxy || proxySettings.httpsProxy || proxySettings.allProxy) {
    console.info("[bridge] outbound proxy settings detected");
  }
  void proxyFactory;

  const runtime = await startBridgeServer({
    config,
    tmux,
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

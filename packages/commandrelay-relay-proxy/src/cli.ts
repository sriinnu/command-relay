#!/usr/bin/env node
import process from "node:process";

import {
  createRelayProxyServer,
  normalizeRelayOptions,
  parseRelayProxyEnv,
  type RelayProxyHandle
} from "./index.js";

interface CliConfig {
  listenHost: string;
  listenPort: string;
  relayPath: string;
  healthPath: string;
  upstreamUrl: string;
  maxConnections: string;
  idleTimeoutMs: string;
  shutdownTimeoutMs: string;
  requiredToken: string;
  allowedOrigins: string;
  upstreamSubprotocols: string;
  help?: boolean;
}

/**
 * CLI entrypoint for commandrelay-relay-proxy.
 */
async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return;
  }
  const env = parseRelayProxyEnv(process.env);
  const values = normalizeRelayOptions({
    listenHost: args.listenHost || env.listenHost,
    listenPort: parsePositiveIntArg(args.listenPort, env.listenPort),
    relayPath: args.relayPath || env.relayPath,
    healthPath: args.healthPath || env.healthPath,
    upstreamUrl: args.upstreamUrl || env.upstreamUrl,
    maxConnections: parsePositiveIntArg(args.maxConnections, env.maxConnections),
    idleTimeoutMs: parsePositiveIntArg(args.idleTimeoutMs, env.idleTimeoutMs),
    shutdownTimeoutMs: parsePositiveIntArg(args.shutdownTimeoutMs, env.shutdownTimeoutMs),
    requiredToken: args.requiredToken || env.requiredToken,
    allowedOrigins: args.allowedOrigins || env.allowedOrigins,
    upstreamSubprotocols: args.upstreamSubprotocols || env.upstreamSubprotocols
  });

  const handle = await createRelayProxyServer(values);
  await handle.started;

  process.on("SIGINT", () => {
    void stop(handle, "SIGINT");
  });
  process.on("SIGTERM", () => {
    void stop(handle, "SIGTERM");
  });

  console.info(
    `commandrelay-relay-proxy listening ${values.listenHost}:${values.listenPort}${values.relayPath}`
  );
  console.info(`health: ${values.healthPath}`);
  console.info(`upstream: ${values.upstreamUrl}`);
}

function parseArgs(argv: string[]): CliConfig {
  const config: CliConfig = {
    listenHost: "",
    listenPort: "",
    relayPath: "",
    healthPath: "",
    upstreamUrl: "",
    maxConnections: "",
    idleTimeoutMs: "",
    shutdownTimeoutMs: "",
    requiredToken: "",
    allowedOrigins: "",
    upstreamSubprotocols: ""
  };

  let index = 0;
  while (index < argv.length) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--help" || arg === "-h") {
      config.help = true;
      return config;
    }
    if (arg === "--host") {
      if (!next) throw new Error("missing --host");
      config.listenHost = next;
      index += 2;
      continue;
    }
    if (arg === "--port") {
      if (!next) throw new Error("missing --port");
      config.listenPort = next;
      index += 2;
      continue;
    }
    if (arg === "--relay-path") {
      if (!next) throw new Error("missing --relay-path");
      config.relayPath = next;
      index += 2;
      continue;
    }
    if (arg === "--health-path") {
      if (!next) throw new Error("missing --health-path");
      config.healthPath = next;
      index += 2;
      continue;
    }
    if (arg === "--upstream") {
      if (!next) throw new Error("missing --upstream");
      config.upstreamUrl = next;
      index += 2;
      continue;
    }
    if (arg === "--max-connections") {
      if (!next) throw new Error("missing --max-connections");
      config.maxConnections = next;
      index += 2;
      continue;
    }
    if (arg === "--idle-timeout-ms") {
      if (!next) throw new Error("missing --idle-timeout-ms");
      config.idleTimeoutMs = next;
      index += 2;
      continue;
    }
    if (arg === "--shutdown-timeout-ms") {
      if (!next) throw new Error("missing --shutdown-timeout-ms");
      config.shutdownTimeoutMs = next;
      index += 2;
      continue;
    }
    if (arg === "--token") {
      if (!next) throw new Error("missing --token");
      config.requiredToken = next;
      index += 2;
      continue;
    }
    if (arg === "--allowed-origins") {
      if (!next) throw new Error("missing --allowed-origins");
      config.allowedOrigins = next;
      index += 2;
      continue;
    }
    if (arg === "--upstream-subprotocols") {
      if (!next) throw new Error("missing --upstream-subprotocols");
      config.upstreamSubprotocols = next;
      index += 2;
      continue;
    }
    if (arg === "--token-from-env") {
      if (!next) throw new Error("missing --token-from-env");
      const envKey = normalizeEnvKey(next);
      const envValue = process.env[envKey];
      if (envValue === undefined || envValue.trim() === "") {
        throw new Error(`missing env var: ${envKey}`);
      }
      config.requiredToken = envValue;
      index += 2;
      continue;
    }
    throw new Error(`unknown arg: ${arg}`);
  }
  return config;
}

function parsePositiveIntArg(value: string, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`invalid integer value: ${value}`);
  }
  return parsed;
}

function normalizeEnvKey(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9_]/g, "_");
}

async function stop(handle: RelayProxyHandle, reason: string): Promise<void> {
  try {
    await handle.close();
  } catch (error) {
    process.exitCode = 1;
    throw error;
  }
  process.exit(reason === "SIGINT" ? 130 : 0);
}

function printUsage(): void {
  console.info("Usage: commandrelay-relay-proxy [--host addr] [--port port] [--upstream ws://host:port/ws]");
  console.info("--relay-path /ws --health-path /health --max-connections 128 --idle-timeout-ms 120000");
  console.info("env:");
  for (const option of [
    "COMMANDRELAY_RELAY_LISTEN_HOST",
    "COMMANDRELAY_RELAY_LISTEN_PORT",
    "COMMANDRELAY_RELAY_PATH",
    "COMMANDRELAY_RELAY_HEALTH_PATH",
    "COMMANDRELAY_RELAY_UPSTREAM_URL",
    "COMMANDRELAY_RELAY_MAX_CONNECTIONS",
    "COMMANDRELAY_RELAY_IDLE_TIMEOUT_MS",
    "COMMANDRELAY_RELAY_SHUTDOWN_TIMEOUT_MS",
    "COMMANDRELAY_RELAY_REQUIRED_TOKEN",
    "COMMANDRELAY_RELAY_ALLOWED_ORIGINS",
    "COMMANDRELAY_RELAY_UPSTREAM_SUBPROTOCOLS"
  ]) {
    console.info(`  - ${option}`);
  }
  console.info("Security note: when token is configured, clients must pass `Authorization: Bearer <token>`");
}

void main().catch((error) => {
  if (error instanceof Error) {
    console.error(`commandrelay-relay-proxy failed: ${error.message}`);
  } else {
    console.error("commandrelay-relay-proxy failed: unknown error");
  }
  process.exitCode = 1;
});

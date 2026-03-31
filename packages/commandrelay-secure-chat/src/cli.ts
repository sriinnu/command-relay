#!/usr/bin/env node
import process from "node:process";

import { SecureChatClient } from "./client.js";
import { SecureChatServer } from "./server.js";

interface CliConfig {
  command: "serve" | "connect";
  host: string;
  port: number;
  username: string;
  password: string;
}

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 8787;

/**
 * CLI entrypoint for secure terminal chat.
 */
async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.command === "serve") {
    await startServer(args.host, args.port, args.password);
  } else {
    await startClient(args.host, args.port, args.username, args.password);
  }
}

async function startServer(host: string, port: number, password: string): Promise<void> {
  const server = new SecureChatServer({ password });
  await server.start(host, port);
  console.info(`commandrelay-secure-chat serving on ${host}:${port}`);

  const shutdown = async (): Promise<void> => {
    await server.stop();
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
}

async function startClient(
  host: string,
  port: number,
  username: string,
  password: string
): Promise<void> {
  const client = new SecureChatClient(host, port, username, password);
  await client.runAsync();
}

function printUsage(): void {
  console.info("commandrelay-secure-chat");
  console.info("");
  console.info("Usage: commandrelay-secure-chat <serve|connect> [options]");
  console.info("If no command is supplied, serve is used.");
  console.info("");
  console.info("Commands:");
  console.info("  serve    Run a secure chat server");
  console.info("  connect  Connect a secure chat client");
  console.info("");
  console.info("Global options:");
  console.info("  --host <host>       Host (default 127.0.0.1)");
  console.info("  --port <port>       Port (default 8787)");
  console.info("  --password <value>  Shared password");
  console.info("");
  console.info("Connect options:");
  console.info("  --username <name>   Username");
  console.info("");
  console.info("Environment fallback:");
  console.info("  COMMANDRELAY_SECURE_CHAT_HOST");
  console.info("  COMMANDRELAY_SECURE_CHAT_PORT");
  console.info("  COMMANDRELAY_SECURE_CHAT_PASSWORD");
  console.info("  COMMANDRELAY_SECURE_CHAT_USERNAME");
  console.info("");
  console.info("Examples:");
  console.info("  commandrelay-secure-chat serve --password topsecret");
  console.info("  commandrelay-secure-chat connect --username alice --password topsecret");
}

function parseArgs(argv: string[]): CliConfig {
  if (argv.includes("--help") || argv.includes("-h")) {
    printUsage();
    process.exit(0);
  }

  const commandArg = argv[0];
  const command = ((): CliConfig["command"] => {
    if (!commandArg || commandArg.startsWith("--")) {
      return "serve";
    }
    if (commandArg === "serve" || commandArg === "connect") {
      return commandArg;
    }
    throw new Error(`unknown command '${commandArg}'`);
  })();
  const args = commandArg && (commandArg === "serve" || commandArg === "connect")
    ? argv.slice(1)
    : argv;

  const parsed = parseOptions(args);
  const host = parsed.host || process.env.COMMANDRELAY_SECURE_CHAT_HOST || DEFAULT_HOST;
  const port = resolvePort(parsed.port ?? process.env.COMMANDRELAY_SECURE_CHAT_PORT);
  const password =
    parsed.password || process.env.COMMANDRELAY_SECURE_CHAT_PASSWORD || "";
  const username =
    parsed.username ||
    process.env.COMMANDRELAY_SECURE_CHAT_USERNAME ||
    process.env.USER ||
    "";

  if (!password) {
    throw new Error("missing --password");
  }
  if (command === "connect" && !username.trim()) {
    throw new Error("missing --username");
  }

  return {
    command,
    host,
    port,
    username,
    password
  };
}

function parseOptions(argv: string[]): { host?: string; port?: string; username?: string; password?: string } {
  const parsed: { host?: string; port?: string; username?: string; password?: string } = {};

  let index = 0;
  while (index < argv.length) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--host") {
      if (!next) throw new Error("missing --host");
      parsed.host = next;
      index += 2;
      continue;
    }
    if (arg === "--port") {
      if (!next) throw new Error("missing --port");
      parsed.port = next;
      index += 2;
      continue;
    }
    if (arg === "--username") {
      if (!next) throw new Error("missing --username");
      parsed.username = next;
      index += 2;
      continue;
    }
    if (arg === "--password") {
      if (!next) throw new Error("missing --password");
      parsed.password = next;
      index += 2;
      continue;
    }

    throw new Error(`unknown argument '${arg}'`);
  }

  return parsed;
}

function resolvePort(raw: string | undefined): number {
  if (!raw) {
    return DEFAULT_PORT;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65_535) {
    throw new Error(`invalid --port '${raw}'`);
  }
  return parsed;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  printUsage();
  process.exit(1);
});

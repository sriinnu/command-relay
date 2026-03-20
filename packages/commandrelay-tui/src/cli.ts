#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import path from "node:path";
import process from "node:process";

import {
  isValidProfileName,
  resolveProfileSelection,
  touchProfile
} from "./connection-profile.js";
import { isBackend, detectTerminalBackend } from "./backend.js";
import { resolveStoredAuthToken, promptToken } from "./token.js";
import { createCliCommandHandlers } from "./cli-commands.js";
import { createCliRuntime, RECONNECT_COOLDOWN_MS, RECONNECT_FAILURE_THRESHOLD } from "./cli-runtime.js";
import { createInitialCliState } from "./cli-state.js";
import type { CliState } from "./cli-state.js";
import { createQaModeUsage, runProductionQaMode } from "./qa-mode.js";
import { loadCommandRelayClientModule } from "./commandrelay-client-loader.js";

const DEFAULT_WS_URL = "ws://127.0.0.1:8787/ws";
const CLI_SCRIPT_PATH = path.resolve(fileURLToPath(import.meta.url));
type CommandRelayClientModule = Awaited<ReturnType<typeof loadCommandRelayClientModule>>;

interface CliArgs {
  explicitUrl: boolean;
  url: string;
  profile: string | null;
  command: string;
  backend: "tmux" | "ghostty" | "console" | null;
  qaMode: boolean;
  qaSections: string[];
  qaSkipInstall: boolean;
  qaArtifact: string | null;
}

const state: CliState = createInitialCliState();
let runtime: ReturnType<typeof createCliRuntime>;
let commandRelayClientModule: CommandRelayClientModule | null = null;

/**
 * Entry-point command loop for the terminal UI.
 */
async function main(): Promise<void> {
  let args: CliArgs;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    printUsage();
    writeLine(`error: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
    return;
  }

  if (args.qaMode) {
    let allPass = false;
    try {
      allPass = await runProductionQaMode({
        selectedSections: args.qaSections,
        skipInstall: args.qaSkipInstall,
        artifactPath: args.qaArtifact ?? undefined
      });
    } catch (error) {
      writeLine(`qa mode failed: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
      return;
    }
    process.exitCode = allPass ? 0 : 1;
    return;
  }

  state.activeProfile = resolveProfileSelection(args.profile);
  state.backend = detectTerminalBackend(args.backend);
  state.url = args.url;

  if (state.activeProfile.selectedProfile) {
    if (!args.explicitUrl) {
      state.url = state.activeProfile.selectedProfile.url;
    }
    if (!args.backend && state.activeProfile.selectedProfile.backend) {
      state.backend = isBackend(state.activeProfile.selectedProfile.backend)
        ? state.activeProfile.selectedProfile.backend
        : state.backend;
    }
    if (state.activeProfile.selectedProfile.authToken) {
      state.authToken = state.activeProfile.selectedProfile.authToken;
    }
  }

  if (!state.authToken) {
    state.authToken = resolveStoredAuthToken();
  }

  runtime = createCliRuntime({
    state,
    writeLine,
    connectAndBootstrap
  });

  const handlers = createCliCommandHandlers({
    state,
    writeLine,
    connectAndBootstrap,
    requestReconnect: runtime.reconnectNow,
    requestDisconnect: runtime.disconnectCleanly,
    requestExit: () => process.exit(0),
    refreshSessions: runtime.refreshSessions,
    reconnectMetricsLine: runtime.getReconnectMetricsLine
  });

  state.userRequestedClose = false;
  state.reconnectAttempts = 0;

  try {
    await connectAndBootstrap();
  } catch (error) {
    writeLine(`connect failure: ${error instanceof Error ? error.message : String(error)}`);
    if (commandRelayClientModule?.isAuthenticationError(error)) {
      writeLine("start disconnected; use /token to provide valid credentials");
      await handlers.runCommand("/help");
      runtime.runReadlineLoop(handlers);
      return;
    }
    writeLine("connection unavailable; auto-reconnect is active when possible.");
    writeLine("run /reconnect to retry immediately.");
    await handlers.runCommand("/help");
    runtime.runReadlineLoop(handlers);
    return;
  }

  if (args.command.trim()) {
    await handlers
      .runCommand(args.command.trim())
      .catch((error) => writeLine(error instanceof Error ? error.message : String(error)));
  }

  writeLine(`local terminal backend: ${state.backend}`);
  await handlers.runCommand("/help");
  runtime.runReadlineLoop(handlers);
}

async function connectAndBootstrap(): Promise<void> {
  if (!runtime) {
    throw new Error("runtime not initialized");
  }
  const clientModule = await loadCommandRelayClientModule();
  commandRelayClientModule = clientModule;
  state.userRequestedClose = false;
  const client = new clientModule.CommandRelayClient(state.url, { strictProtocolParsing: true });
  state.client = client;
  runtime.wireClientEvents(client);

  try {
    await client.connect();

    if (client.hello?.requiresAuth) {
      const token = state.authToken || (await promptToken());
      if (!token) throw new Error("auth token required");
      try {
        await client.authenticate(token);
        state.authToken = token;
        writeLine("authenticated");
      } catch (error) {
        state.authToken = null;
        throw error;
      }
    } else {
      writeLine(`connected to ${client.hello?.clientId ?? "server"}`);
    }

    state.authFailureBlocked = false;
    state.hello = {
      requiresAuth: client.hello?.requiresAuth ?? false,
      inputEnabled: client.hello?.inputEnabled ?? false,
      globalInputDisabled: client.hello?.globalInputDisabled ?? false,
      maxInputBytes: client.hello?.maxInputBytes
    };
    state.reconnectAttempts = 0;
    state.reconnectFailures = 0;
    state.reconnectCooldownUntil = 0;

    await runtime.refreshSessions(true);
    if (state.activeProfile.activeProfileName) {
      touchProfile(state.activeProfile.activeProfileName);
    }
    runtime.startHeartbeat();
  } catch (error) {
    if (clientModule.isAuthenticationError(error)) {
      state.authFailureBlocked = true;
      state.authToken = null;
      state.reconnectFailures = 0;
      state.reconnectAttempts = 0;
      state.reconnectCooldownUntil = 0;
      writeLine("authentication failed; use /token to provide valid credentials");
    } else {
      state.reconnectFailures += 1;
      if (state.reconnectFailures >= RECONNECT_FAILURE_THRESHOLD) {
        const now = Date.now();
        state.reconnectCooldownUntil = now + RECONNECT_COOLDOWN_MS;
        state.reconnectFailures = 0;
        state.reconnectAttempts = 0;
        writeLine(`temporary network issue; cooling down for ${RECONNECT_COOLDOWN_MS / 1000}s`);
      }
    }

    client.close(1000, "bootstrap failure");
    throw error;
  }
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    explicitUrl: false,
    url: DEFAULT_WS_URL,
    profile: null,
    command: "",
    backend: null,
    qaMode: false,
    qaSections: [],
    qaSkipInstall: false,
    qaArtifact: null
  };

  let index = 0;
  while (index < argv.length) {
    const current = argv[index];
    const next = argv[index + 1];

    if (current === "--url") {
      if (!next) {
        throw new Error("missing --url value");
      }
      args.url = next;
      args.explicitUrl = true;
      index += 2;
      continue;
    }

    if (current === "--profile") {
      if (!next) {
        throw new Error("missing --profile value");
      }
      if (!isValidProfileName(next)) {
        throw new Error(`invalid --profile '${next}'`);
      }
      args.profile = next;
      index += 2;
      continue;
    }

    if (current === "--backend") {
      if (!next) {
        throw new Error("missing --backend value");
      }
      if (!isBackend(next)) {
        throw new Error(`invalid backend '${next}'`);
      }
      args.backend = next;
      index += 2;
      continue;
    }

    if (current === "--help" || current === "-h") {
      printUsage();
      process.exit(0);
    }

    if (current === "--qa") {
      args.qaMode = true;
      index += 1;
      continue;
    }

    if (current === "--qa-skip-install") {
      args.qaSkipInstall = true;
      index += 1;
      continue;
    }

    if (current === "--qa-artifact") {
      if (!next) {
        throw new Error("missing --qa-artifact value");
      }
      args.qaArtifact = next;
      index += 2;
      continue;
    }

    if (current === "--qa-sections") {
      if (!next) {
        throw new Error("missing --qa-sections value");
      }
      args.qaSections = next
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
      index += 2;
      continue;
    }

    if (current === "--") {
      args.command = argv.slice(index + 1).join(" ");
      return args;
    }

    if (current.startsWith("--")) {
      throw new Error(`unknown option '${current}'`);
    }

    if (!args.command) {
      args.command = argv.slice(index).join(" ");
      break;
    }
  }

  return args;
}

function printUsage(): void {
  writeLine("Usage: commandrelay-tui [--url ws-url] [--profile name] [--backend tmux|ghostty|console] [command]");
  writeLine("Usage: commandrelay-tui --qa [--qa-sections <deps,ci,release,relay,smoke|all|1,2,3..>] [--qa-skip-install] [--qa-artifact <path>]");
  writeLine("  Runs the production checklist with check-off section progress and final PASS/FAIL summary.");
  writeLine(createQaModeUsage());
}

/**
 * Lightweight line output helper.
 */
function writeLine(text: string): void {
  process.stdout.write(`${text}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === CLI_SCRIPT_PATH) {
  void main();
}

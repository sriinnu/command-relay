import readline from "node:readline";

import {
  CommandRelayClient,
  isAuthenticationError,
  type GatewayEnvelope,
  type GatewayErrorPayload,
  type HelloPayload,
  type OutputPayload,
  type PolicyUpdatePayload,
  type SessionListPayload
} from "@commandrelay/client";

import type { CliCommandHandlers } from "./cli-commands.js";
import type { CliState } from "./cli-state.js";

const HEARTBEAT_INTERVAL_MS = 15_000;
export const RECONNECT_ATTEMPTS_MAX = 6;
export const RECONNECT_COOLDOWN_MS = 45_000;
export const RECONNECT_FAILURE_THRESHOLD = 3;
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 20_000;
const RECONNECT_JITTER_MS = 250;

interface CliRuntimeContext {
  state: CliState;
  writeLine: (text: string) => void;
  connectAndBootstrap: () => Promise<void>;
}

export interface CliRuntime {
  refreshSessions(silent: boolean): Promise<void>;
  wireClientEvents(client: CommandRelayClient): void;
  runReadlineLoop(handlers: CliCommandHandlers): void;
  reconnectNow(): Promise<void>;
  disconnectCleanly(): Promise<void>;
  startHeartbeat(): void;
  getReconnectMetricsLine(): string;
}

/**
 * Construct runtime helpers for transport lifecycle and TUI event loop.
 */
export function createCliRuntime(context: CliRuntimeContext): CliRuntime {
  const { state, writeLine, connectAndBootstrap } = context;

  async function refreshSessions(silent: boolean): Promise<void> {
    if (!state.client) return;
    try {
      await state.client.listSessions();
    } catch (error: unknown) {
      if (!silent) writeLine(`list failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  function scheduleReconnect(): void {
    if (state.userRequestedClose) return;
    if (state.reconnectTimer) return;

    const now = Date.now();
    if (state.reconnectCooldownUntil > now) {
      const remaining = Math.ceil((state.reconnectCooldownUntil - now) / 1000);
      const remainingMs = Math.max(state.reconnectCooldownUntil - now, 0);
      const jitter = Math.floor(Math.random() * RECONNECT_JITTER_MS);
      const delay = remainingMs + jitter;

      writeLine(`reconnect cooldown active: ${remaining}s remaining`);
      writeLine(getReconnectMetricsLine());
      state.reconnectTimer = setTimeout(() => {
        state.reconnectTimer = null;
        scheduleReconnect();
      }, delay);
      return;
    }

    if (state.reconnectAttempts >= RECONNECT_ATTEMPTS_MAX) {
      const next = Date.now() + RECONNECT_COOLDOWN_MS;
      state.reconnectCooldownUntil = next;
      state.reconnectAttempts = 0;
      state.reconnectFailures = 0;
      writeLine(`reconnect attempts exhausted; cooling down for ${RECONNECT_COOLDOWN_MS / 1000}s`);
      writeLine(getReconnectMetricsLine());
      scheduleReconnect();
      return;
    }

    const jitter = Math.floor(Math.random() * RECONNECT_JITTER_MS);
    const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** state.reconnectAttempts++) + jitter;
    writeLine(`reconnecting in ${Math.ceil(delay / 1000)}s (attempt ${state.reconnectAttempts}/${RECONNECT_ATTEMPTS_MAX})`);
    writeLine(getReconnectMetricsLine());

    if (state.reconnectTimer) {
      clearTimeout(state.reconnectTimer);
    }

    state.reconnectTimer = setTimeout(async () => {
      state.reconnectTimer = null;
      try {
        stopHeartbeat();
        state.client = null;
        state.hello = null;
        state.activePane = null;
        await connectAndBootstrap();
        writeLine("reconnected");
      } catch (error) {
        writeLine(`reconnect failed: ${error instanceof Error ? error.message : String(error)}`);
        scheduleReconnect();
      }
    }, delay);
  }

  async function reconnectNow(): Promise<void> {
    if (state.client || state.connected) {
      writeLine("already connected; use /token for auth or /quit then /reconnect");
      return;
    }

    if (state.reconnectTimer) {
      clearTimeout(state.reconnectTimer);
      state.reconnectTimer = null;
    }

    state.authFailureBlocked = false;
    state.reconnectFailures = 0;
    state.reconnectAttempts = 0;
    state.reconnectCooldownUntil = 0;
    writeLine("manual reconnect requested");

    try {
      await connectAndBootstrap();
    } catch (error) {
      if (!isAuthenticationError(error)) {
        writeLine(`reconnect failed: ${error instanceof Error ? error.message : String(error)}`);
        scheduleReconnect();
      }
    }
  }

  function isAuthenticationClose(reason: string, code: number): boolean {
    if (code === 1008) return true;
    return /auth|token|credential|permission|invalid token|forbidden|not authorized/.test(reason.toLowerCase());
  }

  function startHeartbeat(): void {
    if (!state.client || state.heartbeatTimer !== null) return;
    state.heartbeatTimer = setInterval(async () => {
      try {
        await state.client?.heartbeat();
      } catch {
        // heartbeat failures are non-fatal; reconnect logic handles disconnects.
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  function stopHeartbeat(): void {
    if (!state.heartbeatTimer) return;
    clearInterval(state.heartbeatTimer);
    state.heartbeatTimer = null;
  }

  function wireClientEvents(client: CommandRelayClient): void {
    client.on("hello", () => {
      state.connected = true;
    });

    client.on("session_list", (message: GatewayEnvelope<SessionListPayload>) => {
      const sessions = Array.isArray(message.payload.sessions) ? message.payload.sessions : [];
      const panes = Array.isArray(message.payload.panes) ? message.payload.panes : [];
      writeLine(`sessions=${sessions.length} panes=${panes.length}`);
      for (const session of sessions) {
        const name = typeof session.sessionName === "string" ? session.sessionName : "unknown";
        const paneIds = Array.isArray(session.paneIds) ? session.paneIds : [];
        writeLine(`  ${name}: ${paneIds.filter((paneId) => typeof paneId === "string").join(", ") || "(empty)"}`);
      }

      if (state.backend !== "console") {
        writeLine(`backend hint: ${state.backend}`);
      }
    });

    client.on("policy_update", (message: GatewayEnvelope<PolicyUpdatePayload>) => {
      if (state.hello) {
        state.hello.inputEnabled = Boolean(message.payload.inputEnabled);
        state.hello.globalInputDisabled = Boolean(message.payload.globalInputDisabled);
      }
    });

    client.on("output", (message: GatewayEnvelope<OutputPayload>) => {
      const paneId = message.payload.paneId;
      const chunk = message.payload.chunk;
      const streamSeq = message.payload.streamSeq;
      if (typeof paneId === "string" && Number.isInteger(streamSeq) && streamSeq >= 0) {
        state.lastSeqByPane.set(paneId, streamSeq);
      }
      if (paneId !== state.activePane) return;
      if (typeof chunk === "string" && chunk.length > 0) process.stdout.write(chunk);
    });

    client.on("error", (message: GatewayEnvelope<GatewayErrorPayload>) => {
      writeLine(`gateway error: ${String(message.payload.code)}`);
    });
    client.on("auth_error", (message: GatewayEnvelope<GatewayErrorPayload>) => {
      writeLine(`auth error: ${String(message.payload.code)}`);
    });
    client.on("parse_error", (error: Error) => writeLine(`parse error: ${error.message}`));
    client.on("close", (code: number, reason: string | Buffer) => {
      const closeReason = String(reason ?? "");
      state.connected = false;
      stopHeartbeat();
      state.client = null;
      state.hello = null;
      state.activePane = null;

      if (isAuthenticationClose(closeReason, code)) {
        state.authFailureBlocked = true;
        state.authToken = null;
        if (state.reconnectTimer) {
          clearTimeout(state.reconnectTimer);
          state.reconnectTimer = null;
        }
        writeLine("authentication closed connection; run /token");
      }

      if (!state.userRequestedClose && !state.authFailureBlocked) {
        scheduleReconnect();
      }
      writeLine(`closed ${code}: ${closeReason}`);
    });
  }

  async function disconnectCleanly(): Promise<void> {
    state.connected = false;
    state.userRequestedClose = true;

    if (state.reconnectTimer) {
      clearTimeout(state.reconnectTimer);
      state.reconnectTimer = null;
    }

    stopHeartbeat();

    if (!state.client) return;

    try {
      await state.client.disconnect();
    } catch {
      state.client.close(1000, "user exit");
    }

    state.client = null;
    state.hello = null;
    state.activePane = null;
  }

  function runReadlineLoop(handlers: CliCommandHandlers): void {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.setPrompt("crc> ");

    rl.on("line", async (rawLine) => {
      const trimmed = rawLine.trim();
      if (!trimmed) {
        rl.prompt();
        return;
      }
      if (trimmed.startsWith("/")) {
        await handlers.runCommand(trimmed);
      } else {
        await handlers.runInputCommand(trimmed);
      }
      rl.prompt();
    });

    rl.on("close", () => {
      void disconnectCleanly();
    });

    rl.on("SIGINT", () => {
      void disconnectCleanly();
      process.exit(0);
    });

    rl.prompt();
  }

  function getReconnectMetricsLine(): string {
    const now = Date.now();
    const cooldownRemainingMs = Math.max(state.reconnectCooldownUntil - now, 0);
    const timerState = state.reconnectTimer ? "armed" : "idle";
    return `reconnect metrics: attempts=${state.reconnectAttempts}/${RECONNECT_ATTEMPTS_MAX}, failures=${state.reconnectFailures}, cooldown=${Math.ceil(cooldownRemainingMs / 1000)}s, blocked=${state.authFailureBlocked}, timer=${timerState}`;
  }

  return {
    refreshSessions,
    wireClientEvents,
    runReadlineLoop,
    reconnectNow,
    disconnectCleanly,
    startHeartbeat,
    getReconnectMetricsLine
  };
}

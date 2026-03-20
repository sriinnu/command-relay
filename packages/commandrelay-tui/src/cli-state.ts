import type { ActiveProfileState } from "./connection-profile.js";
import type { CommandRelayClient } from "./commandrelay-client-loader.js";
import type { Backend } from "./backend.js";

/**
 * Last hello snapshot captured from gateway.
 */
export interface CliHelloState {
  requiresAuth: boolean;
  inputEnabled: boolean;
  globalInputDisabled: boolean;
  maxInputBytes?: number;
}

/**
 * Shared runtime state for the TUI CLI.
 */
export interface CliState {
  client: CommandRelayClient | null;
  backend: Backend;
  connected: boolean;
  hello: CliHelloState | null;
  activePane: string | null;
  lastSeqByPane: Map<string, number>;
  heartbeatTimer: ReturnType<typeof setInterval> | null;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  reconnectAttempts: number;
  reconnectFailures: number;
  reconnectCooldownUntil: number;
  userRequestedClose: boolean;
  authFailureBlocked: boolean;
  authToken: string | null;
  url: string;
  activeProfile: ActiveProfileState;
}

/**
 * Create a default CLI state object used at startup and test boundaries.
 */
export function createInitialCliState(): CliState {
  return {
    client: null,
    backend: "console",
    connected: false,
    hello: null,
    activePane: null,
    lastSeqByPane: new Map(),
    heartbeatTimer: null,
    reconnectTimer: null,
    reconnectAttempts: 0,
    reconnectFailures: 0,
    reconnectCooldownUntil: 0,
    userRequestedClose: false,
    authFailureBlocked: false,
    authToken: null,
    url: "ws://127.0.0.1:8787/ws",
    activeProfile: {
      activeProfileName: null,
      selectedProfile: null,
      hasProfileStore: false
    }
  };
}

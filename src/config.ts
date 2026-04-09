/**
 * @file Runtime configuration loader for the CommandRelay bridge server.
 */

import { accessSync, constants as fsConstants } from "node:fs";
import {
  parseBooleanEnv,
  parseBooleanEnvWithAlias,
  parseEnumEnv,
  parseIntEnv,
  parseOptionalStringEnv,
  parseStrictIntEnv,
  parseStringEnv,
  readAliasedEnv
} from "./config-env.js";
import { isValidSshProfileName, parseSshTarget } from "./ssh/ssh-target.js";

/** Runtime bridge configuration values. */
export interface BridgeConfig {
  runtimeBackends: RuntimeBackend[];
  cmuxCommand: string;
  managedCommand: string;
  managedStateDir: string | null;
  managedCommandTimeoutMs: number;
  host: string;
  port: number;
  transportMode: TransportMode;
  sshProfileName: string;
  sshTarget: string | null;
  sshPort: number;
  sshCommand: string;
  sshConnectTimeoutSeconds: number;
  sshStrictHostKeyChecking: boolean;
  sshKnownHostsFile: string | null;
  sshExpectedFingerprintSha256: string | null;
  strictProtocolParsing: boolean;
  appStaticEnabled: boolean;
  appStaticDir: string;
  pollIntervalMs: number;
  replayLines: number;
  maxHistoryEvents: number;
  maxInputBytes: number;
  maxAttachedPanes: number;
  maxMessagesPerMinute: number;
  maxInputsPerMinute: number;
  globalInputDisabled: boolean;
  allowInputOwnershipOverride: boolean;
  inputLaneLeaseMs: number;
  authToken: string | null;
  auditLogPath: string | null;
}

const SUPPORTED_RUNTIME_BACKENDS = ["tmux", "cmux", "managed"] as const;
const SUPPORTED_TRANSPORT_MODES = ["ws", "ssh"] as const;
const SSH_SHA256_FINGERPRINT_PATTERN = /^SHA256:[A-Za-z0-9+/]{43}=?$/;

/**
 * Supported backend identifiers for runtime pane operations.
 */
export type RuntimeBackend = (typeof SUPPORTED_RUNTIME_BACKENDS)[number];

/**
 * Supported transport mode identifiers for bridge connectivity.
 */
export type TransportMode = (typeof SUPPORTED_TRANSPORT_MODES)[number];

/**
 * Parses and validates optional SSH SHA256 fingerprint env value.
 *
 * @param raw Raw env value.
 * @param envName Environment variable name for error messages.
 * @returns Trimmed SHA256 fingerprint token or null.
 */
function parseOptionalSshFingerprintSha256Env(raw: string | undefined, envName: string): string | null {
  const parsed = parseOptionalStringEnv(raw);
  if (!parsed) return null;
  if (!SSH_SHA256_FINGERPRINT_PATTERN.test(parsed)) {
    throw new Error(`${envName} must match SHA256:<base64> format (received "${raw}")`);
  }

  return parsed;
}

/**
 * Parses and validates SSH profile env value.
 *
 * @param raw Raw env value.
 * @param fallback Fallback when value is unset.
 * @param envName Environment variable name for error messages.
 * @returns Normalized SSH profile name.
 */
function parseSshProfileNameEnv(raw: string | undefined, fallback: string, envName: string): string {
  if (raw === undefined) return fallback;
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error(`${envName} must be non-empty when provided`);
  }
  if (!isValidSshProfileName(trimmed)) {
    throw new Error(
      `${envName} must contain only letters, numbers, dot, underscore, or hyphen (received "${raw}")`
    );
  }

  return trimmed;
}

/**
 * Parses and validates optional SSH target env value.
 *
 * @param raw Raw env value.
 * @param envName Environment variable name for error messages.
 * @returns Trimmed SSH target or null.
 */
function parseOptionalSshTargetEnv(raw: string | undefined, envName: string): string | null {
  const parsed = parseOptionalStringEnv(raw);
  if (!parsed) return null;
  try {
    parseSshTarget(parsed);
  } catch {
    throw new Error(
      `${envName} must match [user@]host format (letters/numbers/._- or bracketed IPv6 host)`
    );
  }

  return parsed;
}

/**
 * Parses the backend list for runtime pane operations.
 *
 * @param raw Raw env value.
 * @returns Ordered runtime backend list with duplicates removed.
 */
function parseRuntimeBackendsEnv(raw: string | undefined): RuntimeBackend[] {
  if (!raw || !raw.trim()) return ["tmux"];

  const selected = raw
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  if (selected.length === 0) return ["tmux"];

  const deduped: RuntimeBackend[] = [];
  const seen = new Set<RuntimeBackend>();
  for (const backend of selected) {
    const normalizedBackend = backend === "oly" ? "managed" : backend;
    if (!SUPPORTED_RUNTIME_BACKENDS.includes(normalizedBackend as RuntimeBackend)) {
      throw new Error(
        `COMMANDRELAY_RUNTIME_BACKENDS contains unsupported backend "${backend}" (supported: ${SUPPORTED_RUNTIME_BACKENDS.join(",")}, legacy alias: oly->managed)`
      );
    }
    const runtimeBackend = normalizedBackend as RuntimeBackend;
    if (seen.has(runtimeBackend)) continue;
    seen.add(runtimeBackend);
    deduped.push(runtimeBackend);
  }

  return deduped.length > 0 ? deduped : ["tmux"];
}

/**
 * Checks whether the host is loopback-only.
 *
 * @param host Hostname or address.
 * @returns True when host is loopback/local-only.
 */
function isLoopbackHost(host: string): boolean {
  return host === "127.0.0.1" || host === "::1" || host === "localhost";
}

/**
 * Loads bridge configuration from environment variables.
 *
 * @returns Normalized runtime configuration.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): BridgeConfig {
  const managedCommandEnv = readAliasedEnv(
    env,
    "COMMANDRELAY_MANAGED_COMMAND",
    "COMMANDRELAY_OLY_COMMAND"
  );
  const managedStateDirEnv = readAliasedEnv(
    env,
    "COMMANDRELAY_MANAGED_STATE_DIR",
    "COMMANDRELAY_OLY_STATE_DIR"
  );
  const managedTimeoutEnv = readAliasedEnv(
    env,
    "COMMANDRELAY_MANAGED_TIMEOUT_MS",
    "COMMANDRELAY_OLY_TIMEOUT_MS"
  );

  return {
    runtimeBackends: parseRuntimeBackendsEnv(env.COMMANDRELAY_RUNTIME_BACKENDS),
    cmuxCommand: parseStringEnv(env.COMMANDRELAY_CMUX_COMMAND, "cmux"),
    managedCommand: parseStringEnv(managedCommandEnv.value, "oly"),
    managedStateDir: parseOptionalStringEnv(managedStateDirEnv.value),
    managedCommandTimeoutMs: parseStrictIntEnv(
      managedTimeoutEnv.value,
      8_000,
      { min: 1_000, max: 60_000 },
      managedTimeoutEnv.source
    ),
    host: env.COMMANDRELAY_HOST || "127.0.0.1",
    port: parseIntEnv(env.COMMANDRELAY_PORT, 8787, { min: 1, max: 65535 }),
    transportMode: parseEnumEnv(
      env.COMMANDRELAY_TRANSPORT_MODE,
      "ws",
      SUPPORTED_TRANSPORT_MODES,
      "COMMANDRELAY_TRANSPORT_MODE"
    ),
    sshProfileName: parseSshProfileNameEnv(
      env.COMMANDRELAY_SSH_PROFILE,
      "primary",
      "COMMANDRELAY_SSH_PROFILE"
    ),
    sshTarget: parseOptionalSshTargetEnv(env.COMMANDRELAY_SSH_TARGET, "COMMANDRELAY_SSH_TARGET"),
    sshPort: parseStrictIntEnv(
      env.COMMANDRELAY_SSH_PORT,
      22,
      { min: 1, max: 65535 },
      "COMMANDRELAY_SSH_PORT"
    ),
    sshCommand: parseStringEnv(env.COMMANDRELAY_SSH_COMMAND, "ssh"),
    sshConnectTimeoutSeconds: parseStrictIntEnv(
      env.COMMANDRELAY_SSH_CONNECT_TIMEOUT_SECONDS,
      8,
      { min: 1, max: 60 },
      "COMMANDRELAY_SSH_CONNECT_TIMEOUT_SECONDS"
    ),
    sshStrictHostKeyChecking: parseBooleanEnv(
      env.COMMANDRELAY_SSH_STRICT_HOST_KEY_CHECKING,
      true,
      "COMMANDRELAY_SSH_STRICT_HOST_KEY_CHECKING"
    ),
    sshKnownHostsFile: parseOptionalStringEnv(env.COMMANDRELAY_SSH_KNOWN_HOSTS_FILE),
    sshExpectedFingerprintSha256: parseOptionalSshFingerprintSha256Env(
      env.COMMANDRELAY_SSH_EXPECTED_FINGERPRINT_SHA256,
      "COMMANDRELAY_SSH_EXPECTED_FINGERPRINT_SHA256"
    ),
    strictProtocolParsing: parseBooleanEnvWithAlias(
      env,
      "COMMANDRELAY_STRICT_PROTOCOL_PARSING",
      "COMMANDRELAY_STRICT_V1",
      true
    ),
    appStaticEnabled: parseBooleanEnv(
      env.COMMANDRELAY_APP_STATIC_ENABLED,
      true,
      "COMMANDRELAY_APP_STATIC_ENABLED"
    ),
    appStaticDir: parseStringEnv(env.COMMANDRELAY_APP_STATIC_DIR, "apps/web"),
    pollIntervalMs: parseIntEnv(env.COMMANDRELAY_POLL_MS, 350, { min: 100, max: 5000 }),
    replayLines: parseIntEnv(env.COMMANDRELAY_REPLAY_LINES, 200, { min: 20, max: 5000 }),
    maxHistoryEvents: parseIntEnv(env.COMMANDRELAY_HISTORY_EVENTS, 300, { min: 50, max: 5000 }),
    maxInputBytes: parseIntEnv(env.COMMANDRELAY_MAX_INPUT_BYTES, 4096, { min: 16, max: 65536 }),
    maxAttachedPanes: parseIntEnv(env.COMMANDRELAY_MAX_ATTACHED_PANES, 8, { min: 1, max: 64 }),
    maxMessagesPerMinute: parseIntEnv(env.COMMANDRELAY_MAX_MSG_PER_MIN, 240, { min: 30, max: 5000 }),
    maxInputsPerMinute: parseIntEnv(env.COMMANDRELAY_MAX_INPUT_PER_MIN, 60, { min: 5, max: 2000 }),
    globalInputDisabled: parseBooleanEnv(
      env.COMMANDRELAY_INPUT_KILL_SWITCH,
      false,
      "COMMANDRELAY_INPUT_KILL_SWITCH"
    ),
    allowInputOwnershipOverride: parseBooleanEnv(
      env.COMMANDRELAY_ALLOW_INPUT_OVERRIDE,
      true,
      "COMMANDRELAY_ALLOW_INPUT_OVERRIDE"
    ),
    inputLaneLeaseMs: parseIntEnv(
      env.COMMANDRELAY_INPUT_LANE_LEASE_MS,
      30_000,
      { min: 1_000, max: 300_000 }
    ),
    authToken: parseOptionalStringEnv(env.COMMANDRELAY_AUTH_TOKEN),
    auditLogPath: parseOptionalStringEnv(env.COMMANDRELAY_AUDIT_LOG)
  };
}

/**
 * Validates startup config for unsafe deployment combinations.
 *
 * @param config Runtime bridge configuration.
 * @returns Nothing.
 */
export function validateStartupConfig(config: BridgeConfig): void {
  if (!isLoopbackHost(config.host) && !config.authToken) {
    throw new Error(
      "COMMANDRELAY_AUTH_TOKEN is required when COMMANDRELAY_HOST is not loopback"
    );
  }
  if (config.transportMode === "ssh" && !config.sshTarget) {
    throw new Error(
      "COMMANDRELAY_SSH_TARGET is required when COMMANDRELAY_TRANSPORT_MODE is ssh"
    );
  }
  if (
    config.transportMode === "ssh" &&
    (config.runtimeBackends.length !== 1 || config.runtimeBackends[0] !== "tmux")
  ) {
    throw new Error(
      `COMMANDRELAY_RUNTIME_BACKENDS must be tmux when COMMANDRELAY_TRANSPORT_MODE is ssh (received "${config.runtimeBackends.join(",")}")`
    );
  }
  if (config.transportMode === "ssh" && config.sshKnownHostsFile) {
    try {
      accessSync(config.sshKnownHostsFile, fsConstants.R_OK);
    } catch {
      throw new Error(
        `COMMANDRELAY_SSH_KNOWN_HOSTS_FILE must reference a readable file when COMMANDRELAY_TRANSPORT_MODE=ssh (received "${config.sshKnownHostsFile}")`
      );
    }
  }
  if (!config.sshStrictHostKeyChecking && config.sshExpectedFingerprintSha256) {
    throw new Error(
      "COMMANDRELAY_SSH_EXPECTED_FINGERPRINT_SHA256 requires COMMANDRELAY_SSH_STRICT_HOST_KEY_CHECKING=true and must be unset when strict host key checking is disabled"
    );
  }
}

/**
 * @file Runtime configuration loader for the CommandRelay bridge server.
 */

/** Runtime bridge configuration values. */
export interface BridgeConfig {
  host: string;
  port: number;
  strictProtocolParsing: boolean;
  pollIntervalMs: number;
  replayLines: number;
  maxHistoryEvents: number;
  maxInputBytes: number;
  maxAttachedPanes: number;
  maxMessagesPerMinute: number;
  maxInputsPerMinute: number;
  globalInputDisabled: boolean;
  authToken: string | null;
  auditLogPath: string | null;
}

interface NumericBounds {
  min?: number;
  max?: number;
}

/**
 * Parses an integer environment variable with a fallback and bounds.
 *
 * @param raw Raw env value.
 * @param fallback Fallback value.
 * @param bounds Optional numeric bounds.
 * @returns Parsed integer or fallback.
 */
function parseIntEnv(raw: string | undefined, fallback: number, bounds: NumericBounds = {}): number {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  if (bounds.min !== undefined && parsed < bounds.min) return fallback;
  if (bounds.max !== undefined && parsed > bounds.max) return fallback;
  return parsed;
}

/**
 * Parses a strict boolean environment variable.
 *
 * @param raw Raw env value.
 * @param fallback Fallback value when unset.
 * @param envName Environment variable name for error messages.
 * @returns Parsed boolean.
 */
function parseBooleanEnv(raw: string | undefined, fallback: boolean, envName: string): boolean {
  if (!raw) return fallback;
  const normalized = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  throw new Error(
    `${envName} must be one of: 1,true,yes,on,0,false,no,off (received "${raw}")`
  );
}

/**
 * Parses a boolean environment variable with optional legacy alias fallback.
 *
 * @param env Environment map.
 * @param primaryName Primary environment variable name.
 * @param aliasName Legacy alias environment variable name.
 * @param fallback Fallback when neither variable is set.
 * @returns Parsed boolean value.
 */
function parseBooleanEnvWithAlias(
  env: NodeJS.ProcessEnv,
  primaryName: string,
  aliasName: string,
  fallback: boolean
): boolean {
  const primary = env[primaryName];
  if (primary !== undefined) {
    return parseBooleanEnv(primary, fallback, primaryName);
  }

  return parseBooleanEnv(env[aliasName], fallback, aliasName);
}

/**
 * Parses an optional env string and normalizes whitespace-only values to null.
 *
 * @param raw Raw env value.
 * @returns Trimmed string or null.
 */
function parseOptionalStringEnv(raw: string | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  return trimmed ? trimmed : null;
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
  return {
    host: env.COMMANDRELAY_HOST || "127.0.0.1",
    port: parseIntEnv(env.COMMANDRELAY_PORT, 8787, { min: 1, max: 65535 }),
    strictProtocolParsing: parseBooleanEnvWithAlias(
      env,
      "COMMANDRELAY_STRICT_PROTOCOL_PARSING",
      "COMMANDRELAY_STRICT_V1",
      true
    ),
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
}

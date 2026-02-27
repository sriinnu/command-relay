/**
 * @file Runtime configuration loader for the CommandRelay bridge server.
 */

/** Runtime bridge configuration values. */
export interface BridgeConfig {
  runtimeBackends: RuntimeBackend[];
  cmuxCommand: string;
  host: string;
  port: number;
  transportMode: TransportMode;
  sshProfileName: string;
  sshTarget: string | null;
  sshPort: number;
  sshStrictHostKeyChecking: boolean;
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
  authToken: string | null;
  auditLogPath: string | null;
}

const SUPPORTED_RUNTIME_BACKENDS = ["tmux", "cmux"] as const;
const SUPPORTED_TRANSPORT_MODES = ["ws", "ssh"] as const;

/**
 * Supported backend identifiers for runtime pane operations.
 */
export type RuntimeBackend = (typeof SUPPORTED_RUNTIME_BACKENDS)[number];

/**
 * Supported transport mode identifiers for bridge connectivity.
 */
export type TransportMode = (typeof SUPPORTED_TRANSPORT_MODES)[number];

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
 * Parses an integer environment variable strictly with fallback and bounds.
 *
 * @param raw Raw env value.
 * @param fallback Fallback value when unset.
 * @param bounds Required numeric bounds.
 * @param envName Environment variable name for error messages.
 * @returns Parsed integer or fallback.
 */
function parseStrictIntEnv(
  raw: string | undefined,
  fallback: number,
  bounds: NumericBounds,
  envName: string
): number {
  if (raw === undefined) return fallback;
  const trimmed = raw.trim();
  if (!trimmed) return fallback;
  if (!/^-?\d+$/.test(trimmed)) {
    throw new Error(`${envName} must be an integer (received "${raw}")`);
  }

  const parsed = Number.parseInt(trimmed, 10);
  if (bounds.min !== undefined && parsed < bounds.min) {
    throw new Error(`${envName} must be >= ${bounds.min} (received "${raw}")`);
  }
  if (bounds.max !== undefined && parsed > bounds.max) {
    throw new Error(`${envName} must be <= ${bounds.max} (received "${raw}")`);
  }

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
 * Parses a required-ish string env with fallback.
 *
 * @param raw Raw env value.
 * @param fallback Fallback when value is unset or blank.
 * @returns Trimmed string or fallback.
 */
function parseStringEnv(raw: string | undefined, fallback: string): string {
  if (!raw) return fallback;
  const trimmed = raw.trim();
  return trimmed ? trimmed : fallback;
}

/**
 * Parses a strict enum environment variable from a list of allowed values.
 *
 * @param raw Raw env value.
 * @param fallback Fallback when value is unset/blank.
 * @param allowed Allowed values.
 * @param envName Environment variable name for error messages.
 * @returns Parsed enum value.
 */
function parseEnumEnv<T extends string>(
  raw: string | undefined,
  fallback: T,
  allowed: readonly T[],
  envName: string
): T {
  if (raw === undefined) return fallback;
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return fallback;
  if (!allowed.includes(trimmed as T)) {
    throw new Error(`${envName} must be one of: ${allowed.join(",")} (received "${raw}")`);
  }
  return trimmed as T;
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
    if (!SUPPORTED_RUNTIME_BACKENDS.includes(backend as RuntimeBackend)) {
      throw new Error(
        `COMMANDRELAY_RUNTIME_BACKENDS contains unsupported backend "${backend}" (supported: ${SUPPORTED_RUNTIME_BACKENDS.join(",")})`
      );
    }
    const runtimeBackend = backend as RuntimeBackend;
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
  return {
    runtimeBackends: parseRuntimeBackendsEnv(env.COMMANDRELAY_RUNTIME_BACKENDS),
    cmuxCommand: parseStringEnv(env.COMMANDRELAY_CMUX_COMMAND, "cmux"),
    host: env.COMMANDRELAY_HOST || "127.0.0.1",
    port: parseIntEnv(env.COMMANDRELAY_PORT, 8787, { min: 1, max: 65535 }),
    transportMode: parseEnumEnv(
      env.COMMANDRELAY_TRANSPORT_MODE,
      "ws",
      SUPPORTED_TRANSPORT_MODES,
      "COMMANDRELAY_TRANSPORT_MODE"
    ),
    sshProfileName: parseStringEnv(env.COMMANDRELAY_SSH_PROFILE, "primary"),
    sshTarget: parseOptionalStringEnv(env.COMMANDRELAY_SSH_TARGET),
    sshPort: parseStrictIntEnv(
      env.COMMANDRELAY_SSH_PORT,
      22,
      { min: 1, max: 65535 },
      "COMMANDRELAY_SSH_PORT"
    ),
    sshStrictHostKeyChecking: parseBooleanEnv(
      env.COMMANDRELAY_SSH_STRICT_HOST_KEY_CHECKING,
      true,
      "COMMANDRELAY_SSH_STRICT_HOST_KEY_CHECKING"
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
}

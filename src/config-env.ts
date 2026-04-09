/**
 * @file Shared environment parsing helpers for bridge configuration loading.
 */

/**
 * Numeric bounds used by integer env parsing helpers.
 */
export interface NumericBounds {
  min?: number;
  max?: number;
}

/**
 * One resolved env value with its originating variable name.
 */
export interface AliasedEnvValue {
  source: string;
  value: string | undefined;
}

/**
 * Parses an integer environment variable with a fallback and bounds.
 *
 * @param raw Raw env value.
 * @param fallback Fallback value.
 * @param bounds Optional numeric bounds.
 * @returns Parsed integer or fallback.
 */
export function parseIntEnv(raw: string | undefined, fallback: number, bounds: NumericBounds = {}): number {
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
export function parseStrictIntEnv(
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
export function parseBooleanEnv(raw: string | undefined, fallback: boolean, envName: string): boolean {
  if (!raw) return fallback;
  const normalized = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  throw new Error(`${envName} must be one of: 1,true,yes,on,0,false,no,off (received "${raw}")`);
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
export function parseBooleanEnvWithAlias(
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
export function parseOptionalStringEnv(raw: string | undefined): string | null {
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
export function parseStringEnv(raw: string | undefined, fallback: string): string {
  if (!raw) return fallback;
  const trimmed = raw.trim();
  return trimmed ? trimmed : fallback;
}

/**
 * Parses a strict enum environment variable from a list of allowed values.
 *
 * @param raw Raw env value.
 * @param fallback Fallback when value is unset or blank.
 * @param allowed Allowed values.
 * @param envName Environment variable name for error messages.
 * @returns Parsed enum value.
 */
export function parseEnumEnv<T extends string>(
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
 * Reads a primary env variable with a legacy alias fallback.
 *
 * @param env Environment map.
 * @param primaryName Preferred environment variable name.
 * @param aliasName Legacy environment variable name.
 * @returns Value with its source variable name.
 */
export function readAliasedEnv(
  env: NodeJS.ProcessEnv,
  primaryName: string,
  aliasName: string
): AliasedEnvValue {
  if (env[primaryName] !== undefined) {
    return { source: primaryName, value: env[primaryName] };
  }

  if (env[aliasName] !== undefined) {
    return { source: aliasName, value: env[aliasName] };
  }

  return { source: primaryName, value: undefined };
}

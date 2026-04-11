import { loadProxySettings, type ProxyEnvironment } from "@commandrelay/proxy-core";
import type {
  ProxyEnvironmentInspection,
  ProxyEnvironmentSnapshot,
  ProxyVariableResolution
} from "./types.js";

const SNAPSHOT_KEYS = [
  "http_proxy",
  "HTTP_PROXY",
  "https_proxy",
  "HTTPS_PROXY",
  "all_proxy",
  "ALL_PROXY",
  "no_proxy",
  "NO_PROXY",
  "REQUEST_METHOD",
  "request_method"
] as const;

const LOWERCASE: Readonly<Record<ProxyVariableResolution["logicalName"], string>> = {
  httpProxy: "http_proxy",
  httpsProxy: "https_proxy",
  allProxy: "all_proxy",
  noProxy: "no_proxy"
};

const UPPERCASE: Readonly<Record<ProxyVariableResolution["logicalName"], string>> = {
  httpProxy: "HTTP_PROXY",
  httpsProxy: "HTTPS_PROXY",
  allProxy: "ALL_PROXY",
  noProxy: "NO_PROXY"
};

/**
 * Builds a normalized proxy environment inspection object.
 *
 * @param env Environment map to inspect.
 * @returns Structured inspection details and resolved settings.
 */
export function inspectProxyEnvironment(
  env: ProxyEnvironment = process.env
): ProxyEnvironmentInspection {
  const cgiMode = Boolean(readEnv(env, "REQUEST_METHOD", "request_method"));
  const variables = snapshotEnvironment(env);

  const resolution: ProxyVariableResolution[] = [
    buildResolution("httpProxy", env, cgiMode),
    buildResolution("httpsProxy", env, false),
    buildResolution("allProxy", env, false),
    buildResolution("noProxy", env, false)
  ];

  return {
    cgiMode,
    variables,
    resolution,
    settings: loadProxySettings(env)
  };
}

function buildResolution(
  logicalName: ProxyVariableResolution["logicalName"],
  env: ProxyEnvironment,
  ignoreUppercase: boolean
): ProxyVariableResolution {
  const lowerKey = LOWERCASE[logicalName];
  const upperKey = UPPERCASE[logicalName];
  const lowerValue = readEnv(env, lowerKey, lowerKey);
  const upperValue = readEnv(env, upperKey, upperKey);

  let selectedKey: string | null = null;
  let selectedValue: string | null = null;

  if (lowerValue !== undefined) {
    selectedKey = lowerKey;
    selectedValue = lowerValue;
  } else if (!ignoreUppercase && upperValue !== undefined) {
    selectedKey = upperKey;
    selectedValue = upperValue;
  }

  return {
    logicalName,
    selectedKey,
    selectedValue,
    lowerKey,
    lowerValue: toNullable(lowerValue),
    upperKey,
    upperValue: toNullable(upperValue),
    ignoredUppercase: ignoreUppercase && upperValue !== undefined && lowerValue === undefined
  };
}

function snapshotEnvironment(env: ProxyEnvironment): ProxyEnvironmentSnapshot {
  const snapshot: Record<(typeof SNAPSHOT_KEYS)[number], string | null> = {
    http_proxy: null,
    HTTP_PROXY: null,
    https_proxy: null,
    HTTPS_PROXY: null,
    all_proxy: null,
    ALL_PROXY: null,
    no_proxy: null,
    NO_PROXY: null,
    REQUEST_METHOD: null,
    request_method: null
  };
  for (const key of SNAPSHOT_KEYS) {
    snapshot[key] = toNullable(env[key]);
  }
  return snapshot as ProxyEnvironmentSnapshot;
}

function readEnv(
  env: ProxyEnvironment,
  primary: string,
  secondary: string
): string | undefined {
  return env[primary] ?? env[secondary];
}

function toNullable(value: string | undefined): string | null {
  return value === undefined ? null : value;
}

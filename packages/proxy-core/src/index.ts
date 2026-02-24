import { isIP } from "node:net";

/**
 * Environment shape used to read proxy variables.
 */
export type ProxyEnvironment = Readonly<Record<string, string | undefined>>;

/**
 * Parsed `NO_PROXY` rule entry.
 */
export interface NoProxyRule {
  /** Hostname, IPv4, IPv6 literal (without brackets), or `*`. */
  host: string;
  /** Optional rule port. */
  port: number | null;
  /** Enables `*.example.com` style matching with a strict label boundary. */
  matchSubdomains: boolean;
}

/**
 * Normalized proxy settings resolved from environment variables.
 */
export interface ProxySettings {
  /** Proxy URL used for `http:` and `ws:` requests. */
  httpProxy: string | null;
  /** Proxy URL used for `https:` and `wss:` requests. */
  httpsProxy: string | null;
  /** Proxy URL used for other protocols when no specific proxy is configured. */
  allProxy: string | null;
  /** Parsed `NO_PROXY` rules. */
  noProxy: NoProxyRule[];
}

/**
 * Loads proxy settings from an environment map.
 *
 * Behavior notes:
 * - lowercase variables have precedence over uppercase (`http_proxy` over `HTTP_PROXY`)
 * - in CGI environments (`REQUEST_METHOD` set), uppercase `HTTP_PROXY` is ignored
 *
 * @param env Environment map. Defaults to `process.env`.
 * @returns Normalized proxy settings.
 */
export function loadProxySettings(env: ProxyEnvironment = process.env): ProxySettings {
  const isCgi = Boolean(readRawEnv(env, "REQUEST_METHOD", "request_method"));

  const httpProxy = sanitizeProxyUrl(
    readProxyEnv(env, {
      uppercase: "HTTP_PROXY",
      lowercase: "http_proxy",
      ignoreUppercase: isCgi
    })
  );

  return {
    httpProxy,
    httpsProxy: sanitizeProxyUrl(
      readProxyEnv(env, {
        uppercase: "HTTPS_PROXY",
        lowercase: "https_proxy",
        ignoreUppercase: false
      })
    ),
    allProxy: sanitizeProxyUrl(
      readProxyEnv(env, {
        uppercase: "ALL_PROXY",
        lowercase: "all_proxy",
        ignoreUppercase: false
      })
    ),
    noProxy: parseNoProxy(readRawEnv(env, "NO_PROXY", "no_proxy") ?? "")
  };
}

/**
 * Resolves the proxy URL for a target URL based on preloaded settings.
 *
 * @param target Target URL string or URL object.
 * @param settings Preloaded proxy settings.
 * @returns Proxy URL, or `null` when direct connectivity should be used.
 */
export function resolveProxyForUrl(
  target: string | URL,
  settings: ProxySettings
): string | null {
  const url = target instanceof URL ? target : new URL(String(target));

  if (shouldBypassProxy(url, settings.noProxy)) {
    return null;
  }

  switch (url.protocol) {
    case "http:":
    case "ws:":
      return settings.httpProxy ?? settings.allProxy;
    case "https:":
    case "wss:":
      return settings.httpsProxy ?? settings.httpProxy ?? settings.allProxy;
    default:
      return settings.allProxy;
  }
}

/**
 * Convenience helper that loads proxy settings from environment variables
 * and resolves the proxy in a single call.
 *
 * @param target Target URL string or URL object.
 * @param env Environment map. Defaults to `process.env`.
 * @returns Proxy URL, or `null` when direct connectivity should be used.
 */
export function resolveProxyForUrlFromEnv(
  target: string | URL,
  env: ProxyEnvironment = process.env
): string | null {
  return resolveProxyForUrl(target, loadProxySettings(env));
}

/**
 * Evaluates whether a URL should bypass proxy usage according to `NO_PROXY` rules.
 *
 * @param target Target URL.
 * @param rules Parsed `NO_PROXY` rules.
 * @returns `true` when direct connectivity should be used.
 */
export function shouldBypassProxy(target: URL, rules: readonly NoProxyRule[]): boolean {
  if (rules.length === 0) {
    return false;
  }

  const host = normalizeHost(target.hostname);
  if (host === null) {
    return false;
  }

  const port = getTargetPort(target);

  for (const rule of rules) {
    if (rule.host === "*") {
      return true;
    }

    if (!matchesRuleHost(host, rule)) {
      continue;
    }

    if (rule.port === null || rule.port === port) {
      return true;
    }
  }

  return false;
}

/**
 * Parses a `NO_PROXY` string into normalized matching rules.
 *
 * Supported entries include:
 * - `*`
 * - `example.com`
 * - `.example.com` and `*.example.com`
 * - `example.com:8080`
 * - `127.0.0.1`
 * - `[::1]` and `[::1]:8080`
 * - URL-like tokens such as `http://internal.service:8080`
 *
 * @param raw Raw `NO_PROXY` value.
 * @returns Parsed rules (invalid entries are ignored).
 */
export function parseNoProxy(raw: string): NoProxyRule[] {
  if (!raw.trim()) {
    return [];
  }

  const rules: NoProxyRule[] = [];

  for (const token of raw.split(",")) {
    const parsed = parseNoProxyToken(token.trim());
    if (parsed !== null) {
      rules.push(parsed);
    }
  }

  return rules;
}

interface ReadProxyEnvOptions {
  uppercase: string;
  lowercase: string;
  ignoreUppercase: boolean;
}

function readProxyEnv(
  env: ProxyEnvironment,
  options: ReadProxyEnvOptions
): string | undefined {
  const lowerValue = readRawEnv(env, options.lowercase, options.lowercase);
  if (lowerValue !== undefined) {
    return lowerValue;
  }

  if (options.ignoreUppercase) {
    return undefined;
  }

  return readRawEnv(env, options.uppercase, options.uppercase);
}

function readRawEnv(
  env: ProxyEnvironment,
  primary: string,
  secondary: string
): string | undefined {
  return env[primary] ?? env[secondary];
}

function parseNoProxyToken(token: string): NoProxyRule | null {
  if (!token) {
    return null;
  }

  if (token === "*") {
    return {
      host: "*",
      port: null,
      matchSubdomains: false
    };
  }

  const urlEntry = parseNoProxyUrlToken(token);
  if (urlEntry !== null) {
    const host = normalizeHost(urlEntry.host);
    if (host === null) {
      return null;
    }

    return {
      host,
      port: urlEntry.port,
      matchSubdomains: shouldMatchSubdomains(host, false)
    };
  }

  const wildcardPrefix = token.startsWith("*.") || token.startsWith(".");
  const tokenWithoutWildcard = wildcardPrefix
    ? token.replace(/^\*?\./, "")
    : token;

  const hostAndPort = splitHostAndPort(tokenWithoutWildcard);
  if (hostAndPort === null) {
    return null;
  }

  const host = normalizeHost(hostAndPort.host);
  if (host === null) {
    return null;
  }

  return {
    host,
    port: hostAndPort.port,
    matchSubdomains: shouldMatchSubdomains(host, wildcardPrefix)
  };
}

function parseNoProxyUrlToken(
  token: string
): { host: string; port: number | null } | null {
  if (!token.includes("://")) {
    return null;
  }

  try {
    const parsed = new URL(token);
    return {
      host: parsed.hostname,
      port: parsePort(parsed.port)
    };
  } catch {
    return null;
  }
}

function splitHostAndPort(token: string): { host: string; port: number | null } | null {
  if (!token) {
    return null;
  }

  if (token.startsWith("[")) {
    const closingIndex = token.indexOf("]");
    if (closingIndex <= 0) {
      return null;
    }

    const host = token.slice(1, closingIndex);
    const rest = token.slice(closingIndex + 1);
    if (!rest) {
      return { host, port: null };
    }

    if (!rest.startsWith(":")) {
      return null;
    }

    return {
      host,
      port: parsePort(rest.slice(1))
    };
  }

  const colonMatches = token.match(/:/g);
  const colonCount = colonMatches?.length ?? 0;

  if (colonCount === 1) {
    const separatorIndex = token.lastIndexOf(":");
    return {
      host: token.slice(0, separatorIndex),
      port: parsePort(token.slice(separatorIndex + 1))
    };
  }

  return {
    host: token,
    port: null
  };
}

function shouldMatchSubdomains(host: string, hasWildcardPrefix: boolean): boolean {
  if (host === "*") {
    return false;
  }

  if (hasWildcardPrefix) {
    return true;
  }

  if (isIP(host) !== 0 || host === "localhost") {
    return false;
  }

  return host.includes(".");
}

function matchesRuleHost(targetHost: string, rule: NoProxyRule): boolean {
  if (targetHost === rule.host) {
    return true;
  }

  if (!rule.matchSubdomains) {
    return false;
  }

  return isSubdomainOf(targetHost, rule.host);
}

function isSubdomainOf(host: string, candidateParent: string): boolean {
  if (!host.endsWith(candidateParent)) {
    return false;
  }

  const boundaryIndex = host.length - candidateParent.length - 1;
  return boundaryIndex >= 0 && host[boundaryIndex] === ".";
}

function getTargetPort(target: URL): number {
  if (target.port) {
    const explicitPort = parsePort(target.port);
    if (explicitPort !== null) {
      return explicitPort;
    }
  }

  switch (target.protocol) {
    case "https:":
    case "wss:":
      return 443;
    default:
      return 80;
  }
}

function parsePort(token: string | undefined): number | null {
  if (!token) {
    return null;
  }

  if (!/^\d+$/.test(token)) {
    return null;
  }

  const port = Number.parseInt(token, 10);
  if (!Number.isSafeInteger(port) || port <= 0 || port > 65_535) {
    return null;
  }

  return port;
}

function normalizeHost(host: string): string | null {
  const trimmed = host.trim().toLowerCase();
  if (!trimmed) {
    return null;
  }

  const unbracketed = trimmed.startsWith("[") && trimmed.endsWith("]")
    ? trimmed.slice(1, -1)
    : trimmed;

  const normalized = unbracketed.endsWith(".")
    ? unbracketed.slice(0, -1)
    : unbracketed;

  if (!normalized || normalized.includes("/") || normalized.includes(" ")) {
    return null;
  }

  return normalized;
}

function sanitizeProxyUrl(rawValue: string | undefined): string | null {
  if (rawValue === undefined) {
    return null;
  }

  const value = rawValue.trim();
  if (!value) {
    return null;
  }

  const candidate = /^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(value)
    ? value
    : `http://${value}`;

  try {
    const parsed = new URL(candidate);
    if (!parsed.hostname) {
      return null;
    }

    return parsed.toString();
  } catch {
    return null;
  }
}

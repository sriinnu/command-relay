import { isIP } from "node:net";

const SUPPORTED_PROXY_PROTOCOLS = new Set([
  "http:",
  "https:",
  "socks:",
  "socks4:",
  "socks4a:",
  "socks5:",
  "socks5h:",
  "pac+http:",
  "pac+https:",
  "pac+file:",
  "pac+data:"
]);

/**
 * Parsed no_proxy matcher rule.
 */
export interface NoProxyRule {
  host: string;
  port: number | null;
  wildcardSubdomains: boolean;
}

/**
 * Normalized proxy environment settings.
 */
export interface ProxySettings {
  httpProxy: string | null;
  httpsProxy: string | null;
  allProxy: string | null;
  noProxy: NoProxyRule[];
}

/**
 * Process-like environment map used for proxy parsing.
 */
export type ProxyEnvironment = Readonly<Record<string, string | undefined>>;

/**
 * Loads and normalizes proxy settings from environment variables.
 *
 * Behavior notes:
 * - lowercase variables win over uppercase (`http_proxy` over `HTTP_PROXY`)
 * - in CGI-like environments (`REQUEST_METHOD`), uppercase `HTTP_PROXY` is ignored
 *
 * @param env Environment source object, defaults to `process.env`.
 * @returns Normalized proxy settings.
 */
export function loadProxySettings(env: ProxyEnvironment = process.env): ProxySettings {
  const isCgi = Boolean(readRawEnv(env, "REQUEST_METHOD", "request_method"));
  return {
    httpProxy: sanitizeProxyUrl(
      readProxyEnv(env, {
        uppercase: "HTTP_PROXY",
        lowercase: "http_proxy",
        ignoreUppercase: isCgi
      })
    ),
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
 * Resolves the proxy URL to use for a target URL.
 *
 * @param target Target URL.
 * @param settings Proxy settings.
 * @returns Proxy URL string or `null` for direct mode.
 * @throws {TypeError} When `target` is not a valid URL.
 */
export function resolveProxyForUrl(
  target: string | URL,
  settings: ProxySettings
): string | null {
  const targetUrl = parseTargetUrl(target);
  if (shouldBypassProxy(targetUrl, settings.noProxy)) {
    return null;
  }

  switch (targetUrl.protocol) {
    case "http:":
    case "ws:":
      return settings.httpProxy ?? settings.allProxy ?? null;
    case "https:":
    case "wss:":
      return settings.httpsProxy ?? settings.httpProxy ?? settings.allProxy ?? null;
    default:
      return settings.allProxy ?? null;
  }
}

/**
 * Evaluates `NO_PROXY` matcher rules for a target URL.
 *
 * @param target Target URL.
 * @param rules Parsed no_proxy rules.
 * @returns True when proxying should be bypassed.
 */
export function shouldBypassProxy(target: URL, rules: NoProxyRule[]): boolean {
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
 * Parses raw `NO_PROXY` CSV values into matcher rules.
 *
 * @param raw Raw no_proxy value.
 * @returns Parsed matcher rules.
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

function parseTargetUrl(target: string | URL): URL {
  if (target instanceof URL) {
    return target;
  }
  try {
    return new URL(String(target));
  } catch {
    throw new TypeError("invalid_target_url");
  }
}

function readProxyEnv(
  env: ProxyEnvironment,
  options: ReadProxyEnvOptions
): string | undefined {
  const lowercase = readRawEnv(env, options.lowercase, options.lowercase);
  if (lowercase !== undefined) {
    return lowercase;
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
      wildcardSubdomains: false
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
      wildcardSubdomains: shouldMatchSubdomains(host, false)
    };
  }

  const wildcardPrefix = token.startsWith("*.") || token.startsWith(".");
  const tokenWithoutWildcard = wildcardPrefix ? token.replace(/^\*?\./, "") : token;
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
    wildcardSubdomains: shouldMatchSubdomains(host, wildcardPrefix)
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

  const colonCount = token.match(/:/g)?.length ?? 0;
  if (colonCount === 1) {
    const separator = token.lastIndexOf(":");
    return {
      host: token.slice(0, separator),
      port: parsePort(token.slice(separator + 1))
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
  if (!rule.wildcardSubdomains) {
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
  return target.protocol === "https:" || target.protocol === "wss:" ? 443 : 80;
}

function parsePort(token: string | undefined): number | null {
  if (!token || !/^\d+$/.test(token)) {
    return null;
  }
  const parsed = Number.parseInt(token, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > 65_535) {
    return null;
  }
  return parsed;
}

function normalizeHost(host: string): string | null {
  const trimmed = host.trim().toLowerCase();
  if (!trimmed) {
    return null;
  }

  const unbracketed =
    trimmed.startsWith("[") && trimmed.endsWith("]")
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
    const protocol = parsed.protocol.toLowerCase();
    if (!SUPPORTED_PROXY_PROTOCOLS.has(protocol)) {
      return null;
    }

    const hostOptional = protocol === "pac+file:" || protocol === "pac+data:";
    if (!hostOptional && !parsed.hostname) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

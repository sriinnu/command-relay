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
export type ProxyEnvironment = Record<string, string | undefined>;

/**
 * Loads and normalizes proxy settings from environment variables.
 *
 * @param env Environment source object, defaults to `process.env`.
 * @returns Normalized proxy settings.
 */
export function loadProxySettings(env: ProxyEnvironment = process.env): ProxySettings {
  const httpProxy = env.HTTP_PROXY ?? env.http_proxy ?? null;
  const httpsProxy = env.HTTPS_PROXY ?? env.https_proxy ?? null;
  const allProxy = env.ALL_PROXY ?? env.all_proxy ?? null;
  const noProxyRaw = env.NO_PROXY ?? env.no_proxy ?? "";

  return {
    httpProxy: sanitizeProxyUrl(httpProxy),
    httpsProxy: sanitizeProxyUrl(httpsProxy),
    allProxy: sanitizeProxyUrl(allProxy),
    noProxy: parseNoProxy(noProxyRaw)
  };
}

/**
 * Resolves the proxy URL to use for a target URL.
 *
 * @param target Target URL.
 * @param settings Proxy settings.
 * @returns Proxy URL string or `null` for direct mode.
 */
export function resolveProxyForUrl(
  target: string | URL,
  settings: ProxySettings
): string | null {
  const targetUrl = target instanceof URL ? target : new URL(String(target));

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

  const hostname = target.hostname.toLowerCase();
  const port =
    target.port ||
    (target.protocol === "https:" || target.protocol === "wss:" ? "443" : "80");

  for (const rule of rules) {
    if (rule.host === "*") {
      return true;
    }

    const exactHostMatch = hostname === rule.host;
    const subdomainMatch =
      rule.wildcardSubdomains && hostname.endsWith(`.${rule.host}`);

    if (!exactHostMatch && !subdomainMatch) {
      continue;
    }

    if (rule.port === null || String(rule.port) === String(port)) {
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
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry): NoProxyRule | null => {
      if (entry === "*") {
        return {
          host: "*",
          port: null,
          wildcardSubdomains: false
        };
      }

      const stripped = entry.startsWith(".") ? entry.slice(1) : entry;
      const [hostPartRaw, portPart] = stripped.split(":");
      const hostPart = hostPartRaw.toLowerCase();

      if (!hostPart) {
        return null;
      }

      return {
        host: hostPart,
        port: parsePort(portPart),
        wildcardSubdomains: entry.startsWith(".") || !hostPart.includes(".")
      };
    })
    .filter((rule): rule is NoProxyRule => rule !== null);
}

/**
 * Parses an optional port token.
 *
 * @param token Port token.
 * @returns Parsed port or `null` when invalid.
 */
function parsePort(token: string | undefined): number | null {
  if (!token) {
    return null;
  }

  const parsed = Number.parseInt(token, 10);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 65535) {
    return null;
  }

  return parsed;
}

/**
 * Sanitizes a candidate proxy URL string.
 *
 * @param value Candidate proxy URL.
 * @returns Normalized proxy URL or `null` when invalid.
 */
function sanitizeProxyUrl(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = new URL(trimmed);
    if (!parsed.protocol) {
      return null;
    }

    return parsed.toString();
  } catch {
    return null;
  }
}

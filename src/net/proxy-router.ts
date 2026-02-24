/**
 * @file Proxy routing utilities for outbound HTTP/WebSocket calls.
 */

/**
 * @typedef {object} ProxySettings
 * @property {string | null} httpProxy Proxy for http:// and ws:// targets.
 * @property {string | null} httpsProxy Proxy for https:// and wss:// targets.
 * @property {string | null} allProxy Global fallback proxy.
 * @property {NoProxyRule[]} noProxy Parsed no_proxy rules.
 */

/**
 * @typedef {object} NoProxyRule
 * @property {string} host Hostname token from no_proxy.
 * @property {number | null} port Optional exact port constraint.
 * @property {boolean} wildcardSubdomains Whether subdomains should match.
 */

/**
 * Loads proxy settings from process-like environment variables.
 *
 * @param {Record<string, string | undefined>} [env=process.env] Env source.
 * @returns {ProxySettings} Normalized proxy settings.
 */
export function loadProxySettings(env = process.env) {
  const httpProxy = env.HTTP_PROXY || env.http_proxy || null;
  const httpsProxy = env.HTTPS_PROXY || env.https_proxy || null;
  const allProxy = env.ALL_PROXY || env.all_proxy || null;
  const noProxyRaw = env.NO_PROXY || env.no_proxy || "";

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
 * @param {string | URL} target Target URL.
 * @param {ProxySettings} settings Proxy settings.
 * @returns {string | null} Proxy URL or null when direct should be used.
 */
export function resolveProxyForUrl(target, settings) {
  const url = target instanceof URL ? target : new URL(String(target));

  if (shouldBypassProxy(url, settings.noProxy)) {
    return null;
  }

  switch (url.protocol) {
    case "http:":
    case "ws:":
      return settings.httpProxy || settings.allProxy || null;
    case "https:":
    case "wss:":
      return settings.httpsProxy || settings.httpProxy || settings.allProxy || null;
    default:
      return settings.allProxy || null;
  }
}

/**
 * Checks whether no_proxy rules bypass proxying for a URL.
 *
 * @param {URL} target Target URL.
 * @param {NoProxyRule[]} rules Parsed no_proxy rules.
 * @returns {boolean} True when proxy should be bypassed.
 */
export function shouldBypassProxy(target, rules) {
  if (rules.length === 0) return false;
  const hostname = target.hostname.toLowerCase();
  const port =
    target.port ||
    (target.protocol === "https:" || target.protocol === "wss:" ? "443" : "80");

  for (const rule of rules) {
    if (rule.host === "*") return true;

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
 * Parses no_proxy CSV into matching rules.
 *
 * @param {string} raw Raw no_proxy value.
 * @returns {NoProxyRule[]} Parsed rules.
 */
export function parseNoProxy(raw) {
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      if (entry === "*") {
        return {
          host: "*",
          port: null,
          wildcardSubdomains: false
        };
      }

      const stripped = entry.startsWith(".") ? entry.slice(1) : entry;
      const [hostPart, portPart] = stripped.split(":");

      return {
        host: hostPart.toLowerCase(),
        port: parsePort(portPart),
        wildcardSubdomains: entry.startsWith(".") || !hostPart.includes(".")
      };
    })
    .filter((rule) => Boolean(rule.host));
}

/**
 * Parses an optional port token.
 *
 * @param {string | undefined} token Port token.
 * @returns {number | null} Parsed port or null when unspecified/invalid.
 */
function parsePort(token) {
  if (!token) return null;
  const parsed = Number.parseInt(token, 10);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 65535) return null;
  return parsed;
}

/**
 * Sanitizes proxy URL values.
 *
 * @param {string | null} value Candidate proxy value.
 * @returns {string | null} Sanitized value or null.
 */
function sanitizeProxyUrl(value) {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (!parsed.protocol) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

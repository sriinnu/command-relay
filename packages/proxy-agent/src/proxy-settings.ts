import {
  loadProxySettings as loadCoreProxySettings,
  parseNoProxy as parseCoreNoProxy,
  resolveProxyForUrl as resolveCoreProxyForUrl,
  shouldBypassProxy as shouldCoreBypassProxy,
  type NoProxyRule as CoreNoProxyRule,
  type ProxyEnvironment as CoreProxyEnvironment,
  type ProxySettings as CoreProxySettings
} from "../../proxy-core/src/index.js";

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
export type ProxyEnvironment = CoreProxyEnvironment;

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
  return fromCoreProxySettings(loadCoreProxySettings(env));
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
  return resolveCoreProxyForUrl(parseTargetUrl(target), toCoreProxySettings(settings));
}

/**
 * Evaluates `NO_PROXY` matcher rules for a target URL.
 *
 * @param target Target URL.
 * @param rules Parsed no_proxy rules.
 * @returns True when proxying should be bypassed.
 */
export function shouldBypassProxy(target: URL, rules: NoProxyRule[]): boolean {
  return shouldCoreBypassProxy(target, rules.map(toCoreNoProxyRule));
}

/**
 * Parses raw `NO_PROXY` CSV values into matcher rules.
 *
 * @param raw Raw no_proxy value.
 * @returns Parsed matcher rules.
 */
export function parseNoProxy(raw: string): NoProxyRule[] {
  return parseCoreNoProxy(raw).map(fromCoreNoProxyRule);
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

function toCoreNoProxyRule(rule: NoProxyRule): CoreNoProxyRule {
  return {
    host: rule.host,
    port: rule.port,
    matchSubdomains: rule.wildcardSubdomains
  };
}

function fromCoreNoProxyRule(rule: CoreNoProxyRule): NoProxyRule {
  return {
    host: rule.host,
    port: rule.port,
    wildcardSubdomains: rule.matchSubdomains
  };
}

function toCoreProxySettings(settings: ProxySettings): CoreProxySettings {
  return {
    httpProxy: settings.httpProxy,
    httpsProxy: settings.httpsProxy,
    allProxy: settings.allProxy,
    noProxy: settings.noProxy.map(toCoreNoProxyRule)
  };
}

function fromCoreProxySettings(settings: CoreProxySettings): ProxySettings {
  return {
    httpProxy: settings.httpProxy,
    httpsProxy: settings.httpsProxy,
    allProxy: settings.allProxy,
    noProxy: settings.noProxy.map(fromCoreNoProxyRule)
  };
}

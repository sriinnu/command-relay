/**
 * @file Compatibility wrapper for proxy routing primitives.
 */

import {
  loadProxySettings as loadProxySettingsPrimitive,
  parseNoProxy as parseNoProxyPrimitive,
  resolveProxyForUrl as resolveProxyForUrlPrimitive,
  shouldBypassProxy as shouldBypassProxyPrimitive,
  type NoProxyRule as PrimitiveNoProxyRule,
  type ProxyEnvironment,
  type ProxySettings as PrimitiveProxySettings
} from "../../packages/proxy-agent/src/index.js";

/** Parsed `NO_PROXY` matcher rule used by runtime net code. */
export type NoProxyRule = PrimitiveNoProxyRule;

/** Normalized proxy settings used by runtime net code. */
export type ProxySettings = PrimitiveProxySettings;

/**
 * Loads proxy settings from process-like environment variables.
 *
 * This compatibility wrapper mirrors canonical core precedence where lowercase
 * environment keys win over uppercase keys when both are present.
 *
 * @param env Env source.
 * @returns Normalized proxy settings.
 */
export function loadProxySettings(
  env: Record<string, string | undefined> = process.env
): ProxySettings {
  const compatibilityEnv: ProxyEnvironment = {
    HTTP_PROXY: env.http_proxy ?? env.HTTP_PROXY,
    HTTPS_PROXY: env.https_proxy ?? env.HTTPS_PROXY,
    ALL_PROXY: env.all_proxy ?? env.ALL_PROXY,
    NO_PROXY: env.no_proxy ?? env.NO_PROXY
  };

  return loadProxySettingsPrimitive(compatibilityEnv);
}

/**
 * Resolves the proxy URL to use for a target URL.
 *
 * @param target Target URL.
 * @param settings Proxy settings.
 * @returns Proxy URL or null when direct should be used.
 */
export function resolveProxyForUrl(
  target: string | URL,
  settings: ProxySettings
): string | null {
  return resolveProxyForUrlPrimitive(target, settings);
}

/**
 * Checks whether no_proxy rules bypass proxying for a URL.
 *
 * @param target Target URL.
 * @param rules Parsed no_proxy rules.
 * @returns True when proxy should be bypassed.
 */
export function shouldBypassProxy(target: URL, rules: NoProxyRule[]): boolean {
  return shouldBypassProxyPrimitive(target, rules);
}

/**
 * Parses no_proxy CSV into matching rules.
 *
 * @param raw Raw no_proxy value.
 * @returns Parsed rules.
 */
export function parseNoProxy(raw: string): NoProxyRule[] {
  return parseNoProxyPrimitive(raw);
}

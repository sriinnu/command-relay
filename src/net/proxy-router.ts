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
} from "../../packages/proxy-agent/src/proxy-settings.js";

/** Parsed `NO_PROXY` matcher rule used by runtime net code. */
export type NoProxyRule = PrimitiveNoProxyRule;

/** Normalized proxy settings used by runtime net code. */
export type ProxySettings = PrimitiveProxySettings;

/**
 * Loads proxy settings from process-like environment variables.
 *
 * This compatibility wrapper preserves historical fallback behavior where
 * lowercase env vars are used when uppercase variants are present but empty.
 *
 * @param env Env source.
 * @returns Normalized proxy settings.
 */
export function loadProxySettings(
  env: Record<string, string | undefined> = process.env
): ProxySettings {
  const compatibilityEnv: ProxyEnvironment = {
    HTTP_PROXY: env.HTTP_PROXY || env.http_proxy,
    HTTPS_PROXY: env.HTTPS_PROXY || env.https_proxy,
    ALL_PROXY: env.ALL_PROXY || env.all_proxy,
    NO_PROXY: env.NO_PROXY || env.no_proxy
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

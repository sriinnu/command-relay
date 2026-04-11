import type { Agent } from "node:http";
import {
  ProxyAgentFactory,
  type ProxyAgentFactoryOptions,
  type ProxyAgentResolution,
  type ProxyEnvironment,
  type ProxySettings
} from "@commandrelay/proxy-agent";

const ABSOLUTE_URL_PREFIX_PATTERN = /^[a-zA-Z][a-zA-Z\d+.-]*:/;

/**
 * Proxy authentication credentials used by axios-style `proxy` config.
 */
export interface ProxyAxiosProxyAuth {
  username: string;
  password: string;
}

/**
 * Axios-compatible static proxy config shape.
 *
 * This package always applies `proxy: false` for resolved requests so axios does
 * not apply environment-based proxy logic on top of resolved agents.
 */
export interface ProxyAxiosProxyConfig {
  protocol?: string;
  host: string;
  port?: number;
  auth?: ProxyAxiosProxyAuth;
}

/**
 * Allowed primitive values for axios-style header maps.
 */
export type ProxyAxiosHeaderValue = string | number | boolean | null;

/**
 * Axios-like header dictionary.
 */
export interface ProxyAxiosHeaders {
  [headerName: string]: ProxyAxiosHeaderValue | undefined;
}

/**
 * Minimal axios request config shape needed for proxy-agent wiring.
 *
 * Additional axios fields are supported through the index signature.
 */
export interface ProxyAxiosRequestConfig {
  url?: string | URL;
  baseURL?: string | URL;
  method?: string;
  headers?: ProxyAxiosHeaders;
  params?: unknown;
  data?: unknown;
  timeout?: number;
  signal?: AbortSignal;
  httpAgent?: Agent;
  httpsAgent?: Agent;
  proxy?: false | ProxyAxiosProxyConfig;
  allowAbsoluteUrls?: boolean;
  [key: string]: unknown;
}

/**
 * Object shape used when a request target is represented by `url` + `baseURL`.
 */
export interface ProxyAxiosTargetInput {
  url?: string | URL;
  baseURL?: string | URL;
}

/**
 * Input accepted by target-resolution helpers.
 */
export type ProxyAxiosTarget = string | URL | ProxyAxiosTargetInput;

/**
 * Routing metadata that can be logged/propagated by callers.
 */
export interface ProxyAxiosRoutingMetadata {
  viaProxy: boolean;
  proxyUrl: string | null;
  fromCache: boolean;
}

/**
 * Proxy resolution result including selected Node agent.
 */
export interface ProxyAxiosAgentResolution extends ProxyAxiosRoutingMetadata {
  agent: Agent | null;
}

/**
 * Combined request target and proxy resolution result.
 */
export interface ProxyAxiosResolvedTarget {
  target: URL;
  resolution: ProxyAxiosAgentResolution;
}

/**
 * Structural resolver contract compatible with `ProxyAxiosAgentResolver` and
 * `ProxyAgentFactory`-style implementations.
 */
export interface ProxyAxiosResolverLike {
  resolve(target: string | URL): ProxyAxiosAgentResolution;
}

/**
 * Options for `applyProxyAgentToAxiosConfig` and `ProxyAxiosAgentResolver.apply`.
 */
export interface ProxyAxiosApplyOptions {
  /**
   * Mutates the provided config object when `true`.
   * Defaults to `true`.
   */
  mutate?: boolean;
  /**
   * Sets `config.proxy = false` when `true`.
   * Defaults to `true`.
   */
  disableAxiosProxyConfig?: boolean;
}

/**
 * Result of applying routing to an axios-like config object.
 */
export interface ProxyAxiosApplyResult<TConfig extends ProxyAxiosRequestConfig> {
  config: TConfig;
  target: URL;
  routing: ProxyAxiosRoutingMetadata;
}

/**
 * Constructor options for `ProxyAxiosAgentResolver`.
 */
export type ProxyAxiosAgentResolverOptions = ProxyAgentFactoryOptions;

/**
 * Axios-focused facade over `ProxyAgentFactory`.
 */
export class ProxyAxiosAgentResolver implements ProxyAxiosResolverLike {
  private readonly factory: ProxyAgentFactory;

  /**
   * @param options Proxy factory options.
   */
  constructor(options: ProxyAxiosAgentResolverOptions = {}) {
    this.factory = new ProxyAgentFactory(options);
  }

  /**
   * Resolves a proxy-aware Node agent for a target URL.
   *
   * @param target Absolute request target.
   * @returns Agent + routing metadata.
   */
  resolve(target: string | URL): ProxyAxiosAgentResolution {
    return toAxiosResolution(this.factory.resolve(target));
  }

  /**
   * Resolves target + routing and applies agent fields to config.
   *
   * @param config Axios-like request config.
   * @param options Apply behavior options.
   * @returns Applied config and routing metadata.
   */
  apply<TConfig extends ProxyAxiosRequestConfig>(
    config: TConfig,
    options: ProxyAxiosApplyOptions = {}
  ): ProxyAxiosApplyResult<TConfig> {
    return applyProxyAgentToAxiosConfig(config, this, options);
  }

  /**
   * Clears cached proxy agents.
   */
  clear(): void {
    this.factory.clear();
  }

  /**
   * Destroys cached proxy agents.
   */
  destroy(): void {
    this.factory.destroy();
  }

  /**
   * Alias for `destroy()`.
   */
  dispose(): void {
    this.factory.dispose();
  }

  /**
   * Replaces active proxy settings and clears cache.
   *
   * @param settings New proxy settings.
   */
  updateSettings(settings: ProxySettings): void {
    this.factory.updateSettings(settings);
  }

  /**
   * Reloads proxy settings from environment and clears cache.
   *
   * @param env Environment source. Defaults to constructor env, then `process.env`.
   * @returns Newly loaded settings.
   */
  reloadFromEnvironment(env?: ProxyEnvironment): ProxySettings {
    return this.factory.reloadFromEnvironment(env);
  }

  /**
   * Number of currently cached proxy agents.
   */
  get cacheSize(): number {
    return this.factory.cacheSize;
  }
}

/**
 * Resolves an absolute request target from axios-style URL inputs.
 *
 * @param target Request URL, URL object, or `{ url, baseURL }` object.
 * @param baseURL Optional base URL when `target` is a string/URL.
 * @returns Absolute request target URL.
 */
export function resolveAxiosRequestTarget(target: ProxyAxiosTarget, baseURL?: string | URL): URL {
  const input = normalizeTargetInput(target, baseURL);

  if (input.url instanceof URL) {
    return cloneUrl(input.url);
  }

  const requestUrl = ensureNonEmptyUrl(input.url);
  if (ABSOLUTE_URL_PREFIX_PATTERN.test(requestUrl) || requestUrl.startsWith("//")) {
    return parseUrl(requestUrl, "invalid_request_url");
  }

  const resolvedBaseUrl = parseBaseUrl(input.baseURL);
  if (!resolvedBaseUrl) {
    throw new TypeError("relative_url_requires_baseURL");
  }

  return new URL(requestUrl, resolvedBaseUrl);
}

/**
 * Resolves proxy routing metadata for an axios request target.
 *
 * @param target Axios-style target input.
 * @param resolver Resolver implementation.
 * @returns Absolute target and resolution metadata.
 */
export function resolveProxyAxiosAgent(
  target: ProxyAxiosTarget,
  resolver: ProxyAxiosResolverLike
): ProxyAxiosResolvedTarget {
  const resolvedTarget = resolveAxiosRequestTarget(target);
  const resolution = toAxiosResolution(resolver.resolve(resolvedTarget));
  return {
    target: resolvedTarget,
    resolution
  };
}

/**
 * Applies proxy-derived agent configuration to an axios-like request config.
 *
 * The helper sets `proxy=false` by default so axios runtime proxy detection does
 * not conflict with resolved agent routing.
 *
 * @param config Axios-like request config.
 * @param resolver Resolver implementation.
 * @param options Apply behavior options.
 * @returns Applied config and routing metadata.
 */
export function applyProxyAgentToAxiosConfig<TConfig extends ProxyAxiosRequestConfig>(
  config: TConfig,
  resolver: ProxyAxiosResolverLike,
  options: ProxyAxiosApplyOptions = {}
): ProxyAxiosApplyResult<TConfig> {
  const mutate = options.mutate ?? true;
  const disableAxiosProxyConfig = options.disableAxiosProxyConfig ?? true;
  const resolved = resolveProxyAxiosAgent(config, resolver);
  const nextConfig = mutate ? config : ({ ...config } as TConfig);

  if (disableAxiosProxyConfig) {
    nextConfig.proxy = false;
  }

  if (resolved.resolution.viaProxy && resolved.resolution.agent) {
    applyResolvedAgent(nextConfig, resolved.target.protocol, resolved.resolution.agent);
  }

  return {
    config: nextConfig,
    target: resolved.target,
    routing: toRoutingMetadata(resolved.resolution)
  };
}

function normalizeTargetInput(
  target: ProxyAxiosTarget,
  baseURL?: string | URL
): ProxyAxiosTargetInput {
  if (typeof target === "string" || target instanceof URL) {
    return {
      url: target,
      baseURL
    };
  }

  return target;
}

function ensureNonEmptyUrl(url: string | URL | undefined): string {
  if (typeof url !== "string") {
    throw new TypeError("axios_request_url_required");
  }

  const trimmed = url.trim();
  if (!trimmed) {
    throw new TypeError("axios_request_url_required");
  }

  return trimmed;
}

function parseBaseUrl(baseURL: string | URL | undefined): URL | null {
  if (baseURL === undefined) {
    return null;
  }

  if (baseURL instanceof URL) {
    return cloneUrl(baseURL);
  }

  const trimmed = baseURL.trim();
  if (!trimmed) {
    return null;
  }

  return parseUrl(trimmed, "invalid_baseURL");
}

function parseUrl(input: string, errorCode: string): URL {
  try {
    return new URL(input);
  } catch {
    throw new TypeError(errorCode);
  }
}

function cloneUrl(input: URL): URL {
  return new URL(input.toString());
}

function applyResolvedAgent(
  config: ProxyAxiosRequestConfig,
  targetProtocol: string,
  agent: Agent
): void {
  if (targetProtocol === "http:") {
    config.httpAgent = agent;
    return;
  }

  if (targetProtocol === "https:") {
    config.httpsAgent = agent;
    return;
  }

  config.httpAgent = agent;
  config.httpsAgent = agent;
}

function toAxiosResolution(
  resolution: ProxyAgentResolution | ProxyAxiosAgentResolution
): ProxyAxiosAgentResolution {
  return {
    agent: resolution.agent ?? null,
    proxyUrl: resolution.proxyUrl ?? null,
    viaProxy: Boolean(resolution.viaProxy),
    fromCache: Boolean(resolution.fromCache)
  };
}

function toRoutingMetadata(resolution: ProxyAxiosAgentResolution): ProxyAxiosRoutingMetadata {
  return {
    viaProxy: resolution.viaProxy,
    proxyUrl: resolution.proxyUrl,
    fromCache: resolution.fromCache
  };
}

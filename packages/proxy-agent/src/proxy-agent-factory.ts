import type { Agent } from "node:http";
import { HttpProxyAgent } from "http-proxy-agent";
import type { HttpProxyAgentOptions } from "http-proxy-agent";
import { HttpsProxyAgent } from "https-proxy-agent";
import type { HttpsProxyAgentOptions } from "https-proxy-agent";
import { PacProxyAgent } from "pac-proxy-agent";
import type { PacProxyAgentOptions } from "pac-proxy-agent";
import { SocksProxyAgent } from "socks-proxy-agent";
import type { SocksProxyAgentOptions } from "socks-proxy-agent";
import { BoundedAgentCache, normalizeCacheEntries } from "./bounded-agent-cache.js";
import {
  loadProxySettings,
  resolveProxyForUrl,
  type ProxyEnvironment,
  type ProxySettings
} from "./proxy-settings.js";

const SOCKS_PROTOCOLS = new Set([
  "socks:",
  "socks4:",
  "socks4a:",
  "socks5:",
  "socks5h:"
]);

const PAC_PROTOCOLS = new Set([
  "pac+http:",
  "pac+https:",
  "pac+file:",
  "pac+data:"
]);
const TARGET_PROTOCOLS = new Set(["http:", "https:", "ws:", "wss:"]);
const PAC_SECURE_DEFAULTS: Pick<PacProxyAgentConstructorOptions, "fallbackToDirect"> = {
  fallbackToDirect: false
};
type DisposableAgent = Agent & {
  destroy?: (() => unknown) | undefined;
  dispose?: (() => unknown) | undefined;
  close?: (() => unknown) | undefined;
};

/**
 * Constructor options forwarded to `HttpProxyAgent`.
 */
export type HttpProxyAgentConstructorOptions =
  | HttpProxyAgentOptions<"http://proxy.local">
  | HttpProxyAgentOptions<"https://proxy.local">;

/**
 * Constructor options forwarded to `HttpsProxyAgent`.
 */
export type HttpsProxyAgentConstructorOptions =
  | HttpsProxyAgentOptions<"http://proxy.local">
  | HttpsProxyAgentOptions<"https://proxy.local">;

/**
 * Constructor options forwarded to `SocksProxyAgent`.
 */
export type SocksProxyAgentConstructorOptions = SocksProxyAgentOptions;

/**
 * Constructor options forwarded to `PacProxyAgent`.
 */
export type PacProxyAgentConstructorOptions =
  | PacProxyAgentOptions<"pac+http://proxy.local/proxy.pac">
  | PacProxyAgentOptions<"pac+https://proxy.local/proxy.pac">
  | PacProxyAgentOptions<"pac+file:///proxy.pac">
  | PacProxyAgentOptions<"pac+data://proxy.pac">;

/**
 * Per-agent constructor options used when creating proxy agents.
 */
export interface ProxyAgentConstructorOptions {
  /**
   * Applied when the selected agent class is `HttpProxyAgent`.
   */
  http?: HttpProxyAgentConstructorOptions;
  /**
   * Applied when the selected agent class is `HttpsProxyAgent`.
   */
  https?: HttpsProxyAgentConstructorOptions;
  /**
   * Applied when the selected agent class is `SocksProxyAgent`.
   */
  socks?: SocksProxyAgentConstructorOptions;
  /**
   * Applied when the selected agent class is `PacProxyAgent`.
   */
  pac?: PacProxyAgentConstructorOptions;
}

/**
 * Result of resolving an agent for a target URL.
 */
export interface ProxyAgentResolution {
  agent: Agent | null;
  proxyUrl: string | null;
  viaProxy: boolean;
  fromCache: boolean;
}

/**
 * Options for `ProxyAgentFactory`.
 */
export interface ProxyAgentFactoryOptions {
  settings?: ProxySettings;
  env?: ProxyEnvironment;
  maxCacheEntries?: number;
  /**
   * Optional per-agent constructor options forwarded when creating agents.
   */
  agentOptions?: ProxyAgentConstructorOptions;
}

/**
 * Error thrown when a target URL cannot be parsed.
 */
export class InvalidTargetUrlError extends TypeError {
  readonly input: string;

  /**
   * @param input Original target input.
   * @param cause Parsing cause.
   */
  constructor(input: string, cause?: unknown) {
    super("invalid_target_url");
    this.name = "InvalidTargetUrlError";
    this.input = input;
    this.cause = cause;
  }
}

/**
 * Error thrown when a proxy URL cannot be parsed.
 */
export class InvalidProxyUrlError extends TypeError {
  readonly proxyUrl: string;

  /**
   * @param proxyUrl Candidate proxy URL.
   * @param cause Parsing cause.
   */
  constructor(proxyUrl: string, cause?: unknown) {
    super("invalid_proxy_url");
    this.name = "InvalidProxyUrlError";
    this.proxyUrl = proxyUrl;
    this.cause = cause;
  }
}

/**
 * Error thrown when proxy protocol is unsupported.
 */
export class UnsupportedProxyProtocolError extends Error {
  readonly protocol: string;

  /**
   * @param protocol Parsed proxy protocol token.
   */
  constructor(protocol: string) {
    super(`unsupported_proxy_protocol:${protocol}`);
    this.name = "UnsupportedProxyProtocolError";
    this.protocol = protocol;
  }
}

/**
 * Error thrown when target protocol is unsupported.
 */
export class UnsupportedTargetProtocolError extends Error {
  readonly protocol: string;

  /**
   * @param protocol Normalized target protocol token.
   */
  constructor(protocol: string) {
    super(`unsupported_target_protocol:${protocol}`);
    this.name = "UnsupportedTargetProtocolError";
    this.protocol = protocol;
  }
}

/**
 * Reusable protocol-aware proxy agent factory with bounded cache.
 */
export class ProxyAgentFactory {
  private settings: ProxySettings;
  private readonly envSource: ProxyEnvironment | undefined;
  private readonly cache: BoundedAgentCache<string, Agent>;
  private readonly agentOptions: ProxyAgentConstructorOptions;

  /**
   * Creates a factory.
   *
   * @param options Factory settings.
   */
  constructor(options: ProxyAgentFactoryOptions = {}) {
    this.envSource = options.env;
    this.settings = options.settings ?? loadProxySettings(options.env);
    this.agentOptions = options.agentOptions ?? {};
    this.cache = new BoundedAgentCache(
      normalizeCacheEntries(options.maxCacheEntries),
      tryDisposeAgent
    );
  }

  /**
   * Resolves an outbound agent for the target URL.
   *
   * @param target Target URL.
   * @returns Resolution containing agent metadata.
   */
  resolve(target: string | URL): ProxyAgentResolution {
    const targetUrl = parseTargetUrl(target);
    const proxyUrl = resolveProxyForUrl(targetUrl, this.settings);

    if (!proxyUrl) {
      return {
        agent: null,
        proxyUrl: null,
        viaProxy: false,
        fromCache: false
      };
    }

    const cacheKey = `${proxyUrl}|${targetUrl.protocol}`;
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return {
        agent: cached,
        proxyUrl,
        viaProxy: true,
        fromCache: true
      };
    }

    const created = createProxyAgent(proxyUrl, targetUrl.protocol, this.agentOptions);
    this.cache.set(cacheKey, created);

    return {
      agent: created,
      proxyUrl,
      viaProxy: true,
      fromCache: false
    };
  }

  /**
   * Clears all cached agents and destroys them when supported.
   */
  clear(): void {
    this.destroy();
  }

  /**
   * Destroys all cached agents and clears the cache.
   */
  destroy(): void {
    this.cache.clear();
  }

  /**
   * Alias for `destroy()` for dispose-oriented integrations.
   */
  dispose(): void {
    this.destroy();
  }

  /**
   * Replaces active proxy settings and clears existing cached agents.
   *
   * @param settings New proxy settings.
   */
  updateSettings(settings: ProxySettings): void {
    this.settings = settings;
    this.destroy();
  }

  /**
   * Reloads proxy settings from environment and clears cached agents.
   *
   * @param env Environment source. Defaults to constructor `env`, then `process.env`.
   * @returns Newly loaded proxy settings.
   */
  reloadFromEnvironment(env: ProxyEnvironment = this.envSource ?? process.env): ProxySettings {
    this.settings = loadProxySettings(env);
    this.destroy();
    return this.settings;
  }

  /**
   * Number of currently cached proxy agents.
   */
  get cacheSize(): number {
    return this.cache.size;
  }
}

/**
 * Creates a protocol-specific proxy agent.
 *
 * @param proxyUrl Proxy URL.
 * @param targetProtocol Target URL protocol (for example `http:`).
 * @param options Optional per-agent constructor options.
 * @returns Agent instance.
 */
export function createProxyAgent(
  proxyUrl: string,
  targetProtocol: string,
  options: ProxyAgentConstructorOptions = {}
): Agent {
  const normalizedTargetProtocol = normalizeTargetProtocol(targetProtocol);
  const protocol = parseProtocol(proxyUrl);

  if (SOCKS_PROTOCOLS.has(protocol)) {
    return new SocksProxyAgent(proxyUrl, options.socks) as unknown as Agent;
  }

  if (PAC_PROTOCOLS.has(protocol)) {
    return new PacProxyAgent(proxyUrl, toPacAgentOptions(options.pac)) as unknown as Agent;
  }

  if (protocol === "http:" || protocol === "https:") {
    if (normalizedTargetProtocol === "http:" || normalizedTargetProtocol === "ws:") {
      return new HttpProxyAgent(proxyUrl, options.http) as unknown as Agent;
    }

    return new HttpsProxyAgent(proxyUrl, options.https) as unknown as Agent;
  }

  throw new UnsupportedProxyProtocolError(protocol);
}

function toPacAgentOptions(
  options: PacProxyAgentConstructorOptions | undefined
): PacProxyAgentConstructorOptions {
  return { ...PAC_SECURE_DEFAULTS, ...options };
}

/**
 * Validates and parses a proxy URL protocol.
 *
 * @param proxyUrl Candidate proxy URL.
 * @returns Lower-cased protocol token ending with `:`.
 */
function parseProtocol(proxyUrl: string): string {
  const trimmed = proxyUrl.trim();
  if (!trimmed) {
    throw new InvalidProxyUrlError(proxyUrl);
  }
  try {
    return new URL(trimmed).protocol.toLowerCase();
  } catch (error) {
    throw new InvalidProxyUrlError(proxyUrl, error);
  }
}

function parseTargetUrl(target: string | URL): URL {
  if (target instanceof URL) {
    return target;
  }

  const input = String(target);
  try {
    return new URL(input);
  } catch (error) {
    throw new InvalidTargetUrlError(input, error);
  }
}

function normalizeTargetProtocol(targetProtocol: string): string {
  const normalized = targetProtocol.trim().toLowerCase();
  const protocol = normalized.endsWith(":") ? normalized : `${normalized}:`;
  if (!TARGET_PROTOCOLS.has(protocol)) {
    throw new UnsupportedTargetProtocolError(protocol);
  }
  return protocol;
}

/**
 * Best-effort lifecycle cleanup for cached agents.
 *
 * Uses `destroy()`, then `dispose()`, then `close()` when available.
 */
function tryDisposeAgent(agent: Agent): void {
  const disposable = agent as DisposableAgent;

  const destroy = disposable.destroy;
  if (typeof destroy === "function") {
    invokeSafe(destroy, disposable);
    return;
  }

  const dispose = disposable.dispose;
  if (typeof dispose === "function") {
    invokeSafe(dispose, disposable);
    return;
  }

  const close = disposable.close;
  if (typeof close === "function") {
    invokeSafe(close, disposable);
  }
}

function invokeSafe(method: () => unknown, context: DisposableAgent): void {
  try {
    method.call(context);
  } catch {
    // Ignore cleanup failures to keep cache operations safe in production.
  }
}

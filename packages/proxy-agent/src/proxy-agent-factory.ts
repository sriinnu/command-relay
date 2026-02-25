import type { Agent } from "node:http";
import { HttpProxyAgent } from "http-proxy-agent";
import { HttpsProxyAgent } from "https-proxy-agent";
import { PacProxyAgent } from "pac-proxy-agent";
import { SocksProxyAgent } from "socks-proxy-agent";
import {
  loadProxySettings,
  resolveProxyForUrl,
  type ProxyEnvironment,
  type ProxySettings
} from "./proxy-settings.js";

const DEFAULT_CACHE_ENTRIES = 256;

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
  private readonly settings: ProxySettings;
  private readonly cache: BoundedAgentCache<string, Agent>;

  /**
   * Creates a factory.
   *
   * @param options Factory settings.
   */
  constructor(options: ProxyAgentFactoryOptions = {}) {
    this.settings = options.settings ?? loadProxySettings(options.env);
    this.cache = new BoundedAgentCache(
      normalizeCacheEntries(options.maxCacheEntries)
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

    const created = createProxyAgent(proxyUrl, targetUrl.protocol);
    this.cache.set(cacheKey, created);

    return {
      agent: created,
      proxyUrl,
      viaProxy: true,
      fromCache: false
    };
  }

  /**
   * Clears all cached agents.
   */
  clear(): void {
    this.cache.clear();
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
 * @returns Agent instance.
 */
export function createProxyAgent(proxyUrl: string, targetProtocol: string): Agent {
  const normalizedTargetProtocol = normalizeTargetProtocol(targetProtocol);
  const protocol = parseProtocol(proxyUrl);

  if (SOCKS_PROTOCOLS.has(protocol)) {
    return new SocksProxyAgent(proxyUrl) as unknown as Agent;
  }

  if (PAC_PROTOCOLS.has(protocol)) {
    return new PacProxyAgent(proxyUrl) as unknown as Agent;
  }

  if (protocol === "http:" || protocol === "https:") {
    if (normalizedTargetProtocol === "http:" || normalizedTargetProtocol === "ws:") {
      return new HttpProxyAgent(proxyUrl) as unknown as Agent;
    }

    return new HttpsProxyAgent(proxyUrl) as unknown as Agent;
  }

  throw new UnsupportedProxyProtocolError(protocol);
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
 * Normalizes maximum cache entries.
 *
 * @param value Raw max entries value.
 * @returns Safe integer max entries.
 */
function normalizeCacheEntries(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_CACHE_ENTRIES;
  }

  if (!Number.isFinite(value) || value < 0) {
    return DEFAULT_CACHE_ENTRIES;
  }

  const normalized = Math.floor(value);
  if (!Number.isSafeInteger(normalized)) {
    return DEFAULT_CACHE_ENTRIES;
  }
  return normalized;
}

/**
 * Small bounded LRU-style cache backed by `Map`.
 */
class BoundedAgentCache<K, V> {
  private readonly store = new Map<K, V>();
  private readonly maxEntries: number;

  /**
   * @param maxEntries Maximum entry count.
   */
  constructor(maxEntries: number) {
    this.maxEntries = maxEntries;
  }

  /**
   * Current number of items in cache.
   */
  get size(): number {
    return this.store.size;
  }

  /**
   * Clears all cache entries.
   */
  clear(): void {
    this.store.clear();
  }

  /**
   * Gets a value and refreshes its recency.
   *
   * @param key Cache key.
   * @returns Cached value or `null`.
   */
  get(key: K): V | null {
    const value = this.store.get(key);
    if (value === undefined) {
      return null;
    }

    this.store.delete(key);
    this.store.set(key, value);
    return value;
  }

  /**
   * Sets a value and evicts least-recently-used entries when needed.
   *
   * @param key Cache key.
   * @param value Cache value.
   */
  set(key: K, value: V): void {
    if (this.maxEntries === 0) {
      return;
    }

    if (this.store.has(key)) {
      this.store.delete(key);
    }
    this.store.set(key, value);

    while (this.store.size > this.maxEntries) {
      const oldestKey = this.store.keys().next().value as K | undefined;
      if (oldestKey === undefined) {
        break;
      }
      this.store.delete(oldestKey);
    }
  }
}

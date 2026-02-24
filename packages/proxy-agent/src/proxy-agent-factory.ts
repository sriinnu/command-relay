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
    const targetUrl = target instanceof URL ? target : new URL(String(target));
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
  const protocol = parseProtocol(proxyUrl);

  if (SOCKS_PROTOCOLS.has(protocol)) {
    return new SocksProxyAgent(proxyUrl) as unknown as Agent;
  }

  if (PAC_PROTOCOLS.has(protocol)) {
    return new PacProxyAgent(proxyUrl) as unknown as Agent;
  }

  if (protocol === "http:" || protocol === "https:") {
    if (targetProtocol === "http:" || targetProtocol === "ws:") {
      return new HttpProxyAgent(proxyUrl) as unknown as Agent;
    }

    return new HttpsProxyAgent(proxyUrl) as unknown as Agent;
  }

  throw new Error(`unsupported_proxy_protocol:${protocol}`);
}

/**
 * Validates and parses a proxy URL protocol.
 *
 * @param proxyUrl Candidate proxy URL.
 * @returns Lower-cased protocol token ending with `:`.
 */
function parseProtocol(proxyUrl: string): string {
  try {
    return new URL(proxyUrl).protocol.toLowerCase();
  } catch {
    throw new Error("invalid_proxy_url");
  }
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

  return Math.floor(value);
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
    const value = this.store.get(key) ?? null;
    if (!value) {
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

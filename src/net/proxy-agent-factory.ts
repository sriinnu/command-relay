/**
 * @file Proxy-agent style factory with protocol-aware agent selection.
 */

import type { Agent } from "node:http";
import { HttpProxyAgent } from "http-proxy-agent";
import { HttpsProxyAgent } from "https-proxy-agent";
import { SocksProxyAgent } from "socks-proxy-agent";
import { PacProxyAgent } from "pac-proxy-agent";
import { loadProxySettings, resolveProxyForUrl } from "./proxy-router.js";

const SOCKS_SCHEMES = new Set([
  "socks:",
  "socks4:",
  "socks4a:",
  "socks5:",
  "socks5h:"
]);

const PAC_SCHEMES = new Set([
  "pac+http:",
  "pac+https:",
  "pac+file:",
  "pac+data:"
]);

/** Agent resolution output for one target URL. */
export interface AgentResolution {
  agent: Agent | null;
  proxyUrl: string | null;
  viaProxy: boolean;
}

/** Factory constructor options. */
export interface ProxyAgentFactoryOptions {
  settings?: ReturnType<typeof loadProxySettings>;
  maxCacheEntries?: number;
}

/**
 * Factory that resolves and caches outbound proxy agents by target URL.
 */
export class ProxyAgentFactory {
  private readonly settings: ReturnType<typeof loadProxySettings>;
  private readonly maxCacheEntries: number;
  private readonly cache: Map<string, Agent>;

  /**
   * @param options Factory configuration.
   */
  constructor(options: ProxyAgentFactoryOptions = {}) {
    this.settings = options.settings ?? loadProxySettings();
    this.maxCacheEntries = options.maxCacheEntries ?? 256;

    this.cache = new Map();
  }

  /**
   * Resolves an agent for the given target URL.
   *
   * @param target Target URL.
   * @returns Proxy resolution result.
   */
  resolve(target: string | URL): AgentResolution {
    const targetUrl = target instanceof URL ? target : new URL(String(target));
    const proxyUrl = resolveProxyForUrl(targetUrl, this.settings);

    if (!proxyUrl) {
      return { agent: null, proxyUrl: null, viaProxy: false };
    }

    const cacheKey = `${proxyUrl}|${targetUrl.protocol}`;
    const cached = this.getCache(cacheKey);
    if (cached) {
      return { agent: cached, proxyUrl, viaProxy: true };
    }

    const created = createAgent(proxyUrl, targetUrl.protocol);
    this.setCache(cacheKey, created);

    return { agent: created, proxyUrl, viaProxy: true };
  }

  /**
   * Clears all cached agents.
   *
   * @returns Nothing.
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Reads an item from LRU-like cache and refreshes its recency.
   *
   * @param key Cache key.
   * @returns Cached agent.
   */
  private getCache(key: string): Agent | null {
    const value = this.cache.get(key) ?? null;
    if (!value) return null;

    // Refresh recency by reinserting.
    this.cache.delete(key);
    this.cache.set(key, value);
    return value;
  }

  /**
   * Inserts an agent into bounded cache.
   *
   * @param key Cache key.
   * @param agent Agent instance.
   * @returns Nothing.
   */
  private setCache(key: string, agent: Agent): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }
    this.cache.set(key, agent);

    while (this.cache.size > this.maxCacheEntries) {
      const oldest = this.cache.keys().next().value;
      if (!oldest) break;
      this.cache.delete(oldest);
    }
  }
}

/**
 * Creates a protocol-appropriate proxy agent.
 *
 * @param proxyUrl Resolved proxy URL.
 * @param targetProtocol Target URL protocol.
 * @returns Created proxy agent.
 */
function createAgent(proxyUrl: string, targetProtocol: string): Agent {
  const proxy = new URL(proxyUrl);

  if (SOCKS_SCHEMES.has(proxy.protocol)) {
    return new SocksProxyAgent(proxyUrl) as unknown as Agent;
  }

  if (PAC_SCHEMES.has(proxy.protocol)) {
    return new PacProxyAgent(proxyUrl) as unknown as Agent;
  }

  if (proxy.protocol === "http:" || proxy.protocol === "https:") {
    if (targetProtocol === "http:" || targetProtocol === "ws:") {
      return new HttpProxyAgent(proxyUrl) as unknown as Agent;
    }
    return new HttpsProxyAgent(proxyUrl) as unknown as Agent;
  }

  throw new Error(`unsupported_proxy_protocol:${proxy.protocol}`);
}

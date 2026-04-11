import {
  loadProxySettings,
  resolveProxyForUrl,
  type ProxyEnvironment,
  type ProxySettings
} from "@commandrelay/proxy-core";
import { Agent as UndiciAgent, ProxyAgent as UndiciProxyAgent, type Dispatcher } from "undici";
import { BoundedDispatcherCache, normalizeCacheEntries } from "./bounded-dispatcher-cache.js";
import {
  InvalidProxyUrlError,
  InvalidTargetUrlError,
  UnsupportedProxyProtocolError,
  UnsupportedTargetProtocolError
} from "./errors.js";

const SOCKS_PROTOCOLS = new Set(["socks:", "socks4:", "socks4a:", "socks5:", "socks5h:"]);
const PAC_PROTOCOLS = new Set(["pac+http:", "pac+https:", "pac+file:", "pac+data:"]);
const TARGET_PROTOCOLS = new Set(["http:", "https:"]);
const SUPPORTED_PROXY_PROTOCOLS = new Set(["http:", "https:"]);

type DispatcherWithClose = Dispatcher & {
  close?: (() => unknown) | undefined;
  destroy?: (() => unknown) | undefined;
};

/**
 * Constructor options forwarded when creating direct Undici `Agent` instances.
 */
export type UndiciDirectDispatcherOptions = Record<string, unknown>;

/**
 * Constructor options forwarded when creating proxied Undici `ProxyAgent` instances.
 */
export type UndiciProxyDispatcherOptions = Record<string, unknown>;

/**
 * Adapter interface for creating dispatchers.
 */
export interface UndiciDispatcherAdapter {
  /**
   * Creates direct dispatcher (no proxy).
   *
   * @param options Constructor options.
   * @returns Dispatcher instance.
   */
  createDirect(options?: UndiciDirectDispatcherOptions): Dispatcher;
  /**
   * Creates proxied dispatcher for a proxy URL.
   *
   * @param proxyUrl Proxy URL.
   * @param options Constructor options.
   * @returns Dispatcher instance.
   */
  createProxy(proxyUrl: string, options?: UndiciProxyDispatcherOptions): Dispatcher;
}

/**
 * Result of resolving a dispatcher for an outbound URL.
 */
export interface ProxyUndiciDispatcherResolution {
  dispatcher: Dispatcher;
  proxyUrl: string | null;
  viaProxy: boolean;
  fromCache: boolean;
}

/**
 * Options for `ProxyUndiciDispatcherFactory`.
 */
export interface ProxyUndiciDispatcherFactoryOptions {
  settings?: ProxySettings;
  env?: ProxyEnvironment;
  maxCacheEntries?: number;
  directDispatcherOptions?: UndiciDirectDispatcherOptions;
  proxyDispatcherOptions?: UndiciProxyDispatcherOptions;
  adapter?: UndiciDispatcherAdapter;
}

/**
 * Reusable proxy-aware dispatcher factory for Undici clients.
 */
export class ProxyUndiciDispatcherFactory {
  private settings: ProxySettings;
  private readonly envSource: ProxyEnvironment | undefined;
  private readonly cache: BoundedDispatcherCache<string, Dispatcher>;
  private readonly directDispatcherOptions: UndiciDirectDispatcherOptions | undefined;
  private readonly proxyDispatcherOptions: UndiciProxyDispatcherOptions | undefined;
  private readonly adapter: UndiciDispatcherAdapter;
  private directDispatcher: Dispatcher | null = null;

  /**
   * @param options Factory configuration.
   */
  constructor(options: ProxyUndiciDispatcherFactoryOptions = {}) {
    this.envSource = options.env;
    this.settings = options.settings ?? loadProxySettings(options.env);
    this.directDispatcherOptions = options.directDispatcherOptions;
    this.proxyDispatcherOptions = options.proxyDispatcherOptions;
    this.adapter = options.adapter ?? createDefaultDispatcherAdapter();
    this.cache = new BoundedDispatcherCache(
      normalizeCacheEntries(options.maxCacheEntries),
      closeDispatcher
    );
  }

  /**
   * Resolves an Undici dispatcher for target URL.
   *
   * @param target Target URL string or `URL`.
   * @returns Dispatcher decision and metadata.
   */
  resolve(target: string | URL): ProxyUndiciDispatcherResolution {
    const targetUrl = parseTargetUrl(target);
    const targetProtocol = targetUrl.protocol.toLowerCase();
    if (!TARGET_PROTOCOLS.has(targetProtocol)) {
      throw new UnsupportedTargetProtocolError(targetProtocol);
    }

    const proxyUrlValue = resolveProxyForUrl(targetUrl, this.settings);
    if (!proxyUrlValue) {
      return this.resolveDirect();
    }

    const parsedProxyUrl = parseProxyUrl(proxyUrlValue);
    const proxyProtocol = parsedProxyUrl.protocol.toLowerCase();
    if (SOCKS_PROTOCOLS.has(proxyProtocol) || PAC_PROTOCOLS.has(proxyProtocol)) {
      throw new UnsupportedProxyProtocolError(proxyProtocol);
    }
    if (!SUPPORTED_PROXY_PROTOCOLS.has(proxyProtocol)) {
      throw new UnsupportedProxyProtocolError(proxyProtocol);
    }

    const cacheKey = parsedProxyUrl.href;
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return {
        dispatcher: cached,
        proxyUrl: cacheKey,
        viaProxy: true,
        fromCache: true
      };
    }

    const created = this.adapter.createProxy(cacheKey, this.proxyDispatcherOptions);
    this.cache.set(cacheKey, created);
    return {
      dispatcher: created,
      proxyUrl: cacheKey,
      viaProxy: true,
      fromCache: false
    };
  }

  /**
   * Clears all cached dispatchers and closes them.
   */
  clear(): void {
    this.destroy();
  }

  /**
   * Destroys all dispatchers and resets factory cache.
   */
  destroy(): void {
    if (this.directDispatcher) {
      closeDispatcher(this.directDispatcher);
      this.directDispatcher = null;
    }
    this.cache.clear();
  }

  /**
   * Alias for `destroy()` for dispose-oriented integrations.
   */
  dispose(): void {
    this.destroy();
  }

  /**
   * Replaces active proxy settings and closes existing dispatchers.
   *
   * @param settings New proxy settings.
   */
  updateSettings(settings: ProxySettings): void {
    this.settings = settings;
    this.destroy();
  }

  /**
   * Reloads settings from environment and closes existing dispatchers.
   *
   * @param env Environment source. Defaults to constructor env, then process env.
   * @returns Loaded settings.
   */
  reloadFromEnvironment(env: ProxyEnvironment = this.envSource ?? process.env): ProxySettings {
    this.settings = loadProxySettings(env);
    this.destroy();
    return this.settings;
  }

  /**
   * Number of cached proxy dispatchers.
   */
  get cacheSize(): number {
    return this.cache.size;
  }

  private resolveDirect(): ProxyUndiciDispatcherResolution {
    if (this.directDispatcher) {
      return {
        dispatcher: this.directDispatcher,
        proxyUrl: null,
        viaProxy: false,
        fromCache: true
      };
    }
    this.directDispatcher = this.adapter.createDirect(this.directDispatcherOptions);
    return {
      dispatcher: this.directDispatcher,
      proxyUrl: null,
      viaProxy: false,
      fromCache: false
    };
  }
}

/**
 * Creates a `ProxyUndiciDispatcherFactory`.
 *
 * @param options Factory options.
 * @returns Factory instance.
 */
export function createProxyUndiciDispatcherFactory(
  options: ProxyUndiciDispatcherFactoryOptions = {}
): ProxyUndiciDispatcherFactory {
  return new ProxyUndiciDispatcherFactory(options);
}

function createDefaultDispatcherAdapter(): UndiciDispatcherAdapter {
  return {
    createDirect: (options) => new UndiciAgent(options as never),
    createProxy: (proxyUrl, options) =>
      new UndiciProxyAgent({
        uri: proxyUrl,
        ...(options ?? {})
      } as never)
  };
}

function parseTargetUrl(target: string | URL): URL {
  if (target instanceof URL) {
    return target;
  }
  try {
    return new URL(target);
  } catch (error) {
    throw new InvalidTargetUrlError(target, error);
  }
}

function parseProxyUrl(proxyUrl: string): URL {
  try {
    return new URL(proxyUrl);
  } catch (error) {
    throw new InvalidProxyUrlError(proxyUrl, error);
  }
}

function closeDispatcher(dispatcher: Dispatcher): void {
  const closeCandidate = dispatcher as DispatcherWithClose;
  if (invokeCloseMethod(closeCandidate.close)) {
    return;
  }
  invokeCloseMethod(closeCandidate.destroy);
}

function invokeCloseMethod(method: (() => unknown) | undefined): boolean {
  if (!method) {
    return false;
  }
  try {
    const result = method();
    if (result instanceof Promise) {
      void result.catch(() => {
        // Ignore async close errors during cache cleanup.
      });
    }
  } catch {
    // Ignore sync close errors during cache cleanup.
  }
  return true;
}

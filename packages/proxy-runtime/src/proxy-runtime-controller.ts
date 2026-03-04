import type { Agent } from "node:http";
import {
  ProxyAgentFactory,
  loadProxySettings,
  shouldBypassProxy,
  type ProxyAgentConstructorOptions,
  type ProxyAgentResolution,
  type ProxyEnvironment,
  type ProxySettings
} from "@commandrelay/proxy-agent";

/**
 * Runtime-level decision mode for a resolved target.
 */
export type ProxyRuntimeDecisionMode = "proxy" | "direct";

/**
 * Runtime-level reason code for a target routing decision.
 */
export type ProxyRuntimeDecisionReason =
  | "proxy_configured"
  | "no_proxy_match"
  | "proxy_not_configured";

/**
 * Structured metadata describing the latest proxy routing decision.
 */
export interface ProxyRuntimeDecisionMetadata {
  target: string;
  protocol: string;
  mode: ProxyRuntimeDecisionMode;
  reason: ProxyRuntimeDecisionReason;
  matchedNoProxy: boolean;
  proxyUrl: string | null;
  viaProxy: boolean;
  fromCache: boolean;
}

/**
 * Structured resolve output with decision metadata.
 */
export interface ProxyRuntimeResolution extends ProxyAgentResolution {
  agent: Agent | null;
  metadata: ProxyRuntimeDecisionMetadata;
}

/**
 * Runtime counters useful for diagnostics and observability.
 */
export interface ProxyRuntimeStats {
  resolveCount: number;
  proxiedCount: number;
  directCount: number;
  noProxyBypassCount: number;
  cacheHitCount: number;
}

/**
 * Snapshot of controller state.
 */
export interface ProxyRuntimeSnapshot {
  settings: ProxySettings;
  cacheSize: number;
  disposed: boolean;
  stats: ProxyRuntimeStats;
}

/**
 * Constructor options for `ProxyRuntimeController`.
 */
export interface ProxyRuntimeControllerOptions {
  settings?: ProxySettings;
  env?: ProxyEnvironment;
  maxCacheEntries?: number;
  agentOptions?: ProxyAgentConstructorOptions;
}

/**
 * Production runtime controller for proxy settings, routing, and agent lifecycle.
 */
export class ProxyRuntimeController {
  private settings: ProxySettings;
  private readonly envSource: ProxyEnvironment | undefined;
  private readonly factory: ProxyAgentFactory;
  private disposed = false;
  private readonly stats: ProxyRuntimeStats = createInitialStats();

  /**
   * Creates a runtime controller.
   *
   * @param options Optional controller settings.
   */
  constructor(options: ProxyRuntimeControllerOptions = {}) {
    this.envSource = options.env;
    this.settings = cloneProxySettings(options.settings ?? loadProxySettings(options.env));
    this.factory = new ProxyAgentFactory({
      settings: cloneProxySettings(this.settings),
      maxCacheEntries: options.maxCacheEntries,
      agentOptions: options.agentOptions
    });
  }

  /**
   * Resolves routing and cached agent metadata for a target.
   *
   * @param target Target URL input.
   * @returns Proxy resolution with runtime decision metadata.
   */
  resolve(target: string | URL): ProxyRuntimeResolution {
    this.activate();

    const targetUrl = toTargetUrl(target);
    const matchedNoProxy = shouldBypassProxy(targetUrl, this.settings.noProxy);
    const resolution = this.factory.resolve(targetUrl);
    const mode: ProxyRuntimeDecisionMode = resolution.viaProxy ? "proxy" : "direct";
    const reason: ProxyRuntimeDecisionReason = resolution.viaProxy
      ? "proxy_configured"
      : matchedNoProxy
        ? "no_proxy_match"
        : "proxy_not_configured";

    this.recordDecision(resolution, matchedNoProxy);

    return {
      ...resolution,
      metadata: {
        target: targetUrl.toString(),
        protocol: targetUrl.protocol,
        mode,
        reason,
        matchedNoProxy,
        proxyUrl: resolution.proxyUrl,
        viaProxy: resolution.viaProxy,
        fromCache: resolution.fromCache
      }
    };
  }

  /**
   * Replaces active settings and clears cached agents.
   *
   * @param settings Next proxy settings.
   */
  updateSettings(settings: ProxySettings): void {
    this.activate();
    const next = cloneProxySettings(settings);
    this.settings = next;
    this.factory.updateSettings(cloneProxySettings(next));
  }

  /**
   * Reloads settings from environment and clears cached agents.
   *
   * @param env Environment source. Defaults to constructor env, then `process.env`.
   * @returns Reloaded settings.
   */
  reloadFromEnvironment(env: ProxyEnvironment = this.envSource ?? process.env): ProxySettings {
    this.activate();
    const loaded = this.factory.reloadFromEnvironment(env);
    this.settings = cloneProxySettings(loaded);
    return cloneProxySettings(this.settings);
  }

  /**
   * Clears cached agents while preserving active settings and counters.
   */
  clear(): void {
    this.factory.clear();
  }

  /**
   * Destroys cached agents and marks this runtime as disposed.
   */
  destroy(): void {
    this.factory.destroy();
    this.disposed = true;
  }

  /**
   * Alias for `destroy()` to support dispose-first integrations.
   */
  dispose(): void {
    this.destroy();
  }

  /**
   * Number of currently cached proxy agents.
   */
  get cacheSize(): number {
    return this.factory.cacheSize;
  }

  /**
   * Returns a read-only runtime snapshot suitable for diagnostics.
   */
  getSnapshot(): ProxyRuntimeSnapshot {
    return {
      settings: cloneProxySettings(this.settings),
      cacheSize: this.cacheSize,
      disposed: this.disposed,
      stats: { ...this.stats }
    };
  }

  private activate(): void {
    this.disposed = false;
  }

  private recordDecision(resolution: ProxyAgentResolution, matchedNoProxy: boolean): void {
    this.stats.resolveCount += 1;

    if (resolution.viaProxy) {
      this.stats.proxiedCount += 1;
    } else {
      this.stats.directCount += 1;
      if (matchedNoProxy) {
        this.stats.noProxyBypassCount += 1;
      }
    }

    if (resolution.fromCache) {
      this.stats.cacheHitCount += 1;
    }
  }
}

/**
 * Creates a `ProxyRuntimeController` instance.
 *
 * @param options Optional controller settings.
 * @returns Runtime controller.
 */
export function createProxyRuntimeController(
  options: ProxyRuntimeControllerOptions = {}
): ProxyRuntimeController {
  return new ProxyRuntimeController(options);
}

function createInitialStats(): ProxyRuntimeStats {
  return {
    resolveCount: 0,
    proxiedCount: 0,
    directCount: 0,
    noProxyBypassCount: 0,
    cacheHitCount: 0
  };
}

function cloneProxySettings(settings: ProxySettings): ProxySettings {
  return {
    httpProxy: settings.httpProxy,
    httpsProxy: settings.httpsProxy,
    allProxy: settings.allProxy,
    noProxy: settings.noProxy.map((rule) => ({ ...rule }))
  };
}

function toTargetUrl(target: string | URL): URL {
  if (target instanceof URL) {
    return target;
  }

  const input = String(target);
  try {
    return new URL(input);
  } catch (error) {
    const invalidTargetError = new TypeError("invalid_target_url") as TypeError & {
      cause?: unknown;
    };
    invalidTargetError.cause = error;
    throw invalidTargetError;
  }
}

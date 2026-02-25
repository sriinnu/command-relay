/**
 * @file Compatibility wrapper for proxy agent factory primitives.
 */

import type { Agent } from "node:http";
import {
  ProxyAgentFactory as PrimitiveProxyAgentFactory
} from "../../packages/proxy-agent/src/proxy-agent-factory.js";
import {
  loadProxySettings,
  type ProxySettings
} from "./proxy-router.js";

/** Agent resolution output for one target URL. */
export interface AgentResolution {
  agent: Agent | null;
  proxyUrl: string | null;
  viaProxy: boolean;
}

/** Factory constructor options. */
export interface ProxyAgentFactoryOptions {
  settings?: ProxySettings;
  maxCacheEntries?: number;
}

/**
 * Factory that resolves and caches outbound proxy agents by target URL.
 */
export class ProxyAgentFactory {
  private readonly primitiveFactory: PrimitiveProxyAgentFactory;

  /**
   * @param options Factory configuration.
   */
  constructor(options: ProxyAgentFactoryOptions = {}) {
    this.primitiveFactory = new PrimitiveProxyAgentFactory({
      settings: options.settings ?? loadProxySettings(),
      maxCacheEntries: options.maxCacheEntries
    });
  }

  /**
   * Resolves an agent for the given target URL.
   *
   * @param target Target URL.
   * @returns Proxy resolution result.
   */
  resolve(target: string | URL): AgentResolution {
    const resolution = this.primitiveFactory.resolve(target);
    return {
      agent: resolution.agent,
      proxyUrl: resolution.proxyUrl,
      viaProxy: resolution.viaProxy
    };
  }

  /**
   * Clears all cached agents.
   */
  clear(): void {
    this.primitiveFactory.clear();
  }
}

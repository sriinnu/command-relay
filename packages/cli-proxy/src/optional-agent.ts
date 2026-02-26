import type { ProxyEnvironment } from "@commandrelay/proxy-core";
import type {
  ProxyAgentResolutionDetail,
  ProxyAgentRouteResolver
} from "./types.js";

interface ProxyAgentFactoryLike {
  new (options?: Record<string, unknown>): {
    resolve: (target: string | URL) => {
      agent: unknown;
      proxyUrl: string | null;
      viaProxy: boolean;
    };
    destroy?: () => void;
    dispose?: () => void;
  };
}

/**
 * Attempts to create a proxy-agent-backed route resolver.
 *
 * Returns `null` when `@commandrelay/proxy-agent` is not installed.
 */
export async function createOptionalProxyAgentResolver(): Promise<ProxyAgentRouteResolver | null> {
  const ProxyAgentFactory = await loadFactory();
  if (!ProxyAgentFactory) {
    return null;
  }

  return {
    async resolve(target: string | URL, env: ProxyEnvironment): Promise<ProxyAgentResolutionDetail> {
      const factory = new ProxyAgentFactory({ env, maxCacheEntries: 0 });
      try {
        const resolved = factory.resolve(target);
        const agentClass = readAgentClassName(resolved.agent);
        return {
          adapter: "@commandrelay/proxy-agent",
          agentClass,
          viaProxy: Boolean(resolved.viaProxy),
          proxyUrl: resolved.proxyUrl,
          error: null
        };
      } catch (error) {
        return {
          adapter: "@commandrelay/proxy-agent",
          agentClass: null,
          viaProxy: false,
          proxyUrl: null,
          error: toErrorMessage(error)
        };
      } finally {
        if (typeof factory.destroy === "function") {
          factory.destroy();
        } else if (typeof factory.dispose === "function") {
          factory.dispose();
        }
      }
    }
  };
}

async function loadFactory(): Promise<ProxyAgentFactoryLike | null> {
  try {
    const module = await import("@commandrelay/proxy-agent");
    const candidate = (module as { ProxyAgentFactory?: unknown }).ProxyAgentFactory;
    return typeof candidate === "function" ? (candidate as ProxyAgentFactoryLike) : null;
  } catch {
    return null;
  }
}

function readAgentClassName(agent: unknown): string | null {
  if (!agent || typeof agent !== "object") {
    return null;
  }

  const ctor = (agent as { constructor?: { name?: unknown } }).constructor;
  if (!ctor || typeof ctor.name !== "string") {
    return "UnknownAgent";
  }

  return ctor.name;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

import {
  resolveProxyForUrl,
  shouldBypassProxy,
  type NoProxyRule,
  type ProxyEnvironment,
  type ProxySettings
} from "@commandrelay/proxy-core";
import { inspectProxyEnvironment } from "./env-inspector.js";
import { createOptionalProxyAgentResolver } from "./optional-agent.js";
import type {
  AgentSupport,
  ExplainRoutesOptions,
  ExplainRoutesResult,
  ProxyAgentRouteResolver,
  ProxySettingSource,
  RouteExplanation
} from "./types.js";

/**
 * Explains proxy routing for each input URL.
 *
 * @param inputs URL-like inputs to explain.
 * @param options Explain options.
 * @returns Structured route explain output.
 */
export async function explainProxyRoutes(
  inputs: readonly string[],
  options: ExplainRoutesOptions = {}
): Promise<ExplainRoutesResult> {
  const env = options.env ?? process.env;
  const inspection = inspectProxyEnvironment(env);

  const { support, resolver } = await resolveAgentResolver(options);
  const routes: RouteExplanation[] = [];

  for (const input of inputs) {
    routes.push(
      await explainOneRoute(input, inspection.settings, env, resolver)
    );
  }

  return {
    inspection,
    routes,
    agentSupport: support
  };
}

async function resolveAgentResolver(
  options: ExplainRoutesOptions
): Promise<{ support: AgentSupport; resolver: ProxyAgentRouteResolver | null }> {
  if (!options.enableAgent) {
    return {
      support: "disabled",
      resolver: null
    };
  }

  if (options.agentResolver === null) {
    return {
      support: "unavailable",
      resolver: null
    };
  }

  if (options.agentResolver) {
    return {
      support: "enabled",
      resolver: options.agentResolver
    };
  }

  const optionalResolver = await createOptionalProxyAgentResolver();
  if (!optionalResolver) {
    return {
      support: "unavailable",
      resolver: null
    };
  }

  return {
    support: "enabled",
    resolver: optionalResolver
  };
}

async function explainOneRoute(
  input: string,
  settings: ProxySettings,
  env: ProxyEnvironment,
  agentResolver: ProxyAgentRouteResolver | null
): Promise<RouteExplanation> {
  const target = tryParseUrl(input);
  if (!target) {
    return {
      input,
      decision: "error",
      targetUrl: null,
      targetProtocol: null,
      proxyUrl: null,
      proxySource: null,
      matchedNoProxyRule: null,
      reason: "Target is not a valid URL.",
      agent: null,
      error: "invalid_target_url"
    };
  }

  const bypass = shouldBypassProxy(target, settings.noProxy);
  const matchedNoProxyRule = bypass
    ? findMatchingNoProxyRule(target, settings.noProxy)
    : null;
  const proxyUrl = resolveProxyForUrl(target, settings);
  const proxySource = resolveProxySource(target.protocol, settings, proxyUrl);

  const explanation: RouteExplanation = {
    input,
    decision: "direct",
    targetUrl: target.toString(),
    targetProtocol: target.protocol,
    proxyUrl,
    proxySource,
    matchedNoProxyRule,
    reason: "",
    agent: null,
    error: null
  };

  if (bypass) {
    explanation.decision = "direct";
    explanation.reason = matchedNoProxyRule
      ? `Direct route due to NO_PROXY rule ${formatNoProxyRule(matchedNoProxyRule)}.`
      : "Direct route due to NO_PROXY bypass.";
  } else if (proxyUrl) {
    explanation.decision = "proxy";
    explanation.reason = proxySource
      ? `Route uses ${proxySource} with proxy ${proxyUrl}.`
      : `Route uses proxy ${proxyUrl}.`;
  } else {
    explanation.decision = "direct";
    explanation.reason = "Direct route because no proxy setting matched this protocol.";
  }

  if (agentResolver) {
    explanation.agent = await agentResolver.resolve(target, env);
  }

  return explanation;
}

function tryParseUrl(input: string): URL | null {
  try {
    return new URL(input);
  } catch {
    return null;
  }
}

function resolveProxySource(
  protocol: string,
  settings: ProxySettings,
  proxyUrl: string | null
): ProxySettingSource | null {
  if (!proxyUrl) {
    return null;
  }

  switch (protocol) {
    case "http:":
    case "ws:":
      if (settings.httpProxy === proxyUrl) {
        return "httpProxy";
      }
      if (settings.allProxy === proxyUrl) {
        return "allProxy";
      }
      return null;
    case "https:":
    case "wss:":
      if (settings.httpsProxy === proxyUrl) {
        return "httpsProxy";
      }
      if (settings.httpProxy === proxyUrl) {
        return "httpProxy";
      }
      if (settings.allProxy === proxyUrl) {
        return "allProxy";
      }
      return null;
    default:
      if (settings.allProxy === proxyUrl) {
        return "allProxy";
      }
      return null;
  }
}

function findMatchingNoProxyRule(target: URL, rules: readonly NoProxyRule[]): NoProxyRule | null {
  const host = normalizeHost(target.hostname);
  if (!host) {
    return null;
  }

  const port = getPort(target);

  for (const rule of rules) {
    if (rule.host === "*") {
      return rule;
    }

    if (!matchesRuleHost(host, rule)) {
      continue;
    }

    if (rule.port === null || rule.port === port) {
      return rule;
    }
  }

  return null;
}

function matchesRuleHost(targetHost: string, rule: NoProxyRule): boolean {
  if (targetHost === rule.host) {
    return true;
  }

  if (!rule.matchSubdomains) {
    return false;
  }

  if (!targetHost.endsWith(rule.host)) {
    return false;
  }

  const boundaryIndex = targetHost.length - rule.host.length - 1;
  return boundaryIndex >= 0 && targetHost[boundaryIndex] === ".";
}

function normalizeHost(hostname: string): string | null {
  const trimmed = hostname.trim().toLowerCase();
  if (!trimmed) {
    return null;
  }

  const unbracketed = trimmed.startsWith("[") && trimmed.endsWith("]")
    ? trimmed.slice(1, -1)
    : trimmed;
  const normalized = unbracketed.endsWith(".")
    ? unbracketed.slice(0, -1)
    : unbracketed;

  if (!normalized || normalized.includes("/") || normalized.includes(" ")) {
    return null;
  }

  return normalized;
}

function getPort(target: URL): number {
  if (target.port) {
    const parsed = Number.parseInt(target.port, 10);
    if (Number.isSafeInteger(parsed) && parsed > 0 && parsed <= 65_535) {
      return parsed;
    }
  }

  switch (target.protocol) {
    case "https:":
    case "wss:":
      return 443;
    default:
      return 80;
  }
}

function formatNoProxyRule(rule: NoProxyRule): string {
  const host = rule.matchSubdomains && rule.host !== "*"
    ? `*.${rule.host}`
    : rule.host;
  return rule.port === null ? host : `${host}:${rule.port}`;
}

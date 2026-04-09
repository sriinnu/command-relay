import type { Agent } from "node:http";
import {
  ProxyAgentFactory,
  type ProxyAgentFactoryOptions,
  type ProxyEnvironment,
  type ProxySettings
} from "@commandrelay/proxy-agent";
import {
  InvalidGotPrefixUrlError,
  InvalidGotTargetError,
  MissingGotTargetError,
  UnsupportedGotProtocolError
} from "./errors.js";

const SUPPORTED_TARGET_PROTOCOLS = new Set(["http:", "https:"]);

/**
 * Target argument accepted by got-style request APIs.
 */
export type ProxyGotTargetInput = string | URL | undefined;

/**
 * URL value accepted by got-style `url` option.
 */
export type ProxyGotUrlInput = string | URL;

/**
 * URL value accepted by got-style `prefixUrl` option.
 */
export type ProxyGotPrefixUrlInput = string | URL;

/**
 * Protocol slot names used by got's `agent` option object.
 */
export type ProxyGotAgentProtocol = "http" | "https";

/**
 * Got-compatible `agent` option shape.
 *
 * `http2` remains an open slot so callers can keep an existing HTTP/2 agent
 * object without this package depending on got's runtime or type packages.
 */
export interface ProxyGotAgentOptions {
  http?: Agent | false;
  https?: Agent | false;
  http2?: unknown;
}

/**
 * Minimal got-compatible request option shape used by resolver/apply helpers.
 */
export interface ProxyGotOptions {
  url?: ProxyGotUrlInput;
  prefixUrl?: ProxyGotPrefixUrlInput;
  agent?: ProxyGotAgentOptions;
  method?: string;
  headers?: Record<string, string>;
  searchParams?: URLSearchParams | string | Record<string, string | number | boolean>;
}

/**
 * Routing metadata preserved by all resolver/apply results.
 */
export interface ProxyGotRoutingMetadata {
  viaProxy: boolean;
  proxyUrl: string | null;
  fromCache: boolean;
}

/**
 * Result for a got proxy-agent resolution for a concrete target URL.
 */
export interface ProxyGotAgentResolution extends ProxyGotRoutingMetadata {
  targetUrl: URL;
  protocol: ProxyGotAgentProtocol;
  agent: Agent | undefined;
}

/**
 * Request options shape returned by `applyProxyGotAgent`.
 */
export type ProxyGotAppliedOptions<TOptions extends ProxyGotOptions> = Omit<TOptions, "agent"> & {
  agent?: ProxyGotAgentOptions;
};

/**
 * Result for applying proxy agent options to a got-compatible options object.
 */
export interface ProxyGotApplyResult<TOptions extends ProxyGotOptions = ProxyGotOptions>
  extends ProxyGotRoutingMetadata {
  targetUrl: URL;
  protocol: ProxyGotAgentProtocol;
  options: ProxyGotAppliedOptions<TOptions>;
}

/**
 * Constructor options for `ProxyGotAgentResolver`.
 */
export interface ProxyGotAgentResolverOptions extends ProxyAgentFactoryOptions {}

/**
 * Minimal resolver contract shared by helpers and class wrappers.
 */
export interface ProxyGotRoutingResolver {
  resolve(target: string | URL): ProxyGotRoutingResolution;
}

/**
 * Minimal routing resolution shape consumed by proxy-got helpers.
 */
export interface ProxyGotRoutingResolution extends ProxyGotRoutingMetadata {
  agent: Agent | null | undefined;
}

/**
 * Got-focused wrapper around `ProxyAgentFactory`.
 */
export class ProxyGotAgentResolver {
  private readonly factory: ProxyAgentFactory;

  /**
   * @param options Resolver construction options.
   */
  constructor(options: ProxyGotAgentResolverOptions = {}) {
    this.factory = new ProxyAgentFactory(options);
  }

  /**
   * Resolves proxy routing + Node agent entry for a concrete target.
   *
   * @param target Absolute request target.
   * @returns Routing metadata plus protocol-scoped got agent entry.
   */
  resolve(target: string | URL): ProxyGotAgentResolution {
    return resolveProxyGotAgentEntry(target, this.factory);
  }

  /**
   * Resolves target and routing from got-style `input` + options.
   *
   * @param options Got-compatible options (`url`, `prefixUrl`, ...).
   * @param input Optional got positional input.
   * @returns Routing metadata plus protocol-scoped got agent entry.
   */
  resolveForOptions<TOptions extends ProxyGotOptions>(
    options: TOptions,
    input?: ProxyGotTargetInput
  ): ProxyGotAgentResolution {
    const targetUrl = resolveGotRequestTarget(input, options);
    return resolveProxyGotAgentEntry(targetUrl, this.factory);
  }

  /**
   * Applies resolved proxy agent entry to a got-compatible options object.
   *
   * @param options Got-compatible options (`url`, `prefixUrl`, `agent`, ...).
   * @param input Optional got positional input.
   * @returns Updated options plus preserved routing metadata.
   */
  applyToOptions<TOptions extends ProxyGotOptions>(
    options: TOptions,
    input?: ProxyGotTargetInput
  ): ProxyGotApplyResult<TOptions> {
    return applyProxyGotAgent(options, this.factory, input);
  }

  /**
   * Replaces active proxy settings and clears stale cached agents.
   *
   * @param settings New proxy settings.
   */
  updateSettings(settings: ProxySettings): void {
    this.factory.updateSettings(settings);
  }

  /**
   * Reloads settings from environment and clears stale cached agents.
   *
   * @param env Environment source.
   * @returns Newly loaded proxy settings.
   */
  reloadFromEnvironment(env?: ProxyEnvironment): ProxySettings {
    return this.factory.reloadFromEnvironment(env);
  }

  /**
   * Clears the cached proxy agents.
   */
  clear(): void {
    this.factory.clear();
  }

  /**
   * Destroys cached agents and clears cache entries.
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
   * Number of currently cached proxy agents.
   */
  get cacheSize(): number {
    return this.factory.cacheSize;
  }
}

/**
 * Creates a `ProxyGotAgentResolver` instance.
 *
 * @param options Resolver options.
 * @returns Resolver instance.
 */
export function createProxyGotAgentResolver(
  options: ProxyGotAgentResolverOptions = {}
): ProxyGotAgentResolver {
  return new ProxyGotAgentResolver(options);
}

/**
 * Resolves a concrete URL from got-like input and option fields.
 *
 * Resolution priority:
 * 1) `options.url`
 * 2) positional `input`
 *
 * If the resolved value is relative, `options.prefixUrl` is used as a base.
 *
 * @param input Optional got positional input.
 * @param options Got-compatible options.
 * @returns Absolute request target URL.
 */
export function resolveGotRequestTarget(
  input: ProxyGotTargetInput,
  options: Pick<ProxyGotOptions, "url" | "prefixUrl"> = {}
): URL {
  const rawTarget = options.url ?? input;
  if (rawTarget === undefined || rawTarget === null) {
    throw new MissingGotTargetError();
  }

  const prefixBase =
    options.prefixUrl === undefined ? null : parsePrefixUrl(options.prefixUrl);

  if (rawTarget instanceof URL) {
    return assertSupportedTargetProtocol(new URL(rawTarget.toString()));
  }

  const inputText = String(rawTarget).trim();
  if (!inputText) {
    throw new MissingGotTargetError();
  }

  try {
    return assertSupportedTargetProtocol(new URL(inputText));
  } catch (absoluteError) {
    if (!prefixBase) {
      throw new InvalidGotTargetError(inputText, absoluteError);
    }

    try {
      return assertSupportedTargetProtocol(new URL(inputText, prefixBase));
    } catch (relativeError) {
      throw new InvalidGotTargetError(inputText, relativeError);
    }
  }
}

/**
 * Resolves a proxy agent entry for a concrete target URL.
 *
 * @param target Absolute target input.
 * @param resolver Routing resolver.
 * @returns Protocol-scoped got agent entry and routing metadata.
 */
export function resolveProxyGotAgentEntry(
  target: string | URL,
  resolver: ProxyGotRoutingResolver
): ProxyGotAgentResolution {
  const targetUrl = parseAbsoluteTarget(target);
  const protocol = toGotAgentProtocol(targetUrl.protocol);
  const route = resolver.resolve(targetUrl);

  return {
    targetUrl,
    protocol,
    agent: route.viaProxy ? route.agent ?? undefined : undefined,
    viaProxy: route.viaProxy,
    proxyUrl: route.proxyUrl,
    fromCache: route.fromCache
  };
}

/**
 * Applies proxy agent routing to got-style options while preserving metadata.
 *
 * @param options Got-compatible options to update.
 * @param resolver Routing resolver.
 * @param input Optional got positional input.
 * @returns Updated options and routing metadata.
 */
export function applyProxyGotAgent<TOptions extends ProxyGotOptions>(
  options: TOptions,
  resolver: ProxyGotRoutingResolver,
  input?: ProxyGotTargetInput
): ProxyGotApplyResult<TOptions> {
  const targetUrl = resolveGotRequestTarget(input, options);
  const resolution = resolveProxyGotAgentEntry(targetUrl, resolver);
  const agent = mergeAgentOptions(options.agent, resolution.protocol, resolution.agent);

  const nextOptions = {
    ...options,
    ...(agent ? { agent } : {})
  } as ProxyGotAppliedOptions<TOptions>;

  return {
    targetUrl: resolution.targetUrl,
    protocol: resolution.protocol,
    options: nextOptions,
    viaProxy: resolution.viaProxy,
    proxyUrl: resolution.proxyUrl,
    fromCache: resolution.fromCache
  };
}

function mergeAgentOptions(
  existing: ProxyGotAgentOptions | undefined,
  protocol: ProxyGotAgentProtocol,
  resolvedAgent: Agent | undefined
): ProxyGotAgentOptions | undefined {
  if (!resolvedAgent) {
    return existing ? { ...existing } : undefined;
  }

  const next: ProxyGotAgentOptions = { ...(existing ?? {}) };
  if (protocol === "http") {
    next.http = resolvedAgent;
  } else {
    next.https = resolvedAgent;
  }
  return next;
}

function parseAbsoluteTarget(target: string | URL): URL {
  if (target instanceof URL) {
    return assertSupportedTargetProtocol(new URL(target.toString()));
  }

  const value = String(target).trim();
  if (!value) {
    throw new MissingGotTargetError();
  }

  try {
    return assertSupportedTargetProtocol(new URL(value));
  } catch (error) {
    throw new InvalidGotTargetError(value, error);
  }
}

function parsePrefixUrl(prefixUrl: ProxyGotPrefixUrlInput): URL {
  const raw = prefixUrl instanceof URL ? prefixUrl.toString() : String(prefixUrl).trim();
  if (!raw) {
    throw new InvalidGotPrefixUrlError(String(prefixUrl));
  }

  try {
    return ensureTrailingSlash(assertSupportedTargetProtocol(new URL(raw)));
  } catch (error) {
    throw new InvalidGotPrefixUrlError(raw, error);
  }
}

function ensureTrailingSlash(url: URL): URL {
  const normalized = new URL(url.toString());
  if (!normalized.pathname.endsWith("/")) {
    normalized.pathname = `${normalized.pathname}/`;
  }
  return normalized;
}

function assertSupportedTargetProtocol(targetUrl: URL): URL {
  toGotAgentProtocol(targetUrl.protocol);
  return targetUrl;
}

function toGotAgentProtocol(protocol: string): ProxyGotAgentProtocol {
  const normalized = protocol.toLowerCase();
  if (!SUPPORTED_TARGET_PROTOCOLS.has(normalized)) {
    throw new UnsupportedGotProtocolError(normalized);
  }

  return normalized === "http:" ? "http" : "https";
}

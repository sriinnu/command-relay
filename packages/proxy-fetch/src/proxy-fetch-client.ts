import {
  createProxyUndiciDispatcherFactory,
  type ProxyEnvironment,
  type ProxySettings,
  ProxyUndiciDispatcherFactory,
  type ProxyUndiciDispatcherFactoryOptions
} from "@commandrelay/proxy-undici";
import { NonJsonResponseError, RequestTimeoutError } from "./errors.js";
import {
  createAbortControl,
  createRequestInit,
  isJsonMediaType,
  normalizeMaxResponseBytes,
  normalizeTimeout,
  parseTargetUrl,
  readResponseTextWithLimit
} from "./proxy-fetch-runtime.js";
import type { ProxyUndiciDispatcherResolution } from "@commandrelay/proxy-undici";

/**
 * Default request timeout in milliseconds.
 */
export const DEFAULT_TIMEOUT_MS = 8_000;

/**
 * Default maximum JSON response payload size in bytes.
 */
export const DEFAULT_MAX_RESPONSE_BYTES = 1_048_576;

/**
 * Fetch-compatible function used by the client.
 */
export type ProxyFetchImplementation = (
  input: string | URL,
  init?: RequestInit
) => Promise<Response>;

/**
 * Common request options for `fetch` and `fetchJson`.
 */
export interface ProxyFetchRequestOptions {
  /** HTTP method. Defaults to `GET`. */
  method?: string;
  /** Request headers. */
  headers?: RequestInit["headers"];
  /** Request body. */
  body?: RequestInit["body"];
  /** Request timeout in milliseconds. Defaults to client default. */
  timeoutMs?: number;
  /** Optional caller-controlled abort signal. */
  signal?: AbortSignal;
  /** Additional `fetch` options excluding fields controlled by this package. */
  requestInit?: Omit<RequestInit, "method" | "headers" | "body" | "signal">;
}

/**
 * JSON request options with payload size guardrails.
 */
export interface ProxyFetchJsonOptions extends ProxyFetchRequestOptions {
  /** Maximum response payload size in bytes. Defaults to client default. */
  maxResponseBytes?: number;
}

/**
 * Result of a raw proxied fetch call.
 */
export interface ProxyFetchResult {
  response: Response;
  routing: ProxyUndiciDispatcherResolution;
}

/**
 * Result of a JSON proxied fetch call.
 */
export interface ProxyFetchJsonResult<TBody> extends ProxyFetchResult {
  status: number;
  headers: Headers;
  body: TBody | null;
  rawBody: string;
}

/**
 * Constructor options for `ProxyFetchClient`.
 */
export interface ProxyFetchClientOptions
  extends Pick<
    ProxyUndiciDispatcherFactoryOptions,
    | "settings"
    | "env"
    | "maxCacheEntries"
    | "directDispatcherOptions"
    | "proxyDispatcherOptions"
    | "adapter"
  > {
  /** Optional externally managed dispatcher factory. */
  dispatcherFactory?: ProxyUndiciDispatcherFactory;
  /** Custom fetch implementation. Defaults to global `fetch`. */
  fetchImplementation?: ProxyFetchImplementation;
  /** Default timeout in milliseconds. Defaults to `8000`. */
  defaultTimeoutMs?: number;
  /** Default max JSON payload size in bytes. Defaults to `1048576`. */
  defaultMaxResponseBytes?: number;
}

/**
 * One-shot options for `proxyFetch`.
 */
export interface ProxyFetchOneShotOptions extends ProxyFetchRequestOptions {
  /** Client-level options used to construct a temporary `ProxyFetchClient`. */
  client?: ProxyFetchClientOptions;
}

/**
 * One-shot options for `proxyFetchJson`.
 */
export interface ProxyFetchJsonOneShotOptions extends ProxyFetchJsonOptions {
  /** Client-level options used to construct a temporary `ProxyFetchClient`. */
  client?: ProxyFetchClientOptions;
}

/**
 * Reusable proxy-aware `fetch` client with JSON helpers.
 */
export class ProxyFetchClient {
  private readonly dispatcherFactory: ProxyUndiciDispatcherFactory;
  private readonly ownsDispatcherFactory: boolean;
  private readonly fetchImplementation: ProxyFetchImplementation;
  private readonly defaultTimeoutMs: number;
  private readonly defaultMaxResponseBytes: number;

  /**
   * @param options Client configuration.
   */
  constructor(options: ProxyFetchClientOptions = {}) {
    this.dispatcherFactory =
      options.dispatcherFactory ??
      createProxyUndiciDispatcherFactory({
        settings: options.settings,
        env: options.env,
        maxCacheEntries: options.maxCacheEntries,
        directDispatcherOptions: options.directDispatcherOptions,
        proxyDispatcherOptions: options.proxyDispatcherOptions,
        adapter: options.adapter
      });

    this.ownsDispatcherFactory = !options.dispatcherFactory;
    this.fetchImplementation = options.fetchImplementation ?? globalThis.fetch.bind(globalThis);
    this.defaultTimeoutMs = normalizeTimeout(options.defaultTimeoutMs, DEFAULT_TIMEOUT_MS);
    this.defaultMaxResponseBytes = normalizeMaxResponseBytes(
      options.defaultMaxResponseBytes,
      DEFAULT_MAX_RESPONSE_BYTES
    );
  }

  /**
   * Performs a proxy-aware `fetch` request.
   *
   * @param target Target URL.
   * @param options Request options.
   * @returns Raw response and routing metadata.
   */
  async fetch(
    target: string | URL,
    options: ProxyFetchRequestOptions = {}
  ): Promise<ProxyFetchResult> {
    const targetUrl = parseTargetUrl(target);
    return this.performFetch(targetUrl, options);
  }

  /**
   * Performs a proxy-aware `fetch` request and parses JSON response body.
   *
   * @param target Target URL.
   * @param options JSON request options.
   * @returns Parsed response details with routing metadata.
   */
  async fetchJson<TBody = unknown>(
    target: string | URL,
    options: ProxyFetchJsonOptions = {}
  ): Promise<ProxyFetchJsonResult<TBody>> {
    const targetUrl = parseTargetUrl(target);
    const maxResponseBytes = normalizeMaxResponseBytes(
      options.maxResponseBytes,
      this.defaultMaxResponseBytes
    );
    const fetchResult = await this.performFetch(targetUrl, options);

    const rawBody = await readResponseTextWithLimit(
      fetchResult.response,
      maxResponseBytes,
      targetUrl.toString()
    );

    if (!rawBody) {
      return {
        ...fetchResult,
        status: fetchResult.response.status,
        headers: fetchResult.response.headers,
        body: null,
        rawBody
      };
    }

    const contentType = fetchResult.response.headers.get("content-type");
    if (!isJsonMediaType(contentType)) {
      throw new NonJsonResponseError(
        targetUrl.toString(),
        fetchResult.response.status,
        contentType,
        rawBody,
        "invalid_content_type"
      );
    }

    try {
      return {
        ...fetchResult,
        status: fetchResult.response.status,
        headers: fetchResult.response.headers,
        body: JSON.parse(rawBody) as TBody,
        rawBody
      };
    } catch (error) {
      throw new NonJsonResponseError(
        targetUrl.toString(),
        fetchResult.response.status,
        contentType,
        rawBody,
        "invalid_json",
        error
      );
    }
  }

  /**
   * Clears cached dispatchers and closes owned resources.
   */
  destroy(): void {
    if (this.ownsDispatcherFactory) {
      this.dispatcherFactory.destroy();
    }
  }

  /**
   * Alias for `destroy()`.
   */
  dispose(): void {
    this.destroy();
  }

  /**
   * Clears cached dispatchers.
   */
  clear(): void {
    this.dispatcherFactory.clear();
  }

  /**
   * Replaces proxy settings when the client owns the dispatcher factory.
   *
   * @param settings New proxy settings.
   */
  updateSettings(settings: ProxySettings): void {
    this.dispatcherFactory.updateSettings(settings);
  }

  /**
   * Reloads proxy settings from environment when the client owns the dispatcher factory.
   *
   * @param env Environment source. Defaults to process env.
   * @returns Loaded settings.
   */
  reloadFromEnvironment(env?: ProxyEnvironment): ProxySettings {
    return this.dispatcherFactory.reloadFromEnvironment(env);
  }

  private async performFetch(
    targetUrl: URL,
    options: ProxyFetchRequestOptions
  ): Promise<ProxyFetchResult> {
    const timeoutMs = normalizeTimeout(options.timeoutMs, this.defaultTimeoutMs);
    const routing = this.dispatcherFactory.resolve(targetUrl);
    const requestInit = createRequestInit(options, routing);
    const abortControl = createAbortControl(timeoutMs, options.signal);

    try {
      const response = await this.fetchImplementation(targetUrl, {
        ...requestInit,
        signal: abortControl.signal
      });
      return {
        response,
        routing
      };
    } catch (error) {
      if (abortControl.didTimeout()) {
        throw new RequestTimeoutError(targetUrl.toString(), timeoutMs, error);
      }
      throw error;
    } finally {
      abortControl.cleanup();
    }
  }
}

/**
 * Creates a reusable `ProxyFetchClient`.
 *
 * @param options Client configuration.
 * @returns Client instance.
 */
export function createProxyFetchClient(options: ProxyFetchClientOptions = {}): ProxyFetchClient {
  return new ProxyFetchClient(options);
}

/**
 * Performs a one-shot proxy-aware raw fetch call.
 *
 * @param target Target URL.
 * @param options Request options and temporary client configuration.
 * @returns Raw response and routing metadata.
 */
export async function proxyFetch(
  target: string | URL,
  options: ProxyFetchOneShotOptions = {}
): Promise<ProxyFetchResult> {
  const client = new ProxyFetchClient(options.client);
  const { client: _ignoredClient, ...requestOptions } = options;
  try {
    return await client.fetch(target, requestOptions);
  } finally {
    client.destroy();
  }
}

/**
 * Performs a one-shot proxy-aware fetch call and parses a JSON response body.
 *
 * @param target Target URL.
 * @param options JSON request options and temporary client configuration.
 * @returns Parsed JSON response details with routing metadata.
 */
export async function proxyFetchJson<TBody = unknown>(
  target: string | URL,
  options: ProxyFetchJsonOneShotOptions = {}
): Promise<ProxyFetchJsonResult<TBody>> {
  const client = new ProxyFetchClient(options.client);
  const { client: _ignoredClient, ...requestOptions } = options;
  try {
    return await client.fetchJson<TBody>(target, requestOptions);
  } finally {
    client.destroy();
  }
}

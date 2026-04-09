/**
 * @file Concrete outbound control-plane client for auth/pairing/telemetry APIs.
 */

import {
  requestJson as requestJsonViaPackage,
  type JsonRequestOptions as ProxyHttpRequestOptions,
  type JsonResponse as ProxyHttpJsonResponse,
  type ProxyAgentResolver
} from "../../packages/proxy-http-client/src/index.js";
import {
  ProxyAgentFactory,
  loadProxySettings,
  type ProxyEnvironment
} from "../../packages/proxy-agent/src/index.js";
import type { Agent } from "node:http";

/** Request payload for device auth exchange. */
export interface DeviceAuthRequest {
  deviceId: string;
  accessToken: string;
  challengeProof?: string;
  metadata?: Record<string, unknown>;
}

/** Response payload returned by auth exchange. */
export interface DeviceAuthResponse {
  mode?: string;
  capabilities?: string[];
  expiresAt?: string;
  [key: string]: unknown;
}

/** Request payload for one-time pairing claim exchange. */
export interface PairClaimRequest {
  pairingCode: string;
  publicKey: string;
  deviceName?: string;
  platform?: string;
}

/** Response payload returned by pairing claim exchange. */
export interface PairClaimResponse {
  deviceId?: string;
  challenge?: string;
  [key: string]: unknown;
}

/** Request payload for telemetry event submission. */
export interface TelemetryRequest {
  events: Array<{
    name: string;
    timestamp: number;
    attributes?: Record<string, string | number | boolean | null>;
  }>;
}

/** Response payload returned by telemetry endpoint. */
export interface TelemetryResponse {
  accepted?: number;
  rejected?: number;
  [key: string]: unknown;
}

/** Outbound JSON request options used by control-plane client request adapters. */
export interface ControlPlaneRequestOptions {
  method: string;
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
}

/** Outbound JSON response envelope used by control-plane client request adapters. */
export interface ControlPlaneResponse<TBody = unknown> {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: TBody | null;
}

/** Proxy resolution contract used by control-plane request adapters. */
export interface ControlPlaneProxyResolution {
  agent: Agent | null;
}

/**
 * Proxy resolver contract used by control-plane request adapters.
 *
 * Implementations can include optional metadata fields such as `proxyUrl`
 * and `viaProxy`; control-plane request dispatch only requires `agent`.
 */
export interface ControlPlaneProxyResolver {
  resolve(target: string | URL): ControlPlaneProxyResolution;
}

/** Function signature for control-plane JSON request implementations. */
export type ControlPlaneRequestFunction = <TBody = unknown>(
  url: string | URL,
  options: ControlPlaneRequestOptions,
  proxyFactory?: ControlPlaneProxyResolver
) => Promise<ControlPlaneResponse<TBody>>;

/** Categorized transport-layer error codes for outbound control-plane requests. */
export type ControlPlaneTransportErrorCode =
  | "request_timeout"
  | "request_aborted"
  | "transport_error"
  | "unknown_transport_error";

/**
 * Error raised when an outbound request fails before a valid HTTP response is returned.
 */
export class ControlPlaneTransportError extends Error {
  readonly code: ControlPlaneTransportErrorCode;
  readonly url: string;
  readonly cause: unknown;

  /**
   * @param code Categorized transport code.
   * @param url Request URL.
   * @param cause Original thrown error or value.
   */
  constructor(
    code: ControlPlaneTransportErrorCode,
    url: string,
    cause: unknown
  ) {
    super(`control_plane_transport_error:${code}:${url}`);
    this.name = "ControlPlaneTransportError";
    this.code = code;
    this.url = url;
    this.cause = cause;
  }
}

/** Constructor options for {@link ControlPlaneClient}. */
export interface ControlPlaneClientOptions {
  baseUrl: string | URL;
  apiToken?: string | null;
  timeoutMs?: number;
  proxyFactory?: ControlPlaneProxyResolver;
  requestFn?: ControlPlaneRequestFunction;
}

/** Factory options for env-driven client creation. */
export interface CreateControlPlaneClientFromEnvOptions
  extends Omit<ControlPlaneClientOptions, "proxyFactory"> {
  env?: ProxyEnvironment;
  maxProxyCacheEntries?: number;
}

/**
 * Error raised for non-2xx control-plane responses.
 */
export class ControlPlaneHttpError extends Error {
  readonly status: number;
  readonly url: string;
  readonly responseBody: unknown;

  /**
   * @param status HTTP status code.
   * @param url Request URL.
   * @param responseBody Parsed error body.
   */
  constructor(status: number, url: string, responseBody: unknown) {
    super(`control_plane_http_error:${status}:${url}`);
    this.name = "ControlPlaneHttpError";
    this.status = status;
    this.url = url;
    this.responseBody = responseBody;
  }
}

/**
 * Builds an env-driven proxy agent factory for outbound control-plane calls.
 *
 * @param options Optional env and cache overrides.
 * @returns Configured proxy agent factory.
 */
export function createControlPlaneProxyFactory(options: {
  env?: ProxyEnvironment;
  maxProxyCacheEntries?: number;
} = {}): ProxyAgentFactory {
  const settings = loadProxySettings(options.env ?? process.env);
  return new ProxyAgentFactory({
    settings,
    maxCacheEntries: options.maxProxyCacheEntries
  });
}

/**
 * Creates a control-plane client that automatically reads proxy env settings.
 *
 * @param options Client options.
 * @returns Configured client instance.
 */
export function createControlPlaneClientFromEnv(
  options: CreateControlPlaneClientFromEnvOptions
): ControlPlaneClient {
  return new ControlPlaneClient({
    baseUrl: options.baseUrl,
    apiToken: options.apiToken,
    timeoutMs: options.timeoutMs,
    requestFn: options.requestFn,
    proxyFactory: createControlPlaneProxyFactory({
      env: options.env,
      maxProxyCacheEntries: options.maxProxyCacheEntries
    })
  });
}

/**
 * Concrete outbound client for control-plane API calls.
 */
export class ControlPlaneClient {
  private readonly baseUrl: URL;
  private readonly apiToken: string | null;
  private readonly timeoutMs: number;
  private readonly proxyFactory?: ControlPlaneProxyResolver;
  private readonly requestFn: ControlPlaneRequestFunction;

  /**
   * @param options Client configuration.
   */
  constructor(options: ControlPlaneClientOptions) {
    this.baseUrl = options.baseUrl instanceof URL ? options.baseUrl : new URL(options.baseUrl);
    this.apiToken = options.apiToken?.trim() || null;
    this.timeoutMs = normalizeTimeoutMs(options.timeoutMs);
    this.proxyFactory = options.proxyFactory;
    this.requestFn = options.requestFn ?? requestViaProxyHttpPackage;
  }

  /**
   * Performs control-plane auth exchange.
   *
   * @param input Auth payload.
   * @returns Auth response body.
   */
  async authenticate(input: DeviceAuthRequest): Promise<DeviceAuthResponse> {
    return this.post<DeviceAuthResponse>("auth/device", input);
  }

  /**
   * Claims a one-time pairing code.
   *
   * @param input Pairing claim payload.
   * @returns Pairing response body.
   */
  async claimPairing(input: PairClaimRequest): Promise<PairClaimResponse> {
    return this.post<PairClaimResponse>("pair/claim", input);
  }

  /**
   * Sends telemetry events to control-plane ingestion endpoint.
   *
   * @param input Telemetry payload.
   * @returns Telemetry response body.
   */
  async sendTelemetry(input: TelemetryRequest): Promise<TelemetryResponse> {
    return this.post<TelemetryResponse>("telemetry/events", input);
  }

  /**
   * Performs a POST request against the control-plane API.
   *
   * @param path Relative API path.
   * @param payload JSON-serializable payload.
   * @returns Parsed response payload.
   */
  private async post<TResponse>(path: string, payload: unknown): Promise<TResponse> {
    const url = new URL(path, this.baseUrl);
    const headers: Record<string, string> = {};
    if (this.apiToken) {
      headers.authorization = `Bearer ${this.apiToken}`;
    }

    let response: ControlPlaneResponse<TResponse>;
    try {
      response = await this.requestFn<TResponse>(
        url,
        {
          method: "POST",
          headers,
          body: payload,
          timeoutMs: this.timeoutMs
        },
        this.proxyFactory
      );
    } catch (error) {
      throw normalizeTransportError(url, error);
    }

    this.assertSuccess(url, response);
    return response.body as TResponse;
  }

  /**
   * Enforces successful response status range.
   *
   * @param url Request URL.
   * @param response HTTP response envelope.
   * @returns Nothing.
   */
  private assertSuccess(url: URL, response: ControlPlaneResponse<unknown>): void {
    if (response.status >= 200 && response.status < 300) {
      return;
    }
    throw new ControlPlaneHttpError(response.status, url.toString(), response.body);
  }
}

/**
 * Default request adapter that routes through package-managed proxy/http contracts.
 *
 * Uses `@commandrelay/proxy-http-client` for HTTP transport and passes through
 * proxy resolution via `@commandrelay/proxy-agent` compatible resolvers.
 *
 * @param url Target URL.
 * @param options Request options.
 * @param proxyFactory Optional proxy resolver.
 * @returns Control-plane response envelope.
 */
const requestViaProxyHttpPackage: ControlPlaneRequestFunction = async <TBody = unknown>(
  url: string | URL,
  options: ControlPlaneRequestOptions,
  proxyFactory: ControlPlaneProxyResolver | undefined = undefined
): Promise<ControlPlaneResponse<TBody>> => {
  const requestOptions: ProxyHttpRequestOptions = {
    method: options.method,
    headers: options.headers,
    body: options.body,
    timeoutMs: options.timeoutMs,
    throwOnHttpError: false,
    proxyResolver: toProxyAgentResolver(proxyFactory)
  };

  const response: ProxyHttpJsonResponse<TBody> = await requestJsonViaPackage<TBody>(
    url,
    requestOptions
  );

  return {
    status: response.status,
    headers: response.headers as Record<string, string | string[] | undefined>,
    body: response.body
  };
};

/**
 * Converts the legacy control-plane proxy resolver contract to package resolver contract.
 *
 * @param proxyFactory Optional control-plane proxy resolver.
 * @returns Proxy agent resolver for package request client.
 */
function toProxyAgentResolver(
  proxyFactory: ControlPlaneProxyResolver | undefined
): ProxyAgentResolver | undefined {
  if (!proxyFactory) {
    return undefined;
  }

  return {
    resolve(target: URL) {
      const resolved = proxyFactory.resolve(target);
      return { agent: resolved.agent };
    }
  };
}

/**
 * Normalizes configured timeout values.
 *
 * @param timeoutMs Raw timeout option.
 * @returns Finite positive timeout in milliseconds.
 */
function normalizeTimeoutMs(timeoutMs: number | undefined): number {
  if (timeoutMs === undefined) {
    return 8_000;
  }

  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return 8_000;
  }

  return Math.floor(timeoutMs);
}

/**
 * Normalizes outbound request failures into stable transport contracts when applicable.
 *
 * @param url Request URL.
 * @param error Thrown value from request layer.
 * @returns Transport error to throw.
 */
function normalizeTransportError(url: URL, error: unknown): Error {
  if (error instanceof ControlPlaneTransportError) {
    return error;
  }

  const code = inferTransportErrorCode(error);
  if (code) {
    return new ControlPlaneTransportError(code, url.toString(), error);
  }

  if (error instanceof Error) {
    return error;
  }

  return new ControlPlaneTransportError("unknown_transport_error", url.toString(), error);
}

/**
 * Derives a transport error code from known request-layer timeout/abort/proxy failures.
 *
 * @param error Thrown request-layer value.
 * @returns Transport error code when recognized; otherwise null.
 */
function inferTransportErrorCode(error: unknown): ControlPlaneTransportErrorCode | null {
  if (typeof error === "string") {
    if (error.startsWith("request_timeout:")) {
      return "request_timeout";
    }
    if (error === "request_aborted") {
      return "request_aborted";
    }
    return "transport_error";
  }

  if (error instanceof Error) {
    if (error.message.startsWith("request_timeout:") || error.name === "RequestTimeoutError") {
      return "request_timeout";
    }
    if (
      error.message === "request_aborted" ||
      error.name === "RequestAbortedError" ||
      error.name === "AbortError" ||
      (error as { code?: unknown }).code === "ABORT_ERR"
    ) {
      return "request_aborted";
    }
    if (error.message === "proxy_resolution_error" || error.name === "ProxyResolutionError") {
      return "transport_error";
    }
    return null;
  }

  return "unknown_transport_error";
}

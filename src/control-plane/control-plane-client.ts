/**
 * @file Concrete outbound control-plane client for auth/pairing/telemetry APIs.
 */

import { ProxyAgentFactory } from "../net/proxy-agent-factory.js";
import { loadProxySettings } from "../net/proxy-router.js";
import {
  requestJson,
  type JsonRequestFunction,
  type JsonResponse,
  type ProxyResolver
} from "../net/outbound-http.js";

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

/** Constructor options for {@link ControlPlaneClient}. */
export interface ControlPlaneClientOptions {
  baseUrl: string | URL;
  apiToken?: string | null;
  timeoutMs?: number;
  proxyFactory?: ProxyResolver;
  requestFn?: JsonRequestFunction;
}

/** Factory options for env-driven client creation. */
export interface CreateControlPlaneClientFromEnvOptions
  extends Omit<ControlPlaneClientOptions, "proxyFactory"> {
  env?: Record<string, string | undefined>;
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
  env?: Record<string, string | undefined>;
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
  private readonly proxyFactory?: ProxyResolver;
  private readonly requestFn: JsonRequestFunction;

  /**
   * @param options Client configuration.
   */
  constructor(options: ControlPlaneClientOptions) {
    this.baseUrl = options.baseUrl instanceof URL ? options.baseUrl : new URL(options.baseUrl);
    this.apiToken = options.apiToken?.trim() || null;
    this.timeoutMs = options.timeoutMs ?? 8000;
    this.proxyFactory = options.proxyFactory;
    this.requestFn = options.requestFn ?? requestJson;
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

    const response = await this.requestFn<TResponse>(
      url,
      {
        method: "POST",
        headers,
        body: payload,
        timeoutMs: this.timeoutMs
      },
      this.proxyFactory
    );

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
  private assertSuccess(url: URL, response: JsonResponse<unknown>): void {
    if (response.status >= 200 && response.status < 300) {
      return;
    }
    throw new ControlPlaneHttpError(response.status, url.toString(), response.body);
  }
}

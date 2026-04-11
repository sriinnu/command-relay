/**
 * @file Shared transport contracts and error types for the outbound control-plane client.
 */

import type { Agent } from "node:http";
import type { ProxyEnvironment } from "../../packages/proxy-agent/src/index.js";

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

/** Constructor options for {@link import("./control-plane-client.js").ControlPlaneClient}. */
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

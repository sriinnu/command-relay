/**
 * @file Compatibility wrapper for the proxy-aware JSON HTTP client.
 */

import type { Agent, IncomingHttpHeaders } from "node:http";
import {
  requestJson as requestJsonPrimitive
} from "../../packages/proxy-http-client/src/index.js";

/**
 * Request options for JSON HTTP calls.
 */
export interface JsonRequestOptions {
  method: string;
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
}

/** JSON response envelope returned by {@link requestJson}. */
export interface JsonResponse<TBody = unknown> {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: TBody | null;
}

/**
 * Proxy resolution result for an outbound target.
 *
 * Implementations can include additional metadata fields such as `proxyUrl`
 * and `viaProxy`; `requestJson` only requires the optional `agent`.
 */
export interface ProxyResolution {
  agent: Agent | null;
}

/** Contract for proxy-aware target resolution. */
export interface ProxyResolver {
  resolve(target: string | URL): ProxyResolution;
}

/** Function signature for JSON request implementations. */
export type JsonRequestFunction = <TBody = unknown>(
  url: string | URL,
  options: JsonRequestOptions,
  proxyFactory?: ProxyResolver
) => Promise<JsonResponse<TBody>>;

/**
 * Performs a JSON HTTP request with optional proxy agent routing.
 *
 * @param url Request URL.
 * @param options Request options.
 * @param proxyFactory Proxy factory.
 * @returns Response payload.
 */
export const requestJson: JsonRequestFunction = async <TBody = unknown>(
  url,
  options,
  proxyFactory = undefined
) => {
  const response = await requestJsonPrimitive<TBody>(url, {
    method: options.method,
    headers: options.headers,
    body: options.body,
    timeoutMs: options.timeoutMs,
    throwOnHttpError: false,
    proxyResolver: proxyFactory
      ? {
          resolve: (target) => proxyFactory.resolve(target)
        }
      : undefined
  });

  return {
    status: response.status,
    headers: response.headers as IncomingHttpHeaders,
    body: response.body
  };
};

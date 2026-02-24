/**
 * @file Proxy-aware outbound HTTP JSON client.
 */

import type { Agent } from "node:http";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

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
 * @param {string | URL} url Request URL.
 * @param {JsonRequestOptions} options Request options.
 * @param {ProxyResolver} [proxyFactory] Proxy factory.
 * @returns {Promise<JsonResponse<TBody>>} Response payload.
 */
export const requestJson: JsonRequestFunction = async <TBody = unknown>(
  url,
  options,
  proxyFactory = undefined
) => {
  const target = url instanceof URL ? url : new URL(String(url));
  const method = options.method.toUpperCase();
  const timeoutMs = options.timeoutMs ?? 8000;

  const bodyText =
    options.body === undefined ? undefined : JSON.stringify(options.body);

  const headers = {
    accept: "application/json",
    ...(bodyText ? { "content-type": "application/json" } : {}),
    ...(options.headers ?? {})
  };

  if (bodyText) {
    headers["content-length"] = String(Buffer.byteLength(bodyText, "utf8"));
  }

  const proxy = proxyFactory ? proxyFactory.resolve(target) : { agent: null };
  const requester = target.protocol === "https:" ? httpsRequest : httpRequest;

  return new Promise<JsonResponse<TBody>>((resolve, reject) => {
    const req = requester(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || undefined,
        path: `${target.pathname}${target.search}`,
        method,
        headers,
        agent: proxy.agent ?? undefined
      },
      (res) => {
        /** @type {Buffer[]} */
        const chunks = [];
        res.on("data", (chunk) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });

        res.on("end", () => {
          try {
            const raw = Buffer.concat(chunks).toString("utf8");
            const body = raw ? (JSON.parse(raw) as TBody) : null;
            resolve({
              status: res.statusCode ?? 0,
              headers: res.headers,
              body
            });
          } catch (error) {
            reject(error);
          }
        });
      }
    );

    req.on("error", reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`request_timeout:${timeoutMs}`));
    });

    if (bodyText) {
      req.write(bodyText);
    }
    req.end();
  });
};

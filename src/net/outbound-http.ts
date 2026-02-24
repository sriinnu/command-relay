/**
 * @file Proxy-aware outbound HTTP JSON client.
 */

import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

/**
 * @typedef {object} JsonRequestOptions
 * @property {string} method HTTP method.
 * @property {Record<string, string>} [headers] Optional request headers.
 * @property {unknown} [body] Optional JSON-serializable body.
 * @property {number} [timeoutMs=8000] Request timeout in milliseconds.
 */

/**
 * Performs a JSON HTTP request with optional proxy agent routing.
 *
 * @param {string | URL} url Request URL.
 * @param {JsonRequestOptions} options Request options.
 * @param {{ resolve: (target: string | URL) => { agent: import("node:http").Agent | null } }} [proxyFactory] Proxy factory.
 * @returns {Promise<{ status: number, headers: Record<string, string | string[]>, body: unknown }>} Response payload.
 */
export async function requestJson(url, options, proxyFactory = undefined) {
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

  return new Promise((resolve, reject) => {
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
            const body = raw ? JSON.parse(raw) : null;
            resolve({
              status: res.statusCode ?? 0,
              headers: /** @type {Record<string, string | string[]>} */ (res.headers),
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
}

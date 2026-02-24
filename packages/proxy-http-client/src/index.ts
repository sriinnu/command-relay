/**
 * Proxy-aware JSON HTTP request helper for Node.js.
 */

import {
  type Agent,
  type ClientRequest,
  type IncomingMessage,
  type IncomingHttpHeaders,
  type RequestOptions,
  type OutgoingHttpHeaders
} from "node:http";
import * as nodeHttp from "node:http";
import * as nodeHttps from "node:https";

const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_TRANSPORT: JsonRequestTransport = {
  httpRequest: nodeHttp.request,
  httpsRequest: nodeHttps.request
};

/** Request function signature used for HTTP and HTTPS transports. */
export type JsonRequestFunction = (
  options: RequestOptions,
  callback: (response: IncomingMessage) => void
) => ClientRequest;

/** HTTP transport adapter used by `requestJson`. */
export interface JsonRequestTransport {
  httpRequest: JsonRequestFunction;
  httpsRequest: JsonRequestFunction;
}

/** Proxy resolution result for a target URL. */
export interface ProxyAgentResolution {
  agent: Agent | null;
}

/**
 * Optional resolver interface for injecting proxy-aware HTTP agents.
 *
 * The resolver may return synchronously or asynchronously.
 */
export interface ProxyAgentResolver {
  /**
   * Resolves an agent for the provided target URL.
   *
   * @param target Target URL.
   * @returns Agent resolution.
   */
  resolve(
    target: URL
  ): ProxyAgentResolution | Promise<ProxyAgentResolution>;
}

/**
 * Request options for JSON HTTP calls.
 */
export interface JsonRequestOptions {
  /** HTTP method, defaults to `GET`. */
  method?: string;
  /** Additional request headers. */
  headers?: Record<string, string>;
  /** JSON-serializable request body. */
  body?: unknown;
  /** Request timeout in milliseconds, defaults to `8000`. */
  timeoutMs?: number;
  /** Optional external cancellation signal. */
  signal?: AbortSignal;
  /** Optional injected proxy resolver. */
  proxyResolver?: ProxyAgentResolver;
  /** Throw `HttpStatusError` on status >= 400. Defaults to `true`. */
  throwOnHttpError?: boolean;
  /** Optional HTTP transport adapter, primarily for tests and advanced integrations. */
  transport?: JsonRequestTransport;
}

/**
 * Parsed JSON HTTP response details.
 */
export interface JsonResponse<TBody> {
  status: number;
  headers: IncomingHttpHeaders;
  body: TBody | null;
  rawBody: string;
}

/**
 * Error thrown when an HTTP response status indicates failure.
 */
export class HttpStatusError<TBody = unknown> extends Error {
  readonly status: number;
  readonly headers: IncomingHttpHeaders;
  readonly body: TBody | null;
  readonly rawBody: string;

  /**
   * @param status HTTP status code.
   * @param headers Response headers.
   * @param body Parsed response body.
   * @param rawBody Raw response body.
   */
  constructor(
    status: number,
    headers: IncomingHttpHeaders,
    body: TBody | null,
    rawBody: string
  ) {
    super(`http_status_error:${status}`);
    this.name = "HttpStatusError";
    this.status = status;
    this.headers = headers;
    this.body = body;
    this.rawBody = rawBody;
  }
}

/**
 * Error thrown when the request exceeds the configured timeout.
 */
export class RequestTimeoutError extends Error {
  readonly timeoutMs: number;
  readonly target: string;

  /**
   * @param timeoutMs Timeout value in milliseconds.
   * @param target Target URL string.
   */
  constructor(timeoutMs: number, target: string) {
    super(`request_timeout:${timeoutMs}`);
    this.name = "RequestTimeoutError";
    this.timeoutMs = timeoutMs;
    this.target = target;
  }
}

/**
 * Error thrown when a non-empty response cannot be parsed as JSON.
 */
export class JsonParseError extends Error {
  readonly status: number;
  readonly rawBody: string;

  /**
   * @param status HTTP status code.
   * @param rawBody Raw response body.
   * @param cause Parsing cause.
   */
  constructor(status: number, rawBody: string, cause: unknown) {
    super(`json_parse_error:${status}`);
    this.name = "JsonParseError";
    this.status = status;
    this.rawBody = rawBody;
    this.cause = cause;
  }
}

/**
 * Performs an HTTP request and parses the response body as JSON.
 *
 * Empty response bodies are returned as `null`.
 *
 * @param url Target URL.
 * @param options Request options.
 * @returns Parsed JSON response payload.
 */
export async function requestJson<TBody = unknown>(
  url: string | URL,
  options: JsonRequestOptions = {}
): Promise<JsonResponse<TBody>> {
  const target = url instanceof URL ? url : new URL(String(url));
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    throw new Error(`unsupported_protocol:${target.protocol}`);
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
    throw new TypeError("timeoutMs must be a finite number >= 0");
  }

  const method = (options.method ?? "GET").toUpperCase();
  const bodyText =
    options.body === undefined ? undefined : JSON.stringify(options.body);
  const headers = buildHeaders(options.headers ?? {}, bodyText);
  const throwOnHttpError = options.throwOnHttpError ?? true;
  const transport = options.transport ?? DEFAULT_TRANSPORT;

  const resolverResult = options.proxyResolver
    ? await options.proxyResolver.resolve(target)
    : null;
  const agent = resolverResult?.agent ?? undefined;
  const requester =
    target.protocol === "https:"
      ? transport.httpsRequest
      : transport.httpRequest;

  return new Promise<JsonResponse<TBody>>((resolve, reject) => {
    const request = requester(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || undefined,
        path: `${target.pathname}${target.search}`,
        method,
        headers,
        agent
      },
      (response) => {
        const chunks: Buffer[] = [];

        response.on("data", (chunk: Buffer | string) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });

        response.on("end", () => {
          cleanup();

          const rawBody = Buffer.concat(chunks).toString("utf8");
          const status = response.statusCode ?? 0;

          let body: TBody | null = null;
          if (rawBody.length > 0) {
            try {
              body = JSON.parse(rawBody) as TBody;
            } catch (error) {
              reject(new JsonParseError(status, rawBody, error));
              return;
            }
          }

          if (throwOnHttpError && status >= 400) {
            reject(
              new HttpStatusError<TBody>(status, response.headers, body, rawBody)
            );
            return;
          }

          resolve({
            status,
            headers: response.headers,
            body,
            rawBody
          });
        });
      }
    );

    let timeoutHandle: NodeJS.Timeout | null = null;
    const onAbort = (): void => {
      request.destroy(new Error("request_aborted"));
    };

    if (timeoutMs > 0) {
      timeoutHandle = setTimeout(() => {
        request.destroy(new RequestTimeoutError(timeoutMs, target.toString()));
      }, timeoutMs);
    }

    const signal = options.signal;
    if (signal) {
      if (signal.aborted) {
        request.destroy(new Error("request_aborted"));
        cleanup();
        reject(new Error("request_aborted"));
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }

    request.on("error", (error: Error) => {
      cleanup();
      reject(error);
    });

    if (bodyText !== undefined) {
      request.write(bodyText);
    }
    request.end();

    function cleanup(): void {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
        timeoutHandle = null;
      }
      signal?.removeEventListener("abort", onAbort);
    }
  });
}

/**
 * Builds request headers for a JSON HTTP call.
 *
 * @param inputHeaders User-provided headers.
 * @param bodyText Serialized request body.
 * @returns Final outgoing headers.
 */
function buildHeaders(
  inputHeaders: Record<string, string>,
  bodyText: string | undefined
): OutgoingHttpHeaders {
  const headers: Record<string, string> = {
    accept: "application/json",
    ...inputHeaders
  };

  if (bodyText !== undefined) {
    if (!hasHeader(headers, "content-type")) {
      headers["content-type"] = "application/json";
    }

    if (!hasHeader(headers, "content-length")) {
      headers["content-length"] = String(Buffer.byteLength(bodyText, "utf8"));
    }
  }

  return headers;
}

/**
 * Performs case-insensitive header name lookup.
 *
 * @param headers Header map.
 * @param key Header key.
 * @returns True when a matching header is present.
 */
function hasHeader(headers: Record<string, string>, key: string): boolean {
  const expected = key.toLowerCase();
  return Object.keys(headers).some((header) => header.toLowerCase() === expected);
}

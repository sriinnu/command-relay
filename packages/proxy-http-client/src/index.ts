/** Proxy-aware JSON HTTP request helper for Node.js. */
import {
  type Agent,
  type ClientRequest,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type OutgoingHttpHeaders,
  type RequestOptions
} from "node:http";
import * as nodeHttp from "node:http";
import * as nodeHttps from "node:https";
const DEFAULT_TIMEOUT_MS = 8_000;
const HTTP_TOKEN_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const SUPPORTED_REQUEST_PROTOCOLS = new Set(["http:", "https:"]);
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
/** Optional resolver interface for injecting proxy-aware HTTP agents. */
export interface ProxyAgentResolver {
  /** Resolves an agent for the provided target URL. */
  resolve(target: URL): ProxyAgentResolution | Promise<ProxyAgentResolution>;
}
/** Request options for JSON HTTP calls. */
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
/** Parsed JSON HTTP response details. */
export interface JsonResponse<TBody> {
  status: number;
  headers: IncomingHttpHeaders;
  body: TBody | null;
  rawBody: string;
}
/** Error thrown when request URL protocol is not HTTP(S). */
export class UnsupportedProtocolError extends Error {
  readonly protocol: string;

  /** @param protocol URL protocol token. */
  constructor(protocol: string) {
    super(`unsupported_protocol:${protocol}`);
    this.name = "UnsupportedProtocolError";
    this.protocol = protocol;
  }
}

/** Error thrown when proxy resolution fails. */
export class ProxyResolutionError extends Error {
  readonly target: string;

  /**
   * @param target Target URL string.
   * @param cause Resolver failure cause.
   */
  constructor(target: string, cause: unknown) {
    super("proxy_resolution_error");
    this.name = "ProxyResolutionError";
    this.target = target;
    this.cause = cause;
  }
}

/** Error thrown when a request is cancelled. */
export class RequestAbortedError extends Error {
  readonly target: string;
  readonly reason: unknown;

  /**
   * @param target Target URL string.
   * @param reason Abort reason.
   */
  constructor(target: string, reason: unknown) {
    super("request_aborted");
    this.name = "RequestAbortedError";
    this.target = target;
    this.reason = reason;
  }
}

/** Error thrown when an HTTP response status indicates failure. */
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

/** Error thrown when the request exceeds the configured timeout. */
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

/** Error thrown when a non-empty response cannot be parsed as JSON. */
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
 * Empty response bodies are returned as `null`.
 */
export async function requestJson<TBody = unknown>(
  url: string | URL,
  options: JsonRequestOptions = {}
): Promise<JsonResponse<TBody>> {
  const target = parseTargetUrl(url);
  validateProtocol(target.protocol);

  const timeoutMs = normalizeTimeout(options.timeoutMs);
  const method = normalizeMethod(options.method);
  const bodyText = serializeRequestBody(options.body);
  const headers = buildHeaders(options.headers ?? {}, bodyText);
  const throwOnHttpError = options.throwOnHttpError ?? true;
  const transport = normalizeTransport(options.transport ?? DEFAULT_TRANSPORT);

  throwIfAborted(options.signal, target.toString());
  const resolverResult = await resolveProxyAgent(target, options.proxyResolver);
  throwIfAborted(options.signal, target.toString());

  const requester =
    target.protocol === "https:" ? transport.httpsRequest : transport.httpRequest;

  return executeJsonRequest<TBody>({
    target,
    method,
    bodyText,
    headers,
    timeoutMs,
    signal: options.signal,
    throwOnHttpError,
    agent: resolverResult?.agent ?? undefined,
    requester
  });
}

interface ExecuteJsonRequestParams {
  target: URL;
  method: string;
  bodyText: string | undefined;
  headers: OutgoingHttpHeaders;
  timeoutMs: number;
  signal: AbortSignal | undefined;
  throwOnHttpError: boolean;
  agent: Agent | undefined;
  requester: JsonRequestFunction;
}

function parseTargetUrl(url: string | URL): URL {
  if (url instanceof URL) {
    return url;
  }
  const input = String(url);
  try {
    return new URL(input);
  } catch {
    throw new TypeError("invalid_request_url");
  }
}

function validateProtocol(protocol: string): void {
  if (!SUPPORTED_REQUEST_PROTOCOLS.has(protocol)) {
    throw new UnsupportedProtocolError(protocol);
  }
}

function normalizeTimeout(timeoutMs: number | undefined): number {
  const value = timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError("timeoutMs must be a finite number >= 0");
  }
  return value;
}

function normalizeMethod(method: string | undefined): string {
  const normalized = (method ?? "GET").trim().toUpperCase();
  if (!normalized || !HTTP_TOKEN_PATTERN.test(normalized)) {
    throw new TypeError("invalid_http_method");
  }
  return normalized;
}

function serializeRequestBody(body: unknown): string | undefined {
  if (body === undefined) {
    return undefined;
  }
  try {
    return JSON.stringify(body);
  } catch {
    throw new TypeError("request_body_serialization_failed");
  }
}

function normalizeTransport(transport: JsonRequestTransport): JsonRequestTransport {
  if (
    typeof transport.httpRequest !== "function" ||
    typeof transport.httpsRequest !== "function"
  ) {
    throw new TypeError("invalid_transport");
  }
  return transport;
}

async function resolveProxyAgent(
  target: URL,
  resolver: ProxyAgentResolver | undefined
): Promise<ProxyAgentResolution | null> {
  if (!resolver) {
    return null;
  }
  try {
    const resolved = await resolver.resolve(target);
    if (!resolved || typeof resolved !== "object") {
      throw new TypeError("invalid_proxy_resolution");
    }
    return { agent: resolved.agent ?? null };
  } catch (error) {
    throw new ProxyResolutionError(target.toString(), error);
  }
}

function throwIfAborted(signal: AbortSignal | undefined, target: string): void {
  if (signal?.aborted) {
    throw new RequestAbortedError(target, signal.reason);
  }
}

function executeJsonRequest<TBody>(
  params: ExecuteJsonRequestParams
): Promise<JsonResponse<TBody>> {
  return new Promise<JsonResponse<TBody>>((resolve, reject) => {
    const target = params.target;
    const abortError = new RequestAbortedError(target.toString(), params.signal?.reason);
    let timeoutHandle: NodeJS.Timeout | null = null;
    // Timeout, abort, and socket errors can race; settle only once.
    let settled = false;

    const settleResolve = (value: JsonResponse<TBody>): void => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve(value);
    };

    const settleReject = (error: unknown): void => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(error instanceof Error ? error : new Error(String(error)));
    };

    const request = params.requester(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || undefined,
        path: `${target.pathname}${target.search}`,
        method: params.method,
        headers: params.headers,
        agent: params.agent
      },
      (response) => {
        const chunks: Buffer[] = [];

        response.on("data", (chunk: Buffer | string) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        response.on("error", settleReject);
        response.on("aborted", () => {
          settleReject(abortError);
        });
        response.on("end", () => {
          const rawBody = Buffer.concat(chunks).toString("utf8");
          const status = response.statusCode ?? 0;

          let body: TBody | null = null;
          if (rawBody.length > 0) {
            try {
              body = JSON.parse(rawBody) as TBody;
            } catch (error) {
              settleReject(new JsonParseError(status, rawBody, error));
              return;
            }
          }

          if (params.throwOnHttpError && status >= 400) {
            settleReject(new HttpStatusError<TBody>(status, response.headers, body, rawBody));
            return;
          }

          settleResolve({
            status,
            headers: response.headers,
            body,
            rawBody
          });
        });
      }
    );

    const onAbort = (): void => {
      request.destroy(abortError);
    };

    if (params.timeoutMs > 0) {
      timeoutHandle = setTimeout(() => {
        request.destroy(new RequestTimeoutError(params.timeoutMs, target.toString()));
      }, params.timeoutMs);
    }

    if (params.signal) {
      if (params.signal.aborted) {
        request.destroy(abortError);
        settleReject(abortError);
        return;
      }
      params.signal.addEventListener("abort", onAbort, { once: true });
    }

    request.on("error", settleReject);

    try {
      if (params.bodyText !== undefined) {
        request.write(params.bodyText);
      }
      request.end();
    } catch (error) {
      settleReject(error);
    }

    function cleanup(): void {
      if (timeoutHandle !== null) {
        clearTimeout(timeoutHandle);
        timeoutHandle = null;
      }
      params.signal?.removeEventListener("abort", onAbort);
    }
  });
}

/** Builds request headers for a JSON HTTP call. */
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

/** Performs case-insensitive header name lookup. */
function hasHeader(headers: Record<string, string>, key: string): boolean {
  const expected = key.toLowerCase();
  return Object.keys(headers).some((header) => header.toLowerCase() === expected);
}

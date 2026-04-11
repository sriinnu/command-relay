import type { IncomingHttpHeaders } from "node:http";

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

/** Error thrown when a response exceeds the configured byte limit. */
export class ResponseSizeLimitError extends Error {
  readonly target: string;
  readonly status: number;
  readonly maxBytes: number;
  readonly receivedBytes: number;

  /**
   * @param target Target URL string.
   * @param status HTTP status code.
   * @param maxBytes Configured response size ceiling in bytes.
   * @param receivedBytes Bytes observed when the limit was exceeded.
   */
  constructor(target: string, status: number, maxBytes: number, receivedBytes: number) {
    super(`response_size_limit_exceeded:${maxBytes}`);
    this.name = "ResponseSizeLimitError";
    this.target = target;
    this.status = status;
    this.maxBytes = maxBytes;
    this.receivedBytes = receivedBytes;
  }
}

/**
 * Error reason for `NonJsonResponseError`.
 */
export type NonJsonResponseReason = "invalid_content_type" | "invalid_json";

/**
 * Error thrown when a request target URL cannot be parsed.
 */
export class InvalidUrlError extends TypeError {
  readonly input: string;

  /**
   * @param input Original URL input value.
   * @param cause Parsing failure cause.
   */
  constructor(input: string, cause?: unknown) {
    super("invalid_url");
    this.name = "InvalidUrlError";
    this.input = input;
    this.cause = cause;
  }
}

/**
 * Error thrown when a non-empty response is not valid JSON.
 */
export class NonJsonResponseError extends Error {
  readonly target: string;
  readonly status: number;
  readonly contentType: string | null;
  readonly rawBody: string;
  readonly reason: NonJsonResponseReason;

  /**
   * @param target Request target URL.
   * @param status HTTP status code.
   * @param contentType Response `content-type` header.
   * @param rawBody Raw response payload text.
   * @param reason Non-JSON failure reason.
   * @param cause Optional parse cause for `invalid_json` failures.
   */
  constructor(
    target: string,
    status: number,
    contentType: string | null,
    rawBody: string,
    reason: NonJsonResponseReason,
    cause?: unknown
  ) {
    super(`non_json_response:${reason}`);
    this.name = "NonJsonResponseError";
    this.target = target;
    this.status = status;
    this.contentType = contentType;
    this.rawBody = rawBody;
    this.reason = reason;
    this.cause = cause;
  }
}

/**
 * Error thrown when a response payload exceeds configured byte limit.
 */
export class ResponseSizeLimitError extends Error {
  readonly target: string;
  readonly status: number;
  readonly maxBytes: number;
  readonly receivedBytes: number;

  /**
   * @param target Request target URL.
   * @param status HTTP status code.
   * @param maxBytes Configured byte ceiling.
   * @param receivedBytes Bytes observed when limit was exceeded.
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

/**
 * Error thrown when a request exceeds configured timeout.
 */
export class RequestTimeoutError extends Error {
  readonly target: string;
  readonly timeoutMs: number;

  /**
   * @param target Request target URL.
   * @param timeoutMs Timeout in milliseconds.
   * @param cause Fetch abort cause.
   */
  constructor(target: string, timeoutMs: number, cause?: unknown) {
    super(`request_timeout:${timeoutMs}`);
    this.name = "RequestTimeoutError";
    this.target = target;
    this.timeoutMs = timeoutMs;
    this.cause = cause;
  }
}

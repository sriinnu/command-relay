/**
 * Error thrown when a target URL cannot be parsed.
 */
export class InvalidTargetUrlError extends TypeError {
  readonly input: string;

  /**
   * @param input Original target input.
   * @param cause Parsing cause.
   */
  constructor(input: string, cause?: unknown) {
    super("invalid_target_url");
    this.name = "InvalidTargetUrlError";
    this.input = input;
    this.cause = cause;
  }
}

/**
 * Error thrown when a proxy URL cannot be parsed.
 */
export class InvalidProxyUrlError extends TypeError {
  readonly proxyUrl: string;

  /**
   * @param proxyUrl Proxy URL value that failed parsing.
   * @param cause Parsing cause.
   */
  constructor(proxyUrl: string, cause?: unknown) {
    super("invalid_proxy_url");
    this.name = "InvalidProxyUrlError";
    this.proxyUrl = proxyUrl;
    this.cause = cause;
  }
}

/**
 * Error thrown when a proxy protocol is unsupported for this package.
 */
export class UnsupportedProxyProtocolError extends Error {
  readonly protocol: string;

  /**
   * @param protocol Parsed proxy protocol token.
   */
  constructor(protocol: string) {
    super(`unsupported_proxy_protocol:${protocol}`);
    this.name = "UnsupportedProxyProtocolError";
    this.protocol = protocol;
  }
}

/**
 * Error thrown when a target protocol is unsupported.
 */
export class UnsupportedTargetProtocolError extends Error {
  readonly protocol: string;

  /**
   * @param protocol Parsed target protocol token.
   */
  constructor(protocol: string) {
    super(`unsupported_target_protocol:${protocol}`);
    this.name = "UnsupportedTargetProtocolError";
    this.protocol = protocol;
  }
}

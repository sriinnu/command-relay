/**
 * Error thrown when a got target cannot be derived from input or options.
 */
export class MissingGotTargetError extends TypeError {
  /**
   * Creates a missing-target error.
   */
  constructor() {
    super("missing_target_url");
    this.name = "MissingGotTargetError";
  }
}

/**
 * Error thrown when a got target value cannot be parsed into a URL.
 */
export class InvalidGotTargetError extends TypeError {
  readonly input: string;

  /**
   * @param input Original target input.
   * @param cause Parsing cause.
   */
  constructor(input: string, cause?: unknown) {
    super("invalid_target_url");
    this.name = "InvalidGotTargetError";
    this.input = input;
    this.cause = cause;
  }
}

/**
 * Error thrown when `prefixUrl` cannot be parsed into a URL.
 */
export class InvalidGotPrefixUrlError extends TypeError {
  readonly input: string;

  /**
   * @param input Original prefixUrl input.
   * @param cause Parsing cause.
   */
  constructor(input: string, cause?: unknown) {
    super("invalid_prefix_url");
    this.name = "InvalidGotPrefixUrlError";
    this.input = input;
    this.cause = cause;
  }
}

/**
 * Error thrown when a target protocol is unsupported by got's Node agent map.
 */
export class UnsupportedGotProtocolError extends Error {
  readonly protocol: string;

  /**
   * @param protocol Parsed target protocol.
   */
  constructor(protocol: string) {
    super(`unsupported_target_protocol:${protocol}`);
    this.name = "UnsupportedGotProtocolError";
    this.protocol = protocol;
  }
}

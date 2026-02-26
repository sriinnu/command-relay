import type { ProxyUndiciDispatcherResolution } from "@termina/proxy-undici";
import { InvalidUrlError, RequestTimeoutError, ResponseSizeLimitError } from "./errors.js";
import type { ProxyFetchRequestOptions } from "./proxy-fetch-client.js";

const SUPPORTED_PROTOCOLS = new Set(["http:", "https:"]);

/**
 * Internal request init shape that accepts Undici dispatcher values.
 */
export interface RequestInitWithDispatcher extends RequestInit {
  dispatcher?: RequestInit["dispatcher"];
}

/**
 * Internal timeout/abort controller contract.
 */
export interface TimeoutAbortControl {
  signal: AbortSignal;
  cleanup: () => void;
  didTimeout: () => boolean;
}

/**
 * Creates request init with dispatcher and normalized method/header/body fields.
 *
 * @param options Request options.
 * @param routing Dispatcher routing result.
 * @returns Request init for fetch execution.
 */
export function createRequestInit(
  options: ProxyFetchRequestOptions,
  routing: ProxyUndiciDispatcherResolution
): RequestInitWithDispatcher {
  const requestInit: RequestInitWithDispatcher = {
    ...(options.requestInit ?? {})
  };
  requestInit.dispatcher = routing.dispatcher as unknown as RequestInit["dispatcher"];
  requestInit.method = options.method ?? requestInit.method ?? "GET";

  if (options.headers !== undefined) {
    requestInit.headers = options.headers;
  }

  if (options.body !== undefined) {
    requestInit.body = options.body;
  }

  return requestInit;
}

/**
 * Parses and validates a target URL.
 *
 * @param target Request target input.
 * @returns Parsed URL.
 */
export function parseTargetUrl(target: string | URL): URL {
  if (target instanceof URL) {
    assertSupportedProtocol(target);
    return target;
  }

  const input = String(target);
  try {
    const parsed = new URL(input);
    assertSupportedProtocol(parsed);
    return parsed;
  } catch (error) {
    if (error instanceof InvalidUrlError) {
      throw error;
    }
    throw new InvalidUrlError(input, error);
  }
}

/**
 * Normalizes timeout value.
 *
 * @param value User-provided timeout.
 * @param fallback Default timeout.
 * @returns Timeout in milliseconds.
 */
export function normalizeTimeout(value: number | undefined, fallback: number): number {
  const candidate = value ?? fallback;
  if (!Number.isFinite(candidate) || candidate < 0) {
    throw new TypeError("timeoutMs must be a finite number >= 0");
  }
  return candidate;
}

/**
 * Normalizes max-response-bytes value.
 *
 * @param value User-provided max response bytes.
 * @param fallback Default max response bytes.
 * @returns Max bytes.
 */
export function normalizeMaxResponseBytes(value: number | undefined, fallback: number): number {
  const candidate = value ?? fallback;
  if (!Number.isSafeInteger(candidate) || candidate <= 0) {
    throw new TypeError("maxResponseBytes must be a safe integer > 0");
  }
  return candidate;
}

/**
 * Creates a combined abort signal with timeout and external-signal support.
 *
 * @param timeoutMs Timeout in milliseconds.
 * @param externalSignal Caller-provided abort signal.
 * @returns Abort signal with cleanup hooks.
 */
export function createAbortControl(
  timeoutMs: number,
  externalSignal?: AbortSignal
): TimeoutAbortControl {
  const controller = new AbortController();
  let didTimeout = false;
  let timeoutHandle: NodeJS.Timeout | null = null;

  const onExternalAbort = (): void => {
    controller.abort(externalSignal?.reason);
  };

  if (externalSignal?.aborted) {
    controller.abort(externalSignal.reason);
  } else if (externalSignal) {
    externalSignal.addEventListener("abort", onExternalAbort, { once: true });
  }

  if (timeoutMs > 0) {
    timeoutHandle = setTimeout(() => {
      didTimeout = true;
      controller.abort(new RequestTimeoutError("timeout", timeoutMs));
    }, timeoutMs);
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      if (externalSignal) {
        externalSignal.removeEventListener("abort", onExternalAbort);
      }
    },
    didTimeout: () => didTimeout
  };
}

/**
 * Reads UTF-8 response text while enforcing byte limits.
 *
 * @param response Fetch response.
 * @param maxBytes Max allowed body bytes.
 * @param target Target URL string.
 * @returns Response text.
 */
export async function readResponseTextWithLimit(
  response: Response,
  maxBytes: number,
  target: string
): Promise<string> {
  const declared = parseContentLength(response.headers.get("content-length"));
  if (declared !== null && declared > maxBytes) {
    throw new ResponseSizeLimitError(target, response.status, maxBytes, declared);
  }

  if (!response.body) {
    return "";
  }

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let receivedBytes = 0;

  try {
    while (true) {
      const readResult = await reader.read();
      if (readResult.done) {
        break;
      }

      const value = readResult.value;
      if (!value) {
        continue;
      }

      receivedBytes += value.byteLength;
      if (receivedBytes > maxBytes) {
        throw new ResponseSizeLimitError(target, response.status, maxBytes, receivedBytes);
      }

      chunks.push(Buffer.from(value));
    }
  } catch (error) {
    await safeCancelReader(reader);
    throw error;
  }

  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Determines whether a content-type represents JSON.
 *
 * @param contentType Raw `content-type` header.
 * @returns `true` when media type is `application/json` or `*+json`.
 */
export function isJsonMediaType(contentType: string | null): boolean {
  if (!contentType) {
    return false;
  }

  const mediaType = contentType.split(";", 1)[0]?.trim().toLowerCase();
  if (!mediaType) {
    return false;
  }

  return mediaType === "application/json" || mediaType.endsWith("+json");
}

function assertSupportedProtocol(target: URL): void {
  if (!SUPPORTED_PROTOCOLS.has(target.protocol)) {
    throw new InvalidUrlError(target.toString(), `unsupported_protocol:${target.protocol}`);
  }
}

function parseContentLength(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    return null;
  }

  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed)) {
    return null;
  }

  return parsed;
}

async function safeCancelReader(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
  try {
    await reader.cancel();
  } catch {
    // Ignore reader cancellation failures while propagating the original error.
  }
}

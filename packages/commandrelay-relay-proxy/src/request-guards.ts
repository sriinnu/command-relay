import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";

/**
 * Check whether the request targets the configured relay websocket path.
 */
export function isRelayPath(request: IncomingMessage, relayPath: string): boolean {
  const parsed = new URL(request.url || "", "http://localhost");
  return parsed.pathname === relayPath;
}

/**
 * Check whether the request origin is allowed by policy.
 */
export function isOriginAllowed(originHeader: string | undefined, allowedOrigins: string[]): boolean {
  if (!allowedOrigins.length) return true;
  return typeof originHeader === "string" && allowedOrigins.includes(originHeader);
}

/**
 * Extract a bearer token from the Authorization header.
 */
export function extractBearerTokenFromRequest(request: Pick<IncomingMessage, "headers">): string {
  const bearer = request.headers.authorization;
  if (typeof bearer === "string" && bearer.toLowerCase().startsWith("bearer ")) {
    return bearer.slice(7).trim();
  }
  return "";
}

/**
 * Validate the bearer token using constant-time comparison.
 */
export function isTokenValidFromRequest(request: IncomingMessage, requiredToken: string): boolean {
  if (!requiredToken) return true;
  return constantTimeEquals(hashToken(requiredToken), hashToken(extractBearerTokenFromRequest(request)));
}

function hashToken(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

function constantTimeEquals(left: Buffer, right: Buffer): boolean {
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

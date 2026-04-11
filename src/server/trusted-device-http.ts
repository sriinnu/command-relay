/**
 * @file HTTP route handling for trusted-device pairing, auth refresh, and revocation.
 */

import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { BridgeConfig } from "../config.js";
import type {
  PairConfirmRequest,
  PairProofRequest,
  PairSessionRequest,
  RefreshDeviceAccessRequest,
  RevokeDeviceRequest
} from "../control-plane/control-plane-types.js";
import { tokenEquals } from "./bridge-server-utils.js";
import { type TrustedDeviceAuthority } from "./trusted-device-authority.js";

/**
 * Handles trusted-device routes when the feature is enabled.
 *
 * @param req Incoming HTTP request.
 * @param res Outgoing HTTP response.
 * @param params Config and authority context.
 * @returns True when the request matched a trusted-device route.
 */
export async function handleTrustedDeviceHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  params: {
    config: BridgeConfig;
    authority: TrustedDeviceAuthority | null;
  }
): Promise<boolean> {
  const { config, authority } = params;
  const url = req.url?.split("?")[0] ?? "";
  if (!url.startsWith("/pair/") && url !== "/auth/device" && url !== "/auth/refresh" && url !== "/devices/revoke") {
    return false;
  }
  if (!authority || !config.trustedDeviceAuthEnabled) {
    writeJson(res, 404, { code: "trusted_device_auth_disabled" });
    return true;
  }
  if (requiresHostAuth(url) && !isHostAuthorized(req, config.authToken)) {
    writeJson(res, 401, { code: "host_auth_required" });
    return true;
  }
  try {
    if (req.method === "POST" && url === "/pair/sessions") {
      const body = await readJsonBody<Record<string, unknown>>(req);
      const session = authority.createPairingSession(
        buildPairSessionRequest(req, config, body)
      );
      writeJson(res, 200, session);
      return true;
    }
    if (req.method === "GET" && url.startsWith("/pair/sessions/")) {
      const pairingSessionId = decodeURIComponent(url.slice("/pair/sessions/".length));
      const session = authority.getPairingSessionStatus(pairingSessionId);
      if (!session) {
        writeJson(res, 404, { code: "pairing_session_not_found" });
        return true;
      }
      writeJson(res, 200, session);
      return true;
    }
    if (req.method === "POST" && url === "/pair/claim") {
      writeJson(res, 200, authority.claimPairing(await readJsonBody(req)));
      return true;
    }
    if (req.method === "POST" && url === "/pair/prove") {
      writeJson(res, 200, authority.provePairing(await readJsonBody<PairProofRequest>(req)));
      return true;
    }
    if (req.method === "POST" && url === "/pair/confirm") {
      writeJson(res, 200, authority.confirmPairing(await readJsonBody<PairConfirmRequest>(req)));
      return true;
    }
    if (req.method === "POST" && url === "/auth/device") {
      writeJson(res, 200, authority.authenticateDevice(await readJsonBody(req)));
      return true;
    }
    if (req.method === "POST" && url === "/auth/refresh") {
      writeJson(res, 200, authority.refreshAccessToken(await readJsonBody<RefreshDeviceAccessRequest>(req)));
      return true;
    }
    if (req.method === "POST" && url === "/devices/revoke") {
      writeJson(res, 200, authority.revokeDevice(await readJsonBody<RevokeDeviceRequest>(req)));
      return true;
    }
    writeJson(res, 405, { code: "method_not_allowed" });
    return true;
  } catch (error) {
    const { status, code } = mapTrustedDeviceError(error);
    writeJson(res, status, {
      code,
      message: error instanceof Error ? error.message : String(error)
    });
    return true;
  }
}

function buildPairSessionRequest(
  req: IncomingMessage,
  config: BridgeConfig,
  body: Record<string, unknown>
): PairSessionRequest {
  const apiBaseUrl = config.publicApiBaseUrl ?? deriveApiBaseUrl(req);
  const relayEndpoint = config.publicWebSocketUrl ?? deriveWebSocketUrl(req);
  return {
    apiBaseUrl,
    relayEndpoint,
    relayId: parseOptionalString(body.relayId) ?? hashHint(relayEndpoint, 16),
    relayFingerprintHint:
      parseOptionalString(body.relayFingerprintHint) ??
      hashHint(`${apiBaseUrl}|${relayEndpoint}`, 12)
  };
}

async function readJsonBody<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    if (Buffer.concat(chunks).byteLength > 64 * 1024) {
      throw new Error("request_body_too_large");
    }
  }
  if (chunks.length === 0) {
    return {} as T;
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error("invalid_json");
  }
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function deriveApiBaseUrl(req: IncomingMessage): string {
  const protocol = forwardedProtocol(req) === "https" ? "https" : "http";
  const host = forwardedHost(req);
  return `${protocol}://${host}`;
}

function deriveWebSocketUrl(req: IncomingMessage): string {
  const protocol = forwardedProtocol(req) === "https" ? "wss" : "ws";
  const host = forwardedHost(req);
  return `${protocol}://${host}/ws`;
}

function forwardedProtocol(req: IncomingMessage): string {
  const header = req.headers["x-forwarded-proto"];
  if (typeof header === "string" && header.trim()) {
    return header.split(",")[0]?.trim() ?? "http";
  }
  return (req.socket as { encrypted?: boolean }).encrypted ? "https" : "http";
}

function forwardedHost(req: IncomingMessage): string {
  const forwarded = req.headers["x-forwarded-host"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0]?.trim() ?? "127.0.0.1";
  }
  return req.headers.host ?? "127.0.0.1";
}

function hashHint(value: string, length: number): string {
  return createHash("sha256").update(value, "utf8").digest("hex").slice(0, length);
}

function parseOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function requiresHostAuth(url: string): boolean {
  return url === "/pair/sessions" || url.startsWith("/pair/sessions/");
}

function isHostAuthorized(req: IncomingMessage, authToken: string | null): boolean {
  if (!authToken) {
    return isLoopbackRequest(req);
  }
  const authorization = req.headers.authorization;
  const header = typeof authorization === "string" ? authorization.trim() : "";
  const bearerPrefix = "Bearer ";
  if (!header.startsWith(bearerPrefix)) {
    return false;
  }
  const candidate = header.slice(bearerPrefix.length);
  return tokenEquals(authToken, candidate);
}

function isLoopbackRequest(req: IncomingMessage): boolean {
  const remoteAddress = req.socket?.remoteAddress?.trim();
  return (
    remoteAddress === "127.0.0.1" ||
    remoteAddress === "::1" ||
    remoteAddress === "::ffff:127.0.0.1"
  );
}

function mapTrustedDeviceError(error: unknown): { status: number; code: string } {
  const message = error instanceof Error ? error.message : String(error);
  if (message === "pairing_session_not_found" || message === "pairing_claim_not_found" || message === "device_not_found") {
    return { status: 404, code: message };
  }
  if (message === "pairing_session_expired" || message === "pairing_claim_expired") {
    return { status: 410, code: message };
  }
  if (message === "pairing_claim_already_used" || message === "pairing_session_not_available" || message === "pairing_proof_required") {
    return { status: 409, code: message };
  }
  if (message === "pairing_verification_code_locked") {
    return { status: 429, code: message };
  }
  if (
    message === "invalid_pairing_token" ||
    message === "invalid_challenge_proof" ||
    message === "invalid_verification_code" ||
    message === "invalid_access_token" ||
    message === "invalid_access_proof" ||
    message === "invalid_refresh_token"
  ) {
    return { status: 401, code: message };
  }
  if (message === "request_body_too_large") {
    return { status: 413, code: message };
  }
  if (message === "invalid_json") {
    return { status: 400, code: message };
  }
  return { status: 400, code: message || "invalid_request" };
}

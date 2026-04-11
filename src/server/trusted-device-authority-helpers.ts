/**
 * @file Shared helpers and record types for the trusted-device authority state machine.
 */

import {
  createPublicKey,
  randomBytes,
  randomInt,
  randomUUID,
  verify as verifySignature
} from "node:crypto";
import type { PairSessionResponse } from "../control-plane/control-plane-types.js";
import type { TrustedDeviceAccessLevel } from "../control-plane/control-plane-types.js";

/**
 * Stored pairing-session record.
 */
export interface PairingSessionRecord extends PairSessionResponse {
  status: "pending" | "claimed" | "confirmed" | "expired" | "revoked";
  claimId: string | null;
  verificationAttempts: number;
  verificationLockedUntilMs: number | null;
}

/**
 * Stored pairing-claim record.
 */
export interface PairingClaimRecord {
  claimId: string;
  pairingSessionId: string;
  publicKey: string;
  challenge: string;
  deviceName: string | null;
  platform: string | null;
  proofVerified: boolean;
  confirmedAtMs: number | null;
  expiresAtMs: number;
}

/**
 * Stored registered-device record.
 */
export interface RegisteredDeviceRecord {
  deviceId: string;
  publicKey: string;
  deviceName: string | null;
  platform: string | null;
  accessLevel: TrustedDeviceAccessLevel;
  revoked: boolean;
}

/**
 * Stored access-token record.
 */
export interface AccessTokenRecord {
  token: string;
  deviceId: string;
  expiresAtMs: number;
  revoked: boolean;
}

/**
 * Stored refresh-token record.
 */
export interface RefreshTokenRecord {
  token: string;
  deviceId: string;
  expiresAtMs: number;
  revoked: boolean;
}

/**
 * Normalizes a ttl option against a safe default.
 *
 * @param raw Candidate ttl in milliseconds.
 * @param fallback Fallback ttl in milliseconds.
 * @returns Finite positive ttl.
 */
export function normalizeTrustedDeviceTtl(raw: number | undefined, fallback: number): number {
  if (raw === undefined || !Number.isFinite(raw) || raw <= 0) {
    return fallback;
  }
  return Math.floor(raw);
}

/**
 * Normalizes optional text fields to trimmed strings or null.
 *
 * @param value Optional input text.
 * @returns Trimmed string or null.
 */
export function normalizeTrustedDeviceOptional(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Generates a random opaque token used for pairing and auth material.
 *
 * @returns URL-safe random token.
 */
export function randomTrustedDeviceToken(): string {
  return randomBytes(24).toString("base64url");
}

/**
 * Generates a 6-digit human confirmation code.
 *
 * @returns Stringified six-digit code.
 */
export function randomTrustedDeviceVerificationCode(): string {
  return `${100_000 + randomInt(900_000)}`;
}

/**
 * Generates a stable random identifier for sessions and claims.
 *
 * @returns UUID string.
 */
export function randomTrustedDeviceId(): string {
  return randomUUID();
}

/**
 * Converts one stored session into its public response shape.
 *
 * @param session Stored session record.
 * @returns Public pairing-session response.
 */
export function toPublicPairSessionResponse(session: PairingSessionRecord): PairSessionResponse {
  return {
    pairingSessionId: session.pairingSessionId,
    pairingToken: session.pairingToken,
    expiresAt: session.expiresAt,
    relayEndpoint: session.relayEndpoint,
    apiBaseUrl: session.apiBaseUrl,
    relayId: session.relayId,
    relayFingerprintHint: session.relayFingerprintHint ?? null,
    verificationCode: session.verificationCode
  };
}

/**
 * Verifies a signed challenge against the stored public key.
 *
 * @param publicKey PEM/SPKI public key string.
 * @param challenge Raw challenge text.
 * @param challengeProof Base64url signature string.
 * @returns Whether the signature is valid.
 */
export function isValidTrustedDeviceSignature(
  publicKey: string,
  challenge: string,
  challengeProof: string
): boolean {
  try {
    const key = createPublicKey(publicKey);
    const proof = Buffer.from(challengeProof, "base64url");
    return verifySignature("sha256", Buffer.from(challenge, "utf8"), key, proof);
  } catch {
    return false;
  }
}

/**
 * Removes expired or revoked token records from one token map.
 *
 * @param tokenMap Token record map.
 * @param now Current epoch time in milliseconds.
 * @returns Nothing.
 */
export function expireTrustedDeviceTokenMap<T extends { expiresAtMs: number; revoked: boolean }>(
  tokenMap: Map<string, T>,
  now: number
): void {
  for (const [token, record] of tokenMap.entries()) {
    if (record.expiresAtMs <= now || record.revoked) {
      tokenMap.delete(token);
    }
  }
}

/**
 * Marks all tokens for one device as revoked.
 *
 * @param tokenMap Token record map.
 * @param deviceId Stable device identifier.
 * @returns Nothing.
 */
export function revokeTrustedDeviceTokensForDevice<T extends { deviceId: string; revoked: boolean }>(
  tokenMap: Map<string, T>,
  deviceId: string
): void {
  for (const record of tokenMap.values()) {
    if (record.deviceId === deviceId) {
      record.revoked = true;
    }
  }
}

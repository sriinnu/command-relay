/**
 * @file In-memory trusted-device authority used by the bridge for pairing and device auth.
 */

import type {
  DeviceAuthRequest,
  DeviceAuthResponse,
  PairClaimRequest,
  PairClaimResponse,
  PairConfirmRequest,
  PairConfirmResponse,
  PairProofRequest,
  PairProofResponse,
  PairSessionRequest,
  PairSessionResponse,
  PairSessionStatusResponse,
  RefreshDeviceAccessRequest,
  RefreshDeviceAccessResponse,
  RevokeDeviceRequest,
  RevokeDeviceResponse,
  TrustedDeviceAccessLevel,
  TrustedDeviceCapability
} from "../control-plane/control-plane-types.js";
import {
  expireTrustedDeviceTokenMap,
  isValidTrustedDeviceSignature,
  normalizeTrustedDeviceOptional,
  normalizeTrustedDeviceTtl,
  PairingClaimRecord,
  PairingSessionRecord,
  randomTrustedDeviceId,
  randomTrustedDeviceToken,
  randomTrustedDeviceVerificationCode,
  RegisteredDeviceRecord,
  revokeTrustedDeviceTokensForDevice,
  toPublicPairSessionResponse,
  AccessTokenRecord,
  RefreshTokenRecord
} from "./trusted-device-authority-helpers.js";
import { tokenEquals } from "./bridge-server-utils.js";

/**
 * Constructor options for {@link TrustedDeviceAuthority}.
 */
export interface TrustedDeviceAuthorityOptions {
  pairingTtlMs?: number;
  accessTokenTtlMs?: number;
  refreshTokenTtlMs?: number;
  maxPairingSessions?: number;
  maxVerificationAttempts?: number;
  verificationCodeLockoutWindowMs?: number;
  now?: () => number;
}

const DEFAULT_PAIRING_TTL_MS = 60_000;
const DEFAULT_ACCESS_TOKEN_TTL_MS = 5 * 60_000;
const DEFAULT_REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60_000;
const DEFAULT_MAX_PAIRING_SESSIONS = 128;
const DEFAULT_MAX_VERIFICATION_ATTEMPTS = 5;
const DEFAULT_VERIFICATION_LOCKOUT_WINDOW_MS = 60_000;

/**
 * Returns the default capability set for one access level.
 *
 * @param accessLevel Level granted to the authenticated device.
 * @returns Stable capability list surfaced to the client.
 */
export function capabilitiesForAccessLevel(
  accessLevel: TrustedDeviceAccessLevel
): TrustedDeviceCapability[] {
  switch (accessLevel) {
    case "full_control":
      return ["write", "full_control"];
    case "write":
      return ["write", "can_request_full_control"];
    case "read_only":
    default:
      return ["read_only", "can_request_write", "can_request_full_control"];
  }
}

/**
 * In-memory authority for short-lived pairing, token refresh, and device auth.
 */
export class TrustedDeviceAuthority {
  private readonly now: () => number;
  private readonly pairingTtlMs: number;
  private readonly accessTokenTtlMs: number;
  private readonly refreshTokenTtlMs: number;
  private readonly maxPairingSessions: number;
  private readonly maxVerificationAttempts: number;
  private readonly verificationCodeLockoutWindowMs: number;
  private readonly pairingSessions = new Map<string, PairingSessionRecord>();
  private readonly pairingClaims = new Map<string, PairingClaimRecord>();
  private readonly devices = new Map<string, RegisteredDeviceRecord>();
  private readonly accessTokens = new Map<string, AccessTokenRecord>();
  private readonly refreshTokens = new Map<string, RefreshTokenRecord>();

  /**
   * @param options Optional ttl and clock overrides.
   */
  constructor(options: TrustedDeviceAuthorityOptions = {}) {
    this.now = options.now ?? Date.now;
    this.pairingTtlMs = normalizeTrustedDeviceTtl(options.pairingTtlMs, DEFAULT_PAIRING_TTL_MS);
    this.accessTokenTtlMs = normalizeTrustedDeviceTtl(
      options.accessTokenTtlMs,
      DEFAULT_ACCESS_TOKEN_TTL_MS
    );
    this.refreshTokenTtlMs = normalizeTrustedDeviceTtl(
      options.refreshTokenTtlMs,
      DEFAULT_REFRESH_TOKEN_TTL_MS
    );
    this.maxPairingSessions = normalizeTrustedDeviceLimit(
      options.maxPairingSessions,
      DEFAULT_MAX_PAIRING_SESSIONS
    );
    this.maxVerificationAttempts = Math.max(
      1,
      normalizeTrustedDeviceLimit(
        options.maxVerificationAttempts,
        DEFAULT_MAX_VERIFICATION_ATTEMPTS
      )
    );
    this.verificationCodeLockoutWindowMs = normalizeTrustedDeviceTtl(
      options.verificationCodeLockoutWindowMs,
      DEFAULT_VERIFICATION_LOCKOUT_WINDOW_MS
    );
  }

  /**
   * Starts one fresh pairing session and revokes older idle sessions.
   *
   * @param input Host and endpoint metadata advertised to the remote device.
   * @returns Pairing payload suitable for QR encoding.
   */
  public createPairingSession(input: PairSessionRequest): PairSessionResponse {
    this.expireStaleState();
    for (const session of this.pairingSessions.values()) {
      if (session.status === "pending") {
        session.status = "revoked";
      }
    }
    const expiresAtMs = this.now() + this.pairingTtlMs;
    const session: PairingSessionRecord = {
      pairingSessionId: randomTrustedDeviceId(),
      pairingToken: randomTrustedDeviceToken(),
      expiresAt: new Date(expiresAtMs).toISOString(),
      relayEndpoint: input.relayEndpoint,
      apiBaseUrl: input.apiBaseUrl,
      relayId: input.relayId,
      relayFingerprintHint: input.relayFingerprintHint ?? null,
      verificationCode: randomTrustedDeviceVerificationCode(),
      verificationAttempts: 0,
      verificationLockedUntilMs: null,
      status: "pending",
      claimId: null
    };
    this.pairingSessions.set(session.pairingSessionId, session);
    this.prunePairingSessions();
    return toPublicPairSessionResponse(session);
  }

  /**
   * Returns the current status for one pairing session.
   *
   * @param pairingSessionId Stable pairing session identifier.
   * @returns Pollable session state or null when unknown.
   */
  public getPairingSessionStatus(pairingSessionId: string): PairSessionStatusResponse | null {
    this.expireStaleState();
    const session = this.pairingSessions.get(pairingSessionId);
    if (!session) {
      return null;
    }
    const claim = session.claimId ? this.pairingClaims.get(session.claimId) : null;
    return {
      pairingSessionId: session.pairingSessionId,
      expiresAt: session.expiresAt,
      verificationCode: session.verificationCode,
      status: session.status,
      claimId: claim?.claimId,
      deviceName: claim?.deviceName ?? undefined,
      platform: claim?.platform ?? undefined,
      proofVerified: claim?.proofVerified ?? undefined
    };
  }

  /**
   * Claims one QR payload and starts proof-of-possession challenge flow.
   *
   * @param input Device claim payload.
   * @returns Claim id, challenge nonce, and shared verification code.
   */
  public claimPairing(input: PairClaimRequest): PairClaimResponse {
    this.expireStaleState();
    const session = this.requireActiveSession(input.pairingSessionId, input.pairingToken);
    if (session.claimId) {
      throw new Error("pairing_claim_already_used");
    }
    const claim: PairingClaimRecord = {
      claimId: randomTrustedDeviceId(),
      pairingSessionId: session.pairingSessionId,
      publicKey: input.publicKey,
      challenge: randomTrustedDeviceToken(),
      deviceName: normalizeTrustedDeviceOptional(input.deviceName),
      platform: normalizeTrustedDeviceOptional(input.platform),
      proofVerified: false,
      confirmedAtMs: null,
      expiresAtMs: Date.parse(session.expiresAt)
    };
    session.claimId = claim.claimId;
    session.status = "claimed";
    this.pairingClaims.set(claim.claimId, claim);
    return {
      claimId: claim.claimId,
      challenge: claim.challenge,
      verificationCode: session.verificationCode,
      expiresAt: session.expiresAt
    };
  }

  /**
   * Verifies the device signature over its claim challenge.
   *
   * @param input Claim-proof payload from the remote device.
   * @returns Verification status and shared verification code.
   */
  public provePairing(input: PairProofRequest): PairProofResponse {
    this.expireStaleState();
    const claim = this.requireClaim(input.claimId);
    if (!isValidTrustedDeviceSignature(claim.publicKey, claim.challenge, input.challengeProof)) {
      throw new Error("invalid_challenge_proof");
    }
    claim.proofVerified = true;
    const session = this.requirePairingSession(claim.pairingSessionId);
    return {
      claimId: claim.claimId,
      verified: true,
      verificationCode: session.verificationCode,
      expiresAt: session.expiresAt
    };
  }

  /**
   * Finalizes pairing after human code verification.
   *
   * @param input Host confirmation payload.
   * @returns Registered device identity and initial token set.
   */
  public confirmPairing(input: PairConfirmRequest): PairConfirmResponse {
    this.expireStaleState();
    const claim = this.requireClaim(input.claimId);
    if (!claim.proofVerified) {
      throw new Error("pairing_proof_required");
    }
    if (claim.confirmedAtMs !== null) {
      throw new Error("pairing_claim_already_used");
    }
    const session = this.requirePairingSession(claim.pairingSessionId);
    this.enforceVerificationCode(session, input.verificationCode, this.now());
    claim.confirmedAtMs = this.now();
    const accessLevel = input.accessLevel ?? "read_only";
    const device: RegisteredDeviceRecord = {
      deviceId: randomTrustedDeviceId(),
      publicKey: claim.publicKey,
      deviceName: claim.deviceName,
      platform: claim.platform,
      accessLevel,
      revoked: false
    };
    this.devices.set(device.deviceId, device);
    session.status = "confirmed";
    this.prunePairingSessions();
    const tokenSet = this.issueTokenSet(device.deviceId, device.accessLevel);
    return {
      deviceId: device.deviceId,
      refreshToken: tokenSet.refreshToken.token,
      accessToken: tokenSet.accessToken.token,
      accessExpiresAt: new Date(tokenSet.accessToken.expiresAtMs).toISOString(),
      accessLevel: device.accessLevel,
      capabilities: capabilitiesForAccessLevel(device.accessLevel)
    };
  }

  /**
   * Authenticates one device-bound access token for a live WebSocket session.
   *
   * @param input Device auth payload.
   * @returns Auth response used by the bridge auth handshake.
   */
  public authenticateDevice(input: DeviceAuthRequest): DeviceAuthResponse {
    this.expireStaleState();
    const device = this.requireDevice(input.deviceId);
    const accessToken = this.requireAccessToken(input.accessToken, input.deviceId);
    const challenge = normalizeTrustedDeviceOptional(input.authChallenge);
    if (!challenge || !input.challengeProof) {
      throw new Error("auth_challenge_required");
    }
    if (!isValidTrustedDeviceSignature(device.publicKey, challenge, input.challengeProof)) {
      throw new Error("invalid_access_proof");
    }
    return {
      mode: "device",
      capabilities: capabilitiesForAccessLevel(device.accessLevel),
      accessLevel: device.accessLevel,
      expiresAt: new Date(accessToken.expiresAtMs).toISOString()
    };
  }

  /**
   * Rotates refresh/access credentials for one device.
   *
   * @param input Refresh request payload.
   * @returns Fresh token set for the same device.
   */
  public refreshAccessToken(input: RefreshDeviceAccessRequest): RefreshDeviceAccessResponse {
    this.expireStaleState();
    const refreshToken = this.requireRefreshToken(input.refreshToken, input.deviceId);
    refreshToken.revoked = true;
    const device = this.requireDevice(input.deviceId);
    const tokenSet = this.issueTokenSet(device.deviceId, device.accessLevel);
    return {
      deviceId: device.deviceId,
      refreshToken: tokenSet.refreshToken.token,
      accessToken: tokenSet.accessToken.token,
      accessExpiresAt: new Date(tokenSet.accessToken.expiresAtMs).toISOString(),
      accessLevel: device.accessLevel,
      capabilities: capabilitiesForAccessLevel(device.accessLevel)
    };
  }

  /**
   * Revokes all credentials for one registered device.
   *
   * @param input Device revoke payload.
   * @returns Revocation status.
   */
  public revokeDevice(input: RevokeDeviceRequest): RevokeDeviceResponse {
    this.expireStaleState();
    const device = this.requireDevice(input.deviceId);
    device.revoked = true;
    revokeTrustedDeviceTokensForDevice(this.accessTokens, device.deviceId);
    revokeTrustedDeviceTokensForDevice(this.refreshTokens, device.deviceId);
    return { revoked: true, deviceId: device.deviceId };
  }

  /**
   * Changes one device access level. I keep this public for tests and host-side upgrades.
   *
   * @param deviceId Stable device identifier.
   * @param accessLevel Next access level to persist.
   * @returns Updated device metadata.
   */
  public setDeviceAccessLevel(
    deviceId: string,
    accessLevel: TrustedDeviceAccessLevel
  ): RegisteredDeviceRecord {
    const device = this.requireDevice(deviceId);
    device.accessLevel = accessLevel;
    return device;
  }

  private issueTokenSet(deviceId: string, accessLevel: TrustedDeviceAccessLevel): {
    accessToken: AccessTokenRecord;
    refreshToken: RefreshTokenRecord;
    accessLevel: TrustedDeviceAccessLevel;
  } {
    const now = this.now();
    const accessToken: AccessTokenRecord = {
      token: randomTrustedDeviceToken(),
      deviceId,
      expiresAtMs: now + this.accessTokenTtlMs,
      revoked: false
    };
    const refreshToken: RefreshTokenRecord = {
      token: randomTrustedDeviceToken(),
      deviceId,
      expiresAtMs: now + this.refreshTokenTtlMs,
      revoked: false
    };
    this.accessTokens.set(accessToken.token, accessToken);
    this.refreshTokens.set(refreshToken.token, refreshToken);
    return { accessToken, refreshToken, accessLevel };
  }

  private expireStaleState(): void {
    const now = this.now();
    for (const session of this.pairingSessions.values()) {
      if (Date.parse(session.expiresAt) <= now && session.status !== "confirmed") {
        session.status = "expired";
      }
    }
    for (const [claimId, claim] of this.pairingClaims.entries()) {
      if (claim.expiresAtMs <= now) {
        this.pairingClaims.delete(claimId);
      }
    }
    expireTrustedDeviceTokenMap(this.accessTokens, now);
    expireTrustedDeviceTokenMap(this.refreshTokens, now);
    this.prunePairingSessions();
  }

  private prunePairingSessions(): void {
    if (this.pairingSessions.size <= this.maxPairingSessions) {
      return;
    }
    for (const [sessionId, session] of this.pairingSessions.entries()) {
      if (this.pairingSessions.size <= this.maxPairingSessions) {
        return;
      }
      if (session.status === "pending" || session.status === "claimed") {
        continue;
      }
      this.pairingSessions.delete(sessionId);
      if (session.claimId) {
        this.pairingClaims.delete(session.claimId);
      }
    }
  }

  private requirePairingSession(pairingSessionId: string): PairingSessionRecord {
    const session = this.pairingSessions.get(pairingSessionId);
    if (!session) {
      throw new Error("pairing_session_not_found");
    }
    return session;
  }

  private requireActiveSession(
    pairingSessionId: string,
    pairingToken: string
  ): PairingSessionRecord {
    const session = this.requirePairingSession(pairingSessionId);
    if (session.pairingToken !== pairingToken) {
      throw new Error("invalid_pairing_token");
    }
    if (session.status !== "pending") {
      throw new Error("pairing_session_not_available");
    }
    if (Date.parse(session.expiresAt) <= this.now()) {
      session.status = "expired";
      throw new Error("pairing_session_expired");
    }
    return session;
  }

  private requireClaim(claimId: string): PairingClaimRecord {
    const claim = this.pairingClaims.get(claimId);
    if (!claim) {
      throw new Error("pairing_claim_not_found");
    }
    if (claim.expiresAtMs <= this.now()) {
      this.pairingClaims.delete(claimId);
      throw new Error("pairing_claim_expired");
    }
    return claim;
  }

  private enforceVerificationCode(session: PairingSessionRecord, inputCode: string, now: number): void {
    if (session.verificationLockedUntilMs !== null && session.verificationLockedUntilMs > now) {
      throw new Error("pairing_verification_code_locked");
    }
    if (session.verificationLockedUntilMs !== null && session.verificationLockedUntilMs <= now) {
      session.verificationLockedUntilMs = null;
    }
    if (typeof inputCode !== "string") {
      this.recordVerificationFailure(session, now);
      throw new Error("invalid_verification_code");
    }

    if (tokenEquals(session.verificationCode, inputCode)) {
      session.verificationAttempts = 0;
      return;
    }

    this.recordVerificationFailure(session, now);
    throw new Error("invalid_verification_code");
  }

  private recordVerificationFailure(session: PairingSessionRecord, now: number): void {
    session.verificationAttempts += 1;
    if (session.verificationAttempts >= this.maxVerificationAttempts) {
      session.verificationAttempts = 0;
      session.verificationLockedUntilMs = now + this.verificationCodeLockoutWindowMs;
      throw new Error("pairing_verification_code_locked");
    }
  }

  private requireDevice(deviceId: string): RegisteredDeviceRecord {
    const device = this.devices.get(deviceId);
    if (!device || device.revoked) {
      throw new Error("device_not_found");
    }
    return device;
  }

  private requireAccessToken(token: string, deviceId: string): AccessTokenRecord {
    const record = this.accessTokens.get(token);
    if (!record || record.deviceId !== deviceId || record.revoked || record.expiresAtMs <= this.now()) {
      throw new Error("invalid_access_token");
    }
    return record;
  }

  private requireRefreshToken(token: string, deviceId: string): RefreshTokenRecord {
    const record = this.refreshTokens.get(token);
    if (!record || record.deviceId !== deviceId || record.revoked || record.expiresAtMs <= this.now()) {
      throw new Error("invalid_refresh_token");
    }
    return record;
  }
}

function normalizeTrustedDeviceLimit(raw: number | undefined, fallback: number): number {
  if (raw === undefined || !Number.isFinite(raw) || raw <= 0) {
    return fallback;
  }
  return Math.floor(raw);
}

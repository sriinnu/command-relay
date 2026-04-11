/**
 * @file Shared request and response contracts for trusted-device auth, pairing, and telemetry.
 */

/**
 * Access levels granted to an authenticated client session.
 */
export type TrustedDeviceAccessLevel = "read_only" | "write" | "full_control";

/**
 * Capability flags surfaced to clients after auth.
 */
export type TrustedDeviceCapability =
  | "read_only"
  | "can_request_write"
  | "can_request_full_control"
  | "write"
  | "full_control";

/**
 * Auth modes advertised by the bridge hello handshake.
 */
export type BridgeAuthMode = "open" | "token" | "device";

/**
 * Request payload for device auth exchange.
 */
export interface DeviceAuthRequest {
  deviceId: string;
  accessToken: string;
  challengeProof?: string;
  authChallenge?: string;
  clientId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Response payload returned by auth exchange.
 */
export interface DeviceAuthResponse {
  mode?: BridgeAuthMode;
  capabilities?: TrustedDeviceCapability[];
  accessLevel?: TrustedDeviceAccessLevel;
  expiresAt?: string;
  [key: string]: unknown;
}

/**
 * Request payload for creating a short-lived pairing session.
 */
export interface PairSessionRequest {
  relayEndpoint: string;
  apiBaseUrl: string;
  relayId: string;
  relayFingerprintHint?: string | null;
}

/**
 * Response payload returned by pairing-session creation.
 */
export interface PairSessionResponse {
  pairingSessionId: string;
  pairingToken: string;
  expiresAt: string;
  relayEndpoint: string;
  apiBaseUrl: string;
  relayId: string;
  relayFingerprintHint?: string | null;
  verificationCode: string;
}

/**
 * Request payload for one-time pairing claim exchange.
 */
export interface PairClaimRequest {
  pairingSessionId: string;
  pairingToken: string;
  publicKey: string;
  deviceName?: string;
  platform?: string;
}

/**
 * Response payload returned by pairing claim exchange.
 */
export interface PairClaimResponse {
  claimId: string;
  challenge: string;
  verificationCode: string;
  expiresAt: string;
}

/**
 * Request payload for proving possession of the device private key.
 */
export interface PairProofRequest {
  claimId: string;
  challengeProof: string;
}

/**
 * Response payload returned after proof verification succeeds.
 */
export interface PairProofResponse {
  claimId: string;
  verified: boolean;
  verificationCode: string;
  expiresAt: string;
}

/**
 * Request payload for human-confirmed pairing finalization.
 */
export interface PairConfirmRequest {
  claimId: string;
  verificationCode: string;
  accessLevel?: TrustedDeviceAccessLevel;
}

/**
 * Response payload returned when pairing is finalized.
 */
export interface PairConfirmResponse {
  deviceId: string;
  refreshToken: string;
  accessToken: string;
  accessExpiresAt: string;
  accessLevel: TrustedDeviceAccessLevel;
  capabilities: TrustedDeviceCapability[];
}

/**
 * Request payload for access-token refresh.
 */
export interface RefreshDeviceAccessRequest {
  deviceId: string;
  refreshToken: string;
}

/**
 * Response payload returned by token refresh.
 */
export interface RefreshDeviceAccessResponse {
  deviceId: string;
  refreshToken: string;
  accessToken: string;
  accessExpiresAt: string;
  accessLevel: TrustedDeviceAccessLevel;
  capabilities: TrustedDeviceCapability[];
}

/**
 * Request payload for server-side device revocation.
 */
export interface RevokeDeviceRequest {
  deviceId: string;
}

/**
 * Response payload returned after device revocation.
 */
export interface RevokeDeviceResponse {
  revoked: boolean;
  deviceId: string;
}

/**
 * Pollable pairing-session state returned to the host control surface.
 */
export interface PairSessionStatusResponse {
  pairingSessionId: string;
  expiresAt: string;
  verificationCode: string;
  status: "pending" | "claimed" | "confirmed" | "expired" | "revoked";
  claimId?: string;
  deviceName?: string;
  platform?: string;
  proofVerified?: boolean;
}

/**
 * Request payload for telemetry event submission.
 */
export interface TelemetryRequest {
  events: Array<{
    name: string;
    timestamp: number;
    attributes?: Record<string, string | number | boolean | null>;
  }>;
}

/**
 * Response payload returned by telemetry endpoint.
 */
export interface TelemetryResponse {
  accepted?: number;
  rejected?: number;
  [key: string]: unknown;
}

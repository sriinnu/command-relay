/**
 * @file Bridge auth-mode resolution and capability helpers for legacy token/open auth plus trusted devices.
 */

import { randomBytes } from "node:crypto";
import type { BridgeConfig } from "../config.js";
import type {
  BridgeAuthMode,
  DeviceAuthResponse,
  TrustedDeviceAccessLevel,
  TrustedDeviceCapability
} from "../control-plane/control-plane-types.js";
import { tokenEquals } from "./bridge-server-utils.js";
import { capabilitiesForAccessLevel, type TrustedDeviceAuthority } from "./trusted-device-authority.js";

export type BridgeAuthConfig = Pick<BridgeConfig, "authToken"> & {
  trustedDeviceAuthEnabled?: boolean;
};

/**
 * Mutable per-client auth state tracked by the bridge connection.
 */
export interface BridgeClientAuthState {
  authenticated: boolean;
  authMode: BridgeAuthMode | null;
  authChallenge: string | null;
  accessLevel: TrustedDeviceAccessLevel;
  capabilities: TrustedDeviceCapability[];
}

/**
 * Resolves the auth modes supported by the current bridge config.
 *
 * @param config Runtime bridge configuration.
 * @returns Ordered auth modes for `hello.authModes`.
 */
export function resolveBridgeAuthModes(config: BridgeAuthConfig): BridgeAuthMode[] {
  const modes: BridgeAuthMode[] = [];
  if (config.authToken) {
    modes.push("token");
  }
  if (config.trustedDeviceAuthEnabled) {
    modes.push("device");
  }
  if (modes.length === 0) {
    modes.push("open");
  }
  return modes;
}

/**
 * Returns the initial auth state for a newly-opened socket.
 *
 * @param config Runtime bridge configuration.
 * @returns Initial auth state with any per-connection challenge.
 */
export function createInitialBridgeAuthState(config: BridgeAuthConfig): BridgeClientAuthState {
  const authModes = resolveBridgeAuthModes(config);
  if (authModes.length === 1 && authModes[0] === "open") {
    return {
      authenticated: true,
      authMode: "open",
      authChallenge: null,
      accessLevel: "full_control",
      capabilities: capabilitiesForAccessLevel("full_control")
    };
  }
  return {
    authenticated: false,
    authMode: null,
    authChallenge: authModes.includes("device") ? randomBytes(24).toString("base64url") : null,
    accessLevel: "read_only",
    capabilities: []
  };
}

/**
 * Returns whether a client access level may enable input.
 *
 * @param accessLevel Current authenticated access level.
 * @returns True when input can be enabled for the connection.
 */
export function canClientEnableInput(accessLevel: TrustedDeviceAccessLevel): boolean {
  return accessLevel === "write" || accessLevel === "full_control";
}

/**
 * Returns whether a client may override active lane ownership.
 *
 * @param accessLevel Current authenticated access level.
 * @returns True when ownership override is allowed.
 */
export function canClientOverrideOwnership(accessLevel: TrustedDeviceAccessLevel): boolean {
  return accessLevel === "full_control";
}

/**
 * Returns the `requiresAuth` flag surfaced in hello payloads.
 *
 * @param config Runtime bridge configuration.
 * @returns Whether the client must authenticate before non-auth actions.
 */
export function isBridgeAuthRequired(config: BridgeAuthConfig): boolean {
  const authModes = resolveBridgeAuthModes(config);
  return !(authModes.length === 1 && authModes[0] === "open");
}

/**
 * Authenticates one bridge client using legacy token mode or trusted-device mode.
 *
 * @param params Auth evaluation context.
 * @returns Finalized auth response payload.
 */
export function authenticateBridgeClient(params: {
  client: BridgeClientAuthState;
  config: BridgeAuthConfig;
  payload: Record<string, unknown>;
  authority?: TrustedDeviceAuthority | null;
}): DeviceAuthResponse {
  const { client, config, payload, authority = null } = params;
  if (!isBridgeAuthRequired(config)) {
    client.authenticated = true;
    client.authMode = "open";
    client.accessLevel = "full_control";
    client.capabilities = capabilitiesForAccessLevel("full_control");
    return buildAuthSuccessPayload("open", "full_control");
  }

  const mode = parseAuthMode(payload);
  if (mode === "device") {
    if (!authority) {
      throw new Error("device_auth_disabled");
    }
    const deviceId = parseString(payload.deviceId);
    const accessToken = parseString(payload.accessToken);
    const challengeProof = parseString(payload.challengeProof);
    if (!deviceId || !accessToken || !challengeProof || !client.authChallenge) {
      throw new Error("invalid_auth_payload");
    }
    const response = authority.authenticateDevice({
      deviceId,
      accessToken,
      challengeProof,
      authChallenge: client.authChallenge,
      clientId: parseString(payload.clientId) ?? undefined,
      metadata: isRecord(payload.metadata) ? payload.metadata : undefined
    });
    const accessLevel = response.accessLevel ?? "read_only";
    client.authenticated = true;
    client.authMode = "device";
    client.accessLevel = accessLevel;
    client.capabilities = response.capabilities ?? capabilitiesForAccessLevel(accessLevel);
    return {
      mode: "device",
      accessLevel,
      capabilities: client.capabilities,
      ...(response.expiresAt ? { expiresAt: response.expiresAt } : {})
    };
  }

  const token = parseString(payload.token);
  if (!token || !config.authToken || !tokenEquals(config.authToken, token)) {
    throw new Error("invalid_token");
  }
  client.authenticated = true;
  client.authMode = "token";
  client.accessLevel = "full_control";
  client.capabilities = capabilitiesForAccessLevel("full_control");
  return buildAuthSuccessPayload("token", "full_control");
}

function buildAuthSuccessPayload(
  mode: BridgeAuthMode,
  accessLevel: TrustedDeviceAccessLevel
): DeviceAuthResponse {
  return {
    mode,
    accessLevel,
    capabilities: capabilitiesForAccessLevel(accessLevel)
  };
}

function parseAuthMode(payload: Record<string, unknown>): BridgeAuthMode {
  const parsed = parseString(payload.mode);
  if (parsed === "device") {
    return "device";
  }
  return "token";
}

function parseString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

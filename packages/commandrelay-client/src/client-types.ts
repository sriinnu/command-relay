import { type Envelope } from "@commandrelay/protocol";

export interface GatewayPayload {
  readonly [key: string]: unknown;
}

export type ClientAuthMode = "open" | "token" | "device";
export type ClientAccessLevel = "read_only" | "write" | "full_control";

export interface HelloPayload extends GatewayPayload {
  readonly clientId: string;
  readonly requiresAuth: boolean;
  readonly authModes?: readonly ClientAuthMode[];
  readonly authChallenge?: string;
  readonly inputEnabled: boolean;
  readonly globalInputDisabled: boolean;
  readonly maxInputBytes?: number;
  readonly maxAttachedPanes?: number;
}

export interface AuthOkPayload extends GatewayPayload {
  readonly mode: ClientAuthMode;
  readonly capabilities?: readonly string[];
  readonly accessLevel?: ClientAccessLevel;
  readonly expiresAt?: string;
}

export interface AuthErrorPayload extends GatewayPayload {
  readonly code: string;
  readonly recoverable?: boolean;
  readonly message?: string;
}

export interface SessionListPayload extends GatewayPayload {
  readonly panes: Array<Record<string, unknown>>;
  readonly sessions: Array<Record<string, unknown>>;
  readonly runtime?: Record<string, unknown>;
}

export interface OutputPayload extends GatewayPayload {
  readonly mode: "snapshot" | "delta";
  readonly paneId: string;
  readonly chunk: string;
  readonly streamSeq: number;
}

export interface PolicyUpdatePayload extends GatewayPayload {
  readonly inputEnabled: boolean;
  readonly globalInputDisabled: boolean;
}

export interface GatewayErrorPayload extends GatewayPayload {
  readonly code: string;
  readonly message?: string;
}

export interface GatewayEnvelope<TPayload extends GatewayPayload = GatewayPayload> extends Envelope {
  readonly type: string;
  readonly payload: TPayload;
  readonly requestId: string | undefined;
}

export interface TokenAuthRequestPayload extends GatewayPayload {
  readonly mode?: "token";
  readonly token: string;
}

export interface DeviceAuthRequestPayload extends GatewayPayload {
  readonly mode: "device";
  readonly deviceId: string;
  readonly accessToken: string;
  readonly challengeProof: string;
  readonly clientId?: string;
  readonly metadata?: Record<string, unknown>;
}

export type AuthRequestPayload = TokenAuthRequestPayload | DeviceAuthRequestPayload;

export interface CommandRelayClientEvents {
  open: () => void;
  close: (code: number, reason: string) => void;
  parse_error: (error: Error, raw: string) => void;
  hello: (message: GatewayEnvelope<HelloPayload>) => void;
  auth_ok: (message: GatewayEnvelope<AuthOkPayload>) => void;
  auth_error: (message: GatewayEnvelope<AuthErrorPayload>) => void;
  session_list: (message: GatewayEnvelope<SessionListPayload>) => void;
  output: (message: GatewayEnvelope<OutputPayload>) => void;
  policy_update: (message: GatewayEnvelope<PolicyUpdatePayload>) => void;
  heartbeat_ack: (message: GatewayEnvelope<GatewayPayload>) => void;
  ack: (message: GatewayEnvelope<GatewayPayload>) => void;
  error: (message: GatewayEnvelope<GatewayErrorPayload>) => void;
  unknown: (message: GatewayEnvelope<GatewayPayload>) => void;
}

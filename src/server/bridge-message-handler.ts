/**
 * @file Parsed WebSocket message handling for the bridge runtime.
 */

import { createHash } from "node:crypto";
import type { BridgeAttachReplayMetadata } from "../bridge/bridge-engine.js";
import { envelope, parseMessage } from "../protocol.js";
import { parseNonEmptyString, parseOptionalBoolean, parseOptionalInt } from "./message-validation.js";
import {
  claimPaneInputOwnership,
  groupSessionsByName,
  releaseClientInputOwnership,
  releasePaneInputOwnership,
  sendEnvelope as send,
  sendPolicyUpdateEnvelope,
  snapshotPaneInputOwnership
} from "./bridge-server-utils.js";
import { buildInputPolicyState, isInputAllowed } from "./input-policy.js";
import { buildSessionListRuntimeMetadata } from "./session-list-runtime-metadata.js";
import {
  authenticateBridgeClient,
  type BridgeAuthConfig,
  canClientEnableInput,
  canClientOverrideOwnership
} from "./bridge-auth.js";
import { classifyReplaySnapshotFallbackReason } from "./bridge-runtime-failures.js";
import type { TrustedDeviceAuthority } from "./trusted-device-authority.js";

/**
 * Handler context passed into bridge message dispatch.
 */
export interface HandleClientMessageContext {
  client: {
    id: string;
    socket: {
      OPEN: number;
      readyState: number;
      send: (message: string) => void;
      close?: (code?: number, reason?: string) => void;
      terminate?: () => void;
      _socket?: { destroy?: () => void };
    };
    authenticated: boolean;
    inputEnabled: boolean;
    attachedPanes: Set<string>;
    accessLevel?: "read_only" | "write" | "full_control";
    authMode?: "open" | "token" | "device" | null;
    authChallenge?: string | null;
    capabilities?: string[];
  };
  tmux: {
    listPanes: () => Promise<Array<Record<string, unknown>>>;
    sendInput: (paneId: string, input: string) => Promise<unknown>;
  };
  listPanes?: () => Promise<Array<Record<string, unknown>>>;
  engine: {
    attach: (
      clientId: string,
      paneId: string,
      lastSeq: number | null
    ) => Promise<BridgeAttachReplayMetadata | void>;
    detach: (clientId: string, paneId: string) => void;
    detachAll: (clientId: string) => void;
    getReplayOffsetsSnapshot?: () => unknown;
  };
  config: BridgeAuthConfig & {
    maxInputBytes: number;
    maxAttachedPanes: number;
    globalInputDisabled: boolean;
    allowInputOwnershipOverride?: boolean;
  };
  inputLimiter: { consume: (key: string) => { allowed: boolean; retryAfterMs: number; limit: number; windowMs: number } };
  type?: string;
  payload?: Record<string, unknown>;
  requestId?: string;
  audit: { write: (event: { action: string; clientId: string; details: Record<string, unknown> }) => Promise<void> };
  telemetry?: {
    recordListLatency?: (value: number) => void;
    recordAttachLatency?: (value: number) => void;
    recordReconnectLatency?: (value: number) => void;
    recordInputAckLatency?: (value: number) => void;
  };
  requestStartedAtMs?: number;
  inputOwnershipArbiter?: unknown;
  paneInputOwnership?: unknown;
  paneInputOwners?: unknown;
  allowInputOwnershipOverride?: boolean;
  trackAttachLag?: (clientId: string, paneId: string, startedAtMs: number) => void;
  trustedDeviceAuthority?: TrustedDeviceAuthority | null;
}

/**
 * Parses an incoming client websocket frame using configured protocol strictness.
 *
 * @param raw UTF-8 JSON message text.
 * @param strictProtocolParsing Whether strict v1 validation is enabled.
 * @returns Parse result from the protocol package.
 */
export function parseIncomingClientMessage(raw: string, strictProtocolParsing: boolean) {
  return parseMessage(raw, strictProtocolParsing ? { strictV1: true } : undefined);
}

/**
 * Handles one parsed client message against the live bridge context.
 *
 * @param ctx Message context and runtime dependencies.
 * @returns Nothing.
 */
export async function handleClientMessage(ctx: HandleClientMessageContext): Promise<void> {
    const {
      client,
      tmux,
      engine,
    config,
    inputLimiter,
    type = "",
    payload = {},
    requestId,
    audit,
    telemetry,
      requestStartedAtMs,
      inputOwnershipArbiter,
      paneInputOwnership,
    paneInputOwners,
    allowInputOwnershipOverride,
      trackAttachLag,
      trustedDeviceAuthority
    } = ctx;
    const getPanes = ctx.listPanes ?? tmux.listPanes;
  client.accessLevel ??= "full_control";
  client.authMode ??= null;
  client.authChallenge ??= null;
  client.capabilities ??= [];
  const startedAtMs = requestStartedAtMs ?? Date.now();
  const accessLevel = client.accessLevel ?? "full_control";
  const laneOverrideAllowed = (allowInputOwnershipOverride ?? config.allowInputOwnershipOverride ?? true)
    && canClientOverrideOwnership(accessLevel);
  const paneInputOwnerState = inputOwnershipArbiter ?? paneInputOwnership ?? paneInputOwners;
  if (!client.authenticated && type !== "auth") {
    try {
      send(client.socket, envelope("error", { code: "auth_required", recoverable: true }, requestId));
    } catch {}
    closeUnauthenticatedSocket(client.socket);
    return;
  }
  switch (type) {
    case "auth": {
      try {
        const authPayload = authenticateBridgeClient({
          client: client as any,
          config,
          payload,
          authority: trustedDeviceAuthority
        });
        await audit.write({
          action: "auth_ok",
          clientId: client.id,
          details: {
            mode: authPayload.mode ?? client.authMode ?? "token",
            accessLevel: authPayload.accessLevel ?? client.accessLevel
          }
        });
        send(client.socket, envelope("auth_ok", authPayload as Record<string, unknown>, requestId));
      } catch (error) {
        const code = mapBridgeAuthErrorCode(error);
        await audit.write({ action: "auth_fail", clientId: client.id, details: { reason: code } });
        send(client.socket, envelope("auth_error", { code, recoverable: true }, requestId));
      }
      return;
    }
    case "list_sessions": {
      const panes = await getPanes();
      const sessions = groupSessionsByName(panes);
      const runtime = buildSessionListRuntimeMetadata({
        panes,
        capabilities: {
          laneOwnership: Boolean(paneInputOwnerState),
          replayOffset: true,
          inputOwnershipOverride: laneOverrideAllowed
        },
        laneOwnershipSnapshot: snapshotPaneInputOwnership(paneInputOwnerState as any),
        replayOffsetSnapshot: (engine.getReplayOffsetsSnapshot?.() ?? []) as any
      });
      telemetry?.recordListLatency?.(Date.now() - startedAtMs);
      send(client.socket, envelope("session_list", { panes, sessions, runtime }, requestId));
      return;
    }
    case "attach": {
      const paneId = parseNonEmptyString(payload.paneId);
      if (!paneId) {
        send(client.socket, envelope("error", { code: "invalid_pane_id" }, requestId));
        return;
      }
      if (!client.attachedPanes.has(paneId) && client.attachedPanes.size >= config.maxAttachedPanes) {
        send(client.socket, envelope("error", { code: "max_attached_panes_exceeded" }, requestId));
        return;
      }
      const lastSeq = parseOptionalInt(payload.lastSeq);
      client.attachedPanes.add(paneId);
      trackAttachLag?.(client.id, paneId, startedAtMs);
      const attachReplayMetadata = (await engine.attach(client.id, paneId, lastSeq)) ?? undefined;
      if (lastSeq !== null && attachReplayMetadata && attachReplayMetadata.replayUsed && attachReplayMetadata.replayedCount && attachReplayMetadata.replayedCount > 0) {
        const replayStartSeq = lastSeq + 1;
        const replayEndSeq = lastSeq + attachReplayMetadata.replayedCount;
        await audit.write({ action: "replay_resume", clientId: client.id, details: { paneId, lastSeq, replayedCount: attachReplayMetadata.replayedCount, replayStartSeq, replayEndSeq, latestSeq: attachReplayMetadata.latestSeq, result: "allowed", reason: "resume" } });
      } else if (lastSeq !== null && attachReplayMetadata && attachReplayMetadata.fallbackToSnapshot) {
        await audit.write({ action: "replay_gap_snapshot_fallback", clientId: client.id, details: { paneId, lastSeq, streamSeq: attachReplayMetadata.latestSeq, latestSeq: attachReplayMetadata.latestSeq, result: "allowed", reason: classifyReplaySnapshotFallbackReason(attachReplayMetadata) } });
      }
      await audit.write({ action: "attach", clientId: client.id, details: { paneId, lastSeq } });
      const attachLatencyMs = Date.now() - startedAtMs;
      telemetry?.recordAttachLatency?.(attachLatencyMs);
      if (lastSeq !== null) telemetry?.recordReconnectLatency?.(attachLatencyMs);
      send(client.socket, envelope("ack", { action: "attach", paneId }, requestId));
      return;
    }
    case "detach": {
      const paneId = parseNonEmptyString(payload.paneId);
      if (!paneId) {
        send(client.socket, envelope("error", { code: "invalid_pane_id" }, requestId));
        return;
      }
      client.attachedPanes.delete(paneId);
      const released = releasePaneInputOwnership(paneInputOwnerState as any, paneId, client.id);
      engine.detach(client.id, paneId);
      await audit.write({ action: "detach", clientId: client.id, details: { paneId } });
      if (released) await audit.write({ action: "lane_owner_released", clientId: client.id, details: { paneId, result: "allowed", reason: "detach" } });
      send(client.socket, envelope("ack", { action: "detach", paneId }, requestId));
      return;
    }
    case "enable_input": {
      if (!canClientEnableInput(accessLevel)) {
        await audit.write({ action: "enable_input", clientId: client.id, details: { result: "denied", reason: "insufficient_capability", accessLevel } });
        send(client.socket, envelope("error", { code: "insufficient_capability", accessLevel }, requestId));
        return;
      }
      const nextInputEnabled = !config.globalInputDisabled;
      client.inputEnabled = nextInputEnabled;
      await audit.write({ action: "enable_input", clientId: client.id, details: { result: nextInputEnabled ? "allowed" : "denied", reason: nextInputEnabled ? "client_enabled" : "global_input_kill_switch" } });
      sendPolicyUpdateEnvelope(client.socket, client.inputEnabled, config.globalInputDisabled, requestId);
      return;
    }
    case "disable_input": {
      client.inputEnabled = false;
      await audit.write({ action: "disable_input", clientId: client.id, details: { result: "allowed", reason: "client_disabled" } });
      sendPolicyUpdateEnvelope(client.socket, client.inputEnabled, config.globalInputDisabled, requestId);
      return;
    }
    case "input": {
      if (!canClientEnableInput(accessLevel)) {
        await audit.write({ action: "input", clientId: client.id, details: { paneId: parseNonEmptyString(payload.paneId), result: "denied", reason: "insufficient_capability", accessLevel } });
        send(client.socket, envelope("error", { code: "insufficient_capability", accessLevel }, requestId));
        return;
      }
      const paneId = parseNonEmptyString(payload.paneId);
      const data = typeof payload.data === "string" ? payload.data : "";
      const inputBytes = Buffer.byteLength(data, "utf8");
      const commandHash = data ? createHash("sha256").update(data, "utf8").digest("hex") : null;
      const previewPolicy = data ? "sha256_only" : "none";
      const inputRate = inputLimiter.consume(client.id);
      if (!inputRate.allowed) {
        await audit.write({ action: "input", clientId: client.id, details: { paneId: paneId ?? null, result: "denied", reason: "rate_limited", bytes: inputBytes, commandHash, previewPolicy } });
        send(client.socket, envelope("error", { code: "input_rate_limited", retryAfterMs: inputRate.retryAfterMs, limit: inputRate.limit, windowMs: inputRate.windowMs }, requestId));
        return;
      }
      if (!isInputAllowed({ clientInputEnabled: client.inputEnabled, globalInputDisabled: config.globalInputDisabled })) {
        await audit.write({ action: "input", clientId: client.id, details: { paneId: paneId ?? null, result: "denied", reason: "policy_blocked", bytes: inputBytes, commandHash, previewPolicy } });
        send(client.socket, envelope("error", { code: "input_disabled" }, requestId));
        return;
      }
      if (!paneId || !data) {
        send(client.socket, envelope("error", { code: "invalid_input" }, requestId));
        return;
      }
      if (!client.attachedPanes.has(paneId)) {
        send(client.socket, envelope("error", { code: "pane_not_attached" }, requestId));
        return;
      }
      if (inputBytes > config.maxInputBytes) {
        send(client.socket, envelope("error", { code: "input_too_large", maxInputBytes: config.maxInputBytes, receivedBytes: inputBytes }, requestId));
        return;
      }
      const overrideRequested = parseOptionalBoolean(payload.override) === true || parseOptionalBoolean(payload.takeOwnership) === true;
      const claimResult = claimPaneInputOwnership(paneInputOwnerState as any, paneId, client.id, overrideRequested, laneOverrideAllowed);
      if (claimResult?.ok === false) {
        const { ownerClientId, overrideAllowed } = claimResult;
        await audit.write({ action: "input", clientId: client.id, details: { paneId, result: "denied", reason: "ownership_conflict", bytes: inputBytes, commandHash, previewPolicy } });
        send(client.socket, envelope("error", { code: "input_lane_conflict", paneId, ownerClientId, overrideAllowed, recoverable: true }, requestId));
        return;
      }
      await tmux.sendInput(paneId, data);
      await audit.write({ action: "input", clientId: client.id, details: { paneId, bytes: inputBytes, result: "allowed", reason: "ok", commandHash, previewPolicy } });
      if (claimResult?.ok && claimResult.overridden) {
        await audit.write({ action: "input_takeover", clientId: client.id, details: { paneId, result: "allowed", reason: "override", bytes: inputBytes } });
      }
      telemetry?.recordInputAckLatency?.(Date.now() - startedAtMs);
      send(client.socket, envelope("ack", { action: "input", paneId, bytes: inputBytes }, requestId));
      return;
    }
    case "heartbeat": {
      send(client.socket, envelope("heartbeat_ack", { clientId: client.id }, requestId));
      return;
    }
    case "disconnect": {
      engine.detachAll(client.id);
      const releasedPanes = releaseClientInputOwnership(paneInputOwnerState as any, client.id);
      client.attachedPanes.clear();
      client.inputEnabled = false;
      if (releasedPanes > 0) await audit.write({ action: "lane_owner_released", clientId: client.id, details: { result: "allowed", reason: "disconnect", releasedPanes } });
      await audit.write({ action: "disconnect", clientId: client.id, details: {} });
      send(client.socket, envelope("ack", { action: "disconnect" }, requestId));
      return;
    }
    default:
      send(client.socket, envelope("error", { code: "unknown_type", type }, requestId));
  }
}

function mapBridgeAuthErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message === "device_auth_disabled") return "device_auth_disabled";
  if (message === "invalid_auth_payload") return "invalid_auth_payload";
  if (message === "auth_challenge_required") return "auth_challenge_required";
  if (message === "invalid_access_token" || message === "invalid_access_proof") return message;
  if (message === "invalid_token") return "invalid_token";
  return "auth_failed";
}

/**
 * Closes or terminates an unauthenticated socket after rejecting access.
 *
 * @param socket Client websocket handle.
 * @returns Nothing.
 */
function closeUnauthenticatedSocket(
  socket: HandleClientMessageContext["client"]["socket"]
): void {
  try {
    if (typeof socket.close === "function") {
      socket.close(1008, "auth_required");
      return;
    }
    if (typeof socket.terminate === "function") {
      socket.terminate();
      return;
    }
    socket._socket?.destroy?.();
  } catch {
    try {
      socket.terminate?.();
    } catch {
      socket._socket?.destroy?.();
    }
  }
}

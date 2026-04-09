/**
 * @file Utility helpers for bridge server message handling.
 */

import { timingSafeEqual } from "node:crypto";
import { envelope } from "../protocol.js";
import { buildInputPolicyState } from "./input-policy.js";

/**
 * Sends an envelope over WebSocket when writable.
 *
 * @param socket WebSocket instance.
 * @param message Envelope payload.
 * @param onSendFailure Optional failure callback used to teardown the active session.
 * @returns Nothing.
 */
export function sendEnvelope(
  socket: {
    OPEN: number;
    CLOSING?: number;
    CLOSED?: number;
    readyState: number;
    send: (payload: string) => void;
    close?: (code?: number, reason?: string) => void;
    _socket?: { destroy?: () => void };
  },
  message: unknown,
  onSendFailure?: () => void
): void {
  if (socket.readyState !== socket.OPEN) {
    if (
      (socket.CLOSING !== undefined && socket.readyState === socket.CLOSING) ||
      (socket.CLOSED !== undefined && socket.readyState === socket.CLOSED)
    ) {
      onSendFailure?.();
    }
    return;
  }
  try {
    socket.send(JSON.stringify(message));
  } catch {
    onSendFailure?.();
    try {
      socket.close?.(1011, "send_failed");
    } catch {
      const transport = socket._socket;
      transport?.destroy?.();
    }
  }
}

/**
 * Groups pane rows into session buckets.
 *
 * @param panes tmux panes list.
 * @returns Grouped sessions keyed by session name.
 */
export function groupSessionsByName(
  panes: Array<Record<string, unknown>>
): Array<{ sessionName: string; paneIds: string[]; backendId?: string }> {
  const grouped = new Map<
    string,
    { sessionName: string; paneIds: string[]; backendId?: string }
  >();
  for (const pane of panes) {
    const sessionName = typeof pane.sessionName === "string" ? pane.sessionName : "unknown";
    const paneId = typeof pane.paneId === "string" ? pane.paneId : "";
    const backendId = typeof pane.backendId === "string" ? pane.backendId : "";
    if (!paneId) continue;

    // Backend-aware key avoids collisions when tmux/cmux share the same session name.
    const bucketKey = `${backendId}:${sessionName}`;
    const sessionBucket = grouped.get(bucketKey);
    if (sessionBucket) {
      sessionBucket.paneIds.push(paneId);
      continue;
    }

    grouped.set(bucketKey, {
      sessionName,
      paneIds: [paneId],
      ...(backendId ? { backendId } : {})
    });
  }

  return Array.from(grouped.values());
}

/**
 * Compares two token strings using timing-safe equality.
 *
 * @param expected Expected token.
 * @param candidate Candidate token.
 * @returns True when both tokens match.
 */
export function tokenEquals(expected: string, candidate: string): boolean {
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(candidate, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Result of pane input ownership arbitration.
 */
export type PaneInputClaimResult =
  | { ok: true; overridden: boolean }
  | {
    ok: false;
    ownerClientId: string;
    overrideAllowed: boolean;
  };

const DEFAULT_PANE_INPUT_LEASE_DURATION_MS = 30_000;

interface PaneInputOwnerLease {
  clientId: string;
  expiresAtMs: number;
}

/**
 * Snapshot row describing the current lane owner for a pane.
 */
export interface PaneInputOwnershipSnapshotRow {
  paneId: string;
  ownerClientId: string;
  expiresAtMs: number | null;
}

/**
 * Configures pane input ownership arbitration lease behavior.
 */
export interface PaneInputOwnershipArbiterConfig {
  /**
   * Ownership lease duration in milliseconds.
   * Invalid values fall back to a safe default.
   */
  leaseDurationMs?: number;

  /**
   * Clock source for deterministic tests.
   */
  now?: () => number;
}

function resolveLeaseDurationMs(leaseDurationMs: number | undefined): number {
  if (typeof leaseDurationMs !== "number") return DEFAULT_PANE_INPUT_LEASE_DURATION_MS;
  if (!Number.isFinite(leaseDurationMs) || leaseDurationMs <= 0) {
    return DEFAULT_PANE_INPUT_LEASE_DURATION_MS;
  }
  return leaseDurationMs;
}

/**
 * Tracks pane input ownership for multi-client arbitration.
 */
export class PaneInputOwnershipArbiter {
  private readonly paneOwners = new Map<string, PaneInputOwnerLease>();
  private readonly leaseDurationMs: number;
  private readonly now: () => number;

  /**
   * Creates a lane ownership arbiter with optional lease controls.
   *
   * @param config Optional lease configuration.
   */
  constructor(config?: PaneInputOwnershipArbiterConfig) {
    this.leaseDurationMs = resolveLeaseDurationMs(config?.leaseDurationMs);
    this.now = config?.now ?? Date.now;
  }

  /**
   * Attempts to claim ownership of a pane's input lane.
   *
   * @param paneId Pane identifier.
   * @param clientId Requesting client identifier.
   * @param overrideRequested Whether request explicitly asks for takeover.
   * @param overrideAllowed Whether runtime config allows takeover.
   * @returns Arbitration outcome.
   */
  claim(
    paneId: string,
    clientId: string,
    overrideRequested: boolean,
    overrideAllowed: boolean
  ): PaneInputClaimResult {
    this.expireStaleOwners();
    const currentOwner = this.paneOwners.get(paneId)?.clientId;
    if (!currentOwner || currentOwner === clientId) {
      this.setOwner(paneId, clientId);
      return { ok: true, overridden: false };
    }

    if (overrideRequested && overrideAllowed) {
      this.setOwner(paneId, clientId);
      return { ok: true, overridden: true };
    }

    return {
      ok: false,
      ownerClientId: currentOwner,
      overrideAllowed
    };
  }

  /**
   * Releases pane ownership if held by the given client.
   *
   * @param paneId Pane identifier.
   * @param clientId Client identifier.
   * @returns True when ownership was released.
   */
  releasePaneIfOwnedBy(paneId: string, clientId: string): boolean {
    this.expireStaleOwners();
    if (this.paneOwners.get(paneId)?.clientId === clientId) {
      this.paneOwners.delete(paneId);
      return true;
    }
    return false;
  }

  /**
   * Releases every pane currently owned by a client.
   *
   * @param clientId Client identifier.
   * @returns Number of released pane lanes.
   */
  releaseClient(clientId: string): number {
    this.expireStaleOwners();
    let released = 0;
    for (const [paneId, ownerLease] of this.paneOwners.entries()) {
      if (ownerLease.clientId !== clientId) continue;
      this.paneOwners.delete(paneId);
      released += 1;
    }
    return released;
  }

  /**
   * Returns deterministic lane ownership rows for host introspection.
   *
   * @returns Current lane ownership rows sorted by pane id.
   */
  snapshot(): PaneInputOwnershipSnapshotRow[] {
    this.expireStaleOwners();
    return Array.from(this.paneOwners.entries())
      .map(([paneId, ownerLease]) => ({
        paneId,
        ownerClientId: ownerLease.clientId,
        expiresAtMs: ownerLease.expiresAtMs
      }))
      .sort((a, b) => a.paneId.localeCompare(b.paneId));
  }

  private setOwner(paneId: string, clientId: string): void {
    this.paneOwners.set(paneId, {
      clientId,
      expiresAtMs: this.now() + this.leaseDurationMs
    });
  }

  private expireStaleOwners(): void {
    const nowMs = this.now();
    for (const [paneId, ownerLease] of this.paneOwners.entries()) {
      if (ownerLease.expiresAtMs > nowMs) continue;
      this.paneOwners.delete(paneId);
    }
  }
}

/**
 * Supported pane ownership state containers.
 */
export type PaneInputOwnershipState = PaneInputOwnershipArbiter | Map<string, string> | undefined;

/**
 * Returns normalized lane ownership rows for arbiter or legacy map state.
 *
 * @param ownershipState Ownership state container.
 * @returns Current lane ownership rows.
 */
export function snapshotPaneInputOwnership(
  ownershipState: PaneInputOwnershipState
): PaneInputOwnershipSnapshotRow[] {
  if (!ownershipState) return [];
  if (ownershipState instanceof PaneInputOwnershipArbiter) {
    return ownershipState.snapshot();
  }

  return Array.from(ownershipState.entries())
    .map(([paneId, ownerClientId]) => ({
      paneId,
      ownerClientId,
      expiresAtMs: null
    }))
    .sort((a, b) => a.paneId.localeCompare(b.paneId));
}

/**
 * Claims pane ownership using either arbiter class or legacy shared map.
 *
 * @param ownershipState Ownership state container.
 * @param paneId Pane identifier.
 * @param clientId Requesting client identifier.
 * @param overrideRequested Whether request asks to override existing ownership.
 * @param overrideAllowed Whether runtime allows override.
 * @returns Arbitration outcome or null when arbitration is disabled.
 */
export function claimPaneInputOwnership(
  ownershipState: PaneInputOwnershipState,
  paneId: string,
  clientId: string,
  overrideRequested: boolean,
  overrideAllowed: boolean
): PaneInputClaimResult | null {
  if (!ownershipState) return null;
  if (ownershipState instanceof PaneInputOwnershipArbiter) {
    return ownershipState.claim(paneId, clientId, overrideRequested, overrideAllowed);
  }

  const currentOwner = ownershipState.get(paneId);
  if (!currentOwner || currentOwner === clientId) {
    ownershipState.set(paneId, clientId);
    return { ok: true, overridden: false };
  }
  if (overrideRequested && overrideAllowed) {
    ownershipState.set(paneId, clientId);
    return { ok: true, overridden: true };
  }
  return {
    ok: false,
    ownerClientId: currentOwner,
    overrideAllowed
  };
}

/**
 * Releases pane ownership if held by the target client.
 *
 * @param ownershipState Ownership state container.
 * @param paneId Pane identifier.
 * @param clientId Client identifier.
 * @returns True when ownership was released.
 */
export function releasePaneInputOwnership(
  ownershipState: PaneInputOwnershipState,
  paneId: string,
  clientId: string
): boolean {
  if (!ownershipState) return false;
  if (ownershipState instanceof PaneInputOwnershipArbiter) {
    return ownershipState.releasePaneIfOwnedBy(paneId, clientId);
  }
  if (ownershipState.get(paneId) === clientId) {
    ownershipState.delete(paneId);
    return true;
  }
  return false;
}

/**
 * Releases all pane ownership held by a client.
 *
 * @param ownershipState Ownership state container.
 * @param clientId Client identifier.
 * @returns Number of released pane lanes.
 */
export function releaseClientInputOwnership(
  ownershipState: PaneInputOwnershipState,
  clientId: string
): number {
  if (!ownershipState) return 0;
  if (ownershipState instanceof PaneInputOwnershipArbiter) {
    return ownershipState.releaseClient(clientId);
  }

  let released = 0;
  for (const [paneId, ownerClientId] of ownershipState.entries()) {
    if (ownerClientId !== clientId) continue;
    ownershipState.delete(paneId);
    released += 1;
  }
  return released;
}

/**
 * Emits a normalized input policy update envelope.
 *
 * @param socket WebSocket instance.
 * @param clientInputEnabled Client-level input setting.
 * @param globalInputDisabled Global kill-switch status.
 * @param requestId Optional request identifier.
 * @returns Nothing.
 */
export function sendPolicyUpdateEnvelope(
  socket: {
    OPEN: number;
    readyState: number;
    send: (payload: string) => void;
  },
  clientInputEnabled: boolean,
  globalInputDisabled: boolean,
  requestId: string | undefined
): void {
  sendEnvelope(
    socket,
    envelope(
      "policy_update",
      buildInputPolicyState({
        clientInputEnabled,
        globalInputDisabled
      }) as unknown as Record<string, unknown>,
      requestId
    )
  );
}

/**
 * Clears pending attach-lag records for a disconnected client.
 *
 * @param pendingAttachLag Pending lag map keyed by `${clientId}:${paneId}`.
 * @param clientId Client identifier.
 * @returns Nothing.
 */
export function clearClientAttachLag(
  pendingAttachLag: Map<string, number>,
  clientId: string
): void {
  for (const key of pendingAttachLag.keys()) {
    if (key.startsWith(`${clientId}:`)) {
      pendingAttachLag.delete(key);
    }
  }
}

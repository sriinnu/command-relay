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
 * @returns Nothing.
 */
export function sendEnvelope(
  socket: { OPEN: number; readyState: number; send: (payload: string) => void },
  message: unknown
): void {
  if (socket.readyState !== socket.OPEN) return;
  socket.send(JSON.stringify(message));
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

/**
 * Tracks pane input ownership for multi-client arbitration.
 */
export class PaneInputOwnershipArbiter {
  private readonly paneOwners = new Map<string, string>();

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
    const currentOwner = this.paneOwners.get(paneId);
    if (!currentOwner || currentOwner === clientId) {
      this.paneOwners.set(paneId, clientId);
      return { ok: true, overridden: false };
    }

    if (overrideRequested && overrideAllowed) {
      this.paneOwners.set(paneId, clientId);
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
   * @returns Nothing.
   */
  releasePaneIfOwnedBy(paneId: string, clientId: string): void {
    if (this.paneOwners.get(paneId) === clientId) {
      this.paneOwners.delete(paneId);
    }
  }

  /**
   * Releases every pane currently owned by a client.
   *
   * @param clientId Client identifier.
   * @returns Number of released pane lanes.
   */
  releaseClient(clientId: string): number {
    let released = 0;
    for (const [paneId, ownerClientId] of this.paneOwners.entries()) {
      if (ownerClientId !== clientId) continue;
      this.paneOwners.delete(paneId);
      released += 1;
    }
    return released;
  }
}

/**
 * Supported pane ownership state containers.
 */
export type PaneInputOwnershipState = PaneInputOwnershipArbiter | Map<string, string> | undefined;

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
 * @returns Nothing.
 */
export function releasePaneInputOwnership(
  ownershipState: PaneInputOwnershipState,
  paneId: string,
  clientId: string
): void {
  if (!ownershipState) return;
  if (ownershipState instanceof PaneInputOwnershipArbiter) {
    ownershipState.releasePaneIfOwnedBy(paneId, clientId);
    return;
  }
  if (ownershipState.get(paneId) === clientId) {
    ownershipState.delete(paneId);
  }
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
  socket: { OPEN: number; readyState: number; send: (payload: string) => void },
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

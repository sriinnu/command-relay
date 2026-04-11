/**
 * @file Host-authoritative runtime metadata builder for list_sessions responses.
 */

/**
 * Capability flags surfaced by host runtime metadata for list_sessions.
 */
export interface SessionListRuntimeCapabilities {
  laneOwnership: boolean;
  replayOffset: boolean;
  inputOwnershipOverride: boolean;
}

/**
 * Per-pane host runtime metadata returned in list_sessions payloads.
 */
export interface SessionListRuntimePaneMetadata {
  paneId: string;
  laneOwnerClientId: string | null;
  replayOffset: number;
}

/**
 * Host runtime metadata envelope returned by list_sessions.
 */
export interface SessionListRuntimeMetadata {
  source: "host";
  generatedAt: number;
  capabilities: SessionListRuntimeCapabilities;
  panes: SessionListRuntimePaneMetadata[];
}

/**
 * Input contract for building list_sessions runtime metadata.
 */
export interface BuildSessionListRuntimeMetadataParams {
  panes: Array<Record<string, unknown>>;
  laneOwnershipSnapshot: Array<{ paneId: string; ownerClientId: string }>;
  replayOffsetSnapshot: Array<{ paneId: string; replayOffset: number }>;
  capabilities: SessionListRuntimeCapabilities;
  generatedAt?: number;
}

/**
 * Builds deterministic host runtime metadata for list_sessions payloads.
 *
 * @param params Runtime metadata build inputs.
 * @returns Host-authoritative runtime metadata payload.
 */
export function buildSessionListRuntimeMetadata(
  params: BuildSessionListRuntimeMetadataParams
): SessionListRuntimeMetadata {
  const laneOwners = new Map<string, string>();
  for (const row of params.laneOwnershipSnapshot) {
    if (typeof row.paneId !== "string" || typeof row.ownerClientId !== "string") continue;
    laneOwners.set(row.paneId, row.ownerClientId);
  }

  const replayOffsets = new Map<string, number>();
  for (const row of params.replayOffsetSnapshot) {
    if (typeof row.paneId !== "string" || typeof row.replayOffset !== "number") continue;
    replayOffsets.set(row.paneId, row.replayOffset);
  }

  const seenPaneIds = new Set<string>();
  const paneRuntime: SessionListRuntimePaneMetadata[] = [];
  for (const pane of params.panes) {
    const paneId = typeof pane.paneId === "string" ? pane.paneId : null;
    if (!paneId || seenPaneIds.has(paneId)) continue;
    seenPaneIds.add(paneId);
    paneRuntime.push({
      paneId,
      laneOwnerClientId: laneOwners.get(paneId) ?? null,
      replayOffset: replayOffsets.get(paneId) ?? 0
    });
  }

  return {
    source: "host",
    generatedAt: params.generatedAt ?? Date.now(),
    capabilities: params.capabilities,
    panes: paneRuntime
  };
}

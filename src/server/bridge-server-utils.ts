/**
 * @file Utility helpers for bridge server message handling.
 */

import { timingSafeEqual } from "node:crypto";

/**
 * Sends an envelope over WebSocket when writable.
 *
 * @param socket WebSocket instance.
 * @param message Envelope payload.
 * @returns Nothing.
 */
export function sendEnvelope(
  socket: { OPEN: number; readyState: number; send: (payload: string) => void },
  message: Record<string, unknown>
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
): Array<{ sessionName: string; paneIds: string[] }> {
  const grouped = new Map<string, string[]>();
  for (const pane of panes) {
    const sessionName = typeof pane.sessionName === "string" ? pane.sessionName : "unknown";
    const paneId = typeof pane.paneId === "string" ? pane.paneId : "";
    if (!paneId) continue;

    const sessionPaneIds = grouped.get(sessionName);
    if (sessionPaneIds) {
      sessionPaneIds.push(paneId);
      continue;
    }

    grouped.set(sessionName, [paneId]);
  }

  return Array.from(grouped.entries()).map(([sessionName, paneIds]) => ({
    sessionName,
    paneIds
  }));
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

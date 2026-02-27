# Controlled Input Audit Contract

Last updated: 2026-02-27

This document defines the structured audit metadata contract for controlled input operations and replay reconnect audit actions.

## Event Shape

1. Each record is JSONL with top-level fields: `ts`, `action`, `clientId`, `details`.
2. `ts` is epoch milliseconds assigned by the bridge process.

## Actions

1. `enable_input`:
   - `details.result`: `allowed` or `denied`
   - `details.reason`: `client_enabled` or `global_input_kill_switch`
2. `disable_input`:
   - `details.result`: `allowed`
   - `details.reason`: `client_disabled`
3. `input`:
   - success: `details.result=allowed`, `details.reason=ok`
   - policy/rate/ownership denial: `details.result=denied`, `details.reason` in:
     - `policy_blocked`
     - `rate_limited`
     - `ownership_conflict`
   - shared metadata:
     - `details.paneId`
     - `details.bytes`
     - `details.commandHash`: SHA-256 digest of submitted UTF-8 input when present, otherwise `null`
     - `details.previewPolicy`: `sha256_only` when input payload exists, otherwise `none`
4. `input_takeover`:
   - emitted when override path is used and lane ownership changes
   - includes `details.paneId`, `details.bytes`, `details.result=allowed`, `details.reason=override`
5. `lane_owner_released`:
   - emitted when a client loses ownership of one or more input lanes due to cleanup/release paths
   - detach path: `details.paneId`, `details.result=allowed`, `details.reason=detach`
   - disconnect/close path: `details.releasedPanes`, `details.result=allowed`, `details.reason` in:
     - `disconnect`
     - `socket_close`
6. `replay_resume` (contract):
   - emitted on `attach` when `lastSeq` is provided and replay emits one or more historical events
   - includes:
     - `details.paneId`
     - `details.lastSeq`
     - `details.replayedCount`
     - `details.replayStartSeq`
     - `details.replayEndSeq`
     - `details.result=allowed`
     - `details.reason=resume`
7. `replay_gap_snapshot_fallback` (contract):
   - emitted on `attach` when `lastSeq` is provided but replay cannot be served as a continuous resume window and host falls back to snapshot delivery
   - includes:
     - `details.paneId`
     - `details.lastSeq`
     - `details.streamSeq` (current host sequence at fallback)
     - `details.result=allowed`
     - `details.reason` in:
       - `ahead_of_stream`
       - `outside_retained_window`
       - `empty_resume_window`

## Sanitization

1. Raw command payload text is never persisted in `details`.
2. Metadata-only capture is enforced (`paneId`, byte count, result, reason, `commandHash`, `previewPolicy`).

## Implementation Status (2026-02-27)

1. `replay_resume`: runtime emission is implemented from attach flow when replay resumes with one or more historical events.
   - Current emitted details: `{ paneId, lastSeq, replayedCount, latestSeq }` ([`src/server/bridge-server.ts`](../src/server/bridge-server.ts)).
2. `replay_gap_snapshot_fallback`: runtime emission is implemented from attach flow for ahead-of-stream fallback.
   - Current emitted details: `{ paneId, lastSeq, latestSeq }` ([`src/server/bridge-server.ts`](../src/server/bridge-server.ts)).
3. Runtime assertions for both replay audit actions are in replay e2e coverage:
   - `replay_resume` assertions ([`src/server/bridge-server.replay.e2e.test.ts`](../src/server/bridge-server.replay.e2e.test.ts))
   - `replay_gap_snapshot_fallback` assertions ([`src/server/bridge-server.replay.e2e.test.ts`](../src/server/bridge-server.replay.e2e.test.ts))
4. Remaining gap to close against the full contract above: normalize emitted replay audit payload fields (`result`/`reason`, and replay range fields) if that schema is required for downstream consumers.

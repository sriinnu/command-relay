# Host-State Authority Implementation Plan

Last updated: 2026-02-27
Status: Implementation-ready
Owner lane: host runtime (`src/server/*`, `src/bridge/*`)

## Goal

Make the host runtime the single authority for:
1. Pane write-lane ownership.
2. Replay offsets (`streamSeq`, `lastSeq`) and replay ordering.
3. Auditable state transitions and recovery behavior.

Clients remain thin: they request actions and render host decisions.

## Authority Boundaries

1. Host-owned state:
   - lane owner per `paneId`
   - pane replay state (`streamSeq`, bounded history window)
   - attach/replay decisions
   - authoritative audit trail
2. Client-owned state:
   - last rendered cursor (`lastSeq`) used only as a resume hint
   - local UX state (`read_only`, `conflict`, `reconnecting`)

## Data Model and Module Ownership

## Lane Owner State (`src/server/bridge-server-utils.ts`)

`PaneInputOwnershipArbiter` becomes metadata-aware:

```ts
type LaneOwnerRecord = {
  paneId: string;
  ownerClientId: string;
  acquiredAtMs: number;
  lastInputAtMs: number;
  leaseExpiresAtMs: number;
  takeoverCount: number;
};
```

Rules:
1. First allowed `input` claims lane.
2. Owner input refreshes `lastInputAtMs` and `leaseExpiresAtMs`.
3. Non-owner input gets `input_lane_conflict` unless explicit override is requested and allowed.
4. `detach`, `disconnect`, and socket `close` release lane if owned by that client.
5. Expired lease is auto-released by host before next claim attempt.

Config knobs (add in `src/config.ts`):
1. `COMMANDRELAY_INPUT_LANE_LEASE_MS` (default: `120000`).
2. `COMMANDRELAY_INPUT_LANE_SWEEP_MS` (default: `5000`).

## Replay Offset State (`src/bridge/bridge-engine.ts`)

Per pane watcher tracks:
1. `streamSeq` (host monotonic sequence).
2. `history` (bounded, sorted by `streamSeq` on replay path).
3. `historyStartSeq`/`historyEndSeq` derived from stored events.

Attach replay algorithm:
1. Parse `lastSeq` as optional integer cursor.
2. Replay events where `streamSeq > lastSeq`.
3. If replay set is empty and watcher exists, send snapshot at current `streamSeq`.
4. If pane watcher is new, capture snapshot and start at sequence `1`.

Operational guarantees:
1. `streamSeq` is monotonic per pane watcher.
2. Replay never emits duplicates for a single attach operation.
3. If requested `lastSeq` is older than retained history, host falls back to snapshot and records a replay-gap audit event.

## Audit Schema (`src/server/audit-log.ts`)

Keep JSONL storage, add normalized schema fields under `details` for compatibility:

```json
{
  "ts": 1772179200000,
  "action": "input_takeover",
  "clientId": "client-b",
  "details": {
    "schemaVersion": 1,
    "paneId": "%1",
    "result": "allowed",
    "reason": "override",
    "ownerClientIdBefore": "client-a",
    "ownerClientIdAfter": "client-b",
    "streamSeq": 184,
    "lastSeq": 176,
    "leaseExpiresAtMs": 1772179320000
  }
}
```

Required actions:
1. `attach`, `detach`, `disconnect`
2. `enable_input`, `disable_input`
3. `input` (allowed/denied)
4. `input_takeover`
5. `lane_owner_released` (detach/disconnect/lease_expired)
6. `replay_resume` (with `lastSeq`, replayed count)
7. `replay_gap_snapshot_fallback` (requested seq outside retained window)

## Failure and Recovery Flows

| Failure | Detection | Host action | Client-visible result | Recovery |
| --- | --- | --- | --- | --- |
| Auth reject | invalid token | no state mutation | `auth_error` | re-authenticate |
| Transport drop | socket close | release lane + detach panes + clear limiter state | disconnected/reconnecting UX | reconnect, `attach(lastSeq)` |
| Stale lane owner | lease expired | auto-release before claim | previous owner loses lane silently | next writer claims or explicit takeover |
| Replay window exceeded | `lastSeq < historyStartSeq` | snapshot fallback, emit replay-gap audit | output snapshot continuity reset | client resets local buffer baseline |
| tmux poll failure | `capturePane` throws | emit `pane_poll_failed` | error event + degraded state | retry attach/reconnect with backoff |
| Audit file append failure | logger write exception | warn + continue runtime path | none (internal) | operator fixes filesystem and monitors warning rate |

## Rollout Phases

1. Phase 0: Guardrails and flags.
   - Add lease config parsing and default values.
   - Add no-op telemetry counters for replay-gap and lease-expiry events.
   - Exit: runtime boots unchanged with new flags disabled/enabled by defaults.
2. Phase 1: Lane ownership lease authority.
   - Extend `PaneInputOwnershipArbiter` metadata and expiry checks.
   - Emit `lane_owner_released` audit records.
   - Exit: ownership conflict/takeover behavior remains protocol-compatible.
3. Phase 2: Replay offset authority hardening.
   - Add replay-gap detection and `replay_resume`/`replay_gap_snapshot_fallback` audit events.
   - Preserve current `attach` + `output` wire contract.
   - Exit: reconnect behavior unchanged for clients, with new audit observability.
4. Phase 3: Failure/recovery enforcement.
   - Add lease sweeper timer and deterministic close-path cleanup assertions.
   - Validate degraded behavior for tmux poll failures and reconnect loops.
   - Exit: no leaked lane owners after disconnect/restart simulations.
5. Phase 4: Rollout and gate.
   - Enable in staging, run flaky-network soak, then promote to production.
   - Exit: all test gates green and audit schema consumed by ops tooling.

## Test Plan (Release Gate)

Unit:
1. `src/server/bridge-server-utils.test.ts`:
   - claim/refresh/release/lease-expire behaviors
   - override + takeover transitions
2. `src/bridge/bridge-engine.replay.test.ts`:
   - ordered replay `streamSeq > lastSeq`
   - replay-gap fallback when `lastSeq` predates retained history

Integration:
1. `src/server/bridge-server.policy.test.ts`:
   - reconnect remains read-only until explicit enable
   - stale owner expires and new owner can write
   - takeover emits both `input` and `input_takeover` audit records
2. `src/server/bridge-server.replay.e2e.test.ts`:
   - disconnect/reconnect with `lastSeq`
   - no duplicate replay on repeated reconnect

Operational/soak:
1. 30-minute flaky-network run with repeated reconnect and lane handoff.
2. Assert:
   - zero out-of-order `streamSeq` per pane
   - zero duplicate replay events per reconnect
   - no orphaned lane owners after disconnect churn
   - replay-gap events remain below agreed SLO threshold

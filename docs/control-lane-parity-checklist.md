# iOS/Web Control-Lane Parity Checklist

Last updated: 2026-02-25
Owner: iOS/web parity doc owner

## Purpose

Use this checklist to validate that iOS and web control-lane flows behave the same against gateway v1 semantics.

Scope:
1. Connect/auth/list/attach/replay.
2. Guarded input (`enable_input` -> `input` -> `disable_input`).
3. Lane conflict, explicit takeover, and ownership release on `detach`/`disconnect`.

Weekly checkpoint expectation:
1. Every `P0` row has green automated coverage.
2. Every `P0` row has at least one fresh manual run note (iOS + web).
3. Any `Gap` row is tracked in `TODO.md` and `docs/roadmap-native.md`.

## Automated Test Commands

Run these suites before manual parity passes:

```bash
node --import tsx --test src/protocol.conformance.test.ts
node --import tsx --test src/server/ws-contract-matrix.test.ts src/server/bridge-server.policy.test.ts src/server/input-policy.test.ts
node --import tsx --test src/server/bridge-server.e2e.test.ts src/server/bridge-server.replay.e2e.test.ts
node --import tsx --test src/bridge/bridge-engine.replay.test.ts
cd apps/ios/M0ProtocolMockClient && swift test
```

## Parity Matrix (Control Lane)

Legend:
1. `Covered`: automated coverage exists and manual verification is defined.
2. `Partial`: some automation exists but parity-specific fixture is still missing.
3. `Gap`: manual-only right now.

| ID | Priority | Flow | Expected parity behavior | Automated mapping | Manual mapping | Status |
| --- | --- | --- | --- | --- | --- | --- |
| CL-01 | P0 | Connect + hello | iOS/web receive `hello` with consistent safety baseline (`inputEnabled=false` by default). | `src/server/bridge-server.e2e.test.ts` (`startBridgeServer e2e covers hello/auth/list/attach/input flow`) | `MAN-01` | Covered |
| CL-02 | P0 | Auth success/failure | Same auth gate behavior and failure handling for invalid token. | `src/server/bridge-server.e2e.test.ts`; `src/server/ws-contract-matrix.test.ts` strict/runtime parse coverage | `MAN-01` | Covered |
| CL-03 | P0 | Session list | `list_sessions` produces stable session/pane shape consumed by both clients. | `src/server/bridge-server.e2e.test.ts` | `MAN-01` | Covered |
| CL-04 | P0 | Attach read-only | `attach` acks and streams read-only output snapshot/delta before any input. | `src/server/bridge-server.e2e.test.ts` | `MAN-01` | Covered |
| CL-05 | P0 | Replay resume | `attach(lastSeq)` replays only missing output; no duplicates/out-of-order. | `src/server/bridge-server.replay.e2e.test.ts`; `src/bridge/bridge-engine.replay.test.ts`; `apps/ios/M0ProtocolMockClient/Tests/M0ProtocolMockClientTests/M0ReplayTests.swift` | `MAN-02` | Covered |
| CL-06 | P0 | Enable input | Input only becomes sendable after explicit `enable_input` and `policy_update.inputEnabled=true`. | `src/server/ws-contract-matrix.test.ts` (`enable -> input -> disable`); `src/server/bridge-server.policy.test.ts` | `MAN-03` | Covered |
| CL-07 | P0 | Disable input | `disable_input` returns both clients to read-only state and blocks `input`. | `src/server/ws-contract-matrix.test.ts`; `src/server/bridge-server.policy.test.ts` | `MAN-03` | Covered |
| CL-08 | P0 | Kill switch | Global kill switch keeps read-only even after enable attempts. | `src/server/ws-contract-matrix.test.ts` (`enforces global kill switch`); `src/server/bridge-server.policy.test.ts`; `apps/ios/M0ProtocolMockClient/Tests/M0ProtocolMockClientTests/M2ControlledInputPolicyStateMachineTests.swift` | `MAN-04` | Covered |
| CL-09 | P0 | Lane conflict | First writer owns pane; second writer gets `input_lane_conflict` without explicit takeover. | `src/server/bridge-server.policy.test.ts` (`establishes first input owner`); `src/server/ws-contract-matrix.test.ts` (`arbitrates pane input ownership across clients`); `src/server/bridge-server.e2e.test.ts` (`arbitrates pane input ownership and releases on detach/disconnect`) | `MAN-05` | Covered |
| CL-10 | P0 | Explicit takeover | Non-owner can take lane only with explicit override (`override=true` / `takeOwnership=true`). | `src/server/bridge-server.policy.test.ts` (`override takes pane ownership`, `fixture scenario iOS writer -> web takeover`, `fixture scenario web writer -> iOS takeover`); `src/server/ws-contract-matrix.test.ts`; `src/server/bridge-server.e2e.test.ts` | `MAN-05`, `MAN-06` | Covered |
| CL-11 | P0 | Ownership release | Owner `detach`/`disconnect` releases lane and allows other client to write without override. | `src/server/bridge-server.policy.test.ts` (`releases ownership on detach and disconnect`); `src/server/bridge-server.e2e.test.ts` | `MAN-05` | Covered |
| CL-12 | P1 | Web multi-tab semantics | Two browser tabs behave like two independent clients for lane arbitration. | `src/server/bridge-server.e2e.test.ts` two-client websocket flow (proxy for multi-tab behavior) | `MAN-06` | Partial |
| CL-13 | P0 | Named cross-client fixtures | Explicit fixture scenarios exist for iOS writer -> web takeover and web writer -> iOS takeover. | `src/server/bridge-server.policy.test.ts` (`fixture scenario iOS writer -> web takeover`, `fixture scenario web writer -> iOS takeover`) | `MAN-05`, `MAN-06` required each checkpoint | Covered |

## Manual Scenarios

Reference setup:
1. Gateway running with deterministic fixture pane (see `scripts/tmux-fixtures` runbook).
2. iOS client connected to same gateway/pane as web app (`/app/`).
3. Both clients authenticated and attached to same pane.

### MAN-01: Connect/Auth/List/Attach Baseline (iOS + web)

1. Connect web UI and authenticate.
2. Connect iOS client and authenticate.
3. On both clients, list sessions and attach same pane.
4. Verify both show read-only baseline and pane output.

Evidence:
1. Screenshot or short log note showing attached pane id on both clients.
2. Session/pane identifiers match.

### MAN-02: Replay Resume

1. Attach web, capture current `streamSeq` from output/log.
2. Disconnect web and generate additional pane output externally.
3. Reconnect web with replay cursor path (app auto-resume via `lastSeq` state).
4. Verify resumed output contains only missing chunks and no duplicates.
5. Repeat once from iOS path (disconnect/reconnect).

Evidence:
1. Before/after output excerpt with sequence continuity note.

### MAN-03: Guarded Enable/Disable Input

1. From web, enable input and wait for policy confirmation.
2. Send one benign command and verify ack/success.
3. Disable input and verify further send is blocked.
4. Repeat enable/send/disable from iOS.

Evidence:
1. Ack/error codes captured in command history/log.

### MAN-04: Kill Switch Safety

1. Restart gateway with `COMMANDRELAY_INPUT_KILL_SWITCH=on`.
2. Attempt enable/send from web and iOS.
3. Verify both remain read-only and receive `input_disabled` semantics.

Evidence:
1. Policy or error snapshots for both clients.

### MAN-05: iOS Writer -> Web Conflict/Takeover

1. iOS enables input and sends first command (claims lane).
2. Web sends command without override and receives conflict.
3. Web retries with override takeover and succeeds.
4. iOS follow-up command without override is now blocked.

Evidence:
1. Conflict code and takeover success captured.
2. Lane owner transition noted.

### MAN-06: Web Writer -> iOS Conflict/Takeover + Multi-Tab Check

1. Web tab A enables input and sends first command (claims lane).
2. iOS send without override is blocked (or second web tab blocked).
3. iOS (or tab B) retries with override and succeeds.
4. Original owner is blocked until takeover or release.
5. Owner disconnects/detaches, then other client sends without override successfully.

Evidence:
1. Conflict, takeover, and release events logged in order.

## Open Coverage Gaps

1. Add browser-driven web multi-tab automation beyond websocket probe parity.
2. After multi-tab automation lands, move `CL-12` to `Covered`.

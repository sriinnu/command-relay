# Operations

This document covers runtime operations for a home-machine deployment.

## Runtime Supervision

Use `launchd` on macOS to keep the bridge daemon running across reboot/logouts.

Proxy-aware outbound behavior is supported through standard env vars:

1. `HTTP_PROXY`
2. `HTTPS_PROXY`
3. `ALL_PROXY`
4. `NO_PROXY`

## Local Chitragupta Bootstrap + Health

Use the local scripts in `scripts/chitragupta` to validate and run MCP safely.

Bootstrap (dependencies + entrypoint readiness):

```bash
cd /mnt/c/sriinnu/personal/Kaala-brahma/terminal
scripts/chitragupta/bootstrap.sh \
  --chitragupta-dir /mnt/c/sriinnu/personal/Kaala-brahma/chitragupta \
  --project /mnt/c/sriinnu/personal/Kaala-brahma/terminal
```

Health diagnostics (includes `--check` from MCP entrypoint):

```bash
cd /mnt/c/sriinnu/personal/Kaala-brahma/terminal
scripts/chitragupta/health.sh \
  --chitragupta-dir /mnt/c/sriinnu/personal/Kaala-brahma/chitragupta \
  --project /mnt/c/sriinnu/personal/Kaala-brahma/terminal
```

Start command (EPERM-safe, uses `node --import tsx`):

```bash
cd /mnt/c/sriinnu/personal/Kaala-brahma/terminal
scripts/chitragupta/start-mcp.sh \
  --chitragupta-dir /mnt/c/sriinnu/personal/Kaala-brahma/chitragupta \
  --project /mnt/c/sriinnu/personal/Kaala-brahma/terminal \
  --name terminal
```

Operational notes:

1. `start-mcp.sh` avoids direct `tsx` execution to prevent `EPERM`.
2. If `tsx` is unavailable, it falls back to `packages/cli/dist/mcp-entry.js` when present.
3. Keep `CHITRAGUPTA_MCP_AGENT=true` and `CHITRAGUPTA_MCP_PROJECT=/mnt/c/sriinnu/personal/Kaala-brahma/terminal`.

## Missing `tsx` Recovery (Tonight Path: 2026-02-25)

Use this exact sequence to restore agentic capability tonight:

```bash
cd /mnt/c/sriinnu/personal/Kaala-brahma/chitragupta
pnpm install
pnpm exec node -p "require.resolve('tsx/package.json')"
cd /mnt/c/sriinnu/personal/Kaala-brahma/terminal
scripts/chitragupta/start-mcp.sh \
  --chitragupta-dir /mnt/c/sriinnu/personal/Kaala-brahma/chitragupta \
  --project /mnt/c/sriinnu/personal/Kaala-brahma/terminal \
  --name terminal
```

If `tsx` is still missing after `pnpm install`:

```bash
cd /mnt/c/sriinnu/personal/Kaala-brahma/chitragupta
pnpm add -D tsx
pnpm exec node -p "require.resolve('tsx/package.json')"
```

## Protocol Contract Test Matrix Execution

Run the strict v1 protocol matrix from the terminal repo root:

```bash
cd /mnt/c/sriinnu/personal/Kaala-brahma/terminal
node --import tsx --test src/protocol.conformance.test.ts
```

Coverage baseline:

1. Envelope construction and parse behavior.
2. Strict v1 required event matrix: `auth`, `list_sessions`, `attach`, `output`, `input`, `ack`, `error`, `heartbeat`, `policy_update`.
3. Rejection matrix: unsupported type, invalid version/timestamp/payload/requestId, missing required requestId, and oversized messages (>64 KiB).

Use this suite as the protocol gate before merging schema changes.

## Batch Outcomes Snapshot (2026-02-25)

Tonight's validation scope for the iOS controlled-input baseline is:

1. App shell artifact set in `apps/ios/CommandRelay` (`AppRootView`, `AuthGateView`, `SessionListView`, `ReadOnlyStreamView`).
2. Domain/transport contracts in `CommandRelayKit` (`AuthSessionServicing`, `SessionListServicing`, `ReadOnlyStreamServicing`, `ControlledInputServicing`, `RelayTransportClient`).
3. Replay behavior in `M0ProtocolMockClient` (`M0ReplayPlanner`, `M0MockClient.reconnect()`, `M0ReplayTests`).
4. Gateway protocol compatibility gates (`src/protocol.conformance.test.ts`, `src/server/ws-contract-matrix.test.ts`).

## iOS Live Mode (M1/M2 Baseline)

Enable live websocket services in iOS by exporting:

```bash
export COMMANDRELAY_WS_URL="ws://<tailscale-or-lan-ip>:8787/ws"
export COMMANDRELAY_AUTH_TOKEN="<token-if-enabled>"
export COMMANDRELAY_WS_TIMEOUT_MS="8000"
```

Behavior:

1. `COMMANDRELAY_WS_URL` present -> app uses websocket-backed `SessionListServicing`, `ReadOnlyStreamServicing`, and `ControlledInputServicing`.
2. `COMMANDRELAY_WS_URL` absent -> app remains on stub services.
3. Input remains opt-in in UI: `enable_input` is explicit, `disable_input` is available, and `input` is guarded by policy state.

## Tonight on Mac (Exact iOS Spike Command Pack - 2026-02-25)

Run in this exact order:

```bash
cd /mnt/c/sriinnu/personal/Kaala-brahma/terminal
node -v
npm -v
tmux -V
swift --version
xcodebuild -version
xcodegen --version
npm ci

test -f apps/ios/CommandRelay/CommandRelayApp/App/AppRootView.swift
test -f apps/ios/CommandRelay/CommandRelayApp/Features/Auth/AuthGateView.swift
test -f apps/ios/CommandRelay/CommandRelayApp/Features/Sessions/SessionListView.swift
test -f apps/ios/CommandRelay/CommandRelayApp/Features/Stream/ReadOnlyStreamView.swift
test -f apps/ios/CommandRelay/Packages/CommandRelayKit/Sources/TransportKit/Interfaces/RelayTransportClient.swift
test -f apps/ios/M0ProtocolMockClient/Tests/M0ProtocolMockClientTests/M0ReplayTests.swift

cd /mnt/c/sriinnu/personal/Kaala-brahma/terminal/apps/ios/CommandRelay
xcodegen generate
xcodebuild -list -project CommandRelay.xcodeproj
xcodebuild -project CommandRelay.xcodeproj -scheme CommandRelay -destination 'generic/platform=iOS Simulator' build

cd /mnt/c/sriinnu/personal/Kaala-brahma/terminal/apps/ios/CommandRelay/Packages/CommandRelayKit
swift test

cd /mnt/c/sriinnu/personal/Kaala-brahma/terminal/apps/ios/M0ProtocolMockClient
swift test --filter M0ReplayTests
swift test

cd /mnt/c/sriinnu/personal/Kaala-brahma/terminal
node --import tsx --test src/protocol.conformance.test.ts
node --import tsx --test src/server/ws-contract-matrix.test.ts
```

Pass/fail gate:

1. All command exits are `0`.
2. No Swift test failures in `CommandRelayKit` and `M0ProtocolMockClient`.
3. Both Node protocol suites end with `# fail 0`.
4. Any failure blocks nightly acceptance of the iOS controlled-input baseline artifacts.

Strict protocol toggle guidance:

1. Live bridge strict mode is controlled by `COMMANDRELAY_STRICT_PROTOCOL_PARSING` (`true` by default); legacy alias `COMMANDRELAY_STRICT_V1` is also supported.
2. The parser flag (`strictV1: true`) remains useful for local deterministic parse checks in ad-hoc CLI scripts.
3. Use strict-mode suites (`src/protocol.conformance.test.ts`, `src/server/ws-contract-matrix.test.ts`) as the authoritative nightly contract gate.

Kill-switch toggle guidance (runtime config sanity):

1. `COMMANDRELAY_INPUT_KILL_SWITCH=true` means global input is forcibly disabled.
2. `COMMANDRELAY_INPUT_KILL_SWITCH=off` means input can be session-enabled.
3. Invalid values fail startup with:

```text
COMMANDRELAY_INPUT_KILL_SWITCH must be one of: 1,true,yes,on,0,false,no,off
```

## Controlled-Input Operator Runbook (Tonight - 2026-02-25)

This runbook verifies:

1. `enable_input` can transition policy to input-enabled when kill switch is off.
2. `input` is accepted only while input-enabled.
3. `disable_input` returns policy to read-only and blocks later `input`.
4. Kill switch blocks `enable_input` and all `input`.

### A) Contract and policy gate (fast verification)

```bash
cd /mnt/c/sriinnu/personal/Kaala-brahma/terminal
node --import tsx --test src/server/ws-contract-matrix.test.ts src/server/bridge-server.policy.test.ts src/server/startup-validation.test.ts
```

Pass signal:

1. Test run ends with `# fail 0`.
2. `ws-contract-matrix` includes `enable -> input -> disable` and kill-switch policy assertions.

### B) Live smoke with kill switch off (input should work)

Terminal 1:

```bash
cd /mnt/c/sriinnu/personal/Kaala-brahma/terminal
COMMANDRELAY_INPUT_KILL_SWITCH=off npm run start
```

Terminal 2:

```bash
cd /mnt/c/sriinnu/personal/Kaala-brahma/terminal
npm run bench:input -- --iterations 5
```

Pass signal:

1. Benchmark exits `0`.
2. Output includes input ack latency summary.

### C) Live smoke with kill switch on (input must be blocked)

Terminal 1 (restart bridge):

```bash
cd /mnt/c/sriinnu/personal/Kaala-brahma/terminal
COMMANDRELAY_INPUT_KILL_SWITCH=on npm run start
```

Terminal 2:

```bash
cd /mnt/c/sriinnu/personal/Kaala-brahma/terminal
npm run bench:input -- --iterations 3
```

Pass signal:

1. Benchmark exits non-zero.
2. Failure message reports that input remained disabled after `enable_input` (kill switch effective).

## iOS Protocol Mock Package Usage

The M0 iOS contract mock package lives at:

```text
/mnt/c/sriinnu/personal/Kaala-brahma/terminal/apps/ios/M0ProtocolMockClient
```

Run local package tests:

```bash
cd /mnt/c/sriinnu/personal/Kaala-brahma/terminal/apps/ios/M0ProtocolMockClient
swift test
```

What this validates:

1. Typed envelope/event encode-decode round trips.
2. Snake_case JSON contract keys for resume requests.
3. Replay planning from `lastSeq` and reconnect generation (`M0MockClient.reconnect()`).

## Health Signals

1. Process up/down state.
2. Active WebSocket connections.
3. Session discovery success/failure counts.
4. Input dispatch latency.
5. Reconnect and replay success rate.

## Logs

Minimum log fields:

1. Timestamp.
2. Actor/session identity.
3. Event type.
4. Target pane/session.
5. Success/failure and error details.

## SLO Suggestions

1. p95 input-to-echo latency under 300ms on private mesh.
2. Reconnect recovery under 5 seconds.
3. Zero unauthorized input events.

## Backup and Recovery

1. Persist config and auth material securely.
2. Persist replay metadata for short reconnect windows.
3. Keep reproducible launch config for quick re-provisioning.

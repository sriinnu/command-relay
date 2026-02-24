# Operations

This document covers runtime operations for a home-machine deployment.

## Runtime Supervision

Use `launchd` on macOS to keep the bridge daemon running across reboot/logouts.

Proxy-aware outbound behavior is supported through standard env vars:

1. `HTTP_PROXY`
2. `HTTPS_PROXY`
3. `ALL_PROXY`
4. `NO_PROXY`

## Local MCP Startup Workaround (tsx EPERM)

When starting local chitragupta MCP, direct `tsx` execution can fail with `EPERM` in some environments. Use Node with the `tsx` import hook instead.

Recommended command:

```bash
pnpm --dir /mnt/c/sriinnu/personal/Kaala-brahma/chitragupta exec node --import tsx packages/cli/src/mcp-entry.ts --stdio --project /mnt/c/sriinnu/personal/Kaala-brahma/terminal --agent
```

Operational notes:

1. This command is the baseline used in `.mcp.json`.
2. Keep `CHITRAGUPTA_MCP_AGENT=true` and `CHITRAGUPTA_MCP_PROJECT=/mnt/c/sriinnu/personal/Kaala-brahma/terminal`.
3. If you see `EPERM` and the process exits early, verify you are not using `pnpm ... exec tsx ...`.

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

## Batch Outcomes Snapshot (2026-02-24)

This batch locked four outcomes used as tonight's validation scope:

1. iOS transport layer contract is defined in `RelayTransportClient` and `RelayTransportState`.
2. Android parity module boundary is documented (`core:protocol` + `core:transport` + `core:auth` + `data:repository`).
3. tmux fixture harness is active in server e2e tests via `createFakeTmux()` in `src/server/bridge-server.e2e.test.ts`.
4. Replay test strategy is split into:
   - bridge replay/delta unit tests (`src/bridge/bridge-engine.test.ts`)
   - websocket contract tests (`src/server/ws-contract-matrix.test.ts`)
   - iOS mock replay tests (`apps/ios/M0ProtocolMockClient/Tests/M0ProtocolMockClientTests/M0ReplayTests.swift`)

## Tonight on Mac (Exact Command Pack - 2026-02-24)

Run in this exact order:

```bash
cd /mnt/c/sriinnu/personal/Kaala-brahma/terminal
node -v
npm -v
tmux -V
npm ci
npm run check
node --import tsx --test src/protocol.conformance.test.ts
node --import tsx --test src/bridge/bridge-engine.test.ts
node --import tsx --test src/server/bridge-server.e2e.test.ts
node --import tsx --test src/server/ws-contract-matrix.test.ts
node --import tsx --test src/server/bridge-server.policy.test.ts
node --import tsx --test src/server/startup-validation.test.ts
cd /mnt/c/sriinnu/personal/Kaala-brahma/terminal/apps/ios/M0ProtocolMockClient
swift test --filter M0ReplayTests
swift test
```

Tonight pass criteria:

1. Every Node test command ends with `# fail 0`.
2. `src/server/bridge-server.e2e.test.ts` passes (verifies tmux fixture harness flow for hello/auth/list/attach/input).
3. `swift test --filter M0ReplayTests` passes (verifies reconnect resume cursor and replay window behavior).
4. Full `swift test` passes for package-wide regression coverage.

## Mac Nightly Validation Runbook (Exact Command Order)

Run nightly from the repo root:

```bash
cd /mnt/c/sriinnu/personal/Kaala-brahma/terminal
node -v
npm -v
tmux -V
npm ci
npm run check
node --import tsx --test src/protocol.conformance.test.ts
node --import tsx --test src/server/ws-contract-matrix.test.ts
node --import tsx --test src/server/bridge-server.policy.test.ts
node --import tsx --test src/server/startup-validation.test.ts
node --import tsx -e 'import { parseMessage } from "./src/protocol.ts"; const raw = JSON.stringify({ v: 1, type: "unknown_future_type", timestamp: 1_771_934_131_735, payload: {} }); console.log("STRICT_OFF", JSON.stringify(parseMessage(raw))); console.log("STRICT_ON", JSON.stringify(parseMessage(raw, { strictV1: true })));'
```

Expected output checks:

1. Every `node --test ...` command ends with:

```text
# pass 1
# fail 0
```

2. Strict protocol toggle command prints:

```text
STRICT_OFF {"ok":true,...}
STRICT_ON {"ok":false,"error":"unsupported_type"}
```

3. If any test shows `# fail 1` (or more), treat nightly as failed and block protocol/runtime merges until fixed.

Strict protocol toggle guidance:

1. Live bridge strict mode is controlled by `COMMANDRELAY_STRICT_PROTOCOL_PARSING` (`true` by default); legacy alias `COMMANDRELAY_STRICT_V1` is also supported.
2. The parser flag (`strictV1: true`) remains useful for local deterministic checks like the toggle command above.
3. Use strict-mode suites (`src/protocol.conformance.test.ts`, `src/server/ws-contract-matrix.test.ts`) as the authoritative nightly contract gate.

Kill-switch toggle guidance (runtime config sanity):

1. `COMMANDRELAY_INPUT_KILL_SWITCH=true` means global input is forcibly disabled.
2. `COMMANDRELAY_INPUT_KILL_SWITCH=off` means input can be session-enabled.
3. Invalid values fail startup with:

```text
COMMANDRELAY_INPUT_KILL_SWITCH must be one of: 1,true,yes,on,0,false,no,off
```

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

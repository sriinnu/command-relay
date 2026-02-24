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

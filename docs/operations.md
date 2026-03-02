# Operations

This document covers runtime operations for a home-machine deployment.

## Runtime Supervision

Use `launchd` on macOS to keep the bridge daemon running across reboot/logouts.

Proxy-aware outbound behavior is supported through standard env vars:

1. `HTTP_PROXY`
2. `HTTPS_PROXY`
3. `ALL_PROXY`
4. `NO_PROXY`

Runtime backend selection is controlled by `COMMANDRELAY_RUNTIME_BACKENDS`:

1. Default: `tmux`
2. Multi-backend example: `tmux,cmux`
3. Supported backend values: `tmux`, `cmux`
4. In multi-backend mode, pane IDs are backend-namespaced (for example `tmux:%1`, `cmux:<pane-id>`). tmux-only mode keeps existing tmux pane IDs.
5. When `COMMANDRELAY_TRANSPORT_MODE=ssh`, runtime backends must be tmux-only (`COMMANDRELAY_RUNTIME_BACKENDS=tmux`).

`cmux` executable override:

1. `COMMANDRELAY_CMUX_COMMAND` sets the command/path used for the cmux backend.
2. Default is `cmux`; whitespace-only values fall back to `cmux`.

Startup availability behavior:

1. Bridge startup probes each configured backend and logs per-backend availability.
2. Unavailable backends are logged as warnings.
3. Startup fails only when every configured backend is unavailable and runtime mode is not tmux-only.
4. tmux-only startup behavior is unchanged.

SSH transport startup env contract:

1. `COMMANDRELAY_TRANSPORT_MODE` accepts `ws` (default) or `ssh`.
2. `COMMANDRELAY_SSH_PROFILE` selects the SSH profile name; default is `primary` only when unset. If provided, it must be non-empty and match `[A-Za-z0-9._-]+`.
3. `COMMANDRELAY_SSH_TARGET` is required when `COMMANDRELAY_TRANSPORT_MODE=ssh`; format must match `[user@]host` where host is `letters/numbers/._-` or bracketed IPv6.
4. `COMMANDRELAY_SSH_COMMAND` overrides the SSH executable/command; default is `ssh`.
5. `COMMANDRELAY_SSH_PORT` defaults to `22`; when set, it must be an integer in range `1..65535`.
6. `COMMANDRELAY_SSH_CONNECT_TIMEOUT_SECONDS` sets SSH connect/runtime command timeout in seconds; default is `8`, valid range is `1..60`.
7. `COMMANDRELAY_SSH_STRICT_HOST_KEY_CHECKING` defaults to `true` and accepts `1,true,yes,on,0,false,no,off`.
8. `COMMANDRELAY_SSH_KNOWN_HOSTS_FILE` optionally selects the known_hosts file used for host key checks in strict mode.
9. `COMMANDRELAY_SSH_EXPECTED_FINGERPRINT_SHA256` optionally pins host trust to one fingerprint (`SHA256:<base64>`).
10. Startup preflight for `ssh` mode runs `<COMMANDRELAY_SSH_COMMAND> -V` and requires a version string; missing/unusable SSH command fails startup.
11. Startup preflight validates trust controls and fails fast for malformed fingerprint values or unreadable known_hosts file paths.
12. After preflight, `ssh` mode executes tmux runtime operations on the remote SSH target in non-interactive mode (`-T`, `BatchMode=yes`).
13. When strict host key checking is disabled, runtime suppresses known_hosts writes (`UserKnownHostsFile=/dev/null`).
14. `ssh` mode requires `COMMANDRELAY_RUNTIME_BACKENDS=tmux`.

Format examples:

1. Valid SSH targets: `relay@example.internal`, `example.internal`, `ops@[2001:db8::1]`.
2. Invalid SSH targets: `relay target`, `relay@@example`, `ops@`.
3. Valid SSH profiles: `primary`, `primary.ops-1_2`.
4. Invalid SSH profiles: `primary/profile`, `   `.

SSH trust model interplay and failure actions:

1. `strict=true` + no expected fingerprint: host trust comes from known_hosts verification (`COMMANDRELAY_SSH_KNOWN_HOSTS_FILE` when set, SSH defaults when unset).
2. `strict=true` + expected fingerprint: both host key verification and fingerprint match must pass.
3. `strict=false` + no expected fingerprint: use only in controlled diagnostics; host identity is not strongly verified.
4. `strict=false` + expected fingerprint: invalid configuration; startup rejects because fingerprint pinning requires strict host key checking.
5. Treat `known_hosts_unreadable`, `host_key_verification_failed`, `expected_fingerprint_mismatch`, and `expected_fingerprint_unavailable` as fail-fast startup errors requiring operator intervention.

## SSH-First Tunnel Runbook

Use the local helper at [`scripts/ssh/open-tunnel.sh`](../scripts/ssh/open-tunnel.sh) to reach a remote CommandRelay instance over SSH before exposing any direct network listener.

Quick start (macOS/Linux):

```bash
cd /mnt/c/sriinnu/personal/Kaala-brahma/terminal
./scripts/ssh/open-tunnel.sh --target <user@host>
```

Tunnel defaults:

1. Local endpoint: `127.0.0.1:8787`
2. Remote endpoint: `127.0.0.1:8787`
3. Local URLs: `http://127.0.0.1:8787` and `ws://127.0.0.1:8787/ws`

For extra examples and option details, see [`scripts/ssh/README.md`](../scripts/ssh/README.md).

## SSH Runtime Validator Reference

Use [`scripts/ssh/validate-remote-runtime.sh`](../scripts/ssh/validate-remote-runtime.sh) before relying on remote tmux runtime operations.

Quick check:

```bash
cd /mnt/c/sriinnu/personal/Kaala-brahma/terminal
./scripts/ssh/validate-remote-runtime.sh --target <user@host>
```

Behavior:

1. Uses a single non-interactive SSH command set to check `tmux` and `node`.
2. Supports strict host key checking toggle (`--strict-host-key-checking on|off`), timeout, identity, and repeatable `--ssh-option`.
3. Prints concise `PASS`/`FAIL` lines and returns deterministic exit codes (`0`, `2`, `3`, `4`).

## Web App Runtime Surface and Checks

Implemented gateway routes:

1. `GET /health` (exact path) returns health/status JSON.
2. `GET /` and `GET /app` return `308` redirects to `/app/`; `GET /app/` and `GET /app/<path>` serve static app content when `COMMANDRELAY_APP_STATIC_ENABLED=true` (default).
3. Static files are served from `COMMANDRELAY_APP_STATIC_DIR` (`apps/web` default); missing/forbidden targets return `404` (`error=not_found`).
4. WebSocket upgrade is accepted only on exact path `/ws`.
5. Other HTTP routes return `404` (`error=not_found`), and non-`/ws` upgrades are rejected.

Quick checks:

```bash
curl -sS http://127.0.0.1:8787/health
curl -i http://127.0.0.1:8787/app/
curl -i http://127.0.0.1:8787/does-not-exist
```

## Web Auth Token Operations

1. `COMMANDRELAY_AUTH_TOKEN` is validated at startup and enforced for non-loopback binds.
2. Auth is handled inside WebSocket protocol messages (`auth.payload.token`), not via HTTP `Authorization` headers.
3. Rotate tokens by updating env and restarting the bridge process.
4. Keep token values out of shell history and operator notes; audit logs store auth outcomes, not submitted token values.
5. SSH runtime hardening is always non-interactive (`-T`, `BatchMode=yes`); if strict host key checking is off, known_hosts writes are suppressed (`UserKnownHostsFile=/dev/null`).
6. For production, keep `COMMANDRELAY_SSH_STRICT_HOST_KEY_CHECKING=true` and pin `COMMANDRELAY_SSH_EXPECTED_FINGERPRINT_SHA256` when host-key rotation process is documented.

## Multi-Tab Safe Writer Operations

1. Treat each tab/window as a separate client (`hello.payload.clientId`).
2. Keep one writer per pane; others stay read-only.
3. Pane write ownership is acquired on first successful `input`.
4. Handoff: old writer `disable_input` then `detach`/`disconnect`; new writer `enable_input` and send first command.
5. Optional hardening: set `COMMANDRELAY_ALLOW_INPUT_OVERRIDE=off` to block forced ownership takeover.
6. Lease tuning: set `COMMANDRELAY_INPUT_LANE_LEASE_MS` (default `30000`, bounds `1000..300000`) to control stale-lane expiry timing.
7. Emergency freeze: restart with `COMMANDRELAY_INPUT_KILL_SWITCH=on`; resume by restarting with it off.

## Keyboard/Input Operational Notes

1. Input accepts only text payloads (`input.payload.data`).
2. Newline (`\n`) in payload is sent as Enter boundaries.
3. Very large pasted payloads can fail with `input_too_large` (default `maxInputBytes=4096`).
4. Rapid key/send loops can fail with `input_rate_limited` (`COMMANDRELAY_MAX_INPUT_PER_MIN`).

## Controlled-Input Audit Behavior

1. Controlled-input events are metadata-only (no raw command payloads).
2. Current action contract is documented in [controlled-input-audit.md](controlled-input-audit.md).

## Local Chitragupta Bootstrap + Health

Use scripts in `scripts/chitragupta` for bootstrap, health checks, and start flows.
Operational details are maintained with the script implementations to avoid drift.

## Distilled Capsule + Brief + Dispatch Operations

Use capsule + brief + dispatch generation to reduce token cost and prevent context leakage.
CLI commands: `npm run capsule:build --` (capsule JSON), `npm run capsule:brief --` (brief from capsule), and `npm run capsule:dispatch --` (dispatch payload from brief).

Policy:

1. Deterministic first (`task`, `owned files`, `expected output`).
2. Minimal context capsule only.
3. Close agents quickly after completion/stall.
4. Redact secrets before dispatch.
5. Scope each agent to owned files.

Flow:

1. Build a task capsule from goal, ownership, and scoped snippets.
2. Generate an execution brief from the capsule file.
3. Dispatch only the capsule/brief payload to the assigned agent owner.

Concrete command example:

```bash
cd /mnt/c/sriinnu/personal/Kaala-brahma/terminal
npm run capsule:build -- \
  --goal "Document capsule brief wiring in operations, docs index, and skill guide" \
  --owner docs-brief-owner \
  --path skills/termina-orchestrator/SKILL.md \
  --path docs/README.md \
  --path docs/operations.md \
  --accept "Document capsule:brief full flow after capsule build" \
  --accept "Keep examples concise and path-accurate" \
  --risk "Over-broad snippets can leak unrelated context" \
  --snippet docs/operations.md:114:155 \
  --out /mnt/c/sriinnu/personal/Kaala-brahma/terminal/.tmp/docs-brief-wiring.capsule.json

npm run capsule:brief -- \
  --capsule /mnt/c/sriinnu/personal/Kaala-brahma/terminal/.tmp/docs-brief-wiring.capsule.json \
  --task "Update docs distilled workflow section and skill references" \
  --owner docs-brief-owner \
  --path docs/operations.md \
  --path docs/README.md \
  --path skills/termina-orchestrator/SKILL.md \
  --out /mnt/c/sriinnu/personal/Kaala-brahma/terminal/.tmp/docs-brief-wiring.md

npm run capsule:dispatch -- \
  --brief /mnt/c/sriinnu/personal/Kaala-brahma/terminal/.tmp/docs-brief-wiring.md \
  --task "Update docs distilled workflow section and skill references" \
  --owner docs-brief-owner \
  --path docs/operations.md \
  --path docs/README.md \
  --path skills/termina-orchestrator/SKILL.md \
  --agent-type worker \
  --instruction "You are not alone in the codebase; respect owned file scope." \
  --out /mnt/c/sriinnu/personal/Kaala-brahma/terminal/.tmp/docs-brief-wiring.dispatch.json
```

`capsule:build` produces the constrained JSON capsule; `capsule:brief` converts that capsule into the orchestration brief payload; `capsule:dispatch` packages the brief for agent handoff.

## Missing `tsx` Recovery

Use this exact sequence to restore agentic capability:

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

## Validation Scope Snapshot

Validation scope for the iOS controlled-input baseline:

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

## iOS Spike Validation Command Pack

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

## Controlled-Input Safety Incident Runbook

Use this runbook for operator incidents in the write path: `kill-switch engaged unexpectedly` and `lane lockout` (`input_lane_conflict` blocks intended writer).

### A) Fast policy verification gate

```bash
cd /mnt/c/sriinnu/personal/Kaala-brahma/terminal
node --import tsx --test src/server/ws-contract-matrix.test.ts src/server/bridge-server.policy.test.ts src/server/startup-validation.test.ts
```

Pass signal:

1. Run ends with `# fail 0`.
2. Suites cover `enable -> input -> disable`, kill-switch enforcement, and lane/takeover policy behavior.

### B) Incident: kill switch is blocking input

1. Contain: restart bridge with `COMMANDRELAY_INPUT_KILL_SWITCH=on` to freeze all writers while triaging.
2. Verify block:

```bash
cd /mnt/c/sriinnu/personal/Kaala-brahma/terminal
npm run bench:input -- --iterations 3
```

3. Pass signal: benchmark exits non-zero and reports input disabled after `enable_input`.
4. Recover: only after explicit operator approval, restart with `COMMANDRELAY_INPUT_KILL_SWITCH=off` and re-run `npm run bench:input -- --iterations 5` (must exit `0`).

### C) Incident: lane lockout (`input_lane_conflict`)

1. Identify owner from conflict payload (`ownerClientId`) and request owner handoff (`disable_input` then `detach`/disconnect).
2. If owner is stale, wait for lease expiry (`COMMANDRELAY_INPUT_LANE_LEASE_MS`) or perform explicit takeover per policy.
3. If lockout persists across reconnects, temporarily freeze writes with kill switch (`on`), clear stale clients, then resume with kill switch (`off`).
4. Verification gate:

```bash
cd /mnt/c/sriinnu/personal/Kaala-brahma/terminal
node --import tsx --test src/server/bridge-server.policy.test.ts
```

5. Pass signal: lane conflict and takeover paths pass (`# fail 0`) and intended writer can send input after handoff.

### D) Evidence to record in checkpoint artifacts

1. Incident UTC timestamp, active commit SHA, and trigger symptom.
2. Containment action (`kill switch on/off`, handoff/takeover path) and operator identity.
3. Verification commands executed and pass/fail outcome.
4. Link the incident note in `scripts/checkpoints/runs/*-checkpoint.md`.

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

## Weekly Observability Baseline and Evidence Pack

Use [`docs/observability-evidence-contract.md`](./observability-evidence-contract.md) as the normative weekly checkpoint contract.

Required weekly artifact flow:

1. Keep all artifacts in `scripts/checkpoints/runs/` using date-prefixed filenames.
2. Produce these files for each weekly checkpoint:
   - `YYYY-MM-DD-weekly-cross-platform-checkpoint.md`
   - `YYYY-MM-DD-command-evidence.md`
   - `YYYY-MM-DD-observability-metrics.json`
   - `YYYY-MM-DD-dashboard-baseline.md`
   - `YYYY-MM-DD-soak-or-incident.md`
3. Use canonical metric names exactly as specified (`cr_connect_latency_ms`, `cr_replay_lag_events`, `cr_reconnect_total`, `cr_input_ack_latency_ms`, `cr_lane_conflict_total`, `cr_kill_switch_block_total`).
4. Record command outputs and pass signals in the command evidence file using the mapping table in the contract doc.
5. Any missing artifact must be explicitly marked `not-run` with owner and next action in the checkpoint summary.

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

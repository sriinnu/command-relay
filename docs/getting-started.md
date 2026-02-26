# Getting Started

This guide helps you run CommandRelay with a home MacBook as the first target.

## Prerequisites

1. macOS with Terminal or iTerm.
2. `tmux` installed.
3. Tailscale installed and logged in.
4. Node.js 22+ or Go 1.22+ (depending on runtime implementation).

## Local MCP Startup (Chitragupta)

Use the local MCP server command that avoids `tsx` `EPERM` startup failures:

```bash
pnpm --dir /mnt/c/sriinnu/personal/Kaala-brahma/chitragupta exec node --import tsx packages/cli/src/mcp-entry.ts --stdio --project /mnt/c/sriinnu/personal/Kaala-brahma/terminal --agent
```

If you previously used `pnpm ... exec tsx .../mcp-entry.ts`, switch to the command above.

## Session Model

Run Codex/Claude inside `tmux` so CommandRelay can discover and control sessions reliably.

## Runtime Backend Selection

Use `COMMANDRELAY_RUNTIME_BACKENDS` to select runtime backends (comma-separated).

```bash
# Default when unset:
COMMANDRELAY_RUNTIME_BACKENDS=tmux

# Multi-backend:
COMMANDRELAY_RUNTIME_BACKENDS=tmux,cmux
```

Notes:

1. Default is `tmux`.
2. Supported values are `tmux` and `cmux`.
3. In multi-backend mode, pane IDs are namespaced by backend (for example `tmux:%1`, `cmux:<pane-id>`). In tmux-only mode, existing tmux pane IDs remain unchanged.

## Web App Route Usage (Current Runtime)

The gateway is an HTTP + WebSocket server with a small route surface:

1. Health check is exact path `GET /health`.
2. Static web app hosting (default on) canonicalizes `GET /` and `GET /app` to `/app/` (`308`), then serves content from `GET /app/` and `GET /app/<path>` using `COMMANDRELAY_APP_STATIC_DIR` (`apps/web` by default).
3. Missing static assets/directories and non-matching HTTP routes return `404` (`{ "error": "not_found" }`).
4. Terminal protocol channel is `ws://<host>:<port>/ws`.
5. WebSocket upgrade path must be exact `/ws`.

## Web App Auth Token Handling

1. `COMMANDRELAY_AUTH_TOKEN` is required when binding non-loopback hosts, optional on loopback.
2. On connect, read `hello.payload.requiresAuth`.
3. If auth is required, send `auth` with `payload.token` before any other command.
4. Non-`auth` messages before successful auth return `error.code=auth_required`.
5. If auth is not required (`requiresAuth=false`), the connection is already in open mode.
6. Auth success emits `auth_ok` (`mode=token` or `mode=open`).
7. Auth is protocol-message based; do not use HTTP `Authorization` headers for `/ws`.

## Web Keyboard Workflow (Input Semantics)

1. Send text through `input.payload.data`; there is no separate keycode event type.
2. Include `\n` to execute command lines; bridge translates newline boundaries to Enter (`C-m`).
3. Multi-line payloads are sent line-by-line in order.
4. `input` is valid only after `enable_input` and for panes already attached by that client.
5. If another client owns the pane write lane, the server returns `error.code=input_lane_conflict` with owner metadata.
6. Takeover requires `input.payload.override=true` (or `takeOwnership=true`) and `COMMANDRELAY_ALLOW_INPUT_OVERRIDE=true`.

## Remote-Control Capability Status (2026-02-25)

1. Gateway controlled-input path is ready: `enable_input`, `input`, `disable_input`, and kill-switch enforcement are implemented and test-covered.
2. iOS controlled-input baseline is implemented (explicit enable/disable + send path); full Mac runtime validation is pending.
3. Pane input ownership arbitration is implemented; non-owner writes get `input_lane_conflict` unless override is requested and allowed.

## iOS Protocol Mock Package (M0)

Use `apps/ios/M0ProtocolMockClient` to validate stream envelope encoding, replay, and reconnect behavior before wiring full gateway transport.

Run package tests (macOS with Swift toolchain):

```bash
cd /mnt/c/sriinnu/personal/Kaala-brahma/terminal/apps/ios/M0ProtocolMockClient
swift test
```

Minimal usage flow in Swift:

```swift
import M0ProtocolMockClient

let client = M0MockClient(streamID: "stream-1")
_ = await client.append(event: .status(M0StatusEvent(code: "READY", message: "ready")), sentAtMs: 1)
await client.acknowledge(seq: 1)
let reconnect = await client.reconnect()
```

`reconnect.resumeRequest` and `reconnect.replayEvents` provide the contract surface for resume and replay assertions.

## Protocol Contract Test Matrix (v1)

Run the strict protocol contract suite from repo root:

```bash
cd /mnt/c/sriinnu/personal/Kaala-brahma/terminal
node --import tsx --test src/protocol.conformance.test.ts
```

The matrix validates required v1 event types:

1. `auth`
2. `list_sessions`
3. `attach`
4. `output`
5. `input`
6. `ack`
7. `error`
8. `heartbeat`
9. `policy_update`

## Tonight on Mac (iOS Read-Only Spike Validation - 2026-02-25)

Run this command pack exactly as written to validate the new iOS read-only spike artifacts.

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

Pass criteria for tonight:

1. All `test -f ...` checks exit with code `0`.
2. `xcodebuild ... build` exits `0` for scheme `CommandRelay`.
3. `swift test --filter M0ReplayTests` exits `0`.
4. Full `swift test` in both `CommandRelayKit` and `M0ProtocolMockClient` exits `0`.
5. Both Node protocol gates end with `# fail 0`.

## Tonight on Mac (Controlled-Input Verification - 2026-02-25)

Run policy gates from repo root:

```bash
cd /mnt/c/sriinnu/personal/Kaala-brahma/terminal
node --import tsx --test src/server/ws-contract-matrix.test.ts src/server/bridge-server.policy.test.ts src/server/startup-validation.test.ts
```

Live smoke for input enabled path (gateway started with kill switch off):

```bash
cd /mnt/c/sriinnu/personal/Kaala-brahma/terminal
COMMANDRELAY_INPUT_KILL_SWITCH=off npm run start
```

In a second terminal:

```bash
cd /mnt/c/sriinnu/personal/Kaala-brahma/terminal
npm run bench:input -- --iterations 5
```

Kill-switch smoke (expect blocked input):

```bash
cd /mnt/c/sriinnu/personal/Kaala-brahma/terminal
COMMANDRELAY_INPUT_KILL_SWITCH=on npm run start
```

In a second terminal:

```bash
cd /mnt/c/sriinnu/personal/Kaala-brahma/terminal
npm run bench:input -- --iterations 3
```

Expected behavior:

1. `ws-contract-matrix` covers `enable_input -> input -> disable_input` and blocked post-disable input.
2. With kill switch `off`, input benchmark exits `0`.
3. With kill switch `on`, benchmark exits non-zero after `enable_input` with input-disabled behavior.

## Multi-Client Tabs: Operator Workflow (Current Runtime)

Use this when two or more clients/tabs may attach to the same pane.

1. Attach from all clients as needed, but allow only one writer client to run `enable_input`.
2. Keep observer tabs read-only by not calling `enable_input` (or calling `disable_input` after diagnostics).
3. First successful `input` claims that pane's write lane for the writer client; other clients get `error.code=input_lane_conflict`.
4. For handoff, current writer calls `disable_input` and then `detach` or `disconnect`; next writer calls `enable_input` and sends first `input`.
5. If you want to block forced takeovers, run with `COMMANDRELAY_ALLOW_INPUT_OVERRIDE=off`.
6. If command collisions are suspected, restart with `COMMANDRELAY_INPUT_KILL_SWITCH=on`, verify no input is accepted, then restart with `off` and re-enable one writer.
7. During incident review, correlate `clientId` from `hello` with audit log `enable_input`/`disable_input`/`input` entries.

## iOS Live Environment

Set these environment variables before launching the iOS app from Xcode:

```bash
export COMMANDRELAY_WS_URL="ws://<tailscale-or-lan-ip>:8787/ws"
export COMMANDRELAY_AUTH_TOKEN="<token-if-enabled>"
export COMMANDRELAY_WS_TIMEOUT_MS="8000"
```

Runtime behavior:

1. If `COMMANDRELAY_WS_URL` is set, `AppDependencies` uses live websocket services.
2. If `COMMANDRELAY_WS_URL` is missing, the app falls back to local stubs.
3. Session rows now expose pane IDs; selected pane ID is reused by the stream tab via `@AppStorage`.

## Setup Steps

1. Create named tmux sessions for active work.
2. Start CommandRelay bridge daemon on the home machine.
3. Confirm daemon is reachable over Tailscale.
4. Open client UI and authenticate.
5. Attach to a pane and verify output streaming; enable controlled input only when needed.

## Minimal tmux Commands

```bash
tmux new -s work
tmux new-window -n codex
tmux new-window -n claude
tmux ls
```

## Expected Outcome

1. You see all active sessions/windows/panes.
2. You receive live output in the client.
3. You can send input when input mode is enabled.

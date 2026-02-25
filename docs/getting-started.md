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

## Remote-Control Capability Status (2026-02-25)

1. Gateway controlled-input path is ready: `enable_input`, `input`, `disable_input`, and kill-switch enforcement are implemented and test-covered.
2. iOS controlled-input baseline is implemented (explicit enable/disable + send path); full Mac runtime validation is pending.

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

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

## Setup Steps

1. Create named tmux sessions for active work.
2. Start CommandRelay bridge daemon on the home machine.
3. Confirm daemon is reachable over Tailscale.
4. Open client UI and authenticate.
5. Attach to a pane and enable input when needed.

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

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

## Tonight on Mac (Batch Validation Commands - 2026-02-24)

Run this command set exactly as written:

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

What this covers tonight:

1. iOS transport replay path via `M0ReplayTests`.
2. Android parity contract gate via strict protocol and websocket matrix tests.
3. tmux fixture harness via `src/server/bridge-server.e2e.test.ts`.
4. Replay delta/snapshot behavior via `src/bridge/bridge-engine.test.ts`.

## Mac Nightly Validation Checklist (Exact Order)

Run these commands in order. Do not skip or reorder.

1. Move to repo root.

```bash
cd /mnt/c/sriinnu/personal/Kaala-brahma/terminal
```

Expected output: no error.

2. Confirm toolchain versions.

```bash
node -v
npm -v
tmux -V
```

Expected output:

```text
v22.x.x
10.x.x
tmux 3.x
```

3. Install dependencies cleanly.

```bash
npm ci
```

Expected output contains `added` and no `npm ERR!`.

4. Run type check gate.

```bash
npm run check
```

Expected output contains no TypeScript errors.

5. Run strict protocol conformance matrix.

```bash
node --import tsx --test src/protocol.conformance.test.ts
```

Expected output footer:

```text
# pass 1
# fail 0
```

6. Run strict websocket contract + policy transition matrix.

```bash
node --import tsx --test src/server/ws-contract-matrix.test.ts
```

Expected output footer:

```text
# pass 1
# fail 0
```

7. Validate policy behavior for input enable/disable flow.

```bash
node --import tsx --test src/server/bridge-server.policy.test.ts
```

Expected output footer:

```text
# pass 1
# fail 0
```

8. Validate startup parsing for kill switch and auth safety checks.

```bash
node --import tsx --test src/server/startup-validation.test.ts
```

Expected output footer:

```text
# pass 1
# fail 0
```

9. Validate strict parser behavior (`strictV1` off vs on).

```bash
node --import tsx -e 'import { parseMessage } from "./src/protocol.ts"; const raw = JSON.stringify({ v: 1, type: "unknown_future_type", timestamp: 1_771_934_131_735, payload: {} }); console.log("STRICT_OFF", JSON.stringify(parseMessage(raw))); console.log("STRICT_ON", JSON.stringify(parseMessage(raw, { strictV1: true })));'
```

Expected output:

```text
STRICT_OFF {"ok":true,...}
STRICT_ON {"ok":false,"error":"unsupported_type"}
```

Strict protocol toggle guidance:

1. `STRICT_OFF` represents loose parsing (unknown message types pass through).
2. `STRICT_ON` represents strict v1 parsing (`strictV1: true`), where unsupported types are rejected.
3. Live socket strictness is controlled by `COMMANDRELAY_STRICT_PROTOCOL_PARSING` (`true` by default).

10. Optional kill-switch parse sanity.

```bash
node --import tsx -e 'import { loadConfig } from "./src/config.ts"; console.log("KILL_SWITCH_TRUE", loadConfig({ COMMANDRELAY_INPUT_KILL_SWITCH: "true" }).globalInputDisabled); console.log("KILL_SWITCH_OFF", loadConfig({ COMMANDRELAY_INPUT_KILL_SWITCH: "off" }).globalInputDisabled);'
```

Expected output:

```text
KILL_SWITCH_TRUE true
KILL_SWITCH_OFF false
```

Nightly pass criteria:

1. Step 4 exits cleanly.
2. Steps 5-8 each show `# fail 0`.
3. Step 9 shows `STRICT_OFF ok:true` and `STRICT_ON unsupported_type`.
4. Optional step 10 shows the exact `true`/`false` toggle values.

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

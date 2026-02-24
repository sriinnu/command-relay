# CommandRelay

CommandRelay is a secure, bi-directional remote terminal bridge for long-running AI coding sessions.

Use it to remotely observe and control terminal sessions running on your home machine (Mac first), including Codex, Claude, and shell workflows.

> **One-line:** Secure remote `tmux` bridge for streaming and controlling long-running AI terminal sessions.
> **Short description:** TypeScript/Node.js gateway with WebSocket streaming, replay, audit logs, and read-only-by-default guarded input.

## Table of Contents

1. [Vision](#vision)
2. [Product Principles](#product-principles)
3. [Naming Strategy](#naming-strategy)
4. [System Architecture](#system-architecture)
5. [ASCII Dataflow Diagram](#ascii-dataflow-diagram)
6. [ASCII Sequence Diagram](#ascii-sequence-diagram)
7. [ASCII State Diagram](#ascii-state-diagram)
8. [Core Capabilities](#core-capabilities)
9. [Security Model](#security-model)
10. [Networking Decision](#networking-decision)
11. [Technical Scope and Roadmap](#technical-scope-and-roadmap)
12. [Documentation](#documentation)
13. [Status](#status)
14. [License](#license)

## Vision

CommandRelay bridges idle-time gaps and distance.

During long windows where your home terminals remain active, you should be able to:

1. Open a browser or app from anywhere.
2. View all active sessions in one place.
3. Send commands safely with low latency.
4. Recover context after disconnects or long idle periods.

## Product Principles

1. Reliability over novelty.
2. Secure-by-default remote control.
3. Low operational burden.
4. Cross-platform direction with adapter-based backend.
5. Public-facing clarity with internal naming depth.

## Naming Strategy

CommandRelay uses dual naming:

1. Internal code names: Vedic/Sanskrit identifiers for modules and services.
2. Public aliases: clear English names for docs, APIs, and UI.

| Internal Name | Public Alias |
| --- | --- |
| `Setu` | Relay Bridge |
| `Dvara` | Gateway |
| `Akasha` | Event Bus |
| `Smriti` | Session Memory |
| `Raksha` | Security Layer |

Rule: public interfaces default to English aliases.

## System Architecture

Primary stack:

1. Session runtime: `tmux` on Mac/Linux/WSL.
2. Bridge daemon: local service on the home machine.
3. Transport: WebSocket for real-time stream + input.
4. Client: `xterm.js` web UI, later Electron wrapper.
5. Access network: Tailscale private mesh.

## ASCII Dataflow Diagram

```text
+---------------------+                            +------------------------------+
| Remote Browser/App  |                            | Home Machine (MacBook)       |
| - xterm.js UI       |                            |                              |
| - Session list      |   Encrypted Private Link   |  +------------------------+  |
| - Command input     | <------------------------> |  | CommandRelay Gateway   |  |
+----------+----------+      (Tailscale/WireGuard) |  | - Auth / ACL           |  |
           |                                       |  | - Session Router       |  |
           | WebSocket (events)                    |  | - Replay Buffer        |  |
           v                                       |  +-----------+------------+  |
+---------------------+                            |              |               |
| JSON Event Channel  |                            |              |               |
| input/output/ack    |                            |      +-------v--------+      |
+---------------------+                            |      | tmux Adapter    |      |
                                                   |      | - list panes    |      |
                                                   |      | - capture pane  |      |
                                                   |      | - send keys     |      |
                                                   |      +-------+--------+      |
                                                   |              |               |
                                                   |      +-------v--------+      |
                                                   |      | tmux Server     |      |
                                                   |      | sessions/windows|      |
                                                   |      | panes (agents)  |      |
                                                   |      +-----------------+      |
                                                   +------------------------------+
```

## ASCII Sequence Diagram

```text
Actors:
  U = User Client (Browser/Electron)
  G = CommandRelay Gateway
  T = tmux Adapter
  M = tmux Pane (Codex/Claude Shell)

1) Connect and Authenticate
U -> G : WS connect + auth token
G -> U : auth_ok + capability set (view/input)

2) Discover Sessions
U -> G : list_sessions
G -> T : query sessions/windows/panes
T -> G : session inventory
G -> U : session_list

3) Attach and Stream
U -> G : attach(pane_id)
G -> T : capture + subscribe pane
T -> G : replay buffer (last N lines)
G -> U : pane_snapshot + stream_start

4) Send Input (bi-directional control)
U -> G : input(pane_id, "git status\n")
G -> T : send-keys pane_id
T -> M : keystrokes delivered
M -> T : output lines
T -> G : pane_output
G -> U : output event

5) Idle / Resume
U -> G : reconnect(last_event_id)
G -> U : replay missed events + heartbeat schedule
```

## ASCII State Diagram

```text
Legend:
  [] = state
  --> = transition

[DISCONNECTED]
  --> connect_request --> [CONNECTING]

[CONNECTING]
  --> auth_ok ---------> [AUTHENTICATED_READ_ONLY]
  --> auth_fail -------> [TERMINATED]
  --> timeout ---------> [DISCONNECTED]

[AUTHENTICATED_READ_ONLY]
  --> attach_pane -----> [STREAMING_READ_ONLY]
  --> enable_input ----> [AUTHENTICATED_INPUT_ENABLED]

[AUTHENTICATED_INPUT_ENABLED]
  --> attach_pane -----> [STREAMING_INPUT_ENABLED]
  --> disable_input ---> [AUTHENTICATED_READ_ONLY]

[STREAMING_READ_ONLY]
  --> enable_input ----> [STREAMING_INPUT_ENABLED]
  --> socket_drop ------> [DISCONNECTED]

[STREAMING_INPUT_ENABLED]
  --> idle_threshold ---> [IDLE_CONNECTED]
  --> disable_input ----> [STREAMING_READ_ONLY]
  --> socket_drop ------> [DISCONNECTED]

[IDLE_CONNECTED]
  --> output_event -----> [STREAMING_INPUT_ENABLED]
  --> socket_drop ------> [DISCONNECTED]

[Any Active State]
  --> admin_kill -------> [TERMINATED]
```

## Core Capabilities

1. Multi-session view of active terminal panes.
2. Real-time output streaming.
3. Bi-directional command/input channel.
4. Reconnect with replay buffer after idle gaps.
5. Session-level read-only and input-enabled modes.
6. Audit trail for remote commands and target panes.

## Bridge Runtime (Implemented)

The `tmux` core bridge engine is implemented in TypeScript and runs with `tsx` on Node.js `>=22`.

Code paths:

1. `src/tmux/tmux-adapter.ts` - tmux discovery, pane capture, and input dispatch.
2. `src/bridge/bridge-engine.ts` - polling stream engine with replay-by-sequence.
3. `src/server/bridge-server.ts` - HTTP + WebSocket server with auth, limits, and audit hooks.

Current runtime and package baseline:

1. Runtime: Node.js `>=22` with ESM (`"type": "module"`).
2. TypeScript toolchain: `tsx` for run/dev and `typescript` for static checks.
3. Transport: `ws` for gateway WebSocket connectivity.
4. Outbound proxy stack: `http-proxy-agent`, `https-proxy-agent`, `socks-proxy-agent`, `pac-proxy-agent`.
5. Planned ecosystem split: iOS (Swift) first, Android (Kotlin) second, web fallback last.

Run locally:

```bash
npm install
npm run check
npm start
```

Health endpoint:

```text
GET /health
```

WebSocket endpoint:

```text
ws://127.0.0.1:8787/ws
```

Important env vars:

1. `COMMANDRELAY_AUTH_TOKEN` - optional static auth token.
2. `COMMANDRELAY_AUDIT_LOG` - optional JSONL path for audit events.
3. `COMMANDRELAY_MAX_INPUT_BYTES` - input payload guardrail.
4. `COMMANDRELAY_MAX_MSG_PER_MIN` - per-client message rate limit.
5. `COMMANDRELAY_MAX_INPUT_PER_MIN` - per-client input rate limit.
6. `HTTP_PROXY` / `HTTPS_PROXY` / `ALL_PROXY` / `NO_PROXY` - outbound proxy routing for gateway control-plane/telemetry calls.

## Security Model

Baseline controls:

1. Read-only by default.
2. Explicit input enable per session.
3. Authenticated clients only.
4. Authorization policy by session/pane.
5. Rate limits and payload size limits.
6. Auditable input events and admin actions.
7. Emergency global input disable switch.

## Networking Decision

Preferred: Tailscale private mesh.

1. No static public IP requirement.
2. End-to-end encrypted access.
3. Reduced exposure and lower ops complexity.

Public ingress should only be considered when private mesh is impossible.

## Technical Scope and Roadmap

### Phase 1

1. `tmux` session discovery.
2. Output stream + replay buffer.
3. Input send path (`send-keys`).
4. Basic auth + read-only toggle.

### Phase 2

1. Rich session dashboard UI.
2. ACL policy controls.
3. Audit and operational metrics.
4. Launchd-managed production runtime.

### Phase 3

1. Electron desktop wrapper.
2. Windows native adapter via ConPTY.
3. Mobile-friendly read-only mode.

## Documentation

See [`docs/README.md`](docs/README.md) for all user and contributor documentation.

Native-first planning and execution files:

1. [`TODO.md`](TODO.md)
2. [`docs/roadmap-native.md`](docs/roadmap-native.md)
3. [`docs/ios-swift-architecture.md`](docs/ios-swift-architecture.md)
4. [`docs/android-architecture.md`](docs/android-architecture.md)

## Status

TypeScript bridge runtime is implemented and test-covered; native client milestones are tracked in the roadmap.

## License

MIT.

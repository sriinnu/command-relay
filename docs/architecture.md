# Architecture

CommandRelay is an adapter-based remote terminal control system.

## Components

1. Client UI (`xterm.js`): render terminal stream and send user input.
2. Gateway: auth, authorization, routing, replay, and session lifecycle.
3. Adapter (`tmux`): discover sessions and bridge input/output.
4. Runtime Sessions: Codex/Claude/shell running inside tmux panes.

## Adapter Strategy

1. `tmux` adapter: Mac/Linux/WSL first-class backend.
2. ConPTY adapter: future Windows-native backend.

## Data Ownership

1. Gateway owns connection state, ACL, and replay buffers.
2. Adapter owns backend transport details.
3. Runtime sessions remain source of truth for shell execution.

## Failure Domains

1. Client disconnect: recover via replay and reconnect token.
2. Gateway restart: restore from persisted session metadata.
3. Adapter failure: isolate and degrade session(s) without full outage.

## Operational Constraints

1. Keep command routing deterministic by pane ID.
2. Never auto-enable input on reconnect.
3. Preserve read-only default unless explicitly changed by user.

## Remote Control Reliability & Safety Notes

1. `tmux` control mode should be treated as the authoritative terminal control protocol.
2. Parse `%begin/%end/%error` blocks as command boundaries and `%output`/`%extended-output` as async stream events.
3. Route all control and replay state by stable pane IDs (for example `%1`), not window or pane indexes.
4. Source: tmux Control Mode wiki and `tmux(1)` `-C` / control-mode docs.
   - https://github.com/tmux/tmux/wiki/Control-Mode
   - https://man.openbsd.org/tmux.1

1. WebSocket reliability requires explicit heartbeat handling for half-open connections.
2. RFC 6455 defines Ping/Pong for keepalive and responsiveness checks; use periodic ping and close stale sockets after missed pong windows.
3. In Node `ws`, follow the documented heartbeat loop (`pong` marks alive, periodic `ping`, `terminate()` on missed heartbeat).
4. Source: RFC 6455 Sections 5.5.2 and 5.5.3, plus `ws` FAQ guidance.
   - https://datatracker.ietf.org/doc/html/rfc6455
   - https://github.com/websockets/ws

1. Input safety should use a short lease + lock model instead of sticky ownership.
2. Grant one input lease per pane/client with TTL + keepalive; on expiry or disconnect, auto-revert to read-only.
3. Require a monotonic lease token with each input event so stale clients cannot write after reconnect/failover.
4. Source: leases as time-bounded ownership and keepalive-driven expiration in distributed systems.
   - https://web.stanford.edu/class/cs240/readings/leases.pdf
   - https://etcd.io/docs/v3.6/dev-guide/api_reference_v3/

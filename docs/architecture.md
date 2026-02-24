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

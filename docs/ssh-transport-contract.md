## SSH Transport Contract (CommandRelay)

Status: Draft baseline for SSH-first track.

This contract defines runtime and client behavior when CommandRelay is operated over SSH transport.

## Transport assumptions
1. SSH is the only transport from bridge to backend; tmux sockets are never exposed directly.
2. Connection targets are resolved from server-side backend profiles (`host`, `port`, `user`, auth mode).
3. SSH execution is non-interactive and bounded by connection and command timeouts.
4. Transport carries terminal stream data and control messages only; file transfer is out of scope.
5. Host key verification policy is explicit per environment, with strict checking in production.

## Session and runtime model (tmux persistence)
1. tmux is long-lived and survives bridge/client disconnects.
2. Bridge attaches and detaches from existing tmux sessions without terminating the shell process tree.
3. Session identity is stable across reconnects and unique per backend runtime.
4. Pane attachment is explicit; one client attachment context maps to one active pane target.
5. Runtime tracks output sequence state to support bounded replay after reconnect.

## Safety controls
1. Default mode is read-only; write input requires explicit per-client enablement.
2. Auth is mandatory before non-auth operations when token mode is enabled.
3. Input ownership is exclusive per pane; conflicting writes are rejected unless override policy allows takeover.
4. Input path enforces max payload size and per-client rate limits before dispatch.
5. Audit logs capture auth results, attachment changes, write-lane toggles, and input attempts.
6. Production transport must not run SSH with verbose (`-v`) logging.
7. Termination paths must prefer graceful session close; avoid `kill -9` as normal control flow.

## Failure and reconnect behavior
1. Failures are classified as transport, runtime, or policy errors and surfaced distinctly.
2. Transport reconnect uses bounded exponential backoff with jitter and retry limits.
3. Reattach requests include `lastSeq` so runtime can replay buffered output deterministically.
4. When full replay is unavailable, runtime sends a fresh snapshot and marks the sequence gap.
5. Reconnect never re-enables write mode automatically; clients must re-request write access.
6. Repeated reconnect exhaustion marks backend unavailable until explicit retry.

## Client UX states
1. `connecting`: transport/auth bootstrap is in progress; controls are disabled.
2. `read_only`: output stream active, write lane disabled.
3. `write_enabled`: client owns pane write lane and input is accepted.
4. `conflict`: another client owns write lane; takeover is policy-gated.
5. `reconnecting`: transport dropped; replay/reattach pending.
6. `degraded`: attached but replay continuity is partial or unavailable.
7. `disconnected`: no active transport; explicit reconnect required.

## Non-goals
1. Multi-writer collaborative command entry on the same pane.
2. Infinite or lossless replay guarantees beyond bounded in-memory history.
3. Built-in SSH key lifecycle management or secret vault behavior.
4. Shell intent parsing, semantic key translation, or command policy inference.
5. Zero-downtime guarantees across backend host restarts or tmux daemon crashes.

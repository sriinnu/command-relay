## SSH Transport Contract (CommandRelay)

Status: Active runtime contract.

This contract defines runtime and client behavior when CommandRelay is operated over SSH transport.

## Transport assumptions
1. SSH is the only transport from bridge to backend; tmux sockets are never exposed directly.
2. Connection target is `COMMANDRELAY_SSH_TARGET` and must match `[user@]host` (hostname or bracketed IPv6).
3. SSH command is `COMMANDRELAY_SSH_COMMAND` (`ssh` default) and is used for startup preflight and runtime execution.
4. Host key verification policy is explicit per environment; production must keep strict checking enabled.
5. SSH execution is non-interactive and bounded by connection and command timeouts.
6. Transport carries terminal stream data and control messages only; file transfer is out of scope.

## Startup/runtime constraints
1. `COMMANDRELAY_TRANSPORT_MODE=ssh` requires `COMMANDRELAY_RUNTIME_BACKENDS=tmux`.
2. Runtime operations in `ssh` mode execute tmux commands on the remote SSH target.
3. Startup preflight must validate SSH client availability (`<COMMANDRELAY_SSH_COMMAND> -V`) before runtime starts.

## Operation Contract Matrix
1. `connect` (`C<->S`): client opens WebSocket `/ws`; server immediately emits `hello` with `clientId`, `requiresAuth`, and read-only policy baseline (`inputEnabled=false`).
2. `auth` (`C->S`): request carries `payload.token` when token mode is enabled; server returns `auth_ok` or `auth_error(code=invalid_token)`.
3. `list` (`C->S`): client sends `list_sessions`; server returns `session_list` with pane/session inventory.
4. `attach` (`C->S`): client sends `attach` with required `paneId` and optional `lastSeq`; server attaches pane stream and returns `ack(action=attach)`.
5. `replay` (`S->C output flow`): there is no standalone `replay` message type; replay is negotiated through `attach(lastSeq)` and delivered as `output` events (`streamSeq > lastSeq`) or snapshot fallback.
6. `input` (`C->S`): accepted only when policy allows write input (`inputEnabled && !globalInputDisabled`), pane is attached, ownership rules pass, and payload size/rate limits pass.
7. `ack` (`S->C`): success envelope for command-like actions (`attach`, `detach`, `input`, `disconnect`) with original `requestId`.
8. `error` (`S->C`): rejection envelope for parse/auth/policy/runtime failures, including request correlation via `requestId` when available.

## Session and runtime model (tmux persistence)
1. tmux is long-lived and survives bridge/client disconnects.
2. Bridge attaches and detaches from existing tmux sessions without terminating the shell process tree.
3. Session identity is stable across reconnects and unique per backend runtime.
4. Pane attachment is explicit; one client attachment context maps to one active pane target.
5. Runtime tracks output sequence state (`streamSeq`) to support bounded replay after reconnect.

## Explicit reconnect semantics
1. Reconnect starts with a new transport connection and new `hello.payload.clientId`; prior connection-scoped write lane ownership does not carry over.
2. Client re-runs auth when `hello.payload.requiresAuth=true` before non-auth operations.
3. Client reattaches each pane using `attach` and SHOULD include previous `lastSeq` cursor for replay continuity.
4. Runtime replays buffered `output` events where `streamSeq > lastSeq`; when full range is unavailable, runtime falls back to current snapshot at latest sequence.
5. Reconnect never re-enables write mode automatically; client must explicitly request `enable_input` again.
6. Transport reconnect uses bounded exponential backoff with jitter and retry limits; repeated exhaustion marks backend unavailable until explicit retry.

## Safety controls
1. Default mode is read-only; write input requires explicit per-client enablement.
2. Auth is mandatory before non-auth operations when token mode is enabled.
3. Input ownership is exclusive per pane; conflicting writes are rejected unless override policy allows takeover.
4. Input path enforces max payload size and per-client rate limits before dispatch.
5. Audit logs capture auth results, attachment changes, write-lane toggles, and input attempts.
6. Production transport must not run SSH with verbose (`-v`) logging.
7. Termination paths must prefer graceful session close; avoid `kill -9` as normal control flow.

## Failure classification
1. `transport`: socket/SSH lifecycle errors, reconnect exhaustion, or handshake failure.
2. `runtime`: attach/list/output/input execution failures against tmux runtime.
3. `policy`: auth-required, input-disabled, ownership-conflict, rate-limit, or payload-size violations.

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

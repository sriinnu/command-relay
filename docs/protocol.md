# Protocol

CommandRelay uses JSON envelopes over WebSocket, with a small HTTP surface for health and static app hosting.

## HTTP + WebSocket Surface

1. `GET /health` returns runtime status JSON.
2. `GET /` and `GET /app` return `308` redirects to `/app/`; `GET /app/` and `GET /app/<path>` serve static files when `COMMANDRELAY_APP_STATIC_ENABLED=true` (default).
3. WebSocket upgrades are accepted only on exact `/ws`.
4. Non-matching HTTP routes and invalid static targets return `404` with `{ "error": "not_found" }`.

## Envelope

```json
{
  "v": 1,
  "type": "event_type",
  "requestId": "optional-request-id",
  "timestamp": 1771934131735,
  "payload": {}
}
```

## Client -> Gateway Events (Current Runtime)

1. `auth`
2. `list_sessions`
3. `attach`
4. `detach`
5. `enable_input`
6. `disable_input`
7. `input`
8. `heartbeat`
9. `disconnect`

## Gateway -> Client Events (Current Runtime)

1. `hello`
2. `auth_ok` / `auth_error`
3. `session_list`
4. `output`
5. `policy_update`
6. `ack` / `error`
7. `heartbeat_ack`

## Auth Behavior

1. `hello.payload.requiresAuth=true` means the client must send `auth` before other commands.
2. In token mode, non-`auth` commands before successful auth return `error.code=auth_required`.
3. On success, server sends `auth_ok` with `mode=token`; when no token is configured, mode is `open`.
4. Auth is message-based (`auth.payload.token`), not HTTP-header based.

## Input Lane Behavior

1. Input stays read-only until `enable_input` and `policy_update.inputEnabled=true`.
2. `input` requires an attached pane, valid payload size, and pass of input rate limits.
3. First successful writer claims pane ownership for that WebSocket `clientId`.
4. Conflicting writers get `error.code=input_lane_conflict`.
5. Takeover requires `input.payload.override=true` (or `takeOwnership=true`) and `COMMANDRELAY_ALLOW_INPUT_OVERRIDE=true`.

## Ordering and Replay

1. Output events carry monotonic `streamSeq` per pane watcher.
2. Reconnect/reattach resumes with `attach` plus optional `lastSeq`.
3. Server replays buffered output where `streamSeq > lastSeq`, with snapshot fallback when needed.

For the full normative contract, use [`docs/protocol-v1.md`](protocol-v1.md).

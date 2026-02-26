# Bridge Protocol v1 Event Contract

Status: Normative for current bridge runtime behavior
Version: `1`
Transport: WebSocket text frames carrying UTF-8 JSON objects

This document describes the implemented v1 event contract used by `src/server/bridge-server.ts` and `src/bridge/bridge-engine.ts`.

## 1. Event Sets

### 1.1 Core v1 Types (required baseline)

1. `auth`
2. `list_sessions`
3. `attach`
4. `output`
5. `input`
6. `ack`
7. `error`
8. `heartbeat`
9. `policy_update`

These are the required baseline event names for v1 interoperability.

### 1.2 Runtime Extension Types (accepted/emitted by bridge server)

1. `hello`
2. `auth_ok`
3. `auth_error`
4. `session_list`
5. `detach`
6. `enable_input`
7. `disable_input`
8. `disconnect`
9. `heartbeat_ack`

## 2. Envelope

Recommended wire shape:

```json
{
  "v": 1,
  "type": "auth",
  "requestId": "req-1",
  "timestamp": 1771934131735,
  "payload": {}
}
```

### 2.1 Compatibility Parse Rules (`COMMANDRELAY_STRICT_PROTOCOL_PARSING=false`)

1. Incoming frame MUST parse as JSON object.
2. `type` MUST be a non-empty string.
3. `payload` is normalized to `{}` when missing or non-object.
4. `requestId` is accepted only when it is a string; otherwise treated as absent.
5. Socket ingress strictness is controlled by `COMMANDRELAY_STRICT_PROTOCOL_PARSING` (`true` by default, legacy alias `COMMANDRELAY_STRICT_V1`).
6. Parse failures return `error` with `code` values such as `invalid_json`, `invalid_json_object`, `missing_type`.

### 2.2 Strict v1 Parse Rules (default runtime mode + conformance profile)

1. `v` MUST equal `1`.
2. `type` MUST be one of the strict allow-list types: the 9 core v1 types plus runtime extensions (`hello`, `auth_ok`, `auth_error`, `session_list`, `detach`, `enable_input`, `disable_input`, `disconnect`, `heartbeat_ack`).
3. `timestamp` MUST be a safe integer `>= 0`.
4. `payload` MUST be an object.
5. `requestId` format: 1..128 ASCII printable chars, no leading/trailing spaces.
6. `requestId` is required for: `auth`, `list_sessions`, `attach`, `detach`, `enable_input`, `disable_input`, `disconnect`, `input`, `ack`, `error`.
7. Maximum encoded message size is 64 KiB.

## 3. Message Contracts

Direction legend:

1. `C->S`: client to server
2. `S->C`: server to client

### 3.1 `hello` (`S->C`)

Sent once on connection open.

```json
{
  "clientId": "uuid",
  "requiresAuth": true,
  "inputEnabled": false,
  "globalInputDisabled": false,
  "maxInputBytes": 4096,
  "maxAttachedPanes": 8
}
```

### 3.2 `auth` (`C->S`) and auth responses

Request payload:

```json
{
  "token": "opaque-token"
}
```

Behavior:

1. If server has no configured auth token, server responds `auth_ok` with `{ "mode": "open" }`.
2. If token auth is configured, `payload.token` is required and compared via timing-safe equality.
3. Invalid token returns `auth_error` with `{ "code": "invalid_token" }`.
4. Before successful auth (when required), all non-`auth` requests return `error` with `code=auth_required`.

### 3.3 `list_sessions` (`C->S`) and `session_list` (`S->C`)

1. `list_sessions` has no required payload fields.
2. Response `session_list` includes `payload.panes` and grouped `payload.sessions`.
3. In multi-backend runtime mode (`tmux,cmux`), each `payload.sessions[]` row can include optional `backendId` and is grouped by `(backendId, sessionName)`.

### 3.4 `attach` (`C->S`)

Request payload:

```json
{
  "paneId": "%1",
  "lastSeq": 42
}
```

Validation and behavior:

1. `paneId` is required non-empty string (trimmed).
2. `lastSeq` is optional and parsed as integer from number or numeric string.
3. Server enforces max concurrent attached panes per client (`maxAttachedPanes`).
4. On success server responds `ack` with `{ "action": "attach", "paneId": "..." }`.
5. Errors include `invalid_pane_id` and `max_attached_panes_exceeded`.

### 3.5 `output` (`S->C`)

Output payload:

```json
{
  "mode": "snapshot",
  "paneId": "%1",
  "chunk": "line text\n",
  "streamSeq": 43
}
```

Rules:

1. `streamSeq` increases monotonically per pane watcher.
2. `mode` is `snapshot` or `delta`.
3. No explicit replay flag is emitted in current runtime.

### 3.6 Input channel controls and ownership arbitration (`C->S` + `S->C`)

Control requests:

1. `enable_input`
2. `disable_input`

Policy response:

```json
{
  "inputEnabled": false,
  "globalInputDisabled": true
}
```

Rules:

1. `enable_input` updates input state for the requesting WebSocket client only.
2. `disable_input` updates input state for the requesting WebSocket client only.
3. Effective policy remains `clientInputEnabled && !globalInputDisabled`.
4. Pane input ownership is enforced at `input` send time (first successful writer claims the lane for that pane).
5. `policy_update` currently carries only `inputEnabled` and `globalInputDisabled` (ownership state is signaled on `input` conflict errors).
6. Both requests return `policy_update` with effective policy.
7. Web control lane follows the same `enable_input`/`disable_input` flow as native clients; there are no web-only event types in v1.
8. For web clients, lane identity is the WebSocket connection (`hello.payload.clientId`), which maps to a browser tab/window instance.

### 3.7 `input` (`C->S`)

Request payload:

```json
{
  "paneId": "%1",
  "data": "git status\n",
  "override": false
}
```

Acceptance requirements:

1. Pass input rate limiter (`maxInputsPerMinute`).
2. Effective policy allows input (`inputEnabled && !globalInputDisabled`).
3. `paneId` and `data` are non-empty strings.
4. Target pane is currently attached by that client.
5. UTF-8 byte length of `data` is `<= maxInputBytes`.
6. If another client already owns the pane input lane, caller must request takeover (`payload.override=true` or `payload.takeOwnership=true`) and server must allow override.

Responses:

1. Success: `ack` with `{ action: "input", paneId, bytes }`.
2. Rejections: `input_rate_limited`, `input_disabled`, `invalid_input`, `pane_not_attached`, `input_too_large`, `input_lane_conflict`.

### 3.8 `heartbeat` (`C->S`) and `heartbeat_ack` (`S->C`)

1. `heartbeat` receives `heartbeat_ack` with `{ clientId }`.
2. Payload echo is not required by current implementation.

### 3.9 `disconnect` and `detach` (`C->S`)

1. `detach` removes one pane subscription and returns `ack(action=detach)`.
2. `disconnect` detaches all panes, resets input state to false, and returns `ack(action=disconnect)`.

### 3.10 Web app control lane user flow (`C->S` + `S->C`)

Web app control uses the same v1 envelope and event names as iOS/Android. Required flow:

1. Connect and authenticate (`hello` -> `auth` -> `auth_ok`), then `list_sessions` and `attach`.
2. Stay read-only until explicit `enable_input`; treat `policy_update.inputEnabled=true` as the only write-ready state.
3. First successful `input` on a pane claims that pane's write lane for the current `clientId`.
4. If server returns `error(code=input_lane_conflict)`, web UI should block send and require explicit operator action for takeover.
5. Takeover request uses `input` with `override=true` (or `takeOwnership=true`); server accepts only when override is allowed.
6. On handoff, current writer should issue `disable_input` before `detach`/`disconnect` to reduce takeover ambiguity.

## 4. Ordering and Replay Semantics

## 4.1 Sequence Domain

1. `streamSeq` is scoped to pane watcher state.
2. Sequence starts at `1` for first snapshot event.
3. Sequence increments by `1` for each emitted `output`.

## 4.2 Attach + Replay Behavior

When client sends `attach(paneId,lastSeq)`:

1. If watcher has history and `lastSeq` is an integer, server replays events where `streamSeq > lastSeq`.
2. If no replayable events match but watcher has state, server sends current `snapshot` at current `streamSeq`.
3. If pane is first seen, server captures pane text and emits first `snapshot`.

## 4.3 Replay Retention Limits

1. Replay history is bounded by `maxHistoryEvents` (default `300`).
2. Replay state is in-memory per watcher.
3. When a watcher has no subscribers, it is removed and its history is dropped.
4. Current runtime does not emit `REPLAY_UNAVAILABLE`; it falls back to snapshot semantics.

## 5. Auth Token Handling Semantics

1. `COMMANDRELAY_AUTH_TOKEN` is optional on loopback binds and required on non-loopback binds.
2. Token comparison is timing-safe (`timingSafeEqual`) with equal-length precheck.
3. Invalid auth attempts are audit logged as `auth_fail` with reason metadata.
4. Token value is not included in bridge responses.

## 6. Kill Switch Semantics

1. Global switch is `COMMANDRELAY_INPUT_KILL_SWITCH` parsed at process startup.
2. Effective input permission is always `clientInputEnabled && !globalInputDisabled`.
3. Kill switch blocks `enable_input` from becoming effective.
4. Kill switch causes subsequent `input` to fail with `input_disabled`.

## 6.1 Multi-Client Pane Arbitration Semantics

1. Arbitration unit is the WebSocket client connection (`hello.payload.clientId`).
2. `enable_input` does not reserve a pane globally and does not preempt other clients.
3. First successful `input` claims pane ownership for that `clientId`.
4. Non-owner `input` receives `error(code=input_lane_conflict)` with `ownerClientId` and `overrideAllowed`.
5. Ownership is released when the owner detaches/disconnects from the pane.
6. Ownership can transfer only via explicit takeover (`override=true` or `takeOwnership=true`) when override is allowed.

## 7. Attack/Mitigation Matrix (Protocol Level)

| Threat | Attack Path | Mitigation in Protocol/Server | Residual Note |
| --- | --- | --- | --- |
| Unauthorized input before auth | Send `input` without successful `auth` | Server gates all non-`auth` messages with `auth_required` when auth is configured | Open mode depends on network isolation |
| Input channel abuse | Flood `input` or send oversized payloads | `input_rate_limited`, `input_too_large`, and required attached pane membership | No command allowlist in protocol |
| Concurrent writers on same pane | Two clients/tabs enable input and send simultaneously | Server-side pane owner arbitration rejects non-owner writes with `input_lane_conflict` unless explicit takeover is requested and allowed | Keep single-writer runbook and require intentional takeover in UI |
| Replay confusion on reconnect | Client resumes with stale or missing `lastSeq` | Sequence-based replay (`streamSeq > lastSeq`) with snapshot fallback | Exact missed range not guaranteed after retention loss |
| Token probing | Repeated `auth` guesses | Static token + timing-safe compare + audit trail | No protocol-level lockout/backoff |
| Kill switch bypass | Call `enable_input` while kill switch set | `policy_update` keeps `inputEnabled=false`, and `input` rejects | Kill switch value is static for process lifetime |

## 8. Error Code Reference (Current Runtime)

Common error payload:

```json
{
  "code": "input_disabled",
  "message": "optional detail"
}
```

Observed codes by stage:

Strict/runtime parse stage:

1. `invalid_json`
2. `invalid_json_object`
3. `missing_type`
4. `message_too_large`
5. `invalid_version`
6. `unsupported_type`
7. `invalid_timestamp`
8. `invalid_payload`
9. `invalid_request_id`
10. `missing_request_id`

Message handling and policy stage:

11. `rate_limited`
12. `auth_required`
13. `invalid_token`
14. `invalid_pane_id`
15. `max_attached_panes_exceeded`
16. `input_rate_limited`
17. `input_disabled`
18. `invalid_input`
19. `pane_not_attached`
20. `input_too_large`
21. `input_lane_conflict`
22. `unknown_type`

Streaming/runtime failure stage:

23. `pane_poll_failed`
24. `handler_failed`

Ownership note:

1. Current runtime emits `input_lane_conflict` when another client owns a pane input lane and takeover is not requested/allowed.

## 9. End-to-End Example

```text
Client                                      Server
  | -- auth(req=A1,token=...) -------------> |
  | <-- auth_ok(req=A1,mode=token) --------- |
  | -- attach(req=T1,paneId=%1,lastSeq=40)-> |
  | <-- ack(req=T1,action=attach) ---------- |
  | <-- output(seq=41,mode=delta) ---------- |
  | -- enable_input(req=E1) ---------------> |
  | <-- policy_update(req=E1,inputEnabled=1)|
  | -- input(req=I1,\"ls\\n\") --------------> |
  | <-- ack(req=I1,action=input) ----------- |
```

Web control lane conflict/takeover example:

```text
Web Tab A                                  Server                                   Web Tab B
  | -- attach(req=A1,paneId=%1) -----------> |                                        |
  | -- enable_input(req=A2) ---------------> |                                        |
  | -- input(req=A3,\"pwd\\n\") ------------> |                                        |
  | <-- ack(req=A3,action=input) ----------- |                                        |
  |                                          | <----------- input(req=B3,\"ls\\n\") -- |
  |                                          | ---- error(code=input_lane_conflict) -> |
  |                                          | <--- input(req=B4,\"ls\\n\",override=1)- |
  |                                          | ---------------- ack(req=B4,action=input)->|
```

## 10. Compatibility Notes

1. Runtime supports strict and compatibility parser modes.
2. Runtime default is strict parse mode (`COMMANDRELAY_STRICT_PROTOCOL_PARSING=true`), with optional compatibility mode when disabled.
3. Clients should treat unknown server events as ignorable unless operating in strict test mode.

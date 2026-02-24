# Bridge Protocol v1 Event Contract

Status: Normative
Version: `1`
Transport: WebSocket text frames with UTF-8 JSON objects

This document defines the strict v1 contract for bridge events:

1. `auth`
2. `list`
3. `attach`
4. `output`
5. `input`
6. `ack`
7. `error`
8. `heartbeat`
9. `policy_update`

## 1. Conformance

The keywords `MUST`, `MUST NOT`, `REQUIRED`, `SHOULD`, `SHOULD NOT`, and `MAY` are to be interpreted as normative requirements.

A peer is conformant only if it validates incoming events against this document and emits outgoing events that satisfy all required fields and constraints.

## 2. Envelope Schema (All Events)

All events MUST match this envelope:

```json
{
  "v": 1,
  "type": "auth|list|attach|output|input|ack|error|heartbeat|policy_update",
  "requestId": "optional-id",
  "timestamp": 1771934131735,
  "payload": {}
}
```

### 2.1 Required Fields

1. `v` (number): MUST equal `1`.
2. `type` (string): MUST be one of the 9 event names listed above.
3. `timestamp` (integer): Unix epoch milliseconds.
4. `payload` (object): Event-specific payload; unknown keys are invalid unless explicitly allowed.

### 2.2 `requestId` Rules

1. `requestId` is REQUIRED for client request events: `auth`, `list`, `attach`, `input`.
2. `requestId` is OPTIONAL for `heartbeat` and server push events (`output`, `policy_update`).
3. `ack` and `error` MUST include the original `requestId` they refer to.

### 2.3 Common Validation Rules

1. Envelope MUST be a JSON object (not array/string/number).
2. `timestamp` MUST be `>= 0` and fit signed 64-bit integer.
3. `requestId`, if present, MUST be 1..128 chars, ASCII printable, no spaces at ends.
4. Unknown top-level keys MUST be rejected in strict mode.
5. Maximum encoded event size MUST be <= 64 KiB.

## 3. Event Payload Contracts

Direction legend:

1. `C->S`: Client to Server
2. `S->C`: Server to Client
3. `C<->S`: Either direction

### 3.1 `auth` (`C->S`)

Authenticate a connection.

```json
{
  "token": "jwt-or-opaque-token",
  "deviceId": "device-123",
  "capabilities": ["read"]
}
```

Validation:

1. `token` REQUIRED, non-empty string, max 4096 chars.
2. `deviceId` REQUIRED, non-empty string, max 128 chars.
3. `capabilities` OPTIONAL array of unique strings.
4. Unknown fields invalid.

Response:

1. Success: `ack` with same `requestId`.
2. Failure: `error` with same `requestId` and `code=AUTH_FAILED`.

### 3.2 `list` (`C->S`)

Request visible sessions/panes inventory.

```json
{
  "scope": "default"
}
```

Validation:

1. `scope` OPTIONAL string, default `"default"`, max 64 chars.
2. Unknown fields invalid.

Response:

1. Success: `ack` with `payload.sessions` array.
2. Failure: `error` with `code=FORBIDDEN|INVALID_REQUEST|INTERNAL`.

### 3.3 `attach` (`C->S`)

Attach stream for one pane and optionally request replay.

```json
{
  "paneId": "work:codex.1",
  "lastSeq": 421
}
```

Validation:

1. `paneId` REQUIRED string, 1..256 chars.
2. `lastSeq` OPTIONAL integer `>= 0`.
3. Unknown fields invalid.

Semantics:

1. If `lastSeq` absent, stream starts from server current tail policy (no historical replay).
2. If `lastSeq` present, server MUST replay from `lastSeq + 1` when available.
3. If replay range unavailable, server MUST emit `error` with `code=REPLAY_UNAVAILABLE`.

### 3.4 `output` (`S->C`)

Output chunk for an attached pane.

```json
{
  "paneId": "work:codex.1",
  "streamSeq": 422,
  "chunk": "On branch main\n",
  "encoding": "utf8",
  "replay": true
}
```

Validation:

1. `paneId` REQUIRED string.
2. `streamSeq` REQUIRED integer `>= 1`.
3. `chunk` REQUIRED string (UTF-8 text payload).
4. `encoding` OPTIONAL enum: `utf8` (default).
5. `replay` OPTIONAL boolean; `true` when chunk came from replay buffer.
6. Unknown fields invalid.

### 3.5 `input` (`C->S`)

Send user input to a pane.

```json
{
  "paneId": "work:codex.1",
  "data": "git status\n"
}
```

Validation:

1. `paneId` REQUIRED string.
2. `data` REQUIRED string, 1..8192 bytes UTF-8 encoded.
3. Input MUST be rejected if policy does not allow input.
4. Unknown fields invalid.

Response:

1. Success: `ack` with same `requestId`.
2. Failure: `error` with `code=INPUT_DISABLED|FORBIDDEN|INVALID_REQUEST`.

### 3.6 `ack` (`C<->S`, typically `S->C`)

Acknowledges a request event by `requestId`.

```json
{
  "requestId": "req-9f3",
  "status": "ok",
  "result": {}
}
```

Validation:

1. `payload.requestId` REQUIRED string matching an in-flight request.
2. Envelope `requestId` MUST equal `payload.requestId`.
3. `status` REQUIRED enum: `ok`.
4. `result` OPTIONAL object (event-specific response body).

### 3.7 `error` (`C<->S`, typically `S->C`)

Negative response or async failure notification.

```json
{
  "requestId": "req-9f3",
  "code": "INVALID_REQUEST",
  "message": "payload.paneId is required",
  "retryable": false,
  "details": {}
}
```

Validation:

1. `code` REQUIRED enum:
   - `AUTH_FAILED`
   - `FORBIDDEN`
   - `INVALID_REQUEST`
   - `INPUT_DISABLED`
   - `NOT_FOUND`
   - `REPLAY_UNAVAILABLE`
   - `RATE_LIMITED`
   - `INTERNAL`
2. `message` REQUIRED string, max 1024 chars.
3. `retryable` OPTIONAL boolean.
4. `requestId` REQUIRED when tied to a prior request; omitted only for unsolicited async faults.

### 3.8 `heartbeat` (`C<->S`)

Keepalive and latency measurement.

```json
{
  "nonce": "hb-001",
  "role": "ping"
}
```

Validation:

1. `nonce` REQUIRED string, 1..64 chars.
2. `role` REQUIRED enum: `ping|pong`.
3. Reply `pong` SHOULD echo the same `nonce`.

### 3.9 `policy_update` (`S->C`)

Server push of effective policy/capability changes.

```json
{
  "inputEnabled": false,
  "maxInputBytes": 8192,
  "heartbeatMs": 15000,
  "reason": "admin_kill_switch"
}
```

Validation:

1. `inputEnabled` REQUIRED boolean.
2. `maxInputBytes` OPTIONAL integer `>= 1`.
3. `heartbeatMs` OPTIONAL integer `>= 1000`.
4. `reason` OPTIONAL string, max 128 chars.
5. Unknown fields invalid.

Semantics:

1. New policy is effective immediately upon receipt.
2. Client MUST block new `input` sends when `inputEnabled=false`.

## 4. Ordering and Replay Semantics

## 4.1 Sequence Domain

1. `streamSeq` is scoped per `paneId`.
2. Server MUST emit strictly increasing `streamSeq` by 1 for each pane.
3. `streamSeq` starts at `1` for a fresh pane stream history.

## 4.2 Client Apply Rules

Let `appliedSeq[paneId]` be last accepted sequence.

1. If incoming `streamSeq <= appliedSeq`, event is duplicate; client MUST drop.
2. If incoming `streamSeq == appliedSeq + 1`, client MUST apply and advance.
3. If incoming `streamSeq > appliedSeq + 1`, gap detected; client MUST NOT apply out of order.

On gap, client MUST initiate replay recovery by sending `attach` with `lastSeq=appliedSeq`.

## 4.3 Replay Contract (`lastSeq`)

1. Client sends `attach(paneId,lastSeq)` after reconnect/resume.
2. Server replays available events where `streamSeq > lastSeq` in ascending order.
3. Replayed `output` SHOULD set `replay=true`.
4. After replay exhausts, server continues live stream with no sequence reset.
5. If requested range is outside retention window, server sends `error(REPLAY_UNAVAILABLE)`; client SHOULD reattach with `lastSeq=0` or without `lastSeq` per UX policy.

## 4.4 ASCII Sequence Example

```text
Client                                Server
  | -- auth(req=A1) ------------------> |
  | <-- ack(req=A1) ------------------- |
  | -- attach(req=T1,lastSeq=10) -----> |
  | <-- ack(req=T1) ------------------- |
  | <-- output(seq=11,replay=true) ---- |
  | <-- output(seq=12,replay=true) ---- |
  | <-- output(seq=13,replay=false) --- |
  | -- input(req=I9,data="ls\n") -----> |
  | <-- ack(req=I9) ------------------- |
  | <-- policy_update(inputEnabled=0)- |
  | -- input(req=I10,"pwd\n") --------> |
  | <-- error(req=I10,INPUT_DISABLED)- |
```

## 4.5 ASCII State Snippet (Per Pane)

```text
[Detached]
   | attach
   v
[Attached seq=n]
   | output seq=n+1 -> apply
   | output seq<=n  -> drop duplicate
   | output seq>n+1 -> [GapDetected]
   v
[GapDetected]
   | send attach(lastSeq=n)
   v
[Replaying]
   | output replay seq=n+1..m
   v
[Attached seq=m]
```

## 5. Strict Validation Matrix

A receiver MUST reject events that violate any rule below.

1. `v != 1`.
2. `type` not in allowed enum.
3. Missing required envelope fields.
4. Missing required payload fields for event type.
5. Wrong JSON types (for example `streamSeq:"12"` string).
6. Unknown fields in strict mode.
7. Payload size exceeds configured max.
8. `ack/error` with no correlatable `requestId`.
9. `output.streamSeq < 1`.
10. `attach.lastSeq < 0`.

Recommended rejection behavior:

1. Respond with `error(code=INVALID_REQUEST)` when correlation is possible.
2. Close connection on repeated malformed events or parse failures.

## 6. Canonical Examples

### 6.1 Valid `attach` Replay Request

```json
{
  "v": 1,
  "type": "attach",
  "requestId": "req-attach-1",
  "timestamp": 1771934131735,
  "payload": {
    "paneId": "work:codex.1",
    "lastSeq": 421
  }
}
```

### 6.2 Invalid `output` (Bad `streamSeq` Type)

```json
{
  "v": 1,
  "type": "output",
  "timestamp": 1771934131736,
  "payload": {
    "paneId": "work:codex.1",
    "streamSeq": "422",
    "chunk": "hello\n"
  }
}
```

Reason: `streamSeq` MUST be an integer, not string.

### 6.3 Invalid `ack` (Missing Correlation)

```json
{
  "v": 1,
  "type": "ack",
  "timestamp": 1771934131737,
  "payload": {
    "status": "ok"
  }
}
```

Reason: `payload.requestId` and envelope `requestId` are both required for `ack`.

### 6.4 Valid `policy_update`

```json
{
  "v": 1,
  "type": "policy_update",
  "timestamp": 1771934131738,
  "payload": {
    "inputEnabled": false,
    "maxInputBytes": 4096,
    "heartbeatMs": 10000,
    "reason": "maintenance_window"
  }
}
```

## 7. Compatibility Notes

1. This contract is strict for `v=1`; extensions require a version bump or explicit extension policy.
2. Producers MUST NOT send undocumented event types under `v=1`.
3. Consumers MAY log and drop unknown events only when operating in non-strict compatibility mode; strict mode MUST reject.

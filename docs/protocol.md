# Protocol

CommandRelay uses JSON events over WebSocket.

## Envelope

```json
{
  "type": "event_type",
  "requestId": "optional-client-id",
  "timestamp": 1771934131735,
  "payload": {}
}
```

## Client -> Gateway Events

1. `auth`: authenticate client.
2. `list_sessions`: request tmux inventory.
3. `attach`: attach to pane stream.
4. `input`: send command/keystrokes to pane.
5. `resize`: update terminal dimensions.
6. `enable_input` / `disable_input`: toggle input mode.
7. `heartbeat`: keepalive and latency measurement.

## Gateway -> Client Events

1. `auth_ok` / `auth_error`.
2. `session_list`.
3. `pane_snapshot`.
4. `output`.
5. `ack` / `error`.
6. `heartbeat_ack`.
7. `policy_update`.

## Example Input Event

```json
{
  "type": "input",
  "payload": {
    "paneId": "work:codex.1",
    "data": "git status\n"
  }
}
```

## Example Output Event

```json
{
  "type": "output",
  "payload": {
    "paneId": "work:codex.1",
    "chunk": "On branch main\n",
    "streamSeq": 421
  }
}
```

## Ordering and Replay

1. Output events carry monotonic `streamSeq` per pane.
2. Client reconnect includes `lastSeq`.
3. Gateway replays buffered output from `lastSeq + 1`.

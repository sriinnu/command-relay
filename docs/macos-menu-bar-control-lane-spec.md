# macOS Menu Bar Control-Lane Spec (v1)

Status: Normative for menu bar companion behavior against current gateway runtime  
Protocol baseline: [`docs/protocol-v1.md`](protocol-v1.md) (`v=1`)

## 1. Scope

This spec defines the macOS menu bar companion behavior for the control lane using the current v1 protocol.

In scope:

1. Quick connect/disconnect from menu bar UI.
2. Session list fetch and single-pane attach for read-only output.
3. Explicit input arm/disarm (`enable_input` / `disable_input`).
4. Input send, lane conflict handling, and explicit takeover flow.
5. Menu bar lane indicators: `read-only`, `input-enabled`, `lane-conflict`, `kill-switch-blocked`.

Out of scope:

1. Protocol changes or new event types.
2. Multi-pane editing from menu bar surface.
3. Any auth or transport mode that diverges from v1 envelope/event rules.

## 2. Protocol Alignment Constraints

1. Use the same WebSocket envelope as v1:
   - `v`, `type`, `requestId`, `timestamp`, `payload`.
2. Use only current runtime event names:
   - `C->S`: `auth`, `list_sessions`, `attach`, `detach`, `enable_input`, `disable_input`, `input`, `heartbeat`, `disconnect`.
   - `S->C`: `hello`, `auth_ok`, `auth_error`, `session_list`, `output`, `policy_update`, `ack`, `error`, `heartbeat_ack`.
3. In strict v1 mode, always send `requestId` for menu bar requests that require it:
   - `auth`, `list_sessions`, `attach`, `detach`, `enable_input`, `disable_input`, `disconnect`, `input`.
4. Do not add menu bar specific wire events; menu bar is a client UX variant, not a protocol variant.

## 3. State Model

### 3.1 Canonical Client State

```ts
type MenuBarControlLaneState = {
  connection: "disconnected" | "connecting" | "socket_open";
  auth: "unknown" | "required" | "ok" | "failed";
  selectedPaneId: string | null;
  attachedPaneId: string | null;
  lastStreamSeqByPane: Record<string, number>;
  policy: {
    inputEnabled: boolean;          // from policy_update / hello
    globalInputDisabled: boolean;   // from policy_update / hello
  };
  lane: {
    mode: "none" | "read_only" | "input_enabled" | "lane_conflict" | "kill_switch_blocked";
    ownerClientId: string | null;   // populated from input_lane_conflict
    overrideAllowed: boolean | null;// populated from input_lane_conflict
  };
};
```

### 3.2 State Derivation Rules

1. `lane.mode=read_only` when attached and `policy.inputEnabled=false` with no conflict.
2. `lane.mode=input_enabled` when attached and `policy.inputEnabled=true`.
3. `lane.mode=kill_switch_blocked` when attached and `policy.globalInputDisabled=true` after `enable_input` attempt.
4. `lane.mode=lane_conflict` when latest `input` response is `error.code=input_lane_conflict`.
5. `lane.mode=none` when no pane is attached.

Note:
1. `policy_update` does not carry owner identity. Ownership details come from `error(code=input_lane_conflict)` payload (`ownerClientId`, `overrideAllowed`).
2. `WRITER_ACTIVE` in the state diagram is a behavioral substate of `lane.mode=input_enabled` (the visible badge remains `input-enabled`).

## 4. Event Mapping (Menu Bar Actions -> v1 Events)

| Menu bar action | Outbound event(s) | Expected inbound event(s) | State impact |
| --- | --- | --- | --- |
| Open socket | transport open | `hello` | Set `connection=socket_open`, hydrate `policy` from `hello.payload`. |
| Authenticate (if required) | `auth` | `auth_ok` or `auth_error` | `auth=ok` on success, `auth=failed` on error. |
| Load sessions | `list_sessions` | `session_list` | Cache panes/sessions for picker. |
| Attach pane (read-only first) | `attach` (`paneId`, optional `lastSeq`) | `ack(action=attach)` then `output` | Set `attachedPaneId`; enter `read_only` unless policy already enabled. |
| Arm input | `enable_input` | `policy_update` | `inputEnabled=true` -> `input_enabled`; `globalInputDisabled=true` -> `kill_switch_blocked`. |
| Disarm input | `disable_input` | `policy_update` | Enter `read_only`. |
| Send command | `input` (`paneId`, `data`) | `ack(action=input)` or `error` | On `ack`, remain/enter writer-active path; on `input_disabled` or `pane_not_attached`, fall back to `read_only`; on `input_lane_conflict`, enter `lane_conflict`. |
| Explicit takeover | `input` with `override=true` or `takeOwnership=true` | `ack(action=input)` or `error(code=input_lane_conflict)` | `ack` resolves conflict to writer-active; repeated conflict keeps `lane_conflict`. |
| Detach pane | `detach` | `ack(action=detach)` | Clear `attachedPaneId`, `lane.mode=none`. |
| Disconnect | `disconnect` | `ack(action=disconnect)` | Clear attach + policy-local write state; return to connected authenticated idle unless client closes socket. |
| Keepalive | `heartbeat` | `heartbeat_ack` | No control-lane state change. |

## 5. ASCII State Diagram

```text
                               socket close/error
         +--------------------------------------------------------------+
         |                                                              v
 [DISCONNECTED] --connect--> [SOCKET_OPEN] --hello.requiresAuth--> [AUTH_REQUIRED]
        ^                          |                                    | \
        |                          | hello.requiresAuth=false           |  \ auth + auth_error
        |                          v                                    |   v
        |                     [AUTH_OK_IDLE] <--- auth retry + auth_ok -- [AUTH_FAILED]
        |                          ^
        |                          |
        |                   auth + auth_ok
        |                          |
        |                          | attach + ack(action=attach)
        |                          v
        |                    [ATTACHED_READ_ONLY]
        |                      |                \
        | enable_input +       | disable_input   \ enable_input + policy_update
        | policy_update        |                  \ inputEnabled=false,
        | inputEnabled=true    |                   \ globalInputDisabled=true
        |                      v                    v
        |                [INPUT_ENABLED]      [KILL_SWITCH_BLOCKED]
        |                      |
        |                      | input + ack(action=input)
        |                      v
        |                [WRITER_ACTIVE]
        |                      |
        |                      | input + error(code=input_lane_conflict)
        |                      v
        |                 [LANE_CONFLICT]
        |                    |      \
        |                    |       \ input(override=true|takeOwnership=true) + ack
        |                    |        \
        |                    v         v
        |             disable_input  [WRITER_ACTIVE]
        |                    |
        |                    v
        +--------------- [ATTACHED_READ_ONLY]

From ATTACHED_READ_ONLY / INPUT_ENABLED / WRITER_ACTIVE / LANE_CONFLICT:
  - detach + ack(action=detach)     -> AUTH_OK_IDLE
  - disconnect + ack(action=disconnect) -> AUTH_OK_IDLE

From any connected state:
  - socket close/error -> DISCONNECTED
```

## 6. Operational Rules for Menu Bar UX

1. Default to read-only after every fresh connect and every reconnect.
2. Keep send action disabled unless:
   - pane is attached,
   - `policy.inputEnabled=true`,
   - `policy.globalInputDisabled=false`.
3. On `input_lane_conflict`, show owner and takeover affordance only when `overrideAllowed=true`.
4. On takeover success (`ack(action=input)` after override request), update badge to `input-enabled`.
5. Before detach/disconnect, issue `disable_input` when possible to reduce handoff ambiguity with other clients.

# Security

CommandRelay treats remote terminal control as high-risk and defaults to read-only behavior.

## Security Objectives

1. Prevent unauthorized access to active terminal sessions.
2. Prevent unauthorized or silent command injection.
3. Preserve operator auditability for sensitive actions.
4. Constrain blast radius when a client or network path is compromised.

## Implementation-Aligned Control Baseline

1. New WebSocket clients start with `inputEnabled=false`.
2. `input` is accepted only when both client input is enabled and global kill switch is off.
3. Non-authenticated clients are blocked from non-`auth` events when `COMMANDRELAY_AUTH_TOKEN` is configured.
4. Startup validation requires `COMMANDRELAY_AUTH_TOKEN` for non-loopback bind addresses.
5. Token validation uses timing-safe comparison (`timingSafeEqual`) with equal-length gate.
6. Input path is guarded by per-client rate limit, max bytes, and attached-pane checks.
7. Sensitive actions (`auth_ok`, `auth_fail`, `attach`, `enable_input`, `disable_input`, `input`) are audit logged.
8. Pane input ownership arbitration is enforced; first successful writer claims pane lane until release or explicit takeover.

## Web Route and Auth Surface

1. HTTP route surface includes exact `GET /health`; with static hosting enabled, `GET /` and `GET /app` redirect (`308`) to `/app/`, which serves static assets.
2. Static serving is rooted at `COMMANDRELAY_APP_STATIC_DIR` (`apps/web` default), with traversal-protection and `404` for missing/forbidden paths.
3. Non-matching HTTP paths return `404`, and non-`/ws` WebSocket upgrades are rejected.
4. Auth for web clients is message-based (`auth.payload.token`), not header-based.
5. When auth token mode is enabled, all non-`auth` events are blocked with `auth_required` until successful auth.

## Keyboard/Input Security Semantics

1. The bridge accepts raw text input only (`input.payload.data`).
2. Newline-separated payloads are executed as Enter-separated tmux sends.
3. There is no server-side symbolic key translation layer for web clients.
4. Security controls apply before dispatch: auth gate, input-enabled policy, pane attachment, byte limit, and input rate limit.

## Attack/Mitigation Matrix (Current Runtime)

| Threat Area | Concrete Attack | Current Mitigation | Residual Risk / Operator Action |
| --- | --- | --- | --- |
| Auth gate | Send `attach`/`input` before auth completes | Server returns `error.code=auth_required` for non-`auth` events until authenticated | If running open mode (no token on loopback), rely on host/network isolation |
| Auth token guessing and timing attacks | Brute-force `auth.token` or exploit compare timing | Static token is required on non-loopback host; compare uses timing-safe equality and rejects different lengths | Static bearer token has no built-in expiry/rotation; rotate operationally |
| Token disclosure in logs | Leak token through audit/event logging | Auth failures log reason (`invalid_token`) but not the submitted token value | Keep process/stdout logs private; avoid reverse proxies that log frames |
| Bi-directional input injection | Malicious client sends unsolicited `input` | Input requires: authenticated client, explicit `enable_input`, kill switch off, attached pane, rate limit pass, payload size <= `COMMANDRELAY_MAX_INPUT_BYTES` | Attached pane trust is session-scoped, not user-scoped ACL |
| Replay on input channel | Re-send old `input` envelope with new transport session | No protocol nonce or anti-replay token for `input`; request correlation is best-effort via `requestId` | Use short-lived network paths and review audit hashes for suspicious duplicates |
| Replay/output gap confusion | Client reconnects with stale `lastSeq` | Server replays bounded in-memory history (`maxHistoryEvents`), then falls back to snapshot if precise range unavailable | History is ephemeral and per-watcher; exact gap reconstruction is not guaranteed |
| Concurrent writers | Multiple clients/tabs enable input on the same pane | Server enforces pane input ownership and rejects non-owner writes with `input_lane_conflict` unless takeover is requested and allowed | Use explicit handoff policy; keep override disabled in higher-risk deployments |
| Kill switch bypass attempt | Client calls `enable_input` while global kill switch is on | `enable_input` cannot override global flag; policy remains `inputEnabled=false`, and `input` returns `input_disabled` | Kill switch is process config, not dynamic remote toggle |

## Kill Switch Semantics (Exact)

1. `COMMANDRELAY_INPUT_KILL_SWITCH` is parsed once at startup (`true/false` strict parser).
2. When on, `enable_input` emits `policy_update` with `inputEnabled=false` and `globalInputDisabled=true`.
3. `input` continues to be rejected with `error.code=input_disabled`.
4. `disable_input` always forces client input state to false.
5. `disconnect` clears attached panes and resets client input state.

## Multi-Client Tab Runbook (Current Runtime)

1. Treat each browser/app tab as an independent client with its own `clientId` and policy state.
2. For a shared pane, designate exactly one writer tab/client; keep all others read-only (`disable_input`).
3. Writer handoff sequence: current writer sends `disable_input` and detaches/disconnects; next writer sends `enable_input`.
4. Emergency takeover uses `input` with `override=true` (or `takeOwnership=true`) when `COMMANDRELAY_ALLOW_INPUT_OVERRIDE=true`.
5. If unexpected commands appear, restart bridge with `COMMANDRELAY_INPUT_KILL_SWITCH=on` to freeze all input, then re-establish one-writer operation.
6. Use audit logs to trace `enable_input`/`disable_input`/`input` events per client during incident review.

## Operator Hardening Checklist

1. Bind to loopback or private mesh only; avoid direct public exposure.
2. Set and rotate `COMMANDRELAY_AUTH_TOKEN`; do not reuse across environments.
3. Enable `COMMANDRELAY_AUDIT_LOG` and protect log file access.
4. Keep `COMMANDRELAY_MAX_INPUT_BYTES` and rate limits conservative.
5. Consider `COMMANDRELAY_ALLOW_INPUT_OVERRIDE=off` for stricter multi-tab control.
6. Treat kill switch as emergency brake and verify policy state from `policy_update`.

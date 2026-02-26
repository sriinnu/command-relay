# CommandRelay (Termina)

<p align="left">
  <img src="docs/brand/commandrelay-logo.svg" alt="CommandRelay logo" width="104" height="104" />
</p>

CommandRelay is a secure, bi-directional terminal control gateway for long-running coding sessions.

It lets you monitor and control home-machine terminal sessions (tmux and ghostty/cmux runtime) from remote clients, with replay, guarded input, and auditability.

## Why This Exists

Long AI coding sessions run for hours while you are away from your main machine.

CommandRelay gives you one control surface to:

1. See active terminal sessions.
2. Reattach after disconnects.
3. Send commands safely when needed.
4. Keep read-only mode as default.

## What You Get

1. WebSocket event protocol with strict envelope validation.
2. Replay-aware terminal output streaming (`streamSeq` + `attach(lastSeq)`).
3. Guarded input flow: `enable_input` -> `input` -> `disable_input`.
4. Kill switch and lane-ownership controls.
5. Runtime backend multiplexer (`tmux`, `cmux`) with backend-aware pane/session routing.
6. Proxy package ecosystem for reusable outbound proxy behavior.

## Architecture

### Runtime Topology

```text
Remote Client (web/iOS/android/macos)
            |
            |  WS (/ws)
            v
+-----------------------------------+
| CommandRelay Gateway (Node/TS)    |
| - Auth / policy / limits          |
| - Replay + output stream engine   |
| - Input lane arbitration          |
+----------------+------------------+
                 |
                 | Runtime multiplexer
                 v
     +-------------------+-------------------+
     |                                       |
+----+------------------+        +-----------+-----------+
| tmux backend adapter  |        | cmux backend adapter  |
| pane ids: %1, %2 ...  |        | pane ids: surface-*   |
+-----------------------+        +-----------------------+
```

### Event Flow (Condensed)

```text
Client -> hello/auth -> list_sessions -> attach(paneId,lastSeq)
Server -> session_list -> output(snapshot/delta, streamSeq)
Client -> enable_input -> input -> disable_input
Server -> ack/error + policy_update
```

### Safety State Model

```text
DISCONNECTED
  -> AUTHENTICATED_READ_ONLY
  -> STREAMING_READ_ONLY
  -> STREAMING_INPUT_ENABLED (explicit only)
  -> READ_ONLY (disable_input / kill switch / disconnect)
```

## Runtime Backends (tmux + ghostty/cmux)

Configure runtime backends with:

```bash
COMMANDRELAY_RUNTIME_BACKENDS=tmux
# or
COMMANDRELAY_RUNTIME_BACKENDS=tmux,cmux
```

Optional cmux command override:

```bash
COMMANDRELAY_CMUX_COMMAND=/opt/homebrew/bin/cmux
```

Notes:

1. Default backend set is `tmux`.
2. In multi-backend mode, pane IDs are backend-namespaced (`tmux:%1`, `cmux:surface-1`).
3. Startup logs availability per backend.
4. Startup fails only when all configured backends are unavailable in non-tmux-only mode.

## Security Model

CommandRelay is secure-by-default:

1. Read-only mode on connect.
2. Explicit input enable required.
3. Global kill switch available.
4. Per-client input rate limits and max payload limits.
5. Pane ownership arbitration to prevent silent concurrent writers.
6. Audit logging support for auth/input/policy events.

## Quick Start

```bash
npm install
npm run check
npm start
```

Default endpoints:

1. Health: `GET http://127.0.0.1:8787/health`
2. Web app (if enabled): `http://127.0.0.1:8787/app/`
3. WebSocket: `ws://127.0.0.1:8787/ws`

## Core Environment Variables

| Variable | Purpose |
| --- | --- |
| `COMMANDRELAY_AUTH_TOKEN` | Token auth for non-loopback binds |
| `COMMANDRELAY_RUNTIME_BACKENDS` | Runtime backend list (`tmux,cmux`) |
| `COMMANDRELAY_CMUX_COMMAND` | cmux executable/path override |
| `COMMANDRELAY_INPUT_KILL_SWITCH` | Global input disable switch |
| `COMMANDRELAY_ALLOW_INPUT_OVERRIDE` | Allow explicit pane ownership takeover |
| `COMMANDRELAY_MAX_INPUT_BYTES` | Max input payload bytes |
| `COMMANDRELAY_MAX_MSG_PER_MIN` | Per-client message rate limit |
| `COMMANDRELAY_MAX_INPUT_PER_MIN` | Per-client input rate limit |
| `COMMANDRELAY_STRICT_PROTOCOL_PARSING` | Strict envelope parsing toggle |
| `COMMANDRELAY_APP_STATIC_ENABLED` | Enable/disable static web app hosting |
| `COMMANDRELAY_APP_STATIC_DIR` | Static app root |
| `COMMANDRELAY_AUDIT_LOG` | Audit JSONL path |
| `HTTP_PROXY`/`HTTPS_PROXY`/`ALL_PROXY`/`NO_PROXY` | Outbound proxy settings |

## Protocol and Behavior

Primary protocol docs:

1. `docs/protocol-v1.md` (normative contract)
2. `docs/protocol.md` (operator-facing summary)
3. `docs/security.md` (threat model + controls)

`list_sessions` behavior in multi-backend mode:

1. `payload.panes[]` include backend-aware pane ids.
2. `payload.sessions[]` are grouped by `(backendId, sessionName)` to avoid cross-backend session-name collisions.

## Validation

Use these for repeatable validation (not date-bound):

```bash
npm run check:root
npm run test:root
npm run ci:all
```

Targeted protocol/runtime checks:

```bash
node --import tsx --test src/protocol.conformance.test.ts
node --import tsx --test src/server/ws-contract-matrix.test.ts
node --import tsx --test src/server/bridge-server.policy.test.ts
```

## Project Structure

```text
src/
  bridge/        replay + delta streaming engine
  server/        ws/http gateway, policies, contract tests
  runtime/       runtime mux + cmux adapter
  tmux/          tmux adapter
  net/           proxy routing and agent factory adapters
packages/
  cli-proxy/
  proxy-core/
  proxy-agent/
  proxy-fetch/
  proxy-http-client/
  proxy-undici/
docs/
  protocol, security, operations, roadmap, proxy ecosystem
apps/
  ios/, android/, web/
```

## Documentation Map

1. `docs/README.md` - full docs index
2. `docs/getting-started.md` - setup and runbook
3. `docs/operations.md` - operations and runtime handling
4. `docs/roadmap-native.md` - iOS/Android/macos/web rollout
5. `docs/proxy-ecosystem-roadmap.md` - proxy package expansion + discovery/use strategy

## Project Status

The core TypeScript gateway is implemented, tested, and production-oriented for the tmux/cmux runtime path.

Active work continues on:

1. Native client parity and UX hardening.
2. Multi-runtime and control-lane reliability.
3. Externalized `@commandrelay` / `@termina` proxy package line, with P1 (`@termina/proxy-undici`, `@termina/cli-proxy`, `@termina/proxy-fetch`) implemented and validated.

## License

MIT.

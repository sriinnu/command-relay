# SKILL: CommandRelay Client (`packages/commandrelay-client`)

## Purpose
`@commandrelay/client` exposes a typed WebSocket client for CommandRelay protocol operations.

This is intended as the canonical SDK for tools that need to:
- discover/attach to remote panes
- stream command output
- enforce input policy changes
- perform authentication and heartbeat loops

## Execution Matrix (Modern AI-friendly)
### Workspace scripts
- `pnpm --filter @commandrelay/client run check`
  - Type checks only (safe prebuild gate).
- `pnpm --filter @commandrelay/client run build`
  - Generates `dist/index.js` and declaration files.

### Extension commands
- `npm run extension:run -- commandrelay-client info`
- `npm run extension:run -- commandrelay-client check`
- `npm run extension:run -- commandrelay-client build`

## Runtime API patterns
### Pattern 1: connect and authenticate
```ts
import { CommandRelayClient, isAuthenticationError } from "@commandrelay/client";

const client = new CommandRelayClient("ws://127.0.0.1:8788/ws", {
  requestTimeoutMs: 8000
});

try {
  const hello = await client.connect();
  if (hello.requiresAuth) {
    await client.authenticate(process.env.COMMANDRELAY_TOKEN ?? "");
  }
  const sessions = await client.listSessions();
  console.log("connected", sessions.sessions?.length ?? 0);
} catch (error) {
  if (isAuthenticationError(error)) {
    console.error("auth failed", error.code);
  } else {
    console.error("connect failed", error);
  }
} finally {
  client.close();
}
```

### Pattern 2: operate on a pane and recover policy
```ts
await client.attach("pane-01");
await client.sendInput("pane-01", "ls -la");
await client.disableInput();
const updated = await client.enableInput();
console.log("input policy", updated.inputEnabled);
await client.heartbeat();
await client.disconnect();
```

## Event model and contracts
- `client.on("hello", (envelope) => ...)`
- `client.on("auth_ok", (payload) => ...)`
- `client.on("auth_error", (payload) => ...)`
- `client.on("output", (payload) => ...)`
- `client.on("session_list", (payload) => ...)`
- `client.on("policy_update", (payload) => ...)`
- `client.on("error", (error) => ...)`
- `client.on("parse_error", (error, raw) => ...)`
- `client.on("close", (code, reason) => ...)`
- `client.on("heartbeat_ack", (payload) => ...)`
- `client.on("ack", (payload) => ...)`
- `client.on("unknown", (payload) => ...)`

## Script output expectations
- `check` exits with non-zero on TypeScript type failures.
- `build` creates `dist/index.js` and `dist/index.d.ts`.
- `close`/`disconnect` methods are idempotent enough for agent loops.

## References
- Source implementation: `packages/commandrelay-client/src/index.ts`
- Validation/type guards: `packages/commandrelay-client/src/validation.ts`
- Shared payload types: `packages/commandrelay-client/src/client-types.ts`

## Operational troubleshooting
- `socket not connected`: call `connect()` before command methods.
- `unexpected response: ...`: likely protocol/event mismatch between client/runtime versions.
- `authentication failed`: rotate token and retry with `authenticate()`.

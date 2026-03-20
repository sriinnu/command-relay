# SKILL: CommandRelay Protocol (`packages/commandrelay-protocol`)

## Purpose
`@commandrelay/protocol` defines the shared v1 protocol model and strict parser used by clients, relays, and any external adapter.

- Protocol metadata constants: event allow-lists, protocol version and required types.
- `envelope()` and `parseMessage()` helpers for request/response messaging.
- Strict parser mode designed for untrusted websocket ingress.

## Execution Matrix (Modern AI-friendly)
### Workspace scripts
- `pnpm --filter @commandrelay/protocol run check`
- `pnpm --filter @commandrelay/protocol run build`

### Extension commands
- `npm run extension:run -- commandrelay-protocol info`
- `npm run extension:run -- commandrelay-protocol check`
- `npm run extension:run -- commandrelay-protocol build`

## Runtime examples
### Build an envelope
```ts
import { envelope, PROTOCOL_V1 } from "@commandrelay/protocol";

const frame = envelope("heartbeat", { t: 123 }, "hb-1");
console.log(frame.v === PROTOCOL_V1, frame.type, frame.requestId);
```

### Strict parsing (trusted/untrusted input)
```ts
import { parseMessage } from "@commandrelay/protocol";

const raw = JSON.stringify({
  v: 1,
  type: "hello",
  requestId: "h-1",
  timestamp: Date.now(),
  payload: { clientId: "agent", serverVersion: "0.1.0", requiresAuth: false, inputEnabled: true }
});

const parsed = parseMessage(raw, { strictV1: true });
if (!parsed.ok) throw new Error(parsed.error);
console.log(parsed.message.type);
```

## Operational contracts
- Strict mode enforces:
  - `v === 1`
  - event type in allow-list
  - finite integer timestamp and bounded request id length
- Non-strict mode is intentionally more permissive for internal tooling; production should use strict parsing on incoming remote traffic.

## Parsing failure mapping
- `invalid_json_object` / `invalid_json`: malformed JSON or non-object payload.
- `invalid_type` / `unsupported_type`: bad or unknown event type.
- `missing_request_id` / `invalid_request_id`: request correlation issues.
- `invalid_payload`: payload is not a record.

## References
- `packages/commandrelay-protocol/src/index.ts`

## Integration notes
- Use this package directly when building custom gateways or replay tooling.
- For CLI tooling, prefer `@commandrelay/client` for transport and stateful request semantics.

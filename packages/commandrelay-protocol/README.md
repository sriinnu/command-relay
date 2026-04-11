# @commandrelay/protocol

![@commandrelay/protocol brand mark](./docs/assets/commandrelay-protocol-brand.svg)

Shared WebSocket protocol schema for CommandRelay

## Install

```bash
npm install @commandrelay/protocol
```

## Runtime

- Node.js `>=18`
- ESM package ("type": "module")

## Use Cases

- Shared protocol-level primitives for CommandRelay components
- Internal composition point for package-level clients and transports
- Reusable utilities for CommandRelay runtimes and toolchains

## Notes

- See neighboring packages and docs for transport-specific integrations.
- Keep package-specific public surface stable and document any new public symbols in companion docs.

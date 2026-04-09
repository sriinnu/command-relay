# proxy-http-client Examples

Copy-paste-ready adapters for `@commandrelay/proxy-http-client`.

These examples are useful when you want `requestJson(...)` as the single HTTP boundary, while keeping familiar call shapes from other clients.

Each example includes a runnable snippet and an expected output snapshot.
Snapshots are stored under [`./snapshots`](./snapshots/).

## Choose an adapter

- [Axios-style adapter](./axios.md)
  - Snapshot: [`./snapshots/axios.expected.json`](./snapshots/axios.expected.json)
- [Undici-style adapter](./undici.md)
  - Snapshot: [`./snapshots/undici.expected.json`](./snapshots/undici.expected.json)
- [Got-style adapter](./got.md)
  - Snapshot: [`./snapshots/got.expected.json`](./snapshots/got.expected.json)
- [Fetch-style adapter](./fetch.md)
  - Snapshot: [`./snapshots/fetch.expected.json`](./snapshots/fetch.expected.json)

## Shared setup

All examples use `@commandrelay/proxy-agent` as an optional proxy resolver:

```ts
import { ProxyAgentFactory } from "@commandrelay/proxy-agent";

export const proxyFactory = new ProxyAgentFactory();
```

Pass `proxyFactory` to `requestJson(..., { proxyResolver: proxyFactory })` and call `proxyFactory.destroy()` on shutdown.

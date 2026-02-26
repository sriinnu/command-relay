# proxy-http-client Examples

Copy-paste-ready adapters for `@commandrelay/proxy-http-client`.

These examples are useful when you want `requestJson(...)` as the single HTTP boundary, while keeping familiar call shapes from other clients.

## Choose an adapter

- [Axios-style adapter](./axios.md)
- [Undici-style adapter](./undici.md)
- [Got-style adapter](./got.md)
- [Fetch-style adapter](./fetch.md)

## Shared setup

All examples use `@commandrelay/proxy-agent` as an optional proxy resolver:

```ts
import { ProxyAgentFactory } from "@commandrelay/proxy-agent";

export const proxyFactory = new ProxyAgentFactory();
```

Pass `proxyFactory` to `requestJson(..., { proxyResolver: proxyFactory })` and call `proxyFactory.destroy()` on shutdown.

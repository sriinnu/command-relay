# SKILL: @commandrelay/proxy-undici

`@commandrelay/proxy-undici` builds cached Undici dispatcher routing for proxy-aware `http`/`https` request flows.

## Install

```bash
npm install @commandrelay/proxy-undici undici
```

## Execution (Modern AI-ready)

- Type check: `pnpm --filter @commandrelay/proxy-undici run check`
- Build: `pnpm --filter @commandrelay/proxy-undici run build`
- Tests: `pnpm --filter @commandrelay/proxy-undici run test`
- Extension metadata: `npm run extension:run -- proxy-undici info`
- Extension check: `npm run extension:run -- proxy-undici check`
- Extension build: `npm run extension:run -- proxy-undici build`
- Extension test: `npm run extension:run -- proxy-undici test`

## Exported API

- Class: `ProxyUndiciDispatcherFactory`
  - `resolve`, `clear`, `destroy`, `dispose`, `updateSettings`, `reloadFromEnvironment`
- Top-level helpers: `createProxyUndiciDispatcherFactory`, `normalizeCacheEntries`
- Types: `ProxyUndiciDispatcherFactoryOptions`, `ProxyUndiciDispatcherResolution`, `BoundedDispatcherCache`
- Errors: `InvalidProxyUrlError`, `InvalidTargetUrlError`, `UnsupportedProxyProtocolError`, `UnsupportedTargetProtocolError`

## Reference Snippet

```ts
import { ProxyUndiciDispatcherFactory } from "@commandrelay/proxy-undici";
import { request } from "undici";

const factory = new ProxyUndiciDispatcherFactory({
  maxCacheEntries: 64,
  env: {
    https_proxy: "http://proxy.internal:8443",
    no_proxy: "internal.service.local"
  }
});

const resolution = factory.resolve("https://api.example.com/v1/status");
console.log("proxy-via", resolution.viaProxy, "cache", resolution.fromCache, "proxy", resolution.proxyUrl);

const response = await request("https://api.example.com/v1/status", {
  method: "GET",
  dispatcher: resolution.dispatcher
});

console.log(response.statusCode);
factory.destroy();
```

## Operational Notes

- Use this package for Undici-native integrations only.
- Restart or call `destroy()` for resource release; this package intentionally does not persist cache across process restarts.
- SOCKS/PAC protocols are not supported in this adapter.

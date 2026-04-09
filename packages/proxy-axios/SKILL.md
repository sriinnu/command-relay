# SKILL: @commandrelay/proxy-axios

`@commandrelay/proxy-axios` provides Axios-adapter utilities so request configs become proxy-aware without bundling Axios internals into package dependencies.

## Install

```bash
npm install @commandrelay/proxy-axios
```

## Execution (Modern AI-ready)

- Type check: `pnpm --filter @commandrelay/proxy-axios run check`
- Build: `pnpm --filter @commandrelay/proxy-axios run build`
- Tests: `pnpm --filter @commandrelay/proxy-axios run test`
- Workspace help: `npm run extension:run -- proxy-axios info`
- Health check: `npm run extension:run -- proxy-axios check`
- Deterministic build: `npm run extension:run -- proxy-axios build`
- Deterministic test: `npm run extension:run -- proxy-axios test`

## API Surface

- Class: `ProxyAxiosAgentResolver`
  - `resolve`, `apply`, `clear`, `destroy`, `dispose`, `cacheSize`, `updateSettings`, `reloadFromEnvironment`
- Helpers:
  - `applyProxyAgentToAxiosConfig`
  - `resolveAxiosRequestTarget`
  - `resolveProxyAxiosAgent`
  - `createProxyAxiosAgentResolver`
- Exports from `@commandrelay/proxy-agent` for policy consistency: `loadProxySettings`, `parseNoProxy`, `resolveProxyForUrl`, `shouldBypassProxy`.

## Reference Snippet

```ts
import axios from "axios";
import {
  ProxyAxiosAgentResolver,
  applyProxyAgentToAxiosConfig,
  type ProxyAxiosRequestConfig,
  type ProxyAxiosApplyOptions
} from "@commandrelay/proxy-axios";

const resolver = new ProxyAxiosAgentResolver({
  env: {
    https_proxy: "http://proxy.internal:8443",
    no_proxy: "localhost,127.0.0.1"
  }
});

const raw: ProxyAxiosRequestConfig = {
  baseURL: "https://api.example.com/v1",
  url: "/health",
  method: "GET"
};

const opts: ProxyAxiosApplyOptions = { mutate: true, disableAxiosProxyConfig: true };
const applied = applyProxyAgentToAxiosConfig(raw, resolver, opts);

const response = await axios.request(applied.config);
console.log(response.status, applied.routing.viaProxy, applied.routing.proxyUrl);

const second = resolver.resolve("https://api.example.com/metrics");
console.log("fromCache", second.fromCache);

resolver.destroy();
```

## Runtime/Operational Notes

- `ProxyAxiosAgentResolver.apply()` returns routing metadata for observability (`viaProxy`, `proxyUrl`, `fromCache`).
- Keep `proxy: false` unless you intentionally want axios’s own proxy logic (`disableAxiosProxyConfig` controls this).
- In CI, run `npm run extension:run -- proxy-axios test` to validate examples and snapshots.

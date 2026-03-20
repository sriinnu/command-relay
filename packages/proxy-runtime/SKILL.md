# SKILL: @commandrelay/proxy-runtime

`@commandrelay/proxy-runtime` provides a long-lived decision controller with metrics and lifecycle for proxy policy + agent cache management.

## Install

```bash
npm install @commandrelay/proxy-runtime
```

## Execution (Modern AI-ready)

- Type check: `pnpm --filter @commandrelay/proxy-runtime run check`
- Build: `pnpm --filter @commandrelay/proxy-runtime run build`
- Tests: `pnpm --filter @commandrelay/proxy-runtime run test`
- Metadata via extension: `npm run extension:run -- proxy-runtime info`
- Health checks via extension: `npm run extension:run -- proxy-runtime check`
- Build via extension: `npm run extension:run -- proxy-runtime build`
- Test via extension: `npm run extension:run -- proxy-runtime test`

## Exported API

- Class: `ProxyRuntimeController`
  - `resolve`, `updateSettings`, `reloadFromEnvironment`, `clear`, `destroy`, `dispose`, `cacheSize`, `getSnapshot`
- Factory: `createProxyRuntimeController`
- Types: `ProxyRuntimeControllerOptions`, `ProxyRuntimeResolution`, `ProxyRuntimeDecisionMetadata`, `ProxyRuntimeStats`, `ProxyRuntimeSnapshot`

## Reference Snippet

```ts
import {
  ProxyRuntimeController,
  createProxyRuntimeController,
  type ProxyRuntimeResolution
} from "@commandrelay/proxy-runtime";

const controller = new ProxyRuntimeController({
  env: {
    https_proxy: "http://proxy.internal:8443",
    no_proxy: ".svc.cluster.local,localhost"
  },
  maxCacheEntries: 128
});

const result: ProxyRuntimeResolution = controller.resolve("https://api.internal.example.com/health");
console.log(result.metadata.mode, result.metadata.reason, result.metadata.viaProxy, result.metadata.proxyUrl);

const snap = controller.getSnapshot();
console.log("requests", snap.stats.resolveCount, "agentCache", snap.cacheSize);

controller.updateSettings({
  ...controller.getSnapshot().settings,
  noProxy: []
});

controller.destroy();

const second = createProxyRuntimeController();
console.log(second.getSnapshot().stats.resolveCount);
second.dispose();
```

## Runtime Monitoring

- `getSnapshot().stats` tracks resolve, proxy, direct, and cache-hit counters.
- `getSnapshot().settings` gives current effective settings for diagnostics.
- `metadata.reason` on each resolution is useful for policy tracing (`proxy_configured`, `no_proxy_match`, `proxy_not_configured`).

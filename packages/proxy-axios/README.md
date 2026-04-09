# @commandrelay/proxy-axios

<p align="left">
  <img src="./docs/assets/proxy-axios-brand.svg" width="88" height="88" alt="Proxy Axios brand mark" />
</p>

Axios-friendly proxy agent adapter for Node.js. It provides typed config contracts and helpers so you can apply proxy routing with `@commandrelay/proxy-agent` without importing axios at runtime.

Typed axios integration that keeps proxy routing explicit and portable.

## Install

```bash
npm install @commandrelay/proxy-axios
```

## Runtime support

- Node.js `>=18`
- npm `>=9`
- ESM package (`"type": "module"`)

## Version support policy

- Current line: `0.1.x`
- While pre-`1.0`, pin minor versions in production (`~0.1.0`).

## Export surface

- `@commandrelay/proxy-axios` (root API)
- `@commandrelay/proxy-axios/package.json` (metadata only)
- Deep imports such as `@commandrelay/proxy-axios/dist/*` are intentionally unsupported.

## Quick Start

```ts
import axios from "axios";
import {
  ProxyAxiosAgentResolver,
  applyProxyAgentToAxiosConfig,
  type ProxyAxiosRequestConfig
} from "@commandrelay/proxy-axios";

const resolver = new ProxyAxiosAgentResolver({
  env: {
    https_proxy: "http://proxy.local:8443",
    no_proxy: "127.0.0.1,localhost"
  }
});

const requestConfig: ProxyAxiosRequestConfig = {
  baseURL: "https://api.example.com",
  url: "/health",
  method: "GET",
  timeout: 5_000
};

const applied = applyProxyAgentToAxiosConfig(requestConfig, resolver);
const response = await axios.request({
  ...applied.config
});

console.log(response.status, applied.routing.viaProxy, applied.routing.proxyUrl);
resolver.destroy();
```

## Usage Matrix

| Scenario | Recommended API | Why |
| --- | --- | --- |
| One shared resolver for many axios calls | `new ProxyAxiosAgentResolver(...)` + `resolver.apply(config)` | Reuses bounded proxy agent cache and exposes routing metadata |
| Existing resolver boundary in your app | `applyProxyAgentToAxiosConfig(config, resolver)` | Works with structural resolver contract and keeps app wiring explicit |
| URL assembled from `baseURL` + relative path | `resolveAxiosRequestTarget({ url, baseURL })` | Deterministic target resolution before request dispatch |
| Need deterministic observability | Read `routing.viaProxy`, `routing.proxyUrl`, `routing.fromCache` | Keeps direct/proxy/cache telemetry stable |

## Migration

1. Replace ad-hoc `httpAgent` / `httpsAgent` assignment with a shared `ProxyAxiosAgentResolver`.
2. Resolve and apply config at your HTTP boundary (`service client`, `API gateway adapter`, `CLI transport`).
3. Keep axios `proxy` behavior disabled (`proxy: false`) through apply helper defaults to avoid double-proxy logic.
4. Capture `routing` metadata in structured logs so direct/proxy decisions are auditable.
5. Dispose resolver on shutdown (`resolver.destroy()` or `resolver.dispose()`).

## API Summary

```ts
class ProxyAxiosAgentResolver {
  resolve(target: string | URL): ProxyAxiosAgentResolution;
  apply<TConfig extends ProxyAxiosRequestConfig>(
    config: TConfig,
    options?: ProxyAxiosApplyOptions
  ): ProxyAxiosApplyResult<TConfig>;
}

function resolveAxiosRequestTarget(
  target: string | URL | { url?: string | URL; baseURL?: string | URL },
  baseURL?: string | URL
): URL;

function resolveProxyAxiosAgent(
  target: ProxyAxiosTarget,
  resolver: ProxyAxiosResolverLike
): ProxyAxiosResolvedTarget;

function applyProxyAgentToAxiosConfig<TConfig extends ProxyAxiosRequestConfig>(
  config: TConfig,
  resolver: ProxyAxiosResolverLike,
  options?: ProxyAxiosApplyOptions
): ProxyAxiosApplyResult<TConfig>;
```

`ProxyAxiosApplyResult` preserves routing metadata:

- `routing.viaProxy: boolean`
- `routing.proxyUrl: string | null`
- `routing.fromCache: boolean`

## Troubleshooting

- Proxy expected but request is direct:
  - Inspect `routing.viaProxy` and `routing.proxyUrl` from apply/resolve helpers.
  - Validate `NO_PROXY` patterns and casing (`no_proxy` vs `NO_PROXY`).
- Request unexpectedly proxied:
  - Check whether `ALL_PROXY` or `http_proxy` fallback is active.
  - Confirm target host/port does not bypass `NO_PROXY` rules.
- Agent mismatch across protocols:
  - Ensure target URL protocol is correct before applying config.
  - Keep a single shared resolver so cache behavior is deterministic.
- Relative URLs failing:
  - Provide `baseURL` when `url` is relative (`/path`).

## Examples and Assets

- [Examples index](./docs/examples/README.md)
- [Integration notes](./NOTES.md)
- [Brand SVG](./docs/assets/proxy-axios-brand.svg)

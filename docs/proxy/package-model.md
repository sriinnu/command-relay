# Proxy Package Model

This document defines the current package contract for outbound proxy routing and how the runtime adapters consume it.

## Scope

- `@commandrelay/proxy-core`
- `@commandrelay/proxy-agent`
- `@commandrelay/proxy-http-client`

Compatibility adapters live in `src/net/*` and `src/control-plane/*`.

## Responsibilities

| Package | Primary responsibility | Network I/O |
| --- | --- | --- |
| `@commandrelay/proxy-core` | Parse/sanitize proxy env, parse `NO_PROXY`, resolve proxy URL by target | No |
| `@commandrelay/proxy-agent` | Map proxy URL to concrete Node agent and cache reusable agents | Yes (agent usage) |
| `@commandrelay/proxy-http-client` | Execute JSON HTTP(S) with timeout/abort and typed errors | Yes |

## Package Contracts

### `@commandrelay/proxy-core`

- `loadProxySettings(env?)`, `parseNoProxy(raw)`, `shouldBypassProxy(target, rules)`, `resolveProxyForUrl(target, settings)`, `resolveProxyForUrlFromEnv(target, env?)`
- Lowercase proxy env vars take precedence over uppercase variants.
- In CGI-like environments (`REQUEST_METHOD` present), uppercase `HTTP_PROXY` is ignored.
- Proxy URL sanitization allows only: `http`, `https`, `socks*`, `pac+http`, `pac+https`, `pac+file`, `pac+data`.
- Invalid proxy values and invalid `NO_PROXY` tokens are ignored safely.

### `@commandrelay/proxy-agent`

- `new ProxyAgentFactory({ settings?, env?, maxCacheEntries? })`
- `resolve(target)` returns `{ agent, proxyUrl, viaProxy, fromCache }`.
- Protocol mapping:
  - `http|ws` target over `http|https` proxy -> `HttpProxyAgent`
  - `https|wss` target over `http|https` proxy -> `HttpsProxyAgent`
  - `socks*` proxy -> `SocksProxyAgent`
  - `pac+*` proxy -> `PacProxyAgent`
- Cache key is `proxyUrl|targetProtocol` with bounded LRU-style eviction (default `256`, `0` disables cache).

### `@commandrelay/proxy-http-client`

- `requestJson(url, options)` accepts `http:` and `https:` only.
- `proxyResolver.resolve(target)` supports sync or async resolver implementations.
- Default timeout is `8000ms`.
- Returns `{ status, headers, body, rawBody }`.
- Typed errors include protocol, resolver, timeout, abort, HTTP status, and JSON parse failures.

## Runtime Adapter Snapshot (Current Repo)

```text
src/net/proxy-router.ts
  -> packages/proxy-agent/src/proxy-settings.ts
src/net/proxy-agent-factory.ts
  -> packages/proxy-agent/src/proxy-agent-factory.ts
src/net/outbound-http.ts
  -> packages/proxy-http-client/src/index.ts
src/control-plane/control-plane-client.ts
  -> packages/proxy-agent/src/index.ts
  -> packages/proxy-http-client/src/index.ts
```

- Runtime wrappers currently import package `src` directly, not published `dist` entrypoints.
- `src/net/proxy-router.ts` intentionally keeps legacy env fallback (`HTTP_PROXY || http_proxy`), so uppercase wins unless uppercase is empty.
- `src/net/proxy-agent-factory.ts` drops `fromCache` metadata from package resolution.
- `src/net/outbound-http.ts` forces `throwOnHttpError: false` and returns `{ status, headers, body }` only.
- `src/index.ts` initializes proxy settings/factory at boot for startup diagnostics; outbound control-plane traffic is not wired into startup flow yet.

## Data Flow (Package Contract)

```text
Caller
  -> requestJson(target, { proxyResolver })
  -> proxyResolver.resolve(target)
  -> ProxyAgentFactory.resolve(target)
  -> resolveProxyForUrl(target, settings)
  -> direct request OR proxy agent request
```

## Production Baseline

- Reuse one `ProxyAgentFactory` per process for steady-state traffic.
- Keep `NO_PROXY` explicit for control-plane and telemetry destinations.
- Validate package contracts before release:
  - `npm --prefix packages/proxy-core test`
  - `npm --prefix packages/proxy-agent test`
  - `npm --prefix packages/proxy-http-client test`

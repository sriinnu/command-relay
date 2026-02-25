# Proxy Package Model

This document defines the production package model for outbound proxy routing in CommandRelay.

## Scope

- `@commandrelay/proxy-core`
- `@commandrelay/proxy-agent`
- `@commandrelay/proxy-http-client`

Compatibility wrappers in `src/net/*` and `src/control-plane/*` are adapters around these packages.

## Responsibilities

| Package | Primary responsibility | Network I/O |
| --- | --- | --- |
| `@commandrelay/proxy-core` | Parse/sanitize proxy env, parse `NO_PROXY`, resolve proxy URL by target | No |
| `@commandrelay/proxy-agent` | Map proxy URL to concrete Node agent, cache reusable agents | Yes (via agent usage) |
| `@commandrelay/proxy-http-client` | Execute JSON HTTP(S) with timeout/abort/error typing and optional proxy resolver | Yes |

## Public Contract

### `@commandrelay/proxy-core`

- `loadProxySettings(env?)` reads `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, `NO_PROXY`
- Lowercase env names override uppercase variants
- In CGI-like envs (`REQUEST_METHOD` present), uppercase `HTTP_PROXY` is ignored
- `resolveProxyForUrl(target, settings)` applies protocol precedence and `NO_PROXY` bypass rules

### `@commandrelay/proxy-agent`

- `new ProxyAgentFactory({ settings, maxCacheEntries })`
- `resolve(target)` returns `{ agent, proxyUrl, viaProxy, fromCache }`
- Protocol mapping:
  - `http|ws` target over `http|https` proxy -> `HttpProxyAgent`
  - `https|wss` target over `http|https` proxy -> `HttpsProxyAgent`
  - `socks*` proxy -> `SocksProxyAgent`
  - `pac+*` proxy -> `PacProxyAgent`
- Cache key is `proxyUrl|targetProtocol` with bounded LRU-style eviction (default `256`)

### `@commandrelay/proxy-http-client`

- `requestJson(url, options)` supports `http:` and `https:` targets only
- `proxyResolver.resolve(target)` can inject proxy-aware agents
- Timeout, abort, status, and JSON-parse failures are returned as typed errors

## Data-Flow Diagram

```text
Caller
  |
  | requestJson(target, { proxyResolver })
  v
@commandrelay/proxy-http-client
  |
  | resolve(target)
  v
@commandrelay/proxy-agent
  |
  | resolveProxyForUrl(target, settings)
  v
@commandrelay/proxy-core
  |
  +--> null -----------------------> direct Node http/https request
  |
  +--> proxy URL -> concrete agent -> proxy hop/tunnel -> target
```

## Sequence Diagram

```text
App -> proxy-core: loadProxySettings(env)
App -> proxy-agent: new ProxyAgentFactory({ settings })
App -> proxy-http-client: requestJson("https://api.service", { proxyResolver: factory })
proxy-http-client -> proxy-agent: resolve(target)
proxy-agent -> proxy-core: resolveProxyForUrl(target, settings)
proxy-core --> proxy-agent: proxy URL | null
proxy-agent --> proxy-http-client: agent metadata
proxy-http-client -> Node transport: execute request (agent attached when proxied)
Node transport --> proxy-http-client: status + headers + body
proxy-http-client --> App: JsonResponse<T>
```

## Current Repo Integration

- `src/net/proxy-router.ts` and `src/net/proxy-agent-factory.ts` are runtime compatibility wrappers
- `src/control-plane/control-plane-client.ts` uses package-backed proxy resolution and HTTP transport
- `src/index.ts` initializes proxy settings/factory at boot, but outbound control-plane usage is not wired into bridge startup yet
- `packages/proxy-core` is available as a standalone package contract; current wrappers still import settings logic from `packages/proxy-agent/src/proxy-settings.ts`

## Production Baseline

- Reuse one `ProxyAgentFactory` per process for steady-state traffic
- Pass that factory into request helpers as `proxyResolver`
- Keep `NO_PROXY` explicit for internal control-plane and telemetry domains
- Validate package contracts before release:
  - `npm --prefix packages/proxy-core test`
  - `npm --prefix packages/proxy-agent test`
  - `npm --prefix packages/proxy-http-client test`

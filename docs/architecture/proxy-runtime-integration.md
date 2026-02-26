# Proxy Runtime Integration Path

This document maps where proxy packages are integrated in the current bridge runtime.

## Integration Surfaces

- Bootstrap (`src/index.ts`)
  - Loads proxy settings through `src/net/proxy-router.ts`.
  - Creates `src/net/ProxyAgentFactory` at startup.
  - Logs when at least one sanitized proxy URL is configured.
  - Does not dispatch outbound control-plane requests in the startup path.
- Runtime compatibility adapters (`src/net/*`)
  - `proxy-router.ts` wraps package proxy settings primitives.
  - `proxy-agent-factory.ts` wraps package `ProxyAgentFactory`.
  - `outbound-http.ts` wraps package `requestJson`.
- Control-plane module (`src/control-plane/control-plane-client.ts`)
  - `createControlPlaneClientFromEnv` builds an env-driven proxy factory.
  - Request dispatch uses package proxy resolution and package HTTP client transport.

## File-Level Dependency Path

```text
src/index.ts
  -> src/net/proxy-router.ts
      -> packages/proxy-agent/src/proxy-settings.ts
  -> src/net/proxy-agent-factory.ts
      -> packages/proxy-agent/src/proxy-agent-factory.ts

src/net/outbound-http.ts
  -> packages/proxy-http-client/src/index.ts

src/control-plane/control-plane-client.ts
  -> packages/proxy-agent/src/index.ts
  -> packages/proxy-http-client/src/index.ts
```

Note: `packages/proxy-core` is published as the standalone proxy policy layer, but current runtime wrappers still route through `packages/proxy-agent/src/proxy-settings.ts`.

## Startup Flow (Current)

```text
src/index.ts
  -> loadProxySettings()
  -> new ProxyAgentFactory({ settings })
  -> if proxy configured: log "[bridge] outbound proxy settings detected"
  -> startBridgeServer(...)
```

## Control-Plane Flow (Module Path)

```text
Env (HTTP_PROXY/HTTPS_PROXY/ALL_PROXY/NO_PROXY)
  -> createControlPlaneProxyFactory()
  -> ProxyAgentFactory(settings)
  -> ControlPlaneClient.post()
  -> proxy-http-client.requestJson(..., { proxyResolver, throwOnHttpError: false })
  -> Node http/https request (proxied or direct)
  -> non-2xx => ControlPlaneHttpError
```

## Operational Notes

- Invalid/unsupported proxy URLs are sanitized to `null`; startup does not fail fast on malformed proxy env values.
- `src/net/proxy-router.ts` uses legacy fallback (`HTTP_PROXY || http_proxy`), which differs from package default lowercase precedence.
- Control-plane proxy behavior is covered by `src/control-plane/control-plane-client.test.ts`.
- Runtime compatibility wrappers keep current call sites stable while package boundaries converge.

## Production Readiness Checklist

- Reuse proxy resolver instances; avoid per-request factory construction.
- Keep `NO_PROXY` rules explicit for control-plane and internal destinations.
- Set explicit `timeoutMs` values for outbound control-plane calls.
- Keep proxy and integration tests in CI:
  - `npm --prefix packages/proxy-core test`
  - `npm --prefix packages/proxy-agent test`
  - `npm --prefix packages/proxy-http-client test`
  - `node --import tsx --test src/net/proxy-router.test.ts src/net/proxy-agent-factory.test.ts src/control-plane/control-plane-client.test.ts`

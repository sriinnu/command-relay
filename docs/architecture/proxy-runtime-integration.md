# Proxy Runtime Integration Path

This document shows where proxy packages are integrated in the current runtime.

## Integration Surfaces

- Bootstrap surface (`src/index.ts`)
  - Loads proxy settings (`loadProxySettings`)
  - Creates `ProxyAgentFactory` during startup
  - Emits startup log when proxy env is configured
- Runtime compatibility surface (`src/net/*`)
  - `proxy-router.ts` wraps package proxy-setting primitives
  - `proxy-agent-factory.ts` wraps package `ProxyAgentFactory`
  - `outbound-http.ts` wraps package `requestJson`
- Control-plane surface (`src/control-plane/control-plane-client.ts`)
  - `createControlPlaneClientFromEnv` builds env-driven proxy factory
  - Request dispatch flows through package-managed proxy resolver and HTTP client

## File-Level Path

```text
src/index.ts
  -> src/net/proxy-router.ts
      -> packages/proxy-agent/src/proxy-settings.ts
  -> src/net/proxy-agent-factory.ts
      -> packages/proxy-agent/src/proxy-agent-factory.ts

src/control-plane/control-plane-client.ts
  -> packages/proxy-agent/src/index.ts
  -> packages/proxy-http-client/src/index.ts
```

Note: `packages/proxy-core` provides the standalone policy layer contract, but current runtime wrappers are still wired to `packages/proxy-agent/src/proxy-settings.ts`.

## Runtime Data Flow (Control-Plane)

```text
Env (HTTP_PROXY/HTTPS_PROXY/ALL_PROXY/NO_PROXY)
  -> createControlPlaneProxyFactory()
  -> ProxyAgentFactory(settings)
  -> ControlPlaneClient.post()
  -> proxy-http-client.requestJson(..., { proxyResolver })
  -> resolver.resolve(target)
  -> Node http/https request (proxied or direct)
```

## Runtime Sequence (Control-Plane)

```text
ControlPlaneClient -> createControlPlaneProxyFactory: load env settings
createControlPlaneProxyFactory -> ProxyAgentFactory: create cache-backed resolver
ControlPlaneClient -> proxy-http-client.requestJson: POST /auth|pair|telemetry
proxy-http-client -> ProxyAgentFactory.resolve: resolve target route
ProxyAgentFactory -> proxy-settings.resolveProxyForUrl: choose proxy or direct
ProxyAgentFactory --> proxy-http-client: agent + route metadata
proxy-http-client -> Node transport: execute with timeout/abort semantics
Node transport --> ControlPlaneClient: response envelope
```

## Operational Notes

- Startup initialization catches malformed proxy env early, before outbound request execution
- Control-plane proxy behavior is covered by `src/control-plane/control-plane-client.test.ts`
- Compatibility wrappers isolate call sites while package boundaries stabilize

## Production Readiness Checklist

- Reuse proxy resolver instances; avoid per-request factory construction
- Keep `NO_PROXY` rules explicit for control-plane and internal destinations
- Set explicit `timeoutMs` values for outbound control-plane calls
- Keep proxy and integration tests in CI:
  - `npm --prefix packages/proxy-core test`
  - `npm --prefix packages/proxy-agent test`
  - `npm --prefix packages/proxy-http-client test`
  - `node --import tsx --test src/control-plane/control-plane-client.test.ts`

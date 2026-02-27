# @termina/proxy-fetch Notes

## Scope

This package adds proxy-aware wrappers around Node fetch with JSON-specific safety defaults.
Dispatcher resolution is delegated to `@termina/proxy-undici`.

## Compatibility Checklist

- Node.js `>=18` with global `fetch` support.
- ESM runtime/package consumption.
- Proxy environment behavior inherited from `@termina/proxy-undici` and `@commandrelay/proxy-core`.
- Dispatcher injection is Node-specific and not a browser feature.

## Migration Checklist

1. Replace direct `fetch` + ad-hoc proxy logic with `proxyFetch`/`proxyFetchJson`.
2. For repeated traffic, consolidate into a shared `ProxyFetchClient` instance.
3. Move timeout/body size constants into client defaults (`defaultTimeoutMs`, `defaultMaxResponseBytes`).
4. Translate package errors to domain errors at your API boundary.

## Troubleshooting Playbook

- Route is direct when proxy expected:
  - Validate `NO_PROXY` matches and inspect normalized settings with `loadProxySettings`.
- Route is proxied when direct expected:
  - Check for `ALL_PROXY` fallback values and missing `NO_PROXY` rules.
- Timeout errors on healthy endpoints:
  - Revisit timeout budgets and upstream latency expectations.
- JSON parsing/content-type failures:
  - Use `fetch()` for non-JSON endpoints, reserve `fetchJson()` for JSON-only contracts.

## Operational Checklist

1. `npm --prefix packages/proxy-fetch run check`
2. `npm --prefix packages/proxy-fetch run build`
3. `npm --prefix packages/proxy-fetch run test`
4. Validate env-specific routing in integration tests using explicit `settings`.

## Integration Guidance

1. Reuse one `ProxyFetchClient` per long-lived process.
2. Choose endpoint-specific `timeoutMs` and `maxResponseBytes` values.
3. Map package errors to application-domain errors at your boundary.
4. Avoid logging full `rawBody` in production for sensitive endpoints.

## Related

- [Package README](./README.md)
- [Examples](./docs/examples/README.md)
- [Brand SVG](./docs/assets/proxy-fetch-brand.svg)

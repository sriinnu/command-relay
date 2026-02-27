# @termina/proxy-fetch Notes

## Scope

This package adds proxy-aware wrappers around Node fetch with JSON-specific safety defaults.
Dispatcher resolution is delegated to `@termina/proxy-undici`.

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
- [Brand SVG](./docs/assets/proxy-fetch-brand.svg)

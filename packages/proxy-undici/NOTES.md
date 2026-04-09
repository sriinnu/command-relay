# @commandrelay/proxy-undici Notes

## Scope

This package binds proxy routing decisions to Undici dispatchers.
It does not implement SOCKS or PAC dispatchers.

## Compatibility Checklist

- Node.js `>=18` with Undici runtime support.
- ESM runtime/package consumption.
- Supports HTTP/HTTPS targets and HTTP/HTTPS proxies.
- Requires `@commandrelay/proxy-agent` for SOCKS/PAC proxy protocols.

## Migration Checklist

1. Move from per-request `ProxyAgent` construction to a shared `ProxyUndiciDispatcherFactory`.
2. Keep URL-to-dispatcher resolution close to request creation (`factory.resolve(target)`).
3. Use `updateSettings`/`reloadFromEnvironment` for runtime proxy changes.
4. Always call `destroy()` when the process exits.

## Security and Safety

1. Honors `NO_PROXY` bypass rules from `@commandrelay/proxy-core`.
2. Rejects unsupported proxy protocols early (`socks:*`, `pac+*`).
3. Supports bounded cache + explicit teardown to avoid descriptor leaks.

## Troubleshooting Playbook

- `invalid_target_url`:
  - Input is not a parseable URL; validate before calling `resolve`.
- `invalid_proxy_url`:
  - One of the selected proxy settings contains malformed URL data.
- `unsupported_target_protocol:*`:
  - Only `http:` and `https:` targets are supported.
- Dispatcher cache churn:
  - Increase `maxCacheEntries` if your service uses many unique proxy URLs.

## Operational Checklist

1. Run `npm --prefix packages/proxy-undici run check`.
2. Run `npm --prefix packages/proxy-undici run build`.
3. Run `npm --prefix packages/proxy-undici run test`.
4. Validate `reloadFromEnvironment` behavior in integration tests.

## Integration Guidance

1. Construct one factory per service/process and reuse it.
2. Resolve dispatcher per target URL.
3. Destroy factory on process shutdown.
4. Prefer explicit `settings` in tests to avoid hidden env drift.

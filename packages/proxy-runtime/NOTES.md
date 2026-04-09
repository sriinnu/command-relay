# proxy-runtime Integration Notes

Use `@commandrelay/proxy-runtime` when a service needs a stable proxy runtime boundary with consistent routing metadata.

## Fast Integration Checklist

1. Create one process-level `ProxyRuntimeController` instance.
2. Resolve routing via `controller.resolve(target)` at request boundaries.
3. Feed `resolution.agent` to clients that accept Node agents.
4. Use `resolution.metadata` for structured logs and metrics dimensions.
5. Refresh config with `reloadFromEnvironment()` or `updateSettings()`.
6. Call `destroy()`/`dispose()` during graceful shutdown.

## Snapshot Contract

`getSnapshot()` is meant for diagnostics and health endpoints:

- `settings`: current normalized proxy config
- `cacheSize`: current agent cache footprint
- `disposed`: whether `destroy()`/`dispose()` was last invoked
- `stats`: aggregate resolve/proxy/direct/cache counters

Treat snapshots as read-only observations and avoid exposing proxy credentials in logs.

## Package Split Guidance

- `@commandrelay/proxy-core`: pure parsing/matching rules
- `@commandrelay/proxy-agent`: agent construction + bounded cache
- `@commandrelay/proxy-runtime`: controller orchestration, lifecycle, diagnostics

Keep transport-specific wrappers in their own packages (`proxy-fetch`, `proxy-undici`, etc.).

## Migration and Compatibility

- Replace scattered env parsing with one controller initialization path.
- Migrate call sites to consume `resolve(...).metadata` for explainable behavior.
- Prefer root exports only (`@commandrelay/proxy-runtime`), not `dist/*` deep imports.
- While pre-`1.0`, pin minor releases (`~0.1.x`) in production.

## Troubleshooting

- `proxy_not_configured`: no matching proxy variable was available for the target protocol.
- `no_proxy_match`: target matched `NO_PROXY`; traffic is intentionally direct.
- Cache growth: tune `maxCacheEntries` and monitor `cacheSize` in runtime snapshots.
- Post-rotation mismatch: call `reloadFromEnvironment()` after env changes.

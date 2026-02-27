# @termina/proxy-undici Notes

## Scope

This package binds proxy routing decisions to Undici dispatchers.
It does not implement SOCKS or PAC dispatchers.

## Security and Safety

1. Honors `NO_PROXY` bypass rules from `@commandrelay/proxy-core`.
2. Rejects unsupported proxy protocols early (`socks:*`, `pac+*`).
3. Supports bounded cache + explicit teardown to avoid descriptor leaks.

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

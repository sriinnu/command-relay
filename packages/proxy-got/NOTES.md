# @commandrelay/proxy-got Notes

## Scope

This package provides a got-friendly proxy adapter layer that keeps got optional and focuses on:

- target resolution (`url`, `prefixUrl`, positional input)
- per-target proxy agent resolution
- protocol-scoped got `agent` map updates
- routing metadata observability

## Compatibility checklist

- Node.js `>=18`
- ESM runtime/package usage
- Downstream got integration is optional and external
- Proxy semantics are inherited from `@commandrelay/proxy-agent`

## Integration checklist

1. Reuse one `ProxyGotAgentResolver` per process.
2. Resolve/apply per request target before calling got.
3. Preserve `viaProxy`, `proxyUrl`, and `fromCache` in request logs/telemetry.
4. Call `destroy()`/`dispose()` during graceful shutdown.

## Migration checklist

1. Replace manual `options.agent` branching with `applyProxyGotAgent`.
2. Convert relative URL handling to `resolveGotRequestTarget` semantics.
3. Remove overlapping proxy auto-config in integration wrappers.
4. Add tests for direct/proxy/no_proxy paths in your service package.

## Troubleshooting playbook

- Missing target input:
  - Expect `MissingGotTargetError` (`missing_target_url`).
- Invalid absolute/relative target:
  - Expect `InvalidGotTargetError` (`invalid_target_url`).
- Invalid `prefixUrl`:
  - Expect `InvalidGotPrefixUrlError` (`invalid_prefix_url`).
- Unsupported protocol:
  - Expect `UnsupportedGotProtocolError` (`unsupported_target_protocol:*`).

## Operational checklist

1. `npm --prefix packages/proxy-got run check`
2. `npm --prefix packages/proxy-got run build`
3. `npm --prefix packages/proxy-got run test`
4. Validate routing metadata in your integration logs.

## Related

- [Package README](./README.md)
- [Examples](./docs/examples/README.md)
- [Brand SVG](./docs/assets/proxy-got-brand.svg)

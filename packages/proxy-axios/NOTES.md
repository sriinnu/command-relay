# @termina/proxy-axios Notes

## Scope

`@termina/proxy-axios` is an adapter package for axios-style configs.
It resolves proxy routing via `@commandrelay/proxy-agent` and applies Node agents without taking an axios runtime dependency.

## Compatibility Checklist

- Node.js `>=18`
- ESM runtime/package usage
- Resolver lifecycle managed at app boundary (`destroy()` on shutdown)
- Request config contains absolute URL or (`baseURL` + relative `url`)

## Migration Checklist

1. Centralize axios request construction in one module.
2. Instantiate one shared `ProxyAxiosAgentResolver` per process.
3. Apply routing via `resolver.apply(config)` or `applyProxyAgentToAxiosConfig(config, resolver)`.
4. Log `routing.viaProxy`, `routing.proxyUrl`, and `routing.fromCache`.
5. Remove duplicated per-call proxy parsing logic.

## Troubleshooting Playbook

- Direct route when proxy expected:
  - Validate env resolution with `loadProxySettings`.
  - Confirm `NO_PROXY` entries are not over-broad.
- Proxied route when direct expected:
  - Inspect `ALL_PROXY` fallback values.
  - Verify host/port matching for `NO_PROXY` bypass rules.
- Relative URL errors:
  - Ensure `baseURL` is provided when `url` is relative.
- Unexpected double proxy behavior:
  - Keep helper default `disableAxiosProxyConfig=true` so `proxy=false` is applied.

## Operational Checklist

1. `npm --prefix packages/proxy-axios run check`
2. `npm --prefix packages/proxy-axios run build`
3. `npm --prefix packages/proxy-axios run test`

## Related

- [Package README](./README.md)
- [Examples](./docs/examples/README.md)
- [Brand SVG](./docs/assets/proxy-axios-brand.svg)

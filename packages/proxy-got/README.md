# @commandrelay/proxy-got

<p align="left">
  <img src="./docs/assets/proxy-got-brand.svg" width="88" height="88" alt="Proxy Got brand mark" />
</p>

`@commandrelay/proxy-got` provides a production-ready got adapter baseline that resolves and applies proxy-aware Node agents without importing got at runtime.

## Install

```bash
npm install @commandrelay/proxy-got
```

## Runtime support

- Node.js `>=18`
- npm `>=9`
- ESM package (`"type": "module"`)

## Compatibility

- No direct got runtime dependency is required by this package.
- Works with got-style option fields (`url`, `prefixUrl`, `agent`) and generic wrappers.
- Proxy routing is delegated to `@commandrelay/proxy-agent`.
- Supports environment or explicit settings (`HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, `NO_PROXY`).

## Features

1. Typed got-compatible option interfaces (including `url`, `prefixUrl`, `agent`).
2. `ProxyGotAgentResolver` class wrapper over `ProxyAgentFactory`.
3. Helper functions to resolve/apply protocol-scoped got agent entries.
4. Routing metadata preserved on every resolution (`viaProxy`, `proxyUrl`, `fromCache`).

## Quick start

```ts
import got from "got";
import { ProxyGotAgentResolver, applyProxyGotAgent } from "@commandrelay/proxy-got";

const resolver = new ProxyGotAgentResolver();

const prepared = applyProxyGotAgent(
  {
    url: "health",
    prefixUrl: "https://api.example.com/v1",
    method: "GET"
  },
  resolver
);

const response = await got(prepared.targetUrl, prepared.options).json<{ ok: boolean }>();

console.log(response.ok);
console.log(prepared.viaProxy, prepared.proxyUrl, prepared.fromCache);

resolver.destroy();
```

## Usage matrix

| Use case | Recommended API | Why |
| --- | --- | --- |
| Repeated requests in a service | `new ProxyGotAgentResolver()` | Reuses cached proxy agents and centralizes lifecycle |
| One-off request option shaping | `applyProxyGotAgent(...)` | Produces got-compatible options + routing metadata |
| Target resolution from `url`/`prefixUrl`/input | `resolveGotRequestTarget(...)` | Deterministic target parsing for wrapper layers |
| Need only per-target route signal | `resolveProxyGotAgentEntry(...)` | Returns agent slot (`http`/`https`) with metadata |

## API surface

### Class

- `ProxyGotAgentResolver`
  - `resolve(target)`
  - `resolveForOptions(options, input?)`
  - `applyToOptions(options, input?)`
  - `updateSettings(settings)`
  - `reloadFromEnvironment(env?)`
  - `clear()` / `destroy()` / `dispose()`
  - `cacheSize`

### Helpers

- `createProxyGotAgentResolver(options?)`
- `resolveGotRequestTarget(input, options?)`
- `resolveProxyGotAgentEntry(target, resolver)`
- `applyProxyGotAgent(options, resolver, input?)`

### Errors

- `MissingGotTargetError`
- `InvalidGotTargetError`
- `InvalidGotPrefixUrlError`
- `UnsupportedGotProtocolError`

## Migration

Most migrations are from ad-hoc got proxy wiring.

1. Create a shared `ProxyGotAgentResolver` instance per process.
2. Replace manual agent assignment with `applyProxyGotAgent` or `resolver.applyToOptions`.
3. Keep route observability by logging `viaProxy`, `proxyUrl`, and `fromCache` from apply/resolve results.
4. Remove duplicate proxy layers in caller code to avoid conflicting behavior.

## Troubleshooting

- Proxy expected but `viaProxy=false`:
  - Check `NO_PROXY` rules and current settings source.
  - Verify the computed `targetUrl` from `resolveGotRequestTarget`.
- Unexpected `unsupported_target_protocol:*`:
  - Ensure targets are `http:` or `https:`.
- Relative `url` failures:
  - Provide an absolute target or set a valid absolute `prefixUrl`.
- Routing not updated after env changes:
  - Call `reloadFromEnvironment()` on long-lived resolvers.

## Examples

- [Examples index](./docs/examples/README.md)
- [Resolver routing example](./docs/examples/resolver.md)
- [Apply-helper example](./docs/examples/apply.md)

## Notes

Operational guidance: [NOTES.md](./NOTES.md)

## License

MIT

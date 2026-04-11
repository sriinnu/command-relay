# @commandrelay/proxy-undici

![@commandrelay/proxy-undici brand mark](./docs/assets/proxy-undici-brand.svg)

`@commandrelay/proxy-undici` provides proxy-aware Undici dispatcher resolution for Node services and SDK clients.

Proxy-aware Undici dispatchers for services that want clean Node defaults.

It reuses `@commandrelay/proxy-core` for environment parsing and `NO_PROXY` matching, then creates direct or proxy dispatchers for HTTP/HTTPS targets.

## Install

```bash
npm install @commandrelay/proxy-undici undici
```

## Runtime support

- Node.js `>=18`
- npm `>=9`
- ESM package (`"type": "module"`)

## Compatibility

- Node-only package; dispatchers are Undici runtime primitives.
- Compatible with `undici@^7.16.0`.
- Supports HTTP/HTTPS target URLs.
- Supports HTTP/HTTPS proxy URLs.
- SOCKS and PAC proxy protocols are intentionally unsupported in this package.

## Migration

`@commandrelay/proxy-undici` is currently `0.1.x`; there is no prior package-specific breaking release. Typical migration is from ad-hoc `ProxyAgent` allocation or direct `Agent` wiring.

1. Replace per-request agent construction with one shared `ProxyUndiciDispatcherFactory`.
2. Resolve dispatchers per target URL (`factory.resolve(target)`) and pass the dispatcher to Undici clients.
3. Keep explicit lifecycle cleanup by calling `factory.destroy()` on shutdown.
4. If you need SOCKS/PAC support, migrate those routes to `@commandrelay/proxy-agent`.

## Features

1. Direct vs proxy dispatcher selection via `HTTP_PROXY`/`HTTPS_PROXY`/`ALL_PROXY`/`NO_PROXY`.
2. Bounded LRU cache for proxy dispatchers.
3. Explicit cleanup lifecycle (`clear`, `destroy`, `dispose`).
4. Typed errors for invalid target/proxy inputs and unsupported proxy protocols.
5. Runtime setting reload via `updateSettings` and `reloadFromEnvironment`.

## Quick Start

```ts
import { ProxyUndiciDispatcherFactory } from "@commandrelay/proxy-undici";
import { request } from "undici";

const factory = new ProxyUndiciDispatcherFactory();
const resolved = factory.resolve("https://api.example.com/v1/status");

const response = await request("https://api.example.com/v1/status", {
  dispatcher: resolved.dispatcher,
  method: "GET"
});

console.log(resolved.viaProxy, resolved.proxyUrl);
console.log(await response.body.json());
factory.destroy();
```

## Usage Matrix

| Undici integration need | Recommended package | Reason |
| --- | --- | --- |
| Reusable dispatcher routing for Undici `request`/`fetch` | `@commandrelay/proxy-undici` | Resolves direct vs proxy dispatcher with bounded cache |
| Need Node agent integration (`http.Agent`/`https.Agent`) | Prefer `@commandrelay/proxy-agent` | Agent-oriented clients do not consume Undici dispatchers |
| Need SOCKS or PAC proxy protocols | Prefer `@commandrelay/proxy-agent` | `@commandrelay/proxy-undici` intentionally supports only HTTP/HTTPS proxy URLs |
| Need policy-only parsing and `NO_PROXY` matching | Prefer `@commandrelay/proxy-core` | Keeps decision logic transport-agnostic |

## API

### `new ProxyUndiciDispatcherFactory(options?)`

`options`:

- `settings`: explicit proxy settings (`ProxySettings`)
- `env`: environment source used when `settings` is not provided
- `maxCacheEntries`: bounded proxy dispatcher cache size (default `256`)
- `directDispatcherOptions`: forwarded to Undici `Agent`
- `proxyDispatcherOptions`: forwarded to Undici `ProxyAgent`

### `resolve(target)`

Returns:

```ts
{
  dispatcher: Dispatcher;
  proxyUrl: string | null;
  viaProxy: boolean;
  fromCache: boolean;
}
```

### Lifecycle methods

- `clear()` / `destroy()` / `dispose()`: close and clear dispatchers.
- `updateSettings(settings)`: swap settings and clear caches.
- `reloadFromEnvironment(env?)`: reload from env and clear caches.

## Error Model

- `InvalidTargetUrlError` -> `invalid_target_url`
- `InvalidProxyUrlError` -> `invalid_proxy_url`
- `UnsupportedProxyProtocolError` -> `unsupported_proxy_protocol:<protocol>`
- `UnsupportedTargetProtocolError` -> `unsupported_target_protocol:<protocol>`

Unsupported proxy protocols in this package: SOCKS and PAC. Use `@commandrelay/proxy-agent` for those protocols.

## Troubleshooting

- `unsupported_proxy_protocol:*` for SOCKS/PAC URLs:
  - This is expected in `@commandrelay/proxy-undici`; route those cases to `@commandrelay/proxy-agent`.
- Unexpected direct routing:
  - Inspect `NO_PROXY` and ensure the target protocol has matching proxy settings.
- Unexpected proxy routing:
  - Check for `ALL_PROXY` fallback and stale runtime env values.
- Growing open handles in long-lived processes:
  - Reuse one factory and call `factory.destroy()` during shutdown.

## Examples

- [Examples index](./docs/examples/README.md)
- [Undici request routing snapshot](./docs/examples/request.md)
- [Node fetch dispatcher routing snapshot](./docs/examples/fetch.md)

## Notes

Operational guidance and release details: [NOTES.md](./NOTES.md).

## License

MIT


# @termina/proxy-undici

`@termina/proxy-undici` provides proxy-aware Undici dispatcher resolution for Node services and SDK clients.

It reuses `@commandrelay/proxy-core` for environment parsing and `NO_PROXY` matching, then creates direct or proxy dispatchers for HTTP/HTTPS targets.

## Install

```bash
npm install @termina/proxy-undici undici
```

## Features

1. Direct vs proxy dispatcher selection via `HTTP_PROXY`/`HTTPS_PROXY`/`ALL_PROXY`/`NO_PROXY`.
2. Bounded LRU cache for proxy dispatchers.
3. Explicit cleanup lifecycle (`clear`, `destroy`, `dispose`).
4. Typed errors for invalid target/proxy inputs and unsupported proxy protocols.
5. Runtime setting reload via `updateSettings` and `reloadFromEnvironment`.

## Quick Start

```ts
import { ProxyUndiciDispatcherFactory } from "@termina/proxy-undici";
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

## Examples

- [Examples index](./docs/examples/README.md)
- [Undici request](./docs/examples/request.md)
- [Node fetch dispatcher](./docs/examples/fetch.md)

## Notes

Operational guidance and release details: [NOTES.md](./NOTES.md).

## License

MIT

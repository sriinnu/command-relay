# @termina/proxy-fetch

<p align="left">
  <img src="./docs/assets/proxy-fetch-brand.svg" width="88" height="88" alt="Proxy Fetch brand mark" />
</p>

`@termina/proxy-fetch` provides a production-ready proxy-aware wrapper around Node fetch.
It resolves Undici dispatchers through `@termina/proxy-undici`, supports explicit settings/env inputs, and includes JSON parsing safeguards with typed failures.

## Install

```bash
npm install @termina/proxy-fetch
```

## Runtime support

- Node.js `>=18`
- npm `>=9`
- ESM package (`"type": "module"`)

## Features

1. Proxy routing with `HTTP_PROXY`/`HTTPS_PROXY`/`ALL_PROXY`/`NO_PROXY`.
2. Reusable client API and one-shot helper API.
3. Typed errors for invalid URL, timeout, non-JSON responses, and payload size overflows.
4. Default guardrails: `8000ms` timeout and `1 MiB` max JSON payload.
5. Dispatcher cache lifecycle control through `ProxyFetchClient`.

## Quick Start

```ts
import { ProxyFetchClient } from "@termina/proxy-fetch";

const client = new ProxyFetchClient();

const response = await client.fetchJson<{ ok: boolean }>("https://api.example.com/health", {
  timeoutMs: 5_000,
  maxResponseBytes: 256_000
});

console.log(response.routing.viaProxy, response.routing.proxyUrl);
console.log(response.body?.ok);

client.destroy();
```

## API

### Reusable client

```ts
new ProxyFetchClient(options?)
```

- `fetch(target, options?)` -> returns `{ response, routing }`
- `fetchJson<T>(target, options?)` -> returns parsed JSON response metadata
- `destroy()` / `dispose()` / `clear()` lifecycle methods
- `updateSettings(settings)` and `reloadFromEnvironment(env?)` for runtime changes

### One-shot helpers

```ts
proxyFetch(target, options?)
proxyFetchJson<T>(target, options?)
```

Pass temporary client options with `options.client`.

### Client options

- `settings?: ProxySettings`
- `env?: ProxyEnvironment`
- `maxCacheEntries?: number`
- `dispatcherFactory?: ProxyUndiciDispatcherFactory`
- `fetchImplementation?: (input, init) => Promise<Response>`
- `defaultTimeoutMs?: number` (default `8000`)
- `defaultMaxResponseBytes?: number` (default `1048576`)

## Error Model

- `InvalidUrlError` -> `invalid_url`
- `RequestTimeoutError` -> `request_timeout:<timeoutMs>`
- `ResponseSizeLimitError` -> `response_size_limit_exceeded:<maxBytes>`
- `NonJsonResponseError` -> `non_json_response:invalid_content_type` or `non_json_response:invalid_json`

## Examples

- [Examples index](./docs/examples/README.md)
- [One-shot usage](./docs/examples/one-shot.md)
- [Reusable client usage](./docs/examples/client.md)

## Notes

Operational guidance: [NOTES.md](./NOTES.md)

## License

MIT

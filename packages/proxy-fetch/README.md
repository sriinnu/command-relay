# @commandrelay/proxy-fetch

<p align="left">
  <img src="./docs/assets/proxy-fetch-brand.svg" width="88" height="88" alt="Proxy Fetch brand mark" />
</p>

`@commandrelay/proxy-fetch` provides a production-ready proxy-aware wrapper around Node fetch.
It resolves Undici dispatchers through `@commandrelay/proxy-undici`, supports explicit settings/env inputs, and includes JSON parsing safeguards with typed failures.

A fetch wrapper that keeps proxy behavior predictable and typed.

## Install

```bash
npm install @commandrelay/proxy-fetch
```

## Runtime support

- Node.js `>=18`
- npm `>=9`
- ESM package (`"type": "module"`)

## Compatibility

- Node-only package: this wrapper depends on Undici dispatchers and Node `fetch` behavior.
- `fetch` dispatcher injection is supported in Node and is not a browser API.
- Works with explicit `settings` objects or with environment variables (`HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, `NO_PROXY`).
- Compatible with `@commandrelay/proxy-undici@^0.1.0`.

## Migration

`@commandrelay/proxy-fetch` is currently `0.1.x`; there is no prior package-specific breaking release. Most migrations are from direct `fetch` usage or custom proxy wrappers.

1. Replace direct `fetch` calls with `proxyFetch`/`proxyFetchJson` for one-shot calls.
2. For services with repeated outbound calls, switch to one long-lived `ProxyFetchClient`.
3. Move timeout/body-size checks into package options (`timeoutMs`, `maxResponseBytes`).
4. Update error handling to map typed package errors (`invalid_url`, `request_timeout`, `response_size_limit_exceeded`, `non_json_response:*`).

## Features

1. Proxy routing with `HTTP_PROXY`/`HTTPS_PROXY`/`ALL_PROXY`/`NO_PROXY`.
2. Reusable client API and one-shot helper API.
3. Typed errors for invalid URL, timeout, non-JSON responses, and payload size overflows.
4. Default guardrails: `8000ms` timeout and `1 MiB` max JSON payload.
5. Dispatcher cache lifecycle control through `ProxyFetchClient`.

## Quick Start

```ts
import { ProxyFetchClient } from "@commandrelay/proxy-fetch";

const client = new ProxyFetchClient();

const response = await client.fetchJson<{ ok: boolean }>("https://api.example.com/health", {
  timeoutMs: 5_000,
  maxResponseBytes: 256_000
});

console.log(response.routing.viaProxy, response.routing.proxyUrl);
console.log(response.body?.ok);

client.destroy();
```

## Usage Matrix

| Use case | Recommended entry point | Why |
| --- | --- | --- |
| One-off proxied `fetch` call with routing metadata | `proxyFetch` | Minimal setup for scripts and low-frequency calls |
| One-off JSON call with timeout/size guards | `proxyFetchJson<T>` | Adds typed JSON parse + guardrail errors |
| Service making repeated outbound calls | `new ProxyFetchClient()` | Reuses dispatcher cache and centralizes defaults |
| Need only Undici dispatcher wiring (no fetch wrapper) | Prefer `@commandrelay/proxy-undici` | Lower-level control for custom Undici clients |

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

## Troubleshooting

- Requests unexpectedly bypass proxy:
  - Confirm `NO_PROXY` rules and lowercase/uppercase env precedence in your runtime.
  - Inspect `result.routing.viaProxy` and `result.routing.proxyUrl` in logs.
- `request_timeout:<ms>` errors:
  - Increase `timeoutMs` for slow endpoints or set a higher client default timeout.
- `response_size_limit_exceeded:<max>` errors:
  - Increase `maxResponseBytes` only for endpoints that are expected to return large JSON payloads.
- `non_json_response:*` errors:
  - Verify endpoint `content-type` and whether non-JSON responses should be handled through `fetch()` instead of `fetchJson()`.
- Process shutdown hangs:
  - Ensure `client.destroy()` is called when the process or worker exits.

## Examples

- [Examples index](./docs/examples/README.md)
- [One-shot usage + snapshot](./docs/examples/one-shot.md)
- [Reusable client usage + snapshot](./docs/examples/client.md)

## Notes

Operational guidance: [NOTES.md](./NOTES.md)

## License

MIT

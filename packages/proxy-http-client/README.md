# @commandrelay/proxy-http-client

<p align="left">
  <img src="./docs/assets/proxy-http-client-brand.svg" width="88" height="88" alt="Proxy HTTP Client brand mark" />
</p>

Proxy-aware JSON HTTP client for Node.js services and CLIs. Designed for reusable app-level integrations with strict protocol checks, timeout and abort controls, response size limits, and typed errors.

A reusable HTTP client core with strict proxy-aware transport controls.

## Install

```bash
npm install @commandrelay/proxy-http-client
```

## Runtime support

- Node.js `>=18`
- npm `>=9`
- ESM package (`"type": "module"`)

## Version support policy

- Current line: `0.1.x`
- While pre-`1.0`, pin minor versions in production (`~0.1.0`) to reduce unexpected breakage.

## Export surface

- `@commandrelay/proxy-http-client` (root API)
- `@commandrelay/proxy-http-client/package.json` (metadata only)
- Deep imports such as `@commandrelay/proxy-http-client/dist/*` are intentionally unsupported.

## External Reuse

- Keep this package at your app boundary (`/infra/http` or similar), not inside business logic.
- Set `timeoutMs` and `maxResponseBytes` per upstream SLA and payload profile.
- Convert library errors into app-specific domain errors at one place.
- For rollout guidance, use [NOTES.md](./NOTES.md).

## Migration and Compatibility

- Runtime baseline: Node.js `>=18`, npm `>=9`, ESM package usage.
- If migrating from direct `fetch`/`axios` calls, move request policy (`timeoutMs`, `maxResponseBytes`, error mapping) into one wrapper module.
- Integrate proxy routing via `proxyResolver` when needed instead of embedding proxy logic per call site.
- Use root imports only (`@commandrelay/proxy-http-client`); deep imports are not compatibility-safe.
- While pre-`1.0`, pin minor versions (`~0.1.x`) before broad deployments.

## Quick Start

```ts
import { requestJson } from "@commandrelay/proxy-http-client";

type HealthResponse = {
  ok: boolean;
  version: string;
};

const response = await requestJson<HealthResponse>("https://api.example.com/health", {
  timeoutMs: 5_000
});

console.log(response.status, response.body?.ok);
```

## Integration Patterns

### 1) App-scoped API client wrapper

```ts
import { requestJson } from "@commandrelay/proxy-http-client";

type User = { id: string; email: string };

export async function getUserById(baseUrl: string, id: string): Promise<User | null> {
  const result = await requestJson<User>(`${baseUrl}/users/${id}`, {
    timeoutMs: 3_000,
    maxResponseBytes: 256_000
  });
  return result.body;
}
```

### 2) Proxy-aware requests (`@commandrelay/proxy-agent`)

```ts
import { ProxyAgentFactory } from "@commandrelay/proxy-agent";
import { requestJson, type ProxyAgentResolver } from "@commandrelay/proxy-http-client";

const factory = new ProxyAgentFactory();

const proxyResolver: ProxyAgentResolver = {
  resolve(target) {
    return factory.resolve(target);
  }
};

await requestJson("https://api.example.com/metrics", {
  method: "GET",
  proxyResolver,
  timeoutMs: 8_000
});
```

### 3) Boundary error mapping

```ts
import {
  HttpStatusError,
  RequestTimeoutError,
  ResponseSizeLimitError,
  requestJson
} from "@commandrelay/proxy-http-client";

export async function fetchProfile(userId: string) {
  try {
    return await requestJson(`https://api.example.com/profiles/${userId}`);
  } catch (error) {
    if (error instanceof RequestTimeoutError) throw new Error("upstream_timeout");
    if (error instanceof ResponseSizeLimitError) throw new Error("upstream_payload_too_large");
    if (error instanceof HttpStatusError) throw new Error(`upstream_http_${error.status}`);
    throw error;
  }
}
```

### 4) Adapter examples for axios/undici/got/fetch call styles

- Overview: [docs/examples/README.md](./docs/examples/README.md)
- Axios-style adapter: [docs/examples/axios.md](./docs/examples/axios.md)
- Undici-style adapter: [docs/examples/undici.md](./docs/examples/undici.md)
- Got-style adapter: [docs/examples/got.md](./docs/examples/got.md)
- Fetch-style adapter: [docs/examples/fetch.md](./docs/examples/fetch.md)

## Usage Matrix

| Integration scenario | Recommended usage | Why |
| --- | --- | --- |
| Service-layer JSON client with standardized errors | `requestJson<T>()` via one app wrapper module | Consistent timeout/size/error policy at the boundary |
| CLI/tooling call that needs strict JSON + proxy support | Direct `requestJson<T>()` call | Minimal API with explicit controls (`timeoutMs`, `maxResponseBytes`) |
| Existing proxy stack using `@commandrelay/proxy-agent` | Pass `proxyResolver` | Reuses your established routing + agent lifecycle |
| Need generic raw HTTP streaming client behavior | Prefer a lower-level transport directly | This package is intentionally JSON-first |

## API Summary

```ts
async function requestJson<TBody = unknown>(
  url: string | URL,
  options?: JsonRequestOptions
): Promise<JsonResponse<TBody>>;
```

`JsonRequestOptions`:

- `method?: string` (default `GET`)
- `headers?: Record<string, string>`
- `body?: unknown` (JSON-serialized when provided)
- `timeoutMs?: number` (default `8000`, `0` disables timeout)
- `maxResponseBytes?: number` (default `1048576` bytes / `1 MiB`)
- `signal?: AbortSignal`
- `proxyResolver?: ProxyAgentResolver`
- `requestOptions?: Omit<RequestOptions, "protocol" | "hostname" | "port" | "path" | "method" | "headers" | "agent" | "signal">`
- `throwOnHttpError?: boolean` (default `true`)
- `transport?: JsonRequestTransport` (advanced/testing use)

`JsonResponse<TBody>`:

- `status: number`
- `headers: IncomingHttpHeaders`
- `body: TBody | null`
- `rawBody: string`

Exported error classes:

- `UnsupportedProtocolError`
- `ProxyResolutionError`
- `RequestAbortedError`
- `HttpStatusError`
- `RequestTimeoutError`
- `JsonParseError`
- `ResponseSizeLimitError`

## Security and Ops Notes

- Only `http:` and `https:` URLs are accepted; unsupported protocols throw `UnsupportedProtocolError`.
- Request bodies are always JSON-serialized when `body` is provided.
- Default response size cap is `1 MiB` to bound memory use.
- Responses with `content-length` above `maxResponseBytes` are rejected before body buffering.
- Proxy resolver failures are wrapped into `ProxyResolutionError` with a `cause`.
- Avoid logging raw payloads when handling `HttpStatusError` or `JsonParseError`.

## Troubleshooting

- `UnsupportedProtocolError`: ensure request URLs use `http:` or `https:` only.
- Frequent `RequestTimeoutError`: tune `timeoutMs` per endpoint SLA and check upstream latency.
- `ResponseSizeLimitError`: increase `maxResponseBytes` for expected payloads or narrow response shape upstream.
- `JsonParseError`: upstream returned non-JSON content; inspect `rawBody` safely in controlled logs.
- `ProxyResolutionError`: validate `proxyResolver` wiring and underlying proxy-agent configuration.

## Docs and Assets

- [Integration note](./NOTES.md)
- [Brand SVG](./docs/assets/proxy-http-client-brand.svg)

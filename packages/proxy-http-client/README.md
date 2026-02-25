# @commandrelay/proxy-http-client

Proxy-aware JSON HTTP client for Node.js with strict protocol checks, timeout/abort controls, and typed errors.

## Install

```bash
npm install @commandrelay/proxy-http-client
```

## Runtime support

- Node.js `>=18`
- npm `>=9`
- ESM package (`"type": "module"`)

## Usage

```ts
import { requestJson } from "@commandrelay/proxy-http-client";

type HealthResponse = {
  ok: boolean;
  version: string;
};

const response = await requestJson<HealthResponse>("https://api.example.com/health", {
  timeoutMs: 5_000
});

console.log(response.status, response.body);
```

### With proxy resolution (`@commandrelay/proxy-agent`)

```ts
import { ProxyAgentFactory } from "@commandrelay/proxy-agent";
import { requestJson, type ProxyAgentResolver } from "@commandrelay/proxy-http-client";

const factory = new ProxyAgentFactory();

const proxyResolver: ProxyAgentResolver = {
  resolve(target) {
    return factory.resolve(target);
  }
};

const result = await requestJson<{ id: string }>("https://api.example.com/users/123", {
  method: "GET",
  proxyResolver,
  timeoutMs: 8_000
});

console.log(result.body?.id);
```

## API

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

## Error handling example

```ts
import {
  HttpStatusError,
  JsonParseError,
  ProxyResolutionError,
  ResponseSizeLimitError,
  RequestTimeoutError,
  requestJson
} from "@commandrelay/proxy-http-client";

try {
  await requestJson("https://api.example.com/data", { timeoutMs: 1_500 });
} catch (error) {
  if (error instanceof RequestTimeoutError) {
    console.error("Timeout", error.timeoutMs, error.target);
  } else if (error instanceof HttpStatusError) {
    console.error("HTTP failure", error.status, error.body);
  } else if (error instanceof JsonParseError) {
    console.error("Response was not valid JSON", error.rawBody);
  } else if (error instanceof ResponseSizeLimitError) {
    console.error("Response payload too large", error.maxBytes, error.receivedBytes);
  } else if (error instanceof ProxyResolutionError) {
    console.error("Proxy resolution failed for", error.target);
  } else {
    throw error;
  }
}
```

## Security notes

- Only `http:` and `https:` request URLs are accepted; `ws:`/`wss:` are rejected.
- Request body is always JSON-serialized when `body` is provided.
- Response body size is capped to `1 MiB` by default to limit memory growth on oversized payloads.
- Proxy resolver failures are wrapped as `ProxyResolutionError` with `cause`.
- Avoid logging sensitive payloads or raw response bodies in production logs.

## Performance notes

- Default timeout is `8000ms`; tune per endpoint SLA.
- Default response size cap is `1048576` bytes; increase `maxResponseBytes` for known large payloads.
- Reuse a long-lived proxy resolver (for example `ProxyAgentFactory`) to maximize agent/cache reuse.
- Set `throwOnHttpError: false` for hot paths that prefer branch handling over exception control flow.
- Inject `transport` only for tests or specialized runtime adapters.

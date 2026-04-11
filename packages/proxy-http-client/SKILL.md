# SKILL: @commandrelay/proxy-http-client

`@commandrelay/proxy-http-client` is the Node-first helper for proxy-aware JSON request calls with typed timeouts, response size caps, and optional proxy resolver injection.

## Install

```bash
npm install @commandrelay/proxy-http-client
```

## Execution (Modern AI-ready)

- Type check: `pnpm --filter @commandrelay/proxy-http-client run check`
- Build: `pnpm --filter @commandrelay/proxy-http-client run build`
- Tests: `pnpm --filter @commandrelay/proxy-http-client run test`
- Metadata via extension: `npm run extension:run -- proxy-http-client info`
- Health check via extension: `npm run extension:run -- proxy-http-client check`
- Release prep via extension: `npm run extension:run -- proxy-http-client build`
- Regression via extension: `npm run extension:run -- proxy-http-client test`

## Exported API

- `requestJson<T>(url, options)` returns `{ status, headers, body, rawBody }`.
- Types: `JsonRequestOptions`, `JsonRequestTransport`, `JsonRequestFunction`, `JsonResponse<TBody>`, `ProxyAgentResolver`.
- Error types: `HttpStatusError`, `JsonParseError`, `ProxyResolutionError`, `RequestAbortedError`, `RequestTimeoutError`, `ResponseSizeLimitError`, `UnsupportedProtocolError`.

## Reference Snippet

```ts
import {
  requestJson,
  HttpStatusError,
  type JsonRequestOptions,
  type JsonRequestTransport
} from "@commandrelay/proxy-http-client";
import * as nodeHttp from "node:http";
import * as nodeHttps from "node:https";

const options: JsonRequestOptions = {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: { ping: true },
  timeoutMs: 4_000,
  maxResponseBytes: 128_000,
  throwOnHttpError: false
};

try {
  const response = await requestJson<{ ok: boolean }>("https://api.example.com/ping", options);
  console.log(response.status, response.body?.ok ?? null);
} catch (error) {
  if (error instanceof HttpStatusError) {
    console.error("upstream status", error.status);
  }
  throw error;
}

const customTransport: JsonRequestTransport = {
  httpRequest: nodeHttp.request,
  httpsRequest: nodeHttps.request
};

await requestJson("https://api.example.com/version", {
  transport: customTransport as unknown as JsonRequestTransport
});
```

## Operational Checks

- Always include `await` on requests in automation loops.
- Use `proxyResolver` when integrating with `@commandrelay/proxy-agent`/`@commandrelay/proxy-runtime` boundaries.
- Keep `maxResponseBytes` aligned with caller expectations; default `1_048_576` is intentionally conservative.

## Failure Signatures

- `invalid_request_url`: malformed URL inputs.
- `invalid_transport`: transport object missing request function(s).
- `request_timeout:*`: timeouts from `timeoutMs`.
- `response_size_limit_exceeded:*`: body overflow (server side or stream overrun).

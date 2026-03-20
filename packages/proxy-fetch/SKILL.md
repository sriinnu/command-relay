# SKILL: @commandrelay/proxy-fetch

`@commandrelay/proxy-fetch` provides proxy-aware fetch wrappers and typed JSON/error behaviors for Node services.

## Install

```bash
npm install @commandrelay/proxy-fetch
```

## Execution (Modern AI-ready)

- Type check: `pnpm --filter @commandrelay/proxy-fetch run check`
- Build: `pnpm --filter @commandrelay/proxy-fetch run build`
- Tests: `pnpm --filter @commandrelay/proxy-fetch run test`
- Extension metadata: `npm run extension:run -- proxy-fetch info`
- Extension health: `npm run extension:run -- proxy-fetch check`
- Deterministic build: `npm run extension:run -- proxy-fetch build`
- Deterministic test: `npm run extension:run -- proxy-fetch test`

## Core APIs

- Class: `ProxyFetchClient`
  - Methods: `fetch`, `fetchJson`, `clear`, `destroy`, `dispose`, `updateSettings`, `reloadFromEnvironment`
- One-shot helpers:
  - `proxyFetch(target, options)`
  - `proxyFetchJson(target, options)`
- Factory: `createProxyFetchClient`
- Types:
  - `ProxyFetchClientOptions`, `ProxyFetchRequestOptions`, `ProxyFetchJsonOptions`, `ProxyFetchResult`, `ProxyFetchJsonResult`
  - Error types: `InvalidUrlError`, `RequestTimeoutError`, `ResponseSizeLimitError`, `NonJsonResponseError`

## Reference Snippet

```ts
import {
  ProxyFetchClient,
  proxyFetch,
  proxyFetchJson
} from "@commandrelay/proxy-fetch";

const client = new ProxyFetchClient({
  defaultTimeoutMs: 4_000,
  defaultMaxResponseBytes: 256_000
});

const status = await client.fetch("https://api.example.com/health");
console.log(status.routing.viaProxy, status.routing.proxyUrl, status.response.status);

const json = await client.fetchJson<{ ok: boolean }>("https://api.example.com/health");
console.log(json.body?.ok, json.status);

await proxyFetch("https://api.example.com/version", {
  timeoutMs: 2_000,
  method: "GET"
});

await proxyFetchJson<{ version: string }>("https://api.example.com/version", {
  maxResponseBytes: 2_048
});

client.destroy();

const legacy = await proxyFetchJson("https://api.example.com/health", {
  method: "GET",
  client: { defaultTimeoutMs: 10_000 }
});
console.log(legacy.body?.ok);
```

## Failure Modes to Watch

- `non_json_response:invalid_content_type` if endpoint returns non-JSON content-type and `fetchJson` is used.
- `non_json_response:invalid_json` if payload cannot be parsed.
- `request_timeout:<ms>` when elapsed timeout is reached.
- `response_size_limit_exceeded:<max>` when payload exceeds configured cap.

## Operational Notes

- Prefer one long-lived `ProxyFetchClient` per process.
- On environment change, call `client.reloadFromEnvironment()` and confirm cache behavior via `client.fetch` calls.
- Always `destroy()` on shutdown to close dispatcher factory resources.

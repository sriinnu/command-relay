# One-Shot Helper Usage

Use the one-shot helper when you need a single proxied request without holding a long-lived client.

## Run

```bash
node --import tsx <<'TS'
import { loadProxySettings, proxyFetchJson } from "@termina/proxy-fetch";

const result = await proxyFetchJson<{ version: string }>("https://api.example.com/version", {
  timeoutMs: 3_000,
  maxResponseBytes: 64_000,
  client: {
    settings: loadProxySettings({
      https_proxy: "http://proxy.local:8080"
    }),
    fetchImplementation: async () =>
      new Response('{"version":"2026.02.0"}', {
        status: 200,
        headers: { "content-type": "application/json" }
      })
  }
});

console.log(
  JSON.stringify(
    {
      status: result.status,
      body: result.body,
      routing: {
        viaProxy: result.routing.viaProxy,
        proxyUrl: result.routing.proxyUrl,
        fromCache: result.routing.fromCache
      }
    },
    null,
    2
  )
);
TS
```

## Expected output snapshot

Snapshot file: [`./snapshots/one-shot.expected.json`](./snapshots/one-shot.expected.json)

```json
{
  "status": 200,
  "body": {
    "version": "2026.02.0"
  },
  "routing": {
    "viaProxy": true,
    "proxyUrl": "http://proxy.local:8080/",
    "fromCache": false
  }
}
```

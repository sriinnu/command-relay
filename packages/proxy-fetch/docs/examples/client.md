# Reusable Client Usage

Use `ProxyFetchClient` when the process performs multiple outbound calls and you want stable dispatcher reuse/lifecycle handling.

## Run

```bash
node --import tsx <<'TS'
import { ProxyFetchClient, loadProxySettings } from "@commandrelay/proxy-fetch";

const client = new ProxyFetchClient({
  settings: loadProxySettings({
    https_proxy: "http://proxy.local:8080",
    no_proxy: "example.com"
  }),
  defaultTimeoutMs: 4_000,
  defaultMaxResponseBytes: 256_000,
  fetchImplementation: async () =>
    new Response('{"id":"u_123","email":"ada@example.com"}', {
      status: 200,
      headers: { "content-type": "application/json" }
    })
});

try {
  const profile = await client.fetchJson<{ id: string; email: string }>(
    "https://api.example.com/profile/me"
  );

  console.log(
    JSON.stringify(
      {
        status: profile.status,
        email: profile.body?.email ?? null,
        routing: {
          viaProxy: profile.routing.viaProxy,
          proxyUrl: profile.routing.proxyUrl,
          fromCache: profile.routing.fromCache
        }
      },
      null,
      2
    )
  );
} finally {
  client.destroy();
}
TS
```

## Expected output snapshot

Snapshot file: [`./snapshots/client.expected.json`](./snapshots/client.expected.json)

```json
{
  "status": 200,
  "email": "ada@example.com",
  "routing": {
    "viaProxy": false,
    "proxyUrl": null,
    "fromCache": false
  }
}
```

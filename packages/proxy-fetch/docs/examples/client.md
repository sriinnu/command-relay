# Reusable Client Usage

```ts
import { ProxyFetchClient, loadProxySettings } from "@termina/proxy-fetch";

const client = new ProxyFetchClient({
  settings: loadProxySettings(process.env),
  defaultTimeoutMs: 4_000,
  defaultMaxResponseBytes: 256_000
});

try {
  const profile = await client.fetchJson<{ id: string; email: string }>(
    "https://api.example.com/profile/me"
  );

  console.log(profile.status, profile.body?.email, profile.routing.proxyUrl);
} finally {
  client.destroy();
}
```

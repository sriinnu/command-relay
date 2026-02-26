# One-Shot Helper Usage

```ts
import { loadProxySettings, proxyFetchJson } from "@termina/proxy-fetch";

const result = await proxyFetchJson<{ version: string }>("https://api.example.com/version", {
  timeoutMs: 3_000,
  maxResponseBytes: 64_000,
  client: {
    settings: loadProxySettings(process.env)
  }
});

console.log(result.body?.version, result.routing.viaProxy);
```

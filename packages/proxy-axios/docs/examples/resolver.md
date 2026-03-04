# Resolver Routing Behavior

This example shows direct vs proxied resolution and cache metadata.

## Run

```bash
node --import tsx <<'TS'
import { ProxyAxiosAgentResolver } from "@termina/proxy-axios";

const resolver = new ProxyAxiosAgentResolver({
  env: {
    http_proxy: "http://proxy.local:8080",
    no_proxy: "internal.local"
  }
});

try {
  const bypassed = resolver.resolve("http://api.internal.local/health");
  const externalFirst = resolver.resolve("http://api.external.local/health");
  const externalSecond = resolver.resolve("http://api.external.local/health");

  console.log(
    JSON.stringify(
      {
        bypassed: {
          viaProxy: bypassed.viaProxy,
          proxyUrl: bypassed.proxyUrl,
          fromCache: bypassed.fromCache
        },
        externalFirst: {
          viaProxy: externalFirst.viaProxy,
          proxyUrl: externalFirst.proxyUrl,
          fromCache: externalFirst.fromCache
        },
        externalSecond: {
          viaProxy: externalSecond.viaProxy,
          proxyUrl: externalSecond.proxyUrl,
          fromCache: externalSecond.fromCache
        }
      },
      null,
      2
    )
  );
} finally {
  resolver.destroy();
}
TS
```

## Expected output snapshot

Snapshot file: [`./snapshots/resolver.expected.json`](./snapshots/resolver.expected.json)

```json
{
  "bypassed": {
    "viaProxy": false,
    "proxyUrl": null,
    "fromCache": false
  },
  "externalFirst": {
    "viaProxy": true,
    "proxyUrl": "http://proxy.local:8080/",
    "fromCache": false
  },
  "externalSecond": {
    "viaProxy": true,
    "proxyUrl": "http://proxy.local:8080/",
    "fromCache": true
  }
}
```

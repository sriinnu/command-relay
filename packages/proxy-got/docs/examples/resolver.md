# Resolver routing and cache behavior

This example demonstrates direct/proxy/no_proxy routing and cache metadata with `ProxyGotAgentResolver`.

## Run

```bash
node --import tsx <<'TS'
import { ProxyGotAgentResolver, loadProxySettings } from "@commandrelay/proxy-got";

const resolver = new ProxyGotAgentResolver({
  settings: loadProxySettings({
    https_proxy: "http://secure-proxy.local:8443",
    no_proxy: "internal.local"
  })
});

const first = resolver.resolve("https://api.example.com/profile");
const second = resolver.resolve("https://api.example.com/orders");
const noProxy = resolver.resolve("https://api.internal.local/health");

console.log(
  JSON.stringify(
    {
      first: {
        viaProxy: first.viaProxy,
        proxyUrl: first.proxyUrl,
        fromCache: first.fromCache
      },
      second: {
        viaProxy: second.viaProxy,
        proxyUrl: second.proxyUrl,
        fromCache: second.fromCache
      },
      noProxy: {
        viaProxy: noProxy.viaProxy,
        proxyUrl: noProxy.proxyUrl,
        fromCache: noProxy.fromCache
      }
    },
    null,
    2
  )
);

resolver.destroy();
TS
```

## Expected output snapshot

Snapshot file: [`./snapshots/resolver.expected.json`](./snapshots/resolver.expected.json)

```json
{
  "first": {
    "viaProxy": true,
    "proxyUrl": "http://secure-proxy.local:8443/",
    "fromCache": false
  },
  "second": {
    "viaProxy": true,
    "proxyUrl": "http://secure-proxy.local:8443/",
    "fromCache": true
  },
  "noProxy": {
    "viaProxy": false,
    "proxyUrl": null,
    "fromCache": false
  }
}
```

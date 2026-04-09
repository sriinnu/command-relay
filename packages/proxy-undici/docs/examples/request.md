# Undici request routing and cache behavior

This example demonstrates deterministic routing and cache behavior for repeated proxy-resolved targets.

## Run

```bash
node --import tsx <<'TS'
import {
  ProxyUndiciDispatcherFactory,
  loadProxySettings,
  type UndiciDispatcherAdapter
} from "@commandrelay/proxy-undici";

const adapter: UndiciDispatcherAdapter = {
  createDirect: () => ({ kind: "direct" } as never),
  createProxy: (proxyUrl) => ({ kind: "proxy", proxyUrl } as never)
};

const factory = new ProxyUndiciDispatcherFactory({
  settings: loadProxySettings({
    https_proxy: "http://secure-proxy.local:8443"
  }),
  adapter
});

const first = factory.resolve("https://api.example.com/get");
const second = factory.resolve("https://api.example.com/health");

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
      }
    },
    null,
    2
  )
);

factory.destroy();
TS
```

## Expected output snapshot

Snapshot file: [`./snapshots/request.expected.json`](./snapshots/request.expected.json)

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
  }
}
```

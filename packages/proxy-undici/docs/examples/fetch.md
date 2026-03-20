# Node fetch with Undici dispatcher

This example focuses on deterministic routing output (no network calls) so the snapshot is stable.

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

const resolved = factory.resolve("https://httpbin.org/json");

console.log(
  JSON.stringify(
    {
      viaProxy: resolved.viaProxy,
      proxyUrl: resolved.proxyUrl,
      fromCache: resolved.fromCache
    },
    null,
    2
  )
);

factory.destroy();
TS
```

## Expected output snapshot

Snapshot file: [`./snapshots/fetch.expected.json`](./snapshots/fetch.expected.json)

```json
{
  "viaProxy": true,
  "proxyUrl": "http://secure-proxy.local:8443/",
  "fromCache": false
}
```

`dispatcher` is a Node/Undici option and is not supported in browsers.

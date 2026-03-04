# Decision Metadata + Runtime Snapshot

Use this example to inspect direct/proxy/no_proxy decisions from one runtime controller.

## Run

```bash
node --import tsx <<'TS'
import { ProxyRuntimeController, loadProxySettings } from "@termina/proxy-runtime";

const controller = new ProxyRuntimeController({
  settings: loadProxySettings({
    https_proxy: "http://secure-proxy.local:8443",
    no_proxy: "internal.local"
  })
});

const first = controller.resolve("https://api.public.local/v1");
const second = controller.resolve("https://admin.public.local/v1");
const third = controller.resolve("https://service.internal.local/v1");

console.log(
  JSON.stringify(
    {
      first: {
        viaProxy: first.viaProxy,
        fromCache: first.fromCache,
        proxyUrl: first.proxyUrl,
        metadata: first.metadata
      },
      second: {
        viaProxy: second.viaProxy,
        fromCache: second.fromCache,
        proxyUrl: second.proxyUrl,
        metadata: second.metadata
      },
      third: {
        viaProxy: third.viaProxy,
        fromCache: third.fromCache,
        proxyUrl: third.proxyUrl,
        metadata: third.metadata
      },
      snapshot: controller.getSnapshot()
    },
    null,
    2
  )
);

controller.destroy();
TS
```

## Expected output snapshot

Snapshot file: [`./snapshots/controller.expected.json`](./snapshots/controller.expected.json)

```json
{
  "first": {
    "viaProxy": true,
    "fromCache": false,
    "proxyUrl": "http://secure-proxy.local:8443/",
    "metadata": {
      "target": "https://api.public.local/v1",
      "protocol": "https:",
      "mode": "proxy",
      "reason": "proxy_configured",
      "matchedNoProxy": false,
      "proxyUrl": "http://secure-proxy.local:8443/",
      "viaProxy": true,
      "fromCache": false
    }
  },
  "second": {
    "viaProxy": true,
    "fromCache": true,
    "proxyUrl": "http://secure-proxy.local:8443/",
    "metadata": {
      "target": "https://admin.public.local/v1",
      "protocol": "https:",
      "mode": "proxy",
      "reason": "proxy_configured",
      "matchedNoProxy": false,
      "proxyUrl": "http://secure-proxy.local:8443/",
      "viaProxy": true,
      "fromCache": true
    }
  },
  "third": {
    "viaProxy": false,
    "fromCache": false,
    "proxyUrl": null,
    "metadata": {
      "target": "https://service.internal.local/v1",
      "protocol": "https:",
      "mode": "direct",
      "reason": "no_proxy_match",
      "matchedNoProxy": true,
      "proxyUrl": null,
      "viaProxy": false,
      "fromCache": false
    }
  },
  "snapshot": {
    "settings": {
      "httpProxy": null,
      "httpsProxy": "http://secure-proxy.local:8443/",
      "allProxy": null,
      "noProxy": [
        {
          "host": "internal.local",
          "port": null,
          "wildcardSubdomains": true
        }
      ]
    },
    "cacheSize": 1,
    "disposed": false,
    "stats": {
      "resolveCount": 3,
      "proxiedCount": 2,
      "directCount": 1,
      "noProxyBypassCount": 1,
      "cacheHitCount": 1
    }
  }
}
```

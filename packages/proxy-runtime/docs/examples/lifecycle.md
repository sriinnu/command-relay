# Settings Reload + Lifecycle Controls

Use this example for runtime settings rotation and lifecycle operations.

## Run

```bash
node --import tsx <<'TS'
import {
  ProxyRuntimeController,
  loadProxySettings
} from "@commandrelay/proxy-runtime";

const controller = new ProxyRuntimeController({
  settings: loadProxySettings({
    http_proxy: "http://proxy-one.local:8080"
  })
});

const first = controller.resolve("http://service.example/v1");

controller.updateSettings(
  loadProxySettings({
    http_proxy: "http://proxy-two.local:8080"
  })
);
const second = controller.resolve("http://service.example/v1");

const env = {
  http_proxy: "http://proxy-three.local:8080",
  no_proxy: "service.example"
};
const reloadedSettings = controller.reloadFromEnvironment(env);
const third = controller.resolve("http://service.example/v1");

controller.clear();
const cacheAfterClear = controller.cacheSize;

controller.destroy();

console.log(
  JSON.stringify(
    {
      first: {
        viaProxy: first.viaProxy,
        proxyUrl: first.proxyUrl,
        metadata: first.metadata
      },
      second: {
        viaProxy: second.viaProxy,
        proxyUrl: second.proxyUrl,
        metadata: second.metadata
      },
      reloadedSettings,
      third: {
        viaProxy: third.viaProxy,
        proxyUrl: third.proxyUrl,
        metadata: third.metadata
      },
      cacheAfterClear,
      finalSnapshot: controller.getSnapshot()
    },
    null,
    2
  )
);
TS
```

## Expected output snapshot

Snapshot file: [`./snapshots/lifecycle.expected.json`](./snapshots/lifecycle.expected.json)

```json
{
  "first": {
    "viaProxy": true,
    "proxyUrl": "http://proxy-one.local:8080/",
    "metadata": {
      "target": "http://service.example/v1",
      "protocol": "http:",
      "mode": "proxy",
      "reason": "proxy_configured",
      "matchedNoProxy": false,
      "proxyUrl": "http://proxy-one.local:8080/",
      "viaProxy": true,
      "fromCache": false
    }
  },
  "second": {
    "viaProxy": true,
    "proxyUrl": "http://proxy-two.local:8080/",
    "metadata": {
      "target": "http://service.example/v1",
      "protocol": "http:",
      "mode": "proxy",
      "reason": "proxy_configured",
      "matchedNoProxy": false,
      "proxyUrl": "http://proxy-two.local:8080/",
      "viaProxy": true,
      "fromCache": false
    }
  },
  "reloadedSettings": {
    "httpProxy": "http://proxy-three.local:8080/",
    "httpsProxy": null,
    "allProxy": null,
    "noProxy": [
      {
        "host": "service.example",
        "port": null,
        "wildcardSubdomains": true
      }
    ]
  },
  "third": {
    "viaProxy": false,
    "proxyUrl": null,
    "metadata": {
      "target": "http://service.example/v1",
      "protocol": "http:",
      "mode": "direct",
      "reason": "no_proxy_match",
      "matchedNoProxy": true,
      "proxyUrl": null,
      "viaProxy": false,
      "fromCache": false
    }
  },
  "cacheAfterClear": 0,
  "finalSnapshot": {
    "settings": {
      "httpProxy": "http://proxy-three.local:8080/",
      "httpsProxy": null,
      "allProxy": null,
      "noProxy": [
        {
          "host": "service.example",
          "port": null,
          "wildcardSubdomains": true
        }
      ]
    },
    "cacheSize": 0,
    "disposed": true,
    "stats": {
      "resolveCount": 3,
      "proxiedCount": 2,
      "directCount": 1,
      "noProxyBypassCount": 1,
      "cacheHitCount": 0
    }
  }
}
```

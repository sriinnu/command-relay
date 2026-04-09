# Resolve Per-Target Proxy Routing

Use this example when you need deterministic routing decisions for multiple target protocols.

## Run

```bash
node --import tsx <<'TS'
import {
  loadProxySettings,
  resolveProxyForUrl,
  resolveProxyForUrlFromEnv
} from "@commandrelay/proxy-core";

const env = {
  http_proxy: "http://edge-proxy.local:8080",
  https_proxy: "http://secure-proxy.local:8443",
  all_proxy: "socks5://fallback-proxy.local:1080",
  no_proxy: "internal.local,localhost"
};

const settings = loadProxySettings(env);

const targets = [
  "http://public.example.com/v1",
  "https://public.example.com/v1",
  "https://api.internal.local/v1",
  "ftp://legacy.example.com/archive"
];

console.log(
  JSON.stringify(
    {
      resolved: targets.map((target) => ({
        target,
        proxyUrl: resolveProxyForUrl(target, settings)
      })),
      oneShot: resolveProxyForUrlFromEnv("https://one-shot.example.com", env)
    },
    null,
    2
  )
);
TS
```

## Expected output snapshot

Snapshot file: [`./snapshots/resolve.expected.json`](./snapshots/resolve.expected.json)

```json
{
  "resolved": [
    {
      "target": "http://public.example.com/v1",
      "proxyUrl": "http://edge-proxy.local:8080/"
    },
    {
      "target": "https://public.example.com/v1",
      "proxyUrl": "http://secure-proxy.local:8443/"
    },
    {
      "target": "https://api.internal.local/v1",
      "proxyUrl": null
    },
    {
      "target": "ftp://legacy.example.com/archive",
      "proxyUrl": "socks5://fallback-proxy.local:1080"
    }
  ],
  "oneShot": "http://secure-proxy.local:8443/"
}
```

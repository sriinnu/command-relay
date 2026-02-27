# Load and Inspect Proxy Settings

Use this example to verify environment parsing behavior and `NO_PROXY` normalization.

## Run

```bash
node --import tsx <<'TS'
import { loadProxySettings } from "@commandrelay/proxy-core";

const settings = loadProxySettings({
  http_proxy: "http://edge-proxy.local:8080",
  HTTPS_PROXY: "http://secure-proxy.local:8443",
  no_proxy: "internal.local,.svc.cluster.local,127.0.0.1:8080"
});

console.log(
  JSON.stringify(
    {
      httpProxy: settings.httpProxy,
      httpsProxy: settings.httpsProxy,
      allProxy: settings.allProxy,
      noProxy: settings.noProxy
    },
    null,
    2
  )
);
TS
```

## Expected output snapshot

Snapshot file: [`./snapshots/settings.expected.json`](./snapshots/settings.expected.json)

```json
{
  "httpProxy": "http://edge-proxy.local:8080/",
  "httpsProxy": "http://secure-proxy.local:8443/",
  "allProxy": null,
  "noProxy": [
    {
      "host": "internal.local",
      "port": null,
      "matchSubdomains": true
    },
    {
      "host": "svc.cluster.local",
      "port": null,
      "matchSubdomains": true
    },
    {
      "host": "127.0.0.1",
      "port": 8080,
      "matchSubdomains": false
    }
  ]
}
```

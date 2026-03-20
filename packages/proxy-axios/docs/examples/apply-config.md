# Apply Helper Config Wiring

This example shows safe non-mutating config application and routing metadata capture.

## Run

```bash
node --import tsx <<'TS'
import {
  ProxyAxiosAgentResolver,
  applyProxyAgentToAxiosConfig,
  type ProxyAxiosRequestConfig
} from "@commandrelay/proxy-axios";

const resolver = new ProxyAxiosAgentResolver({
  env: {
    https_proxy: "http://proxy.local:8443"
  }
});

const originalConfig: ProxyAxiosRequestConfig = {
  baseURL: "https://api.external.local",
  url: "/v1/status",
  method: "GET",
  proxy: {
    host: "legacy-proxy.local"
  }
};

try {
  const applied = applyProxyAgentToAxiosConfig(originalConfig, resolver, {
    mutate: false
  });

  console.log(
    JSON.stringify(
      {
        sameReference: applied.config === originalConfig,
        originalProxy: originalConfig.proxy,
        appliedProxy: applied.config.proxy,
        target: applied.target.toString(),
        routing: applied.routing,
        agentFields: {
          httpAgent: Boolean(applied.config.httpAgent),
          httpsAgent: Boolean(applied.config.httpsAgent)
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

Snapshot file: [`./snapshots/apply-config.expected.json`](./snapshots/apply-config.expected.json)

```json
{
  "sameReference": false,
  "originalProxy": {
    "host": "legacy-proxy.local"
  },
  "appliedProxy": false,
  "target": "https://api.external.local/v1/status",
  "routing": {
    "viaProxy": true,
    "proxyUrl": "http://proxy.local:8443/",
    "fromCache": false
  },
  "agentFields": {
    "httpAgent": false,
    "httpsAgent": true
  }
}
```

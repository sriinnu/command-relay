# Apply-helper option shaping

This example applies proxy routing to got-compatible options while preserving existing agent map entries.

## Run

```bash
node --import tsx <<'TS'
import { ProxyGotAgentResolver, applyProxyGotAgent, loadProxySettings } from "@termina/proxy-got";

const resolver = new ProxyGotAgentResolver({
  settings: loadProxySettings({
    https_proxy: "http://secure-proxy.local:8443"
  })
});

const prepared = applyProxyGotAgent(
  {
    url: "status",
    prefixUrl: "https://api.example.com/v1",
    agent: {
      http2: { tag: "existing-http2" }
    }
  },
  resolver
);

console.log(
  JSON.stringify(
    {
      target: prepared.targetUrl.toString(),
      routing: {
        viaProxy: prepared.viaProxy,
        proxyUrl: prepared.proxyUrl,
        fromCache: prepared.fromCache
      },
      agentShape: {
        hasHttp: Boolean(prepared.options.agent?.http),
        hasHttps: Boolean(prepared.options.agent?.https),
        preservedHttp2: Boolean(prepared.options.agent?.http2)
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

Snapshot file: [`./snapshots/apply.expected.json`](./snapshots/apply.expected.json)

```json
{
  "target": "https://api.example.com/v1/status",
  "routing": {
    "viaProxy": true,
    "proxyUrl": "http://secure-proxy.local:8443/",
    "fromCache": false
  },
  "agentShape": {
    "hasHttp": false,
    "hasHttps": true,
    "preservedHttp2": true
  }
}
```

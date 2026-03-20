# Route explanation

## Explain two URLs in human mode

```bash
env -i PATH="$PATH" \
https_proxy=http://secure-proxy.local:8443 \
no_proxy=internal.local \
commandrelay-cli-proxy explain --no-agent https://public.example.com https://api.internal.local
```

Expected snapshot file: [`./snapshots/explain.human.expected.txt`](./snapshots/explain.human.expected.txt)

```text
Proxy Route Explain
Agent support: disabled

[1] https://public.example.com
  decision: proxy
  target: https://public.example.com/
  protocol: https:
  proxyUrl: http://secure-proxy.local:8443/
  proxySource: httpsProxy
  matchedNoProxyRule: <none>
  reason: Route uses httpsProxy with proxy http://secure-proxy.local:8443/.

[2] https://api.internal.local
  decision: direct
  target: https://api.internal.local/
  protocol: https:
  proxyUrl: <unset>
  proxySource: <unset>
  matchedNoProxyRule: *.internal.local
  reason: Direct route due to NO_PROXY rule *.internal.local.
```

## Explain with JSON output

```bash
env -i PATH="$PATH" \
https_proxy=http://secure-proxy.local:8443 \
no_proxy=internal.local \
commandrelay-cli-proxy explain --json --no-agent https://public.example.com https://api.internal.local
```

Expected snapshot file: [`./snapshots/explain.json.expected.json`](./snapshots/explain.json.expected.json)

```json
{
  "command": "explain",
  "inspection": {
    "cgiMode": false,
    "variables": {
      "http_proxy": null,
      "HTTP_PROXY": null,
      "https_proxy": "http://secure-proxy.local:8443",
      "HTTPS_PROXY": null,
      "all_proxy": null,
      "ALL_PROXY": null,
      "no_proxy": "internal.local",
      "NO_PROXY": null,
      "REQUEST_METHOD": null,
      "request_method": null
    },
    "resolution": [
      {
        "logicalName": "httpProxy",
        "selectedKey": null,
        "selectedValue": null,
        "lowerKey": "http_proxy",
        "lowerValue": null,
        "upperKey": "HTTP_PROXY",
        "upperValue": null,
        "ignoredUppercase": false
      },
      {
        "logicalName": "httpsProxy",
        "selectedKey": "https_proxy",
        "selectedValue": "http://secure-proxy.local:8443",
        "lowerKey": "https_proxy",
        "lowerValue": "http://secure-proxy.local:8443",
        "upperKey": "HTTPS_PROXY",
        "upperValue": null,
        "ignoredUppercase": false
      },
      {
        "logicalName": "allProxy",
        "selectedKey": null,
        "selectedValue": null,
        "lowerKey": "all_proxy",
        "lowerValue": null,
        "upperKey": "ALL_PROXY",
        "upperValue": null,
        "ignoredUppercase": false
      },
      {
        "logicalName": "noProxy",
        "selectedKey": "no_proxy",
        "selectedValue": "internal.local",
        "lowerKey": "no_proxy",
        "lowerValue": "internal.local",
        "upperKey": "NO_PROXY",
        "upperValue": null,
        "ignoredUppercase": false
      }
    ],
    "settings": {
      "httpProxy": null,
      "httpsProxy": "http://secure-proxy.local:8443/",
      "allProxy": null,
      "noProxy": [
        {
          "host": "internal.local",
          "port": null,
          "matchSubdomains": true
        }
      ]
    }
  },
  "routes": [
    {
      "input": "https://public.example.com",
      "decision": "proxy",
      "targetUrl": "https://public.example.com/",
      "targetProtocol": "https:",
      "proxyUrl": "http://secure-proxy.local:8443/",
      "proxySource": "httpsProxy",
      "matchedNoProxyRule": null,
      "reason": "Route uses httpsProxy with proxy http://secure-proxy.local:8443/.",
      "agent": null,
      "error": null
    },
    {
      "input": "https://api.internal.local",
      "decision": "direct",
      "targetUrl": "https://api.internal.local/",
      "targetProtocol": "https:",
      "proxyUrl": null,
      "proxySource": null,
      "matchedNoProxyRule": {
        "host": "internal.local",
        "port": null,
        "matchSubdomains": true
      },
      "reason": "Direct route due to NO_PROXY rule *.internal.local.",
      "agent": null,
      "error": null
    }
  ],
  "agentSupport": "disabled"
}
```

## Invalid URL example

```bash
commandrelay-cli-proxy explain --no-agent not-a-url
```

For invalid entries, each route is reported with `decision=error` and `error=invalid_target_url`.

# Environment inspection

## Human output

```bash
env -i PATH="$PATH" \
http_proxy=http://proxy.local:8080 \
no_proxy=internal.local \
termina-cli-proxy env
```

Expected snapshot file: [`./snapshots/env.human.expected.txt`](./snapshots/env.human.expected.txt)

```text
Proxy Environment Inspection

CGI mode: no
Environment variables:
  http_proxy=http://proxy.local:8080
  HTTP_PROXY=<unset>
  https_proxy=<unset>
  HTTPS_PROXY=<unset>
  all_proxy=<unset>
  ALL_PROXY=<unset>
  no_proxy=internal.local
  NO_PROXY=<unset>
  REQUEST_METHOD=<unset>
  request_method=<unset>

Resolution:
  httpProxy: http_proxy=http://proxy.local:8080
  httpsProxy: <unset>
  allProxy: <unset>
  noProxy: no_proxy=internal.local

Effective settings:
  httpProxy=http://proxy.local:8080/
  httpsProxy=<unset>
  allProxy=<unset>
  noProxyRules:
    - *.internal.local
```

## JSON output

```bash
env -i PATH="$PATH" \
http_proxy=http://proxy.local:8080 \
no_proxy=internal.local \
termina-cli-proxy env --json
```

Expected snapshot file: [`./snapshots/env.json.expected.json`](./snapshots/env.json.expected.json)

```json
{
  "command": "env",
  "inspection": {
    "cgiMode": false,
    "variables": {
      "http_proxy": "http://proxy.local:8080",
      "HTTP_PROXY": null,
      "https_proxy": null,
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
        "selectedKey": "http_proxy",
        "selectedValue": "http://proxy.local:8080",
        "lowerKey": "http_proxy",
        "lowerValue": "http://proxy.local:8080",
        "upperKey": "HTTP_PROXY",
        "upperValue": null,
        "ignoredUppercase": false
      },
      {
        "logicalName": "httpsProxy",
        "selectedKey": null,
        "selectedValue": null,
        "lowerKey": "https_proxy",
        "lowerValue": null,
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
      "httpProxy": "http://proxy.local:8080/",
      "httpsProxy": null,
      "allProxy": null,
      "noProxy": [
        {
          "host": "internal.local",
          "port": null,
          "matchSubdomains": true
        }
      ]
    }
  }
}
```

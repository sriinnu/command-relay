# @commandrelay/proxy-core

Core TypeScript utilities for loading proxy settings from environment variables and resolving per-target proxy routing.

## Install

```bash
npm install @commandrelay/proxy-core
```

Node.js `>=22` is required.

## Usage

```ts
import {
  loadProxySettings,
  resolveProxyForUrl,
  resolveProxyForUrlFromEnv
} from "@commandrelay/proxy-core";

const settings = loadProxySettings(process.env);

const controlPlaneProxy = resolveProxyForUrl("https://api.example.com/v1", settings);
const telemetryProxy = resolveProxyForUrl(new URL("http://telemetry.example.com"), settings);

// Convenience one-shot helper:
const proxyFromEnv = resolveProxyForUrlFromEnv("https://edge.example.com");

console.log({ controlPlaneProxy, telemetryProxy, proxyFromEnv });
```

### `NO_PROXY` matching

```ts
import { parseNoProxy, shouldBypassProxy } from "@commandrelay/proxy-core";

const rules = parseNoProxy("*.internal.local,localhost:8080,[::1],10.0.0.5");
const bypass = shouldBypassProxy(new URL("https://api.internal.local"), rules);

console.log({ bypass }); // true
```

## API

```ts
type ProxyEnvironment = Readonly<Record<string, string | undefined>>;

interface NoProxyRule {
  host: string;
  port: number | null;
  matchSubdomains: boolean;
}

interface ProxySettings {
  httpProxy: string | null;
  httpsProxy: string | null;
  allProxy: string | null;
  noProxy: NoProxyRule[];
}
```

- `loadProxySettings(env?: ProxyEnvironment): ProxySettings`
- `resolveProxyForUrl(target: string | URL, settings: ProxySettings): string | null`
- `resolveProxyForUrlFromEnv(target: string | URL, env?: ProxyEnvironment): string | null`
- `shouldBypassProxy(target: URL, rules: readonly NoProxyRule[]): boolean`
- `parseNoProxy(raw: string): NoProxyRule[]`

## Error handling example

`proxy-core` does not export custom error classes. Invalid target URLs throw `TypeError` from URL parsing.

```ts
import { loadProxySettings, resolveProxyForUrl } from "@commandrelay/proxy-core";

const settings = loadProxySettings();

try {
  resolveProxyForUrl("::not-a-url::", settings);
} catch (error) {
  if (error instanceof TypeError) {
    console.error("Invalid target URL", error.message);
  } else {
    throw error;
  }
}
```

## Security notes

- Lowercase env vars win over uppercase (`http_proxy` over `HTTP_PROXY`).
- In CGI-like environments (`REQUEST_METHOD` set), uppercase `HTTP_PROXY` is ignored.
- Invalid or unsupported proxy URLs are sanitized to `null` instead of being used.
- Supported proxy schemes: `http`, `https`, `socks`, `socks4`, `socks4a`, `socks5`, `socks5h`, `pac+http`, `pac+https`, `pac+file`, `pac+data`.
- Invalid `NO_PROXY` tokens are dropped safely.
- Avoid logging proxy URLs that include credentials.

## Performance notes

- Parse settings once (`loadProxySettings`) and reuse the resulting `ProxySettings`.
- Reuse parsed `NO_PROXY` rules rather than reparsing per request.
- Pass `URL` objects when already available to avoid repeated URL parsing.

# @commandrelay/proxy-agent

Protocol-aware proxy agent factory for Node.js HTTP clients. Supports `http`, `https`, `socks*`, and `pac+*` proxy URLs with bounded agent caching.

## Install

```bash
npm install @commandrelay/proxy-agent
```

## Runtime support

- Node.js `>=18`
- npm `>=9`
- ESM package (`"type": "module"`)

## Version support policy

- Current line: `0.1.x`
- `@commandrelay/proxy-agent` depends on `@commandrelay/proxy-core`.
- For production in pre-`1.0`, keep `proxy-agent` and `proxy-core` on the same minor line (example: `0.1.x` with `0.1.x`).

## Export surface

- `@commandrelay/proxy-agent` (root API)
- `@commandrelay/proxy-agent/package.json` (metadata only)
- Deep imports such as `@commandrelay/proxy-agent/dist/*` are intentionally unsupported.

## Usage

```ts
import https from "node:https";
import { ProxyAgentFactory } from "@commandrelay/proxy-agent";

const factory = new ProxyAgentFactory({
  env: process.env,
  maxCacheEntries: 256
});

const target = "https://api.example.com/data";
const { agent, viaProxy, proxyUrl, fromCache } = factory.resolve(target);

const req = https.request(target, { method: "GET", agent: agent ?? undefined }, (res) => {
  console.log("status", res.statusCode, { viaProxy, proxyUrl, fromCache });
});

req.on("error", console.error);
req.end();
```

### JavaScript (ESM) usage

```js
import { ProxyAgentFactory } from "@commandrelay/proxy-agent";

const factory = new ProxyAgentFactory();
const { agent, viaProxy, proxyUrl } = factory.resolve("https://example.com");

console.log({ hasAgent: Boolean(agent), viaProxy, proxyUrl });
```

### One-off agent creation

```ts
import { createProxyAgent } from "@commandrelay/proxy-agent";

const agent = createProxyAgent("socks5://127.0.0.1:1080", "https:");
```

## API

Root package exports:

```ts
interface ProxyAgentResolution {
  agent: import("node:http").Agent | null;
  proxyUrl: string | null;
  viaProxy: boolean;
  fromCache: boolean;
}

interface ProxyAgentFactoryOptions {
  settings?: ProxySettings;
  env?: ProxyEnvironment;
  maxCacheEntries?: number;
}

class ProxyAgentFactory {
  constructor(options?: ProxyAgentFactoryOptions);
  resolve(target: string | URL): ProxyAgentResolution;
  updateSettings(settings: ProxySettings): void;
  reloadFromEnvironment(env?: ProxyEnvironment): ProxySettings;
  clear(): void;
  destroy(): void;
  dispose(): void;
  get cacheSize(): number;
}
```

- `createProxyAgent(proxyUrl: string, targetProtocol: string): Agent`
- `loadProxySettings(env?: ProxyEnvironment): ProxySettings`
- `resolveProxyForUrl(target: string | URL, settings: ProxySettings): string | null`
- `shouldBypassProxy(target: URL, rules: NoProxyRule[]): boolean`
- `parseNoProxy(raw: string): NoProxyRule[]`
- Types: `NoProxyRule`, `ProxyEnvironment`, `ProxySettings`, `ProxyAgentFactoryOptions`, `ProxyAgentResolution`

## Error handling example

The root package does not export factory-specific error classes; handle by `TypeError` and message codes.

```ts
import { ProxyAgentFactory, createProxyAgent } from "@commandrelay/proxy-agent";

try {
  createProxyAgent("ftp://proxy.local:21", "https:");
} catch (error) {
  if (error instanceof Error && error.message.startsWith("unsupported_proxy_protocol:")) {
    console.error("Proxy URL protocol is unsupported");
  }
}

const factory = new ProxyAgentFactory();
try {
  factory.resolve("::not-a-url::");
} catch (error) {
  if (error instanceof TypeError && error.message === "invalid_target_url") {
    console.error("Target URL is invalid");
  }
}
```

## Security notes

- Lowercase env vars override uppercase counterparts.
- Uppercase `HTTP_PROXY` is ignored in CGI-like contexts (`REQUEST_METHOD` present).
- `NO_PROXY` supports host/domain rules, wildcard-style entries, IPv4/IPv6, and optional ports.
- Invalid proxy env values are sanitized and ignored.
- Treat PAC URLs as executable policy and limit PAC source trust boundaries.
- Do not log proxy URLs with embedded credentials.

## Performance notes

- `ProxyAgentFactory` uses an LRU-style cache keyed by `proxyUrl|targetProtocol`.
- Default cache size is `256`; invalid `maxCacheEntries` values fall back to this default.
- Set `maxCacheEntries: 0` to disable caching.
- Reuse one factory per process/service and call `reloadFromEnvironment()` or `updateSettings()` when proxy configuration rotates.
- Call `destroy()`/`dispose()` on shutdown to close cached proxy agents.

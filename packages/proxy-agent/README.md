# @commandrelay/proxy-agent

![proxy-agent brand](./docs/assets/proxy-agent-brand.svg)

Protocol-aware proxy agent factory for Node.js clients that accept `http.Agent`/`https.Agent`.

- Supports `http`, `https`, `socks*`, and `pac+*` proxy URLs
- Resolves routing from standard proxy env vars (`HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, `NO_PROXY`)
- Reuses agents with bounded cache for low overhead across repeated requests

## Install

```bash
npm install @commandrelay/proxy-agent
```

## Runtime

- Node.js `>=18`
- npm `>=9`
- ESM package (`"type": "module"`)

## External Reuse

This package is designed for proxy-agent style consumers: libraries/services that need a per-target Node agent.

Integration note: [NOTES.md](./NOTES.md)

### Generic adapter for agent-based HTTP clients

```ts
import { ProxyAgentFactory } from "@commandrelay/proxy-agent";

const factory = new ProxyAgentFactory({ env: process.env, maxCacheEntries: 256 });

export function resolveAgent(target: string | URL) {
  const { agent } = factory.resolve(target);
  return agent ?? undefined;
}
```

### Axios example

```ts
import axios from "axios";
import { ProxyAgentFactory } from "@commandrelay/proxy-agent";

const factory = new ProxyAgentFactory();
const target = "https://api.example.com/data";
const { agent } = factory.resolve(target);

const response = await axios.get(target, {
  proxy: false,
  httpAgent: agent ?? undefined,
  httpsAgent: agent ?? undefined
});

console.log(response.status);
```

### Got example

```ts
import got from "got";
import { ProxyAgentFactory } from "@commandrelay/proxy-agent";

const factory = new ProxyAgentFactory();
const target = "https://api.example.com/data";
const { agent } = factory.resolve(target);

const body = await got(target, {
  agent: {
    http: agent ?? undefined,
    https: agent ?? undefined
  }
}).text();

console.log(body.length);
```

## API

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

Also exported:

- `createProxyAgent(proxyUrl: string, targetProtocol: string): Agent`
- `loadProxySettings(env?: ProxyEnvironment): ProxySettings`
- `resolveProxyForUrl(target: string | URL, settings: ProxySettings): string | null`
- `shouldBypassProxy(target: URL, rules: NoProxyRule[]): boolean`
- `parseNoProxy(raw: string): NoProxyRule[]`
- Types: `NoProxyRule`, `ProxyEnvironment`, `ProxySettings`, `ProxyAgentFactoryOptions`, `ProxyAgentResolution`

## Security and Ops

- Lowercase env vars override uppercase counterparts
- In CGI-like environments (`REQUEST_METHOD` set), uppercase `HTTP_PROXY` is ignored
- `NO_PROXY` supports domain/host rules, wildcard-style entries, IPv4/IPv6, and optional ports
- Do not log proxy URLs containing credentials
- PAC URLs are executable policy; only use trusted PAC sources

## Performance

- Default cache size is `256`
- Set `maxCacheEntries: 0` to disable caching
- Reuse one long-lived `ProxyAgentFactory` per process/service
- Call `reloadFromEnvironment()` when proxy env settings rotate
- Call `destroy()`/`dispose()` on shutdown to close cached agents

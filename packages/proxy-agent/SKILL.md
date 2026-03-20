# SKILL: @commandrelay/proxy-agent

`@commandrelay/proxy-agent` turns normalized proxy policy into concrete Node transport agents (`http.Agent`/`https.Agent`) with caching, lifecycle disposal, and protocol-aware factory behavior.

## Install

```bash
npm install @commandrelay/proxy-agent
```

## Execution (Modern AI-ready)

- Type check: `pnpm --filter @commandrelay/proxy-agent run check`
- Build: `pnpm --filter @commandrelay/proxy-agent run build`
- Tests: `pnpm --filter @commandrelay/proxy-agent run test`
- Run via extension: `npm run extension:run -- proxy-agent info`
- Run via extension: `npm run extension:run -- proxy-agent check`
- Build via extension: `npm run extension:run -- proxy-agent build`
- Test via extension: `npm run extension:run -- proxy-agent test`

## Exported API

- Types: `ProxyAgentFactoryOptions`, `ProxyAgentConstructorOptions`, `ProxyAgentTlsOptions`, `ProxyAgentResolution`, `ProxyEnvironment`, `ProxySettings`
- Classes: `ProxyAgentFactory`
- Top-level functions:
  - `loadProxySettings`, `resolveProxyForUrl`, `shouldBypassProxy`, `parseNoProxy`
  - `createProxyAgent(proxyUrl, targetProtocol, options?)`

## Reference Snippet

```ts
import {
  ProxyAgentFactory,
  loadProxySettings,
  parseNoProxy,
  createProxyAgent,
  type ProxyAgentFactoryOptions,
  type ProxyAgentResolution
} from "@commandrelay/proxy-agent";

const factory = new ProxyAgentFactory({
  maxCacheEntries: 64,
  agentOptions: {
    tls: {
      rejectUnauthorized: true,
      minVersion: "TLSv1.2"
    }
  }
});

const outcome: ProxyAgentResolution = factory.resolve("https://api.example.com/status");
console.log(outcome.viaProxy, outcome.proxyUrl, outcome.fromCache, outcome.agent?.constructor.name);

console.log(factory.cacheSize, "entries cached");
factory.destroy();

const direct = createProxyAgent("http://proxy.internal:3128", "https:");
console.log(!!direct);
```

## Troubleshooting Playbook

- `unsupported_target_protocol:<proto>`: only `http:`, `https:`, `ws:`, `wss:` accepted.
- `unsupported_proxy_protocol:<proto>`: SOCKS/PAC protocol handling requires `@commandrelay/proxy-agent` support; unsupported protocols are rejected.
- Unexpected direct routing when proxy expected: check `NO_PROXY` rules and `loadProxySettings` precedence.
- Cache growth: call `destroy()` or `clear()` after config rotations if host/proxy topology changes.

## Runtime Caveats

- Use one factory per process boundary and let it own disposal.
- If long-lived, call `destroy()` before shutdown so agent socket cleanup can complete.
- Optional `ca`, `cert`, `key`, and `pfx` are passed through to HTTPS-capable paths where supported.

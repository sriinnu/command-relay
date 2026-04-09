# SKILL: @commandrelay/proxy-got

`@commandrelay/proxy-got` maps proxy routing to got-compatible request surfaces (`url`, `prefixUrl`, and `agent`) while keeping got runtime optional.

## Install

```bash
npm install @commandrelay/proxy-got
```

## Execution (Modern AI-ready)

- Type check: `pnpm --filter @commandrelay/proxy-got run check`
- Build: `pnpm --filter @commandrelay/proxy-got run build`
- Tests: `pnpm --filter @commandrelay/proxy-got run test`
- Extension metadata: `npm run extension:run -- proxy-got info`
- Extension check: `npm run extension:run -- proxy-got check`
- Extension build: `npm run extension:run -- proxy-got build`
- Extension test: `npm run extension:run -- proxy-got test`

## Exported API

- Class: `ProxyGotAgentResolver`
  - `resolve`, `resolveForOptions`, `applyToOptions`, `updateSettings`, `reloadFromEnvironment`, `clear`, `destroy`, `dispose`, `cacheSize`
- Helpers: `resolveGotRequestTarget`, `resolveProxyGotAgentEntry`, `applyProxyGotAgent`, `createProxyGotAgentResolver`
- Error types: `MissingGotTargetError`, `InvalidGotTargetError`, `InvalidGotPrefixUrlError`, `UnsupportedGotProtocolError`

## Reference Snippet

```ts
import { ProxyGotAgentResolver, applyProxyGotAgent } from "@commandrelay/proxy-got";

const resolver = new ProxyGotAgentResolver({
  env: {
    https_proxy: "http://proxy.internal:8443",
    no_proxy: "localhost"
  }
});

const prepared = applyProxyGotAgent(
  {
    url: "/health",
    prefixUrl: "https://api.example.com",
    method: "GET"
  },
  resolver
);

console.log(prepared.targetUrl.toString(), prepared.protocol, prepared.viaProxy);

const byTarget = resolver.resolve("https://api.example.com/health");
console.log(byTarget.targetUrl.toString(), byTarget.agent?.constructor.name, byTarget.fromCache);

resolver.destroy();
```

## Operational Checks

- Use `applyProxyGotAgent` for deterministic got option shaping before passing options into your got callsite.
- Keep `prefixUrl` absolute for relative route safety.
- Restart resolver after major target policy changes or call `reloadFromEnvironment()` to clear cached agents.

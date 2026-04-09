# SKILL: @commandrelay/proxy-core

`@commandrelay/proxy-core` is the shared proxy policy engine for this ecosystem. It normalizes `http_proxy`, `https_proxy`, `all_proxy`, and `no_proxy` and answers `resolveProxyForUrl` for deterministic routing decisions.

## Install

```bash
npm install @commandrelay/proxy-core
```

## Execution (Modern AI-ready)

- Type check: `pnpm --filter @commandrelay/proxy-core run check`
- Build: `pnpm --filter @commandrelay/proxy-core run build`
- Tests: `pnpm --filter @commandrelay/proxy-core run test`
- Read package metadata quickly: `npm run extension:run -- proxy-core info`
- Run package checks through extension router: `npm run extension:run -- proxy-core check`
- Build + test from extension router:
  - `npm run extension:run -- proxy-core build`
  - `npm run extension:run -- proxy-core test`

## API Surface

- `loadProxySettings(env?: ProxyEnvironment): ProxySettings`
- `resolveProxyForUrl(target, settings): string | null`
- `resolveProxyForUrlFromEnv(target, env?): string | null`
- `parseNoProxy(raw): NoProxyRule[]`
- `shouldBypassProxy(target, rules): boolean`

Use `@commandrelay/proxy-core/package.json` only for metadata; do not import `dist/*`.

## Scripted Smoke

```bash
# Validate policy load + rule match in one command
node - <<'NODE'
import { loadProxySettings, parseNoProxy, resolveProxyForUrl } from "./packages/proxy-core/dist/index.js";
const settings = loadProxySettings({
  https_proxy: "http://proxy.internal:8443",
  no_proxy: "localhost,127.0.0.1,.svc.cluster.local"
});
console.log("settings", settings);
console.log("internal", resolveProxyForUrl("http://example.internal", settings));
console.log("public", resolveProxyForUrl("https://api.example.com", settings));
NODE
```

## Reference Snippet

```ts
import {
  loadProxySettings,
  parseNoProxy,
  resolveProxyForUrl,
  shouldBypassProxy
} from "@commandrelay/proxy-core";

const settings = loadProxySettings(process.env);
const settingsRules = parseNoProxy(".svc.cluster.local,.internal:8080,*.corp.example.com");
const routeFor = (url: string) => ({
  url,
  proxy: resolveProxyForUrl(url, settings),
  bypass: shouldBypassProxy(new URL(url), settingsRules)
});

console.log(routeFor("https://api.corp.example.com/orders"));
```

## Operational Notes

- Lowercase variables (`http_proxy`) override uppercase (`HTTP_PROXY`).
- `REQUEST_METHOD` (CGI) disables uppercase `HTTP_PROXY`.
- Invalid entries are sanitized out; invalid URLs become `null` rather than fatal at this layer.
- Keep this package dependency as the single source of proxy policy when sharing policy across multiple adapters.

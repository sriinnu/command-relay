# @commandrelay/proxy-core

![proxy-core brand mark](./docs/assets/proxy-core-brand.svg)

Transport-agnostic proxy resolution primitives for Node.js and TypeScript.
Use this package as the stable core in `proxy-*` package families across repos.

Shared proxy decision logic for the CommandRelay proxy family.

## Install

```bash
npm install @commandrelay/proxy-core
```

## Runtime

- Node.js `>=18`
- npm `>=9`
- ESM only (`"type": "module"`)

## Reuse Model (`proxy-*` style)

Keep `proxy-core` focused on policy decisions and build protocol/framework adapters in sibling packages:

- `proxy-core`: parse env and decide whether a target should use a proxy URL
- `proxy-undici` / `proxy-fetch` / `proxy-axios`: map the decision to client-specific options
- `proxy-cli` (optional): diagnostics and runtime inspection

This keeps shared behavior consistent while allowing each adapter package to evolve independently.

## Companion Adapter Pattern

Treat adapter packages as thin translators around `proxy-core` decisions:

1. Parse and cache settings once (`loadProxySettings`).
2. Resolve per-request proxy with `resolveProxyForUrl`.
3. Return transport-specific options without re-implementing policy.

```ts
import {
  loadProxySettings,
  resolveProxyForUrl,
  type ProxySettings
} from "@commandrelay/proxy-core";

export type ProxyAdapterResult<TOptions> = TOptions & { proxyUrl: string | null };

const settings: ProxySettings = loadProxySettings(process.env);

export function withProxy<TOptions extends object>(
  target: string | URL,
  options: TOptions
): ProxyAdapterResult<TOptions> {
  return { ...options, proxyUrl: resolveProxyForUrl(target, settings) };
}
```

## External Naming Conventions (`@commandrelay/proxy-*`)

For external consumers that mirror this ecosystem (for example `@commandrelay/*`), keep package role names stable:

- `@commandrelay/proxy-core`: policy/parsing only
- `@commandrelay/proxy-<transport>`: transport bindings only (`undici`, `fetch`, `axios`, etc.)
- `@commandrelay/proxy-runtime` (optional): refresh/diagnostics utilities

Guideline: keep one package per role and preserve the `proxy-*` suffixes so cross-repo docs and migrations stay predictable.

## Quick Start

```ts
import {
  loadProxySettings,
  resolveProxyForUrl,
  resolveProxyForUrlFromEnv
} from "@commandrelay/proxy-core";

const settings = loadProxySettings(process.env);
const controlPlaneProxy = resolveProxyForUrl("https://api.example.com/v1", settings);
const telemetryProxy = resolveProxyForUrl(new URL("http://telemetry.example.com"), settings);
const oneShotProxy = resolveProxyForUrlFromEnv("https://edge.example.com");

console.log({ controlPlaneProxy, telemetryProxy, oneShotProxy });
```

## Examples

- [Examples index](./docs/examples/README.md)
- [Load and inspect normalized proxy settings + snapshot](./docs/examples/settings.md)
- [Resolve per-target proxy routing + snapshot](./docs/examples/resolve.md)

## Usage Matrix

| Integration need | Use `@commandrelay/proxy-core` | Pair with |
| --- | --- | --- |
| Shared proxy policy across multiple HTTP clients | Yes, as the single source of env parsing and `NO_PROXY` matching | `@commandrelay/proxy-agent`, `@commandrelay/proxy-undici`, `@commandrelay/proxy-fetch`, or app wrapper |
| Build a thin adapter for a specific transport | Yes, call `loadProxySettings` once and `resolveProxyForUrl` per target | Transport-specific package in your stack |
| Need ready-to-use runtime agents/dispatchers | Not by itself | `@commandrelay/proxy-agent` or `@commandrelay/proxy-undici` |
| Need operator diagnostics from terminal/CI | Core can power this, but prefer dedicated UX | `@commandrelay/cli-proxy` |

## API Surface

- `loadProxySettings(env?: ProxyEnvironment): ProxySettings`
- `resolveProxyForUrl(target: string | URL, settings: ProxySettings): string | null`
- `resolveProxyForUrlFromEnv(target: string | URL, env?: ProxyEnvironment): string | null`
- `parseNoProxy(raw: string): NoProxyRule[]`
- `shouldBypassProxy(target: URL, rules: readonly NoProxyRule[]): boolean`

Export policy:

- `@commandrelay/proxy-core` (root API)
- `@commandrelay/proxy-core/package.json` (metadata)
- No deep imports (`dist/*`) for compatibility stability

## Security and Compatibility Notes

- Lowercase env vars win over uppercase (`http_proxy` over `HTTP_PROXY`)
- In CGI-like environments (`REQUEST_METHOD` set), uppercase `HTTP_PROXY` is ignored
- Invalid proxy URLs are sanitized to `null`
- Invalid `NO_PROXY` tokens are dropped
- Invalid target input throws `TypeError` via URL parsing

## Versioning

- Current line: `0.1.x`
- Until `1.0`, pin minor versions in production (for example `~0.1.0`)

## Migration and Compatibility

- Runtime baseline: Node.js `>=18`, npm `>=9`, ESM package usage.
- If migrating from custom proxy env parsing, replace local logic with one startup call to `loadProxySettings(process.env)`.
- Replace per-client `NO_PROXY` matching code with `resolveProxyForUrl(target, settings)` to keep behavior consistent.
- Use root imports only (`@commandrelay/proxy-core`); deep imports are not compatibility-safe.
- While pre-`1.0`, pin minor versions (`~0.1.x`) before broad rollout.

## Troubleshooting

- Proxy unexpectedly not used: verify target has `http:` or `https:` scheme and matching `*_PROXY` values are set.
- Target unexpectedly bypassed: review `NO_PROXY` entries (host/domain/port rules may match more than expected).
- `HTTP_PROXY` appears ignored: expected when `REQUEST_METHOD` is set (CGI hardening behavior).
- Resolved proxy is `null`: invalid proxy URL inputs are sanitized and treated as unset.

## Integration Notes

See [NOTES.md](./NOTES.md) for external integration guidelines and adapter conventions.

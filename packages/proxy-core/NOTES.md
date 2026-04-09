# proxy-core Integration Notes

Use `@commandrelay/proxy-core` as the single source of truth for proxy environment parsing and target routing decisions.

## Fast Integration Checklist

1. Load settings once at process startup with `loadProxySettings(process.env)`.
2. Reuse the cached settings for all outbound targets in the process.
3. Resolve per-target proxy via `resolveProxyForUrl(target, settings)`.
4. Keep adapter logic outside this package (for example Undici, Axios, Fetch wrappers).
5. Do not use deep imports; consume only the root package export.

## Recommended Package Split (`proxy-*`)

- `proxy-core`: pure parsing/matching/routing policy
- `proxy-undici` (or similar): agent/dispatcher wiring
- `proxy-runtime` (optional): runtime refresh and diagnostics

This split keeps policy stable while allowing transport-specific packages to iterate independently.

## Companion Adapter Pattern

Build adapters as pure translation layers over one shared `ProxySettings` instance:

1. Cache `loadProxySettings(process.env)` at startup.
2. Resolve `proxyUrl` from `resolveProxyForUrl(target, settings)`.
3. Attach the result to transport-specific options.

## Minimal Typed Example

```ts
import {
  loadProxySettings,
  resolveProxyForUrl,
  type ProxySettings
} from "@commandrelay/proxy-core";

export type AdapterInput = { target: string | URL; timeoutMs: number };
export type AdapterOutput = { timeoutMs: number; proxyUrl: string | null };

const proxySettings: ProxySettings = loadProxySettings(process.env);

export function toAdapterOptions(input: AdapterInput): AdapterOutput {
  return {
    timeoutMs: input.timeoutMs,
    proxyUrl: resolveProxyForUrl(input.target, proxySettings)
  };
}
```

## External Package Naming (`@commandrelay/proxy-*`)

When publishing companion packages outside `@commandrelay`, preserve the role-based suffix model:

- `@commandrelay/proxy-core` for policy/parsing
- `@commandrelay/proxy-<transport>` for transport adapters
- `@commandrelay/proxy-runtime` for optional runtime helpers

Avoid role overlap (for example two different packages both acting as the primary fetch adapter).

## Operational Notes

- Avoid logging proxy URLs that may include credentials.
- Lowercase env vars override uppercase variants.
- In CGI-like environments, `HTTP_PROXY` is intentionally ignored.

## Migration and Compatibility

- Migrate from ad-hoc env parsing to `loadProxySettings(process.env)` once per process.
- Route all outbound target checks through `resolveProxyForUrl(target, settings)` instead of per-adapter matching.
- Keep transport-specific code in companion packages; do not add agent/client coupling in `proxy-core`.
- Import only from `@commandrelay/proxy-core` (no `dist/*` deep imports).
- While pre-`1.0`, pin minor versions (`~0.1.x`) for controlled upgrades.

## Troubleshooting

- Inconsistent decisions across services: ensure all services share one parsed settings snapshot at startup.
- Unexpected bypass behavior: inspect `NO_PROXY` token formatting and port-specific entries.
- `HTTP_PROXY` ignored in CI/CGI-like jobs: check whether `REQUEST_METHOD` is present in env.
- `null` proxy for known endpoints: validate proxy URL format and scheme in source env vars.

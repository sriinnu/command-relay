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

## Minimal Adapter Example

```ts
import { loadProxySettings, resolveProxyForUrl } from "@commandrelay/proxy-core";

const proxySettings = loadProxySettings(process.env);

export function resolveOutboundProxy(target: string | URL): string | null {
  return resolveProxyForUrl(target, proxySettings);
}
```

## Operational Notes

- Avoid logging proxy URLs that may include credentials.
- Lowercase env vars override uppercase variants.
- In CGI-like environments, `HTTP_PROXY` is intentionally ignored.

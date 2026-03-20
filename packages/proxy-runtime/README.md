# @commandrelay/proxy-runtime

![proxy-runtime brand](./docs/assets/proxy-runtime-brand.svg)

`@commandrelay/proxy-runtime` provides a production-ready runtime controller for proxy decisions, settings rotation, and proxy-agent cache lifecycle.

It wraps `@commandrelay/proxy-agent` with:

- deterministic decision metadata (`proxy`, `no_proxy`, direct)
- runtime snapshots for diagnostics
- lifecycle controls (`clear`, `destroy`, `dispose`, env reload)

## Install

```bash
npm install @commandrelay/proxy-runtime
```

## Runtime

- Node.js `>=18`
- npm `>=9`
- ESM package (`"type": "module"`)

## Quick Start

```ts
import {
  ProxyRuntimeController,
  loadProxySettings
} from "@commandrelay/proxy-runtime";

const controller = new ProxyRuntimeController({
  settings: loadProxySettings({
    https_proxy: "http://proxy.local:8443",
    no_proxy: "internal.local"
  })
});

const result = controller.resolve("https://api.example.com/v1");
console.log(result.metadata);

const snapshot = controller.getSnapshot();
console.log(snapshot.stats);

controller.dispose();
```

## Usage Matrix

| Integration need | Use `@commandrelay/proxy-runtime` | Why |
| --- | --- | --- |
| Need a long-lived runtime boundary for proxy decisions | Yes | `ProxyRuntimeController` centralizes settings + lifecycle |
| Need per-request metadata for logs/metrics | Yes | `resolve()` returns structured decision metadata |
| Need hot-reload from env without recreating app wiring | Yes | `reloadFromEnvironment()` updates settings and clears stale cache |
| Need only pure proxy parsing/matching primitives | Prefer `@commandrelay/proxy-core` | Smaller policy-only surface |
| Need raw Node agents only | Prefer `@commandrelay/proxy-agent` | Direct agent factory with minimal wrapper |

## API Surface

- `class ProxyRuntimeController`
  - `resolve(target)`
  - `updateSettings(settings)`
  - `reloadFromEnvironment(env?)`
  - `clear()`
  - `destroy()` / `dispose()`
  - `cacheSize`
  - `getSnapshot()`
- `createProxyRuntimeController(options?)`
- Types:
  - `ProxyRuntimeControllerOptions`
  - `ProxyRuntimeDecisionMetadata`
  - `ProxyRuntimeDecisionMode`
  - `ProxyRuntimeDecisionReason`
  - `ProxyRuntimeResolution`
  - `ProxyRuntimeSnapshot`
  - `ProxyRuntimeStats`

Also re-exported from `@commandrelay/proxy-agent` for convenience:

- `loadProxySettings`, `parseNoProxy`, `resolveProxyForUrl`, `shouldBypassProxy`
- `ProxySettings`, `ProxyEnvironment`, `NoProxyRule`

## Examples

- [Examples index](./docs/examples/README.md)
- [Decision metadata and snapshots](./docs/examples/controller.md)
- [Settings rotation and lifecycle operations](./docs/examples/lifecycle.md)

## Migration and Compatibility

- Runtime baseline is Node.js `>=18` with ESM imports.
- Replace ad-hoc proxy helpers with one process-level `ProxyRuntimeController`.
- Route all outbound targets through `controller.resolve(target)` to get both route and metadata.
- On proxy env rotation, call `reloadFromEnvironment()` (or `updateSettings()` when config is sourced elsewhere).
- Keep imports at package root (`@commandrelay/proxy-runtime`), not deep `dist/*` paths.
- While pre-`1.0`, pin minor versions (`~0.1.x`) for controlled upgrades.

## Troubleshooting

- Unexpected direct traffic:
  - Check `NO_PROXY` rules and `metadata.reason` for `no_proxy_match`.
- Unexpected proxy usage:
  - Verify target scheme and resolved settings snapshot (`getSnapshot().settings`).
- Behavior stale after environment changes:
  - Call `reloadFromEnvironment()` and verify cache reset with `cacheSize`.
- Shutdown concerns:
  - Call `destroy()`/`dispose()` to clean cached agents during graceful stop.

## Integration Notes

See [NOTES.md](./NOTES.md) for package-splitting and operational guidance.

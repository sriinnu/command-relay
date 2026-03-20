# External App Integration Guide (Proxy Packages)

This guide is for teams that want to consume CommandRelay proxy packages from other apps.

## Package boundaries

1. `@commandrelay/proxy-core`
   - Use for policy parsing and deterministic environment decisions only.
2. `@commandrelay/proxy-agent`
   - Use when you need protocol-aware `http.Agent`/`https.Agent` instances.
3. `@commandrelay/proxy-http-client`
   - Use for typed JSON request/response with proxy-aware transport.
4. `@commandrelay/proxy-fetch`
   - Use for `fetch`-style consumers that want a proxy-aware dispatcher.
5. `@commandrelay/proxy-undici`
   - Use for `undici` clients/dispatchers.
6. `@commandrelay/proxy-axios` / `@commandrelay/proxy-got` / `@commandrelay/proxy-runtime`
   - Use for runtime-specific stack integration and richer lifecycle behavior.
7. `@commandrelay/relay-proxy`
   - Use when you need a WS relay sidecar exposing `/ws` safely through upstream TLS policy.

## Runtime decision pattern for all apps

The best default is:

```ts
import { ProxyRuntimeController, loadProxySettings } from "@commandrelay/proxy-runtime";

const controller = new ProxyRuntimeController({
  settings: loadProxySettings(process.env),
  maxCacheEntries: 256
});

const upstream = controller.resolve("https://api.example.com");
console.log(upstream.decision.reason, upstream.decision.metadata);
```

### Why this pattern

1. Centralizes policy in one place.
2. Keeps route decisions reproducible in audit logs.
3. Lets apps reload settings without replacing global process wiring.

## Migration notes

1. Keep one adapter boundary per client stack.
2. Do not stack multiple proxy adapters in one call path.
3. Always prefer root exports; avoid deep `dist/*` paths.
4. On startup or config reload, clear or dispose controller caches to avoid stale routes.

## Production guardrails

1. Enable strict TLS defaults where applicable.
2. Emit route metadata (`proxy`, `mode`, `reason`) in startup logs.
3. Keep credentials out of logs and profile files.
4. Validate env parsing behavior in a startup profile and fail fast when invalid.

## Relay proxy for sidecar topologies

Use `@commandrelay/relay-proxy` when an external app needs to talk to an upstream WS endpoint
through a controlled host process:

- Host app validates upstream TLS + token.
- Relay handles `upstreamUrl`, backlog and heartbeat status (`/status`).
- Downstream clients receive a stable `/ws` entrypoint and `/health`/`/status` checks.

This is useful for:

1. local app-to-remote bridges,
2. multi-tenant internal tooling meshes,
3. and controlled environments where ws endpoint shape should be constrained.

### TLS trust model and relay handoff

`@commandrelay/relay-proxy` uses the same TLS trust model as other Node TLS clients:

1. Configure `upstreamUrl` as `wss://...` to enable TLS.
2. Keep `COMMANDRELAY_RELAY_UPSTREAM_TLS_REJECT_UNAUTHORIZED=true` unless you have a bounded rollback drill.
3. Provide `COMMANDRELAY_RELAY_UPSTREAM_TLS_CA_FILE` when upstream uses private CA roots.
4. Use `..._CERT_FILE` + `..._KEY_FILE` together for mTLS.
5. Optionally pin min/max versions with:
   - `COMMANDRELAY_RELAY_UPSTREAM_TLS_MIN_VERSION`
   - `COMMANDRELAY_RELAY_UPSTREAM_TLS_MAX_VERSION`

At runtime the relay performs standard TLS negotiation:

1. TCP connect and ClientHello.
2. Certificate chain validation.
3. Session key establishment.
4. Encrypted frame transport to upstream.

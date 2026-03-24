# SKILL: CommandRelay Relay Proxy (`packages/commandrelay-relay-proxy`)

## Purpose
`@commandrelay/relay-proxy` is a production-focused WebSocket relay sidecar used to expose a single `/ws` control-plane surface for terminal tooling while keeping upstream complexity and trust policy in one place.

- Exposes:
  - websocket proxy on configurable `relayPath` (default `/ws`)
  - liveness endpoint (`healthPath`, default `/health`)
  - operator status endpoint (`/status`) with `statusContractVersion`, `configFingerprint`, and rotation metadata
- Supports upstream TLS options, token enforcement, origin allow-lists, connection caps, and idle/shutdown timers.
- Returns deterministic build artifacts because all scripts wipe `dist` before compile.

## Execution Matrix (Modern AI-friendly)
### Workspace scripts
- `pnpm --filter @commandrelay/relay-proxy run check`
  - Type-check only. Useful to run in preflight automation.
- `pnpm --filter @commandrelay/relay-proxy run build`
  - `dist/` clean + compile. Required before CLI/CI use.
- `pnpm --filter @commandrelay/relay-proxy run test`
  - Type-check + Node test runner against `dist/**/*.test.js`.
- `pnpm --filter @commandrelay/relay-proxy run cli -- --help`
  - Execute relay CLI help using built output.

### Extension commands
- `npm run extension:run -- commandrelay-relay-proxy info`
- `npm run extension:run -- commandrelay-relay-proxy check`
- `npm run extension:run -- commandrelay-relay-proxy build`
- `npm run extension:run -- commandrelay-relay-proxy test`
- `npm run extension:run -- commandrelay-relay-proxy cli -- --help`

### Example: dry-run a secure relay on localhost
```bash
pnpm --filter @commandrelay/relay-proxy run build
COMMANDRELAY_RELAY_REQUIRED_TOKEN=sekrit \
commandrelay-relay-proxy \
  --host 127.0.0.1 \
  --port 8788 \
  --upstream ws://127.0.0.1:8787/ws \
  --relay-path /ws \
  --health-path /health \
  --max-connections 128 \
  --idle-timeout-ms 120000
```

### Example: test status and health probes
```bash
curl -sS -H "Authorization: Bearer sekrit" http://127.0.0.1:8788/health
curl -sS -H "Authorization: Bearer sekrit" http://127.0.0.1:8788/status
```

### Verify contract fields from status endpoint
```bash
curl -sS -H "Authorization: Bearer ${COMMANDRELAY_RELAY_REQUIRED_TOKEN}" \
  http://127.0.0.1:8788/status \
  | node -e "const fs = require('node:fs'); const data = JSON.parse(fs.readFileSync(0,'utf8')); console.log(JSON.stringify({status:data.status,statusContractVersion:data.statusContractVersion,rotation:data.upstream.rotation,rotationStatus:data.upstream.rotation.status},null,2));"
```

## CLI Reference
- Global options:
  - `--host`, `--port`
  - `--relay-path`, `--health-path`, `--upstream`, `--max-connections`
  - `--idle-timeout-ms`, `--shutdown-timeout-ms`
  - `--token`, `--token-from-env` (for secret-safe startup)
  - `--allowed-origins`, `--upstream-subprotocols`
  - `--upstream-tls-*` family including:
    - `--upstream-tls-watch-interval-ms`
    - `--upstream-tls-restart-on-change`
  - `--help`
- Env variables (equivalent to args):
  - `COMMANDRELAY_RELAY_LISTEN_HOST`, `COMMANDRELAY_RELAY_LISTEN_PORT`, `COMMANDRELAY_RELAY_PATH`,
    `COMMANDRELAY_RELAY_HEALTH_PATH`, `COMMANDRELAY_RELAY_UPSTREAM_URL`,
    `COMMANDRELAY_RELAY_MAX_CONNECTIONS`, `COMMANDRELAY_RELAY_IDLE_TIMEOUT_MS`,
    `COMMANDRELAY_RELAY_SHUTDOWN_TIMEOUT_MS`, `COMMANDRELAY_RELAY_REQUIRED_TOKEN`,
    `COMMANDRELAY_RELAY_ALLOWED_ORIGINS`, `COMMANDRELAY_RELAY_UPSTREAM_SUBPROTOCOLS`,
    `COMMANDRELAY_RELAY_UPSTREAM_TLS_REJECT_UNAUTHORIZED`,
    `COMMANDRELAY_RELAY_UPSTREAM_TLS_CA_FILE`, `COMMANDRELAY_RELAY_UPSTREAM_TLS_CERT_FILE`,
    `COMMANDRELAY_RELAY_UPSTREAM_TLS_KEY_FILE`, `COMMANDRELAY_RELAY_UPSTREAM_TLS_PFX_FILE`,
    `COMMANDRELAY_RELAY_UPSTREAM_TLS_PASSPHRASE`, `COMMANDRELAY_RELAY_UPSTREAM_TLS_SERVERNAME`,
    `COMMANDRELAY_RELAY_UPSTREAM_TLS_MIN_VERSION`, `COMMANDRELAY_RELAY_UPSTREAM_TLS_MAX_VERSION`,
    `COMMANDRELAY_RELAY_UPSTREAM_TLS_WATCH_INTERVAL_MS`, `COMMANDRELAY_RELAY_UPSTREAM_TLS_RESTART_ON_CHANGE`.

## Integration Contracts
- Expected runtime behavior:
  - `GET /status` and `GET /health` both follow token gating logic when required.
  - On malformed websocket frame forwarding, relay marks session closing and drains queued upstream data safely.
  - `SIGINT` and `SIGTERM` flow into `close()` for bounded shutdown.

### Trust, handshake, and cert-management notes

`@commandrelay/relay-proxy` does not perform an application-layer key exchange for transport trust. The trust boundary is established by:

1. WebSocket framing upgrade at `relayPath` from clients to relay.
2. Optional upstream WebSocket upgrade to `upstreamUrl` (`ws:` or `wss:`).
3. Optional required token challenge:
   - Token is validated via hash compare using constant-time comparison.
   - Token must be supplied with `Authorization: Bearer <token>` on `GET /health` and `GET /status`.
   - Client-provided and configured tokens are not logged.

4. Upstream TLS policy:
   - Controlled by `upstreamTls.rejectUnauthorized` and material files.
   - `--upstream-tls-*` and `COMMANDRELAY_RELAY_UPSTREAM_TLS_*` options are loaded into runtime TLS config.

To change TLS roots or certificates:

```bash
# 1) edit relay env file
export COMMANDRELAY_RELAY_UPSTREAM_TLS_CA_FILE=/etc/commandrelay/certs/ca-chain.pem
export COMMANDRELAY_RELAY_UPSTREAM_TLS_CERT_FILE=/etc/commandrelay/certs/client-cert.pem
export COMMANDRELAY_RELAY_UPSTREAM_TLS_KEY_FILE=/etc/commandrelay/certs/client-key.pem

# 2) restart relay so new material is loaded
commandrelay-relay-proxy --help  # validates args
```

Reload and rotation hardening options:

- Blue/green relay roll (`SIGHUP` not supported), then switch traffic via upstream LB or SSH tunnel endpoint.
- Keep `COMMANDRELAY_RELAY_REQUIRED_TOKEN` unchanged while rotating certs unless policy requires rotation too.
- Set `COMMANDRELAY_RELAY_UPSTREAM_TLS_WATCH_INTERVAL_MS` > `0` to track file-backed TLS material.
- Set `COMMANDRELAY_RELAY_UPSTREAM_TLS_RESTART_ON_CHANGE=true` only if your supervisor supports safe process recycle on `restart_required`.

## Example heartbeat checks

```bash
curl -sS -H "Authorization: Bearer ${COMMANDRELAY_RELAY_REQUIRED_TOKEN}" \
  "http://127.0.0.1:8788/health"
curl -sS -H "Authorization: Bearer ${COMMANDRELAY_RELAY_REQUIRED_TOKEN}" \
  "http://127.0.0.1:8788/status"
```

`/status` is always open only when token policy allows access and includes:

- `status: "open"`
- `statusContractVersion` (`2` in current release)
- `heartbeat` object (`checkedAtMs`, `startedAtMs`, `uptimeMs`, `ageMs`)
- `upstream.rotation` object (`status`, `enabled`, `intervalMs`, `autoRestartOnChange`, `lastCheckedAtMs`, `detectedAtMs`, `changedPaths`)
- connection counters, byte totals, and active config path metadata.

## References
- Source entrypoints:
  - `packages/commandrelay-relay-proxy/src/cli.ts`
  - `packages/commandrelay-relay-proxy/src/index.ts`
- Deployment and runbooks:
  - `packages/commandrelay-relay-proxy/README.md`
  - `docs/proxy/relay-server-deployment.md`
  - `packages/commandrelay-relay-proxy/deploy/systemd/check-status.sh`

## Troubleshooting (for automation loops)
- If startup exits with `upstream URL must use ws or wss`, pass `--upstream` and/or `COMMANDRELAY_RELAY_UPSTREAM_URL`.
- If `status` is always empty, verify startup reached READY and that token/origin policies match probe request.
- For TLS failures, inspect certificate chain and set `upstream-tls` file flags intentionally only for trust roots you control.

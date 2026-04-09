# @commandrelay/relay-proxy

`@commandrelay/relay-proxy` is a small WebSocket relay sidecar for exposing a controlled
`/ws` surface in front of an upstream WebSocket backend.

A lean relay layer for controlled WebSocket exposure and status visibility.

- Validates and normalizes upstream TLS options.
- Provides deterministic upstream/downstream byte accounting and heartbeat metrics.
- Exposes:
  - `GET /status` (operator JSON status + contract version + heartbeat)
  - `GET /health` (runtime status compatibility endpoint + heartbeat metadata)
  - `GET /` and `/app` path behavior is unchanged from base runtime.
- Supports origin and token protection.

## Install

```bash
npm install @commandrelay/relay-proxy
```

## Runtime

- Node.js `>=18`
- npm `>=9`
- ESM package (`"type": "module"`)

## CLI Usage

```bash
cd /path/to/project
commandrelay-relay-proxy \
  --host 127.0.0.1 \
  --port 8789 \
  --upstream ws://127.0.0.1:8787/ws \
  --relay-path /ws \
  --health-path /health \
  --max-connections 64 \
  --idle-timeout-ms 120000 \
  --shutdown-timeout-ms 10000
```

### Environment

- `COMMANDRELAY_RELAY_LISTEN_HOST` (default `127.0.0.1`)
- `COMMANDRELAY_RELAY_LISTEN_PORT` (default `8788`)
- `COMMANDRELAY_RELAY_PATH` (default `/ws`)
- `COMMANDRELAY_RELAY_HEALTH_PATH` (default `/health`)
- `COMMANDRELAY_RELAY_UPSTREAM_URL` (default `ws://127.0.0.1:8787/ws`)
- `COMMANDRELAY_RELAY_MAX_CONNECTIONS` (default `128`)
- `COMMANDRELAY_RELAY_IDLE_TIMEOUT_MS` (default `120000`)
- `COMMANDRELAY_RELAY_SHUTDOWN_TIMEOUT_MS` (default `10000`)
- `COMMANDRELAY_RELAY_REQUIRED_TOKEN` (optional)
- `COMMANDRELAY_RELAY_ALLOWED_ORIGINS` (comma list)
- `COMMANDRELAY_RELAY_UPSTREAM_TLS_REJECT_UNAUTHORIZED` (`true` or `false`)
- `COMMANDRELAY_RELAY_UPSTREAM_TLS_CA_FILE`
- `COMMANDRELAY_RELAY_UPSTREAM_TLS_CERT_FILE`
- `COMMANDRELAY_RELAY_UPSTREAM_TLS_KEY_FILE`
- `COMMANDRELAY_RELAY_UPSTREAM_TLS_PFX_FILE`
- `COMMANDRELAY_RELAY_UPSTREAM_TLS_PASSPHRASE`
- `COMMANDRELAY_RELAY_UPSTREAM_TLS_SERVERNAME`
- `COMMANDRELAY_RELAY_UPSTREAM_TLS_MIN_VERSION`
- `COMMANDRELAY_RELAY_UPSTREAM_TLS_MAX_VERSION`
- `COMMANDRELAY_RELAY_UPSTREAM_TLS_WATCH_INTERVAL_MS` (ms, `0` disables)
- `COMMANDRELAY_RELAY_UPSTREAM_TLS_RESTART_ON_CHANGE` (`true` or `false`, default `false`)

Security notes:

1. Keep `COMMANDRELAY_RELAY_UPSTREAM_TLS_REJECT_UNAUTHORIZED=true` unless you have a test-only reason.
2. Prefer `COMMANDRELAY_RELAY_REQUIRED_TOKEN` with TLS in any remote-exposed layout.
3. `COMMANDRELAY_RELAY_REQUIRED_TOKEN` also applies to `/health` and `/status` operator endpoints and must be sent via `Authorization: Bearer <token>`.
4. Monitor `/status` for heartbeat, `statusContractVersion`, and TLS rotation state.

## API Quick Start

```ts
import {
  createRelayProxyServer,
  parseRelayProxyEnv,
  normalizeRelayOptions
} from "@commandrelay/relay-proxy";

const parsed = parseRelayProxyEnv(process.env);
const options = normalizeRelayOptions({
  ...parsed,
  listenPort: parsed.listenPort,
  upstreamUrl: "ws://127.0.0.1:8787/ws",
  maxConnections: parsed.maxConnections,
  idleTimeoutMs: parsed.idleTimeoutMs,
  shutdownTimeoutMs: parsed.shutdownTimeoutMs
});

const relay = await createRelayProxyServer(options);
await relay.started;
console.log(relay.getStats());
await relay.close();
```

## Export Surface

- `createRelayProxyServer(options)` returns `{ started, close, getStats }`
- `parseRelayProxyEnv(env)`
- `normalizeRelayOptions(values)`
- `RelayProxyStats`, `RelayProxyHandle`, `RelayProxyOptions`

## Multi-app integration notes

1. Use one relay per upstream if you need tenant-specific token or upstream trust policy.
2. Keep relay listeners on loopback and forward over SSH tunnel by default.
3. Keep this package on the edge process; let command/control apps consume the stable `/ws`.

## Troubleshooting

1. `upstream URL must use ws or wss` at startup: check `--upstream` or `COMMANDRELAY_RELAY_UPSTREAM_URL`.
2. Unexpected `/status` response shape: confirm `statusContractVersion` (expect `2`) and restart workflow after update.
3. Upgrade handshake failures: check upstream cert trust and token alignment.

## TLS rotation and hardening checks

- `COMMANDRELAY_RELAY_UPSTREAM_TLS_WATCH_INTERVAL_MS` controls file watch cadence for certificate/key/certs loaded via
  `*_TLS_*_FILE` settings.
- When a file-backed TLS material change is detected and restart is required, `upstream.rotation.status` becomes
  `"restart_required"` in both `/status` and `getStats().config`.
- Set `COMMANDRELAY_RELAY_UPSTREAM_TLS_RESTART_ON_CHANGE=true` only when your process supervisor is prepared for a restart path.
- `/status` also includes `configFingerprint` for drift detection of active config + watch state.

## Relay Server Deploy Presets

`@commandrelay/relay-proxy` can be deployed as a relay-server using these presets:

1. **Linux/systemd**

   - Copy `deploy/systemd/commandrelay-relay-proxy.service` to `/etc/systemd/system`.
   - Copy `deploy/relay-proxy.env.example` to `/etc/commandrelay-relay-proxy.env` and edit.
   - Or run:
     - `bash deploy/systemd/install.sh`
   - Run:
     - `systemctl status commandrelay-relay-proxy`
     - `bash deploy/systemd/check-status.sh [url]` (default `http://127.0.0.1:8788/status`)

2. **Docker**

   - `cd packages/commandrelay-relay-proxy/deploy/docker`
   - `docker compose build`
   - `docker compose --env-file .env up -d`
  - Health: `curl -H "Authorization: Bearer <token>" http://127.0.0.1:8788/health` when required token is configured
  - Status: `curl -H "Authorization: Bearer <token>" http://127.0.0.1:8788/status` when required token is configured

3. **Windows (native service)**

   - `powershell`
   - `cd packages/commandrelay-relay-proxy/deploy/windows`
   - `./install-relay-proxy-service.ps1 -PackageRoot ..\..` (edit `deploy\\relay-proxy.env.example` first or pass `-EnvFile`)
   - `./check-relay-proxy-status.ps1` (add `-StatusToken <token>` when token is configured)

4. **macOS (launchd)**

   - `cd packages/commandrelay-relay-proxy/deploy/macos`
   - Copy `../relay-proxy.env.example` to a local path and edit it
   - `./install-relay-proxy-service.sh /path/to/packages/commandrelay-relay-proxy /path/to/edited/env/file`
   - `./check-relay-proxy-status.sh [url] [interval_seconds]` (default `http://127.0.0.1:8788/status`, `2`)

5. **WSL**

   - `cd packages/commandrelay-relay-proxy/deploy/wsl`
   - If systemd is enabled, use the Linux preset from `../systemd`
   - Otherwise use Docker or foreground mode from `../docker`

Default env templates:

- `deploy/relay-proxy.env.example`
- `deploy/docker/.env`

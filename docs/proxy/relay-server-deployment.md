# Relay Server Deployment (Production Preset)

This guide provides a production-oriented deployment preset for the relay-server component:

- `@commandrelay/relay-proxy`
- Endpoint: `GET /ws`, `GET /health`, `GET /status`
- Token + TLS options and multi-platform launch patterns

## Linux with systemd

Use this when the relay host is Ubuntu/Debian/Fedora family and you need a persistent process.

1. Install the relay package globally on the host:
   - `npm install -g @commandrelay/relay-proxy`
2. Go to:
   - `cd /path/to/repo/packages/commandrelay-relay-proxy`
3. Install systemd unit and env file:
   - `sudo bash deploy/systemd/install.sh`
4. Edit `/etc/commandrelay-relay-proxy.env`:
   - Set upstream URL, host bind, and token/TLS policy
5. Control:
   - `sudo systemctl restart commandrelay-relay-proxy`
   - `sudo systemctl status commandrelay-relay-proxy`
6. Check status:
   - `bash deploy/systemd/check-status.sh`

## macOS with launchd

Use this for local macOS relay hosts and laptop/desktop desktop daemons.

1. Edit env template for this host:
   - `cp packages/commandrelay-relay-proxy/deploy/relay-proxy.env.example /tmp/commandrelay-relay-proxy.env`
   - update upstream URL, host bind, and token/TLS policy
2. Install launchd service:
   - `cd /path/to/repo/packages/commandrelay-relay-proxy/deploy/macos`
   - `./install-relay-proxy-service.sh /path/to/repo/packages/commandrelay-relay-proxy /path/to/edited/env/file`
3. Check status:
   - `./check-relay-proxy-status.sh`
4. Restart/Reload:
   - `launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.commandrelay.relay-proxy.plist`
   - `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.commandrelay.relay-proxy.plist`

## Docker / Compose

Use this when you want reproducible host-agnostic rollout.

From `packages/commandrelay-relay-proxy/deploy/docker`:

```bash
docker compose build
docker compose --env-file .env up -d
```

Health / status:

```bash
curl -sS http://127.0.0.1:8788/health  # add ?token=<token> or Authorization header when REQUIRED_TOKEN is set
curl -sS http://127.0.0.1:8788/status  # add ?token=<token> or Authorization header when REQUIRED_TOKEN is set
```

Edit `packages/commandrelay-relay-proxy/deploy/docker/.env` for upstream, token, TLS, and upstream trust policy.

## Windows native (service)

Use this for VPS/desktop Windows relay hosts.

1. Open an elevated PowerShell window.
2. Edit `packages/commandrelay-relay-proxy/deploy/relay-proxy.env.example` (or copy to a custom env path).
3. Run:

```powershell
cd packages\commandrelay-relay-proxy\deploy\windows
./install-relay-proxy-service.ps1 -PackageRoot ..\..
```

4. Poll operator heartbeat/status:

```powershell
./check-relay-proxy-status.ps1
```

The service wrapper reads `deploy\relay-proxy.env.example` and starts either:

- local `dist/cli.js` when present, or
- `commandrelay-relay-proxy` from PATH if installed globally.

## WSL

Use this when relaying from WSL environments.

1. Confirm WSL context:
   - `grep -i microsoft /proc/version`
2. If systemd is available in the distro:
   - `sudo bash deploy/systemd/install.sh`
3. If systemd is unavailable:
   - use the Docker preset from `deploy/docker` or run the CLI directly in foreground

## Hardening checklist (for any platform)

1. Prefer `127.0.0.1` binding and tunnel/port-forward from trusted edge.
2. Set `COMMANDRELAY_RELAY_REQUIRED_TOKEN` for remote exposure.
3. Keep `COMMANDRELAY_RELAY_REQUIRED_TOKEN` also for `/health` and `/status`.
4. Keep `COMMANDRELAY_RELAY_UPSTREAM_TLS_REJECT_UNAUTHORIZED=true` unless doing a tested rollback drill.
5. Rotate upstream CA and restart relay on cert updates (or run rolling two-relay cutover).
6. Keep `/status` polling in a lightweight monitor for:
   - `status=open`
   - monotonic `heartbeat.checkedAtMs`
   - `activeConnections`/`totalConnections` sanity.

## Rollout notes

- For zero-downtime attempts:
  1. Bring up a second relay-server with the new trust/token config.
  2. Shift tunnel/frontend traffic to the new relay.
  3. Drain sessions from old relay.
  4. Stop old relay and monitor `heartbeat` on the new one.

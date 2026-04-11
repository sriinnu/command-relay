# WSL Relay-Proxy Deployment

`@commandrelay/relay-proxy` runs on WSL through the Linux launch path and supports two common modes:

1. **systemd path (best)**: native service lifecycle, automatic restarts, and `systemctl` control.
2. **docker compose path**: works in any WSL distribution with Docker support.

## 1) Prefer systemd on WSL (if enabled)

If your WSL distro runs systemd (newer WSL 2 builds), copy the standard Linux preset:

```bash
cd /path/to/repo/packages/commandrelay-relay-proxy
sudo bash deploy/systemd/install.sh
```

Then monitor:

```bash
bash deploy/systemd/check-status.sh
```

## 2) Use Docker when systemd is unavailable

From `packages/commandrelay-relay-proxy/deploy/docker`:

```bash
docker compose build
docker compose --env-file .env up -d
```

## 3) Health checks

```bash
curl -sS -H "Authorization: Bearer <token>" "http://127.0.0.1:8788/health"   # when token is configured
curl -sS -H "Authorization: Bearer <token>" "http://127.0.0.1:8788/status"   # when token is configured
```

For WSL where neither systemd nor Docker is available, you can run the relay in a foreground process:

```bash
cd /path/to/repo/packages/commandrelay-relay-proxy
COMMANDRELAY_RELAY_UPSTREAM_URL=ws://127.0.0.1:8787/ws \
  commandrelay-relay-proxy --host 127.0.0.1 --port 8788
```

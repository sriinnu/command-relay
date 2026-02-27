# SSH Tunnel Runbook (CommandRelay)

Use [`open-tunnel.sh`](./open-tunnel.sh) to open a local SSH tunnel to a remote CommandRelay instance without exposing remote ports publicly.

## What this does

1. Forwards local `127.0.0.1:<local-port>` to remote `127.0.0.1:<remote-port>` through SSH.
2. Validates required arguments and port ranges before opening the tunnel.
3. Fails early when local port is already in use.
4. Prints only operational details (no auth tokens or secret values).

## Requirements (macOS/Linux)

1. `ssh` installed and available in `PATH`.
2. SSH access to the target host.
3. CommandRelay running on the remote host (default assumed on `127.0.0.1:8787`).

## Quick start

From repo root:

```bash
./scripts/ssh/open-tunnel.sh --target <user@host>
```

Then connect local clients to:

1. `http://127.0.0.1:8787`
2. `ws://127.0.0.1:8787/ws`

## Examples

macOS/Linux default tunnel:

```bash
./scripts/ssh/open-tunnel.sh --target dev@relay-host
```

Use a different local port:

```bash
./scripts/ssh/open-tunnel.sh --target dev@relay-host --local-port 9878
```

Use a specific SSH key:

```bash
./scripts/ssh/open-tunnel.sh --target relay-prod --identity ~/.ssh/id_ed25519
```

Through bastion/proxy jump:

```bash
./scripts/ssh/open-tunnel.sh \
  --target relay-prod \
  --ssh-option ProxyJump=bastion-user@bastion-host
```

Preview command without opening the tunnel:

```bash
./scripts/ssh/open-tunnel.sh --target dev@relay-host --dry-run
```

## Help

```bash
./scripts/ssh/open-tunnel.sh --help
```

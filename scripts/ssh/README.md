# SSH Tunnel Runbook (CommandRelay)

Use [`open-tunnel.sh`](./open-tunnel.sh) to open a local SSH tunnel to a remote CommandRelay instance without exposing remote ports publicly.
Use [`validate-remote-runtime.sh`](./validate-remote-runtime.sh) to preflight a remote host for tmux + Node runtime readiness.

## What this does

1. Forwards local `127.0.0.1:<local-port>` to remote `127.0.0.1:<remote-port>` through SSH.
2. Validates required arguments and port ranges before opening the tunnel.
3. Fails early when local port is already in use.
4. Prints only operational details (no auth tokens or secret values).

## Requirements (macOS/Linux)

1. `ssh` installed and available in `PATH`.
2. SSH access to the target host.
3. CommandRelay running on the remote host (default assumed on `127.0.0.1:8787`).

### PowerShell (Windows)

If you are on Windows, use the PowerShell variants:

```powershell
./open-tunnel.ps1 -Target relay@relay-host
./validate-remote-runtime.ps1 -Target relay@relay-host
```

## Quick start

From repo root:

```bash
./scripts/ssh/open-tunnel.sh --target <user@host>
```

Windows equivalent:

```powershell
./open-tunnel.ps1 -Target <user@host>
```

Then connect local clients to:

1. `http://127.0.0.1:8787`
2. `ws://127.0.0.1:8787/ws`

## Examples

macOS/Linux default tunnel:

```bash
./scripts/ssh/open-tunnel.sh --target dev@relay-host
```

Use a different SSH executable:

```bash
./scripts/ssh/open-tunnel.sh --target dev@relay-host --ssh-command /opt/homebrew/bin/ssh
```

Windows equivalent:

```powershell
./open-tunnel.ps1 -Target dev@relay-host -SshCommand "C:\Program Files\Git\usr\bin\ssh.exe"
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

Windows equivalent:

```powershell
./open-tunnel.ps1 -Target dev@relay-host -DryRun
```

## Help

```bash
./scripts/ssh/open-tunnel.sh --help
```

```powershell
./open-tunnel.ps1 -Help
```

### Open tunnel exit codes

1. `0`: success
2. `2`: invalid usage/arguments
3. `3`: local SSH/port validation issue
4. `4`: ssh command execution failure

## Remote runtime validator

Use this before opening tunnels or enabling SSH runtime mode.

What it checks in one non-interactive SSH command set:

1. `command -v tmux`
2. `tmux -V`
3. `node -v`

### Quick start

```bash
./scripts/ssh/validate-remote-runtime.sh --target <user@host>
```

Windows equivalent:

```powershell
./validate-remote-runtime.ps1 -Target <user@host>
```

### Examples

Use a non-default SSH key:

```bash
./scripts/ssh/validate-remote-runtime.sh \
  --target relay-prod \
  --identity ~/.ssh/id_ed25519
```

Custom SSH command/port and options:

```bash
./scripts/ssh/validate-remote-runtime.sh \
  --target relay-prod \
  --ssh-command ssh \
  --ssh-port 2222 \
  --ssh-option ProxyJump=bastion-user@bastion-host \
  --ssh-option ServerAliveInterval=30
```

Disable strict host key checking (for controlled temporary diagnostics only):

```bash
./scripts/ssh/validate-remote-runtime.sh \
  --target relay-prod \
  --strict-host-key-checking off
```

Dry-run local validation:

```bash
./scripts/ssh/validate-remote-runtime.sh --target relay-prod --dry-run
```

```powershell
./validate-remote-runtime.ps1 -Target relay-prod -DryRun
```

### Exit codes

1. `0`: success (or valid dry-run)
2. `2`: invalid usage/arguments
3. `3`: local SSH command/setup issue
4. `4`: remote runtime validation failed

### Help

```bash
./scripts/ssh/validate-remote-runtime.sh --help
```

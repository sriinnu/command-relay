# Remote Collaboration Workflow (Home/VPS + Other Computer + Multi-Tab)

This guide is for a setup where CommandRelay runs on a home machine or VPS
(`COMMANDRELAY_*` host) and you connect to it from another computer.

## 1) Run-time model

1. Start CommandRelay on the host that owns your working tree and tmux sessions.
2. Expose it through SSH to the local client computer only when needed:
   - Use SSH local forwarding as a temporary transport wrapper (`127.0.0.1:8787`).
   - Connect clients to the forwarded local endpoint.
3. Keep remote editing sessions in tmux:
   - `tmux` is the state owner.
   - Clients connect/disconnect independently from the same session.

## 2) Minimal host startup (on home machine or VPS)

Use SSH transport mode when the bridge runtime itself must execute on a remote host via SSH.
When the bridge and target host are the same, regular mode (`ws`) is usually enough.

```bash
cd /path/to/terminal

# If bridge and target are on the same host
COMMANDRELAY_RUNTIME_BACKENDS=tmux \
COMMANDRELAY_AUTH_TOKEN=change_me \
npm run start

# If bridge runtime must execute through ssh to a remote host
COMMANDRELAY_TRANSPORT_MODE=ssh \
COMMANDRELAY_SSH_TARGET=relay@example.internal \
COMMANDRELAY_RUNTIME_BACKENDS=tmux \
COMMANDRELAY_AUTH_TOKEN=change_me \
npm run start
```

## 3) Open SSH tunnel from another machine

From the **client machine**, forward to the host terminal:

```bash
./scripts/ssh/open-tunnel.sh --target relay@home.example
```

Then connect to:

- `http://127.0.0.1:8787`
- `ws://127.0.0.1:8787/ws`

Common variations:

```bash
./scripts/ssh/open-tunnel.sh --target relay@home.example --local-port 9878
./scripts/ssh/open-tunnel.sh --target relay@home.example --identity ~/.ssh/id_ed25519
./scripts/ssh/open-tunnel.sh --target relay@home.example --dry-run
```

## 4) Multi-window / multi-tab collaboration model

1. Create dedicated tmux workspaces on the host:

```bash
tmux new -d -s work
tmux new-window -t work:1 -n codex
tmux new-window -t work:2 -n claude
```

2. Give each remote client one tab/window in their UI and keep one active writer:
   - All clients can run `list_sessions` and read output.
   - Exactly one client should enable input for a pane at a time.
   - Use `disable_input` or disconnect before handing a pane to another operator.

3. If a takeover is required:
   - Current writer disables input (`/disable` in TUI).
   - New client enables input (`/enable` in TUI).
   - Confirm via `/status` on each side.

4. If `input_disabled_kill_switch` or `input` errors appear, stop writes and confirm
   server-side policies with `/status`.

## 5) Local status checks for remote users

Use the HTTP status endpoint over the tunnel:

```bash
curl -sS http://127.0.0.1:8787/status
curl -sS http://127.0.0.1:8787/health
```

Expected `heartbeat.checkedAtMs` and `activeConnections` should advance under active load.

## 6) Security and operator safety

1. Keep auth tokens out of shell history.
2. Run with `COMMANDRELAY_AUTH_TOKEN` on any exposed listener.
3. Use `COMMANDRELAY_ALLOW_INPUT_OVERRIDE=off` if you do not want takeovers.
4. For tunnel-only access, keep remote endpoint on loopback (`127.0.0.1`) and
   only expose what you forward.

## 7) Quick checklist after host reboot

1. Re-run `./scripts/ssh/open-tunnel.sh --target ... --dry-run`.
2. Re-check `curl -i http://127.0.0.1:8787/health`.
3. Open `commandrelay-tui`, load profile, run `/status`.
4. Re-attach pane and verify heartbeat in status output.


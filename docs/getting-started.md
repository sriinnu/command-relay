# Getting Started

This guide helps you run CommandRelay with a home MacBook as the first target.

## Prerequisites

1. macOS with Terminal or iTerm.
2. `tmux` installed.
3. Tailscale installed and logged in.
4. Node.js 22+ or Go 1.22+ (depending on runtime implementation).

## Session Model

Run Codex/Claude inside `tmux` so CommandRelay can discover and control sessions reliably.

## Setup Steps

1. Create named tmux sessions for active work.
2. Start CommandRelay bridge daemon on the home machine.
3. Confirm daemon is reachable over Tailscale.
4. Open client UI and authenticate.
5. Attach to a pane and enable input when needed.

## Minimal tmux Commands

```bash
tmux new -s work
tmux new-window -n codex
tmux new-window -n claude
tmux ls
```

## Expected Outcome

1. You see all active sessions/windows/panes.
2. You receive live output in the client.
3. You can send input when input mode is enabled.

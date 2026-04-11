# Runtime Patterns

This guide describes the runtime line for long-running coding-agent sessions.

## What Is First-Class Today

The first-class runtime patterns today are:

1. `tmux`
2. `cmux`
3. `managed`
4. `ssh-tmux` as the SSH transport path plus tmux runtime execution

Use those patterns for durable sessions, replay, and input ownership. Host terminals are launch surfaces, not runtime backends.

## Pattern Summary

### `tmux`

Use `tmux` when the machine that owns the work should keep session state alive across client disconnects.

This is the default fit for long-running local coding-agent sessions.

### `cmux`

Use `cmux` when you want the bridge to aggregate more than one runtime backend.

Typical setup:

```bash
COMMANDRELAY_RUNTIME_BACKENDS=tmux,cmux
```

### `managed`

Use `managed` when you want CommandRelay to own the session lifecycle directly instead of relying on a desktop terminal to hold the process open.

This is the most explicit fit for background coding-agent workflows on hosts where the terminal UI is only a launcher.

Managed runtime env vars:

1. `COMMANDRELAY_MANAGED_COMMAND` selects the managed runtime command. Legacy alias: `COMMANDRELAY_OLY_COMMAND`.
2. `COMMANDRELAY_MANAGED_STATE_DIR` selects the managed state directory. Legacy alias: `COMMANDRELAY_OLY_STATE_DIR`.
3. `COMMANDRELAY_MANAGED_TIMEOUT_MS` sets the managed command timeout in milliseconds. Legacy alias: `COMMANDRELAY_OLY_TIMEOUT_MS`.

Defaults:

1. `COMMANDRELAY_MANAGED_COMMAND=oly`
2. `COMMANDRELAY_MANAGED_TIMEOUT_MS=8000`
3. `COMMANDRELAY_MANAGED_STATE_DIR` is optional

### `ssh-tmux`

Use the SSH transport path when the target machine owns the runtime and tmux should execute remotely.

The supported shape is:

```bash
COMMANDRELAY_TRANSPORT_MODE=ssh
COMMANDRELAY_RUNTIME_BACKENDS=tmux
```

This remains tmux-only today. Do not combine `ssh` mode with `cmux` or `managed`.

## Host Terminals

These host terminals are useful launch surfaces, but they do not replace the runtime backends above:

1. Ghostty
2. Terminal.app
3. Windows Terminal
4. `cmd`
5. PowerShell
6. WSL

Treat them as ways to start or observe the process. They do not own replay, input arbitration, or backend persistence.

## PuTTY Boundary

PuTTY is a detection boundary, not a first-class backend.

On Windows, PuTTY or Plink can be detected as part of the host environment, but that only informs launcher heuristics. It does not mean the session is owned by PuTTY or that CommandRelay will treat it as a runtime backend.

## Recommended Use

1. Local long-running coding agent: `tmux`
2. Multi-backend aggregation: `tmux,cmux`
3. Detached ownership on a launcher-style host terminal: `managed`
4. Remote machine with SSH ownership: `ssh-tmux`

## Practical Rule

If you need the session to survive client disconnects, choose a backend that owns the session state. If you are only choosing a desktop terminal, you are selecting a launch surface, not the backend.

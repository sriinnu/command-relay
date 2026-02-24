# Bridge Smoke Benchmarks

Lightweight local benchmark scripts for bridge smoke checks. All scripts output JSON to stdout.

## Prerequisites

1. Bridge server running (default ws endpoint: `ws://127.0.0.1:8787/ws`).
2. `node >= 22`.
3. `tsx` installed in project dependencies.
4. For auth-enabled bridge: set `COMMANDRELAY_AUTH_TOKEN` or pass `--token`.

## Scripts

1. Connect latency

```bash
node --import tsx scripts/perf/connect-latency.ts --iterations 20
```

2. `list_sessions` roundtrip

```bash
node --import tsx scripts/perf/list-sessions-roundtrip.ts --iterations 20
```

3. `input` ack roundtrip (non-destructive)

```bash
node --import tsx scripts/perf/input-ack-roundtrip.ts --iterations 20
```

The input benchmark creates an isolated temporary tmux session running `cat >/dev/null`, measures `input -> ack`, and removes the session automatically.

## Common options

- `--url <ws-url>` websocket URL (default: `ws://127.0.0.1:8787/ws`)
- `--token <token>` auth token
- `--iterations <n>` sample count
- `--timeout-ms <ms>` timeout per operation
- `--interval-ms <ms>` delay between samples
- `--pretty` / `--compact` JSON formatting
- `--help` show script usage

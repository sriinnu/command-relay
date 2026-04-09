# Bridge Smoke Benchmarks

Lightweight local benchmark scripts for bridge smoke checks. All scripts output JSON to stdout.

## Prerequisites

1. Bridge server running (default ws endpoint: `ws://127.0.0.1:8787/ws`).
2. `node >= 22`.
3. `tsx` installed in project dependencies.
4. For auth-enabled bridge: set `COMMANDRELAY_AUTH_TOKEN` or pass `--token`.
5. Optional deterministic tmux fixtures for replay/load tests: see `scripts/tmux-fixtures/README.md`.

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

## Deterministic tmux fixture harness

Use fixtures when you want stable tmux panes and reproducible output while running replay/load checks.

1. Create fixture panes:

```bash
scripts/tmux-fixtures/create-fixture.sh --session fixture_perf --panes 4
```

2. Emit replay-like sample output:

```bash
scripts/tmux-fixtures/emit-fixture-output.sh --session fixture_perf --profile replay --cycles 10 --lines-per-cycle 4
```

3. Emit heavier load sample output:

```bash
scripts/tmux-fixtures/emit-fixture-output.sh --session fixture_perf --profile load --cycles 40 --lines-per-cycle 12 --delay-ms 0
```

4. Teardown fixture:

```bash
scripts/tmux-fixtures/teardown-fixture.sh --session fixture_perf
```

Safety guardrails:

- Session names must start with `fixture`.
- Non-fixture sessions are never recreated or removed.
- `emit` and `teardown` only operate on sessions marked by `create-fixture.sh`.

## Common options

- `--url <ws-url>` websocket URL (default: `ws://127.0.0.1:8787/ws`)
- `--token <token>` auth token
- `--iterations <n>` sample count
- `--timeout-ms <ms>` timeout per operation
- `--interval-ms <ms>` delay between samples
- `--pretty` / `--compact` JSON formatting
- `--help` show script usage

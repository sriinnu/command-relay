# tmux Fixture Harness

Deterministic tmux fixture scripts for replay/load testing.

## Scripts

1. Create fixture session and panes:

```bash
scripts/tmux-fixtures/create-fixture.sh
```

2. Emit deterministic fixture output:

```bash
scripts/tmux-fixtures/emit-fixture-output.sh --profile replay --cycles 10 --lines-per-cycle 4
```

3. Teardown fixture session:

```bash
scripts/tmux-fixtures/teardown-fixture.sh
```

4. Run end-to-end A2 fixture evidence (create -> emit -> replay-order assertions -> teardown):

```bash
node --import tsx scripts/tmux-fixtures/run-fixture-evidence.ts
```

The command writes a checkpoint artifact to:

- `scripts/checkpoints/runs/YYYY-MM-DD-a2-tmux-fixture-harness-evidence.md`
- It also prints the absolute artifact path as `fixture_evidence_artifact=...`.

## Safety checks

- Session names must start with `fixture`.
- Existing non-fixture sessions are never modified or removed.
- `emit` and `teardown` require a fixture marker set by `create-fixture.sh`.
- `--force-recreate` only works on already-marked fixture sessions.

## Defaults

- Session: `fixture_replay_load`
- Window: `fixture`
- Panes: `3`

## Typical workflow

```bash
scripts/tmux-fixtures/create-fixture.sh --session fixture_perf --panes 4
scripts/tmux-fixtures/emit-fixture-output.sh --session fixture_perf --profile load --cycles 25 --lines-per-cycle 8 --delay-ms 0
scripts/tmux-fixtures/teardown-fixture.sh --session fixture_perf

# A2 evidence run via checkpoint wrapper
scripts/checkpoints/run-a2-tmux-fixture-evidence.sh --session fixture_a2_perf --panes 4 --cycles 6
```

## Notes

- Panes run `cat`, so injected lines are echoed as deterministic output.
- Output line format includes `profile`, `seq`, `cycle`, and `line` fields for stable replay assertions.

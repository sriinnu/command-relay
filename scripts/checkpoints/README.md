# Weekly Checkpoints

This directory contains the weekly cross-platform checkpoint workflow artifacts.

## Generate a checkpoint note

```bash
scripts/checkpoints/generate-weekly-checkpoint.sh
```

Optional flags:

- `--date YYYY-MM-DD`
- `--facilitator "Name"`
- `--output <path>`
- `--force`

## Generate A2 tmux fixture harness evidence

```bash
scripts/checkpoints/run-a2-tmux-fixture-evidence.sh
```

Optional flags are forwarded to `scripts/tmux-fixtures/run-fixture-evidence.ts`, for example:

```bash
scripts/checkpoints/run-a2-tmux-fixture-evidence.sh --session fixture_a2_ci --panes 4 --cycles 6
```

## Tracking location

Generated checkpoint notes are stored in:

- `scripts/checkpoints/runs/*.md`

Each weekly note should be committed and referenced from roadmap/TODO updates.

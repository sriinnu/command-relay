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

## Tracking location

Generated checkpoint notes are stored in:

- `scripts/checkpoints/runs/*.md`

Each weekly note should be committed and referenced from roadmap/TODO updates.

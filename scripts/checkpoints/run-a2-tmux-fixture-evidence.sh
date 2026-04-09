#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

usage() {
  cat <<'USAGE'
Usage: scripts/checkpoints/run-a2-tmux-fixture-evidence.sh [options]

Run deterministic A2 tmux fixture harness evidence automation and write
a checkpoint artifact under scripts/checkpoints/runs/.

This wrapper forwards all options to:
  node --import tsx scripts/tmux-fixtures/run-fixture-evidence.ts

Examples:
  scripts/checkpoints/run-a2-tmux-fixture-evidence.sh
  scripts/checkpoints/run-a2-tmux-fixture-evidence.sh --session fixture_a2_ci --panes 4 --cycles 6
USAGE
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  usage
  exit 0
fi

cd "${PROJECT_ROOT}"
exec node --import tsx scripts/tmux-fixtures/run-fixture-evidence.ts "$@"

#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./common.sh
source "${SCRIPT_DIR}/common.sh"

usage() {
  cat <<'USAGE'
Usage: scripts/tmux-fixtures/create-fixture.sh [options]

Create a deterministic detached tmux fixture session with panes running `cat`.
The session is marked with fixture metadata and is safe for replay/load tests.

Options:
  --session <name>      Fixture tmux session name (default: fixture_replay_load)
  --window <name>       Window name to create (default: fixture)
  --panes <count>       Pane count to create (default: 3)
  --force-recreate      Recreate existing marked fixture session with same name
  --help, -h            Show this help

Safety:
  1. Session names must start with "fixture".
  2. Existing non-fixture sessions are never modified.
USAGE
}

SESSION_NAME="${TMUX_FIXTURE_DEFAULT_SESSION}"
WINDOW_NAME="${TMUX_FIXTURE_DEFAULT_WINDOW}"
PANE_COUNT=3
FORCE_RECREATE=0

require_value_arg() {
  local option_name="$1"
  local option_value="${2:-}"

  if [[ -z "${option_value}" ]]; then
    die "${option_name} requires a value"
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --session)
      require_value_arg "--session" "${2:-}"
      SESSION_NAME="${2:-}"
      shift 2
      ;;
    --window)
      require_value_arg "--window" "${2:-}"
      WINDOW_NAME="${2:-}"
      shift 2
      ;;
    --panes)
      require_value_arg "--panes" "${2:-}"
      PANE_COUNT="${2:-}"
      shift 2
      ;;
    --force-recreate)
      FORCE_RECREATE=1
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      die "unknown argument: $1"
      ;;
  esac
done

require_tmux
validate_fixture_session_name "${SESSION_NAME}"
validate_fixture_window_name "${WINDOW_NAME}"

if [[ ! "${PANE_COUNT}" =~ ^[0-9]+$ ]] || [[ "${PANE_COUNT}" -lt 1 ]]; then
  die "--panes must be an integer >= 1"
fi

if tmux_session_exists "${SESSION_NAME}"; then
  if [[ "${FORCE_RECREATE}" -ne 1 ]]; then
    die "session '${SESSION_NAME}' already exists; use --force-recreate only for existing fixture sessions"
  fi

  if ! is_marked_fixture_session "${SESSION_NAME}"; then
    die "session '${SESSION_NAME}' is not a fixture session; refusing to recreate"
  fi

  tmux kill-session -t "${SESSION_NAME}"
fi

tmux new-session -d -s "${SESSION_NAME}" -n "${WINDOW_NAME}" 'cat'

if [[ "${PANE_COUNT}" -gt 1 ]]; then
  for ((i = 2; i <= PANE_COUNT; i += 1)); do
    tmux split-window -d -t "${SESSION_NAME}:${WINDOW_NAME}" 'cat'
  done
fi

tmux select-layout -t "${SESSION_NAME}:${WINDOW_NAME}" tiled >/dev/null
mark_fixture_session "${SESSION_NAME}" "${PANE_COUNT}" "${WINDOW_NAME}"

pane_listing="$(tmux list-panes -t "${SESSION_NAME}:${WINDOW_NAME}" -F '#{pane_index}\t#{pane_id}' | LC_ALL=C sort -n)"

printf 'fixture session created\n'
printf 'session=%s\n' "${SESSION_NAME}"
printf 'window=%s\n' "${WINDOW_NAME}"
printf 'panes=%s\n' "${PANE_COUNT}"
printf 'pane_map:\n%s\n' "${pane_listing}"

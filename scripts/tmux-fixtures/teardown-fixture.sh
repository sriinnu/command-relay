#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./common.sh
source "${SCRIPT_DIR}/common.sh"

usage() {
  cat <<'USAGE'
Usage: scripts/tmux-fixtures/teardown-fixture.sh [options]

Teardown a marked tmux fixture session created by create-fixture.sh.

Options:
  --session <name>      Fixture tmux session name (default: fixture_replay_load)
  --if-missing-ok       Exit successfully if session does not exist
  --help, -h            Show this help

Safety:
  1. Refuses to remove sessions that are not marked as fixtures.
USAGE
}

SESSION_NAME="${TMUX_FIXTURE_DEFAULT_SESSION}"
IF_MISSING_OK=0

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
    --if-missing-ok)
      IF_MISSING_OK=1
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

if ! tmux_session_exists "${SESSION_NAME}"; then
  if [[ "${IF_MISSING_OK}" -eq 1 ]]; then
    printf 'fixture session already absent\n'
    printf 'session=%s\n' "${SESSION_NAME}"
    exit 0
  fi
  die "session '${SESSION_NAME}' does not exist"
fi

if ! is_marked_fixture_session "${SESSION_NAME}"; then
  die "session '${SESSION_NAME}' exists but is not marked as a fixture; refusing teardown"
fi

tmux kill-session -t "${SESSION_NAME}"

printf 'fixture session removed\n'
printf 'session=%s\n' "${SESSION_NAME}"

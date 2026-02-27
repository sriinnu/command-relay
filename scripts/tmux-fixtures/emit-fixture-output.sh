#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./common.sh
source "${SCRIPT_DIR}/common.sh"

usage() {
  cat <<'USAGE'
Usage: scripts/tmux-fixtures/emit-fixture-output.sh [options]

Emit deterministic sample output into each pane of a marked fixture session.
Use replay profile for human-readable stream fixtures and load profile for larger bursts.

Options:
  --session <name>         Fixture tmux session name (default: fixture_replay_load)
  --window <name>          Window name (default: fixture or session metadata)
  --profile <name>         replay | load (default: replay)
  --cycles <count>         Number of cycles to emit (default: 5)
  --lines-per-cycle <n>    Lines per pane each cycle (default: 3)
  --delay-ms <ms>          Delay between cycles (default: 100)
  --help, -h               Show this help

Safety:
  1. Refuses to run unless target session is marked as fixture.
  2. Never writes to non-fixture tmux sessions.
USAGE
}

SESSION_NAME="${TMUX_FIXTURE_DEFAULT_SESSION}"
WINDOW_NAME=""
PROFILE="replay"
CYCLES=5
LINES_PER_CYCLE=3
DELAY_MS=100

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
    --profile)
      require_value_arg "--profile" "${2:-}"
      PROFILE="${2:-}"
      shift 2
      ;;
    --cycles)
      require_value_arg "--cycles" "${2:-}"
      CYCLES="${2:-}"
      shift 2
      ;;
    --lines-per-cycle)
      require_value_arg "--lines-per-cycle" "${2:-}"
      LINES_PER_CYCLE="${2:-}"
      shift 2
      ;;
    --delay-ms)
      require_value_arg "--delay-ms" "${2:-}"
      DELAY_MS="${2:-}"
      shift 2
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
require_marked_fixture_session "${SESSION_NAME}"

if [[ -z "${WINDOW_NAME}" ]]; then
  WINDOW_NAME="$(get_tmux_option_value "${SESSION_NAME}" "${TMUX_FIXTURE_WINDOW_KEY}")"
  WINDOW_NAME="${WINDOW_NAME:-${TMUX_FIXTURE_DEFAULT_WINDOW}}"
fi
validate_fixture_window_name "${WINDOW_NAME}"

if [[ ! "${CYCLES}" =~ ^[0-9]+$ ]] || [[ "${CYCLES}" -lt 1 ]]; then
  die "--cycles must be an integer >= 1"
fi

if [[ ! "${LINES_PER_CYCLE}" =~ ^[0-9]+$ ]] || [[ "${LINES_PER_CYCLE}" -lt 1 ]]; then
  die "--lines-per-cycle must be an integer >= 1"
fi

if [[ ! "${DELAY_MS}" =~ ^[0-9]+$ ]]; then
  die "--delay-ms must be a non-negative integer"
fi

if [[ "${PROFILE}" != "replay" && "${PROFILE}" != "load" ]]; then
  die "--profile must be replay or load"
fi

mapfile -t PANE_ROWS < <(tmux list-panes -t "${SESSION_NAME}:${WINDOW_NAME}" -F '#{pane_index}\t#{pane_id}' | LC_ALL=C sort -n)

if [[ "${#PANE_ROWS[@]}" -eq 0 ]]; then
  die "no panes found for ${SESSION_NAME}:${WINDOW_NAME}"
fi

emit_line() {
  local pane_id="$1"
  local line_text="$2"

  tmux send-keys -t "${pane_id}" -l -- "${line_text}"
  tmux send-keys -t "${pane_id}" C-m
}

profile_payload() {
  local profile_name="$1"
  local pane_index="$2"
  local cycle_number="$3"
  local line_number="$4"

  if [[ "${profile_name}" == "replay" ]]; then
    printf 'topic=stream_%s state=ok pane=%s cycle=%03d line=%02d body="delta packet"' \
      "$((pane_index % 4))" \
      "${pane_index}" \
      "${cycle_number}" \
      "${line_number}"
    return 0
  fi

  printf 'topic=load_%s state=queued pane=%s cycle=%03d line=%02d bytes=512 checksum=%04d' \
    "$((pane_index % 8))" \
    "${pane_index}" \
    "${cycle_number}" \
    "${line_number}" \
    "$(((cycle_number * 97 + line_number * 13 + pane_index) % 10000))"
}

total_lines=0
seq=1

for ((cycle = 1; cycle <= CYCLES; cycle += 1)); do
  for ((line = 1; line <= LINES_PER_CYCLE; line += 1)); do
    for pane_row in "${PANE_ROWS[@]}"; do
      pane_index="${pane_row%%$'\t'*}"
      pane_id="${pane_row#*$'\t'}"
      payload="$(profile_payload "${PROFILE}" "${pane_index}" "${cycle}" "${line}")"
      formatted="$(printf '[fixture profile=%s seq=%05d] %s' "${PROFILE}" "${seq}" "${payload}")"

      emit_line "${pane_id}" "${formatted}"
      total_lines=$((total_lines + 1))
      seq=$((seq + 1))
    done
  done

  if [[ "${cycle}" -lt "${CYCLES}" ]]; then
    sleep_ms "${DELAY_MS}"
  fi
done

printf 'fixture output emitted\n'
printf 'session=%s\n' "${SESSION_NAME}"
printf 'window=%s\n' "${WINDOW_NAME}"
printf 'profile=%s\n' "${PROFILE}"
printf 'cycles=%s\n' "${CYCLES}"
printf 'lines_per_cycle=%s\n' "${LINES_PER_CYCLE}"
printf 'pane_count=%s\n' "${#PANE_ROWS[@]}"
printf 'total_lines=%s\n' "${total_lines}"

#!/usr/bin/env bash
set -euo pipefail

readonly TMUX_FIXTURE_MARKER_KEY='@kaala_brahma_fixture_harness'
readonly TMUX_FIXTURE_MARKER_VALUE='1'
readonly TMUX_FIXTURE_VERSION_KEY='@kaala_brahma_fixture_version'
readonly TMUX_FIXTURE_VERSION_VALUE='1'
readonly TMUX_FIXTURE_PANES_KEY='@kaala_brahma_fixture_panes'
readonly TMUX_FIXTURE_WINDOW_KEY='@kaala_brahma_fixture_window'
readonly TMUX_FIXTURE_DEFAULT_SESSION='fixture_replay_load'
readonly TMUX_FIXTURE_DEFAULT_WINDOW='fixture'

log_error() {
  printf 'error: %s\n' "$*" >&2
}

die() {
  log_error "$*"
  exit 1
}

require_tmux() {
  if ! command -v tmux >/dev/null 2>&1; then
    die "tmux is required but was not found in PATH"
  fi
}

validate_fixture_session_name() {
  local session_name="$1"

  if [[ -z "${session_name}" ]]; then
    die "session name cannot be empty"
  fi

  if [[ ! "${session_name}" =~ ^fixture[[:alnum:]_.-]*$ ]]; then
    die "session name must start with 'fixture' and contain only letters, numbers, '.', '_' or '-'"
  fi
}

validate_fixture_window_name() {
  local window_name="$1"

  if [[ -z "${window_name}" ]]; then
    die "window name cannot be empty"
  fi

  if [[ "${window_name}" == *:* ]]; then
    die "window name cannot include ':'"
  fi
}

tmux_session_exists() {
  local session_name="$1"
  tmux has-session -t "${session_name}" >/dev/null 2>&1
}

get_tmux_option_value() {
  local target="$1"
  local option_name="$2"

  tmux show-options -t "${target}" -qv "${option_name}" 2>/dev/null || true
}

mark_fixture_session() {
  local session_name="$1"
  local pane_count="$2"
  local window_name="$3"

  tmux set-option -t "${session_name}" -q "${TMUX_FIXTURE_MARKER_KEY}" "${TMUX_FIXTURE_MARKER_VALUE}"
  tmux set-option -t "${session_name}" -q "${TMUX_FIXTURE_VERSION_KEY}" "${TMUX_FIXTURE_VERSION_VALUE}"
  tmux set-option -t "${session_name}" -q "${TMUX_FIXTURE_PANES_KEY}" "${pane_count}"
  tmux set-option -t "${session_name}" -q "${TMUX_FIXTURE_WINDOW_KEY}" "${window_name}"
}

is_marked_fixture_session() {
  local session_name="$1"
  local marker

  marker="$(get_tmux_option_value "${session_name}" "${TMUX_FIXTURE_MARKER_KEY}")"
  [[ "${marker}" == "${TMUX_FIXTURE_MARKER_VALUE}" ]]
}

require_marked_fixture_session() {
  local session_name="$1"

  if ! tmux_session_exists "${session_name}"; then
    die "session '${session_name}' does not exist"
  fi

  if ! is_marked_fixture_session "${session_name}"; then
    die "session '${session_name}' exists but is not marked as a fixture; refusing operation"
  fi
}

sleep_ms() {
  local milliseconds="$1"
  local seconds
  local remainder

  if [[ "${milliseconds}" -le 0 ]]; then
    return 0
  fi

  seconds=$((milliseconds / 1000))
  remainder=$((milliseconds % 1000))
  sleep "${seconds}.$(printf '%03d' "${remainder}")"
}

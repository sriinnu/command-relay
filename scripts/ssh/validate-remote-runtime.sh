#!/usr/bin/env bash
set -euo pipefail

readonly EXIT_OK=0
readonly EXIT_USAGE=2
readonly EXIT_LOCAL_SSH=3
readonly EXIT_REMOTE_CHECK=4

SSH_TARGET=""
SSH_COMMAND="ssh"
SSH_PORT="22"
IDENTITY_FILE=""
STRICT_HOST_KEY_CHECKING="on"
CONNECT_TIMEOUT_SECONDS="8"
DRY_RUN="false"
SSH_OPTIONS=()

print_help() {
  cat <<'EOF'
Validate a remote host for CommandRelay tmux runtime over SSH.

Usage:
  validate-remote-runtime.sh --target <user@host> [options]

Required:
  -t, --target <user@host>                 SSH target (user@host or SSH config host alias)

Options:
      --ssh-command <command>              SSH command executable (default: ssh)
  -p, --ssh-port <port>                    SSH server port (default: 22)
  -i, --identity <path>                    SSH identity key path
      --ssh-option <option>                Extra SSH option passed as '-o <option>' (repeatable)
      --strict-host-key-checking <on|off>  Strict host key checking mode (default: on)
      --connect-timeout-seconds <seconds>  SSH connect timeout in seconds (default: 8)
      --dry-run                            Validate local inputs and print plan only
  -h, --help                               Show this help

Remote checks (single non-interactive SSH command set):
  1. command -v tmux
  2. tmux -V
  3. node -v

Exit codes:
  0  Success (all checks passed, or dry-run validated)
  2  Invalid usage/arguments
  3  Local SSH command/setup issue
  4  Remote runtime validation failed
EOF
}

die_usage() {
  printf 'FAIL usage: %s\n' "$1" >&2
  exit "$EXIT_USAGE"
}

die_local_ssh() {
  printf 'FAIL local: %s\n' "$1" >&2
  exit "$EXIT_LOCAL_SSH"
}

require_value() {
  local flag="$1"
  local value="${2:-}"
  if [[ -z "$value" || "$value" == -* ]]; then
    die_usage "missing value for ${flag}"
  fi
}

validate_target() {
  local value="$1"
  if [[ -z "$value" ]]; then
    die_usage "--target is required"
  fi
  if [[ "$value" =~ [[:space:]] ]]; then
    die_usage "--target must not contain whitespace"
  fi
  if [[ "$value" == -* ]]; then
    die_usage "--target must not start with '-'"
  fi
}

validate_port() {
  local label="$1"
  local value="$2"
  if ! [[ "$value" =~ ^[0-9]+$ ]]; then
    die_usage "${label} must be numeric (1-65535): ${value}"
  fi
  if ((value < 1 || value > 65535)); then
    die_usage "${label} must be in range 1-65535: ${value}"
  fi
}

validate_timeout() {
  local value="$1"
  if ! [[ "$value" =~ ^[0-9]+$ ]]; then
    die_usage "--connect-timeout-seconds must be numeric: ${value}"
  fi
  if ((value < 1 || value > 60)); then
    die_usage "--connect-timeout-seconds must be in range 1-60: ${value}"
  fi
}

validate_on_off() {
  local value="$1"
  if [[ "$value" != "on" && "$value" != "off" ]]; then
    die_usage "--strict-host-key-checking must be 'on' or 'off'"
  fi
}

validate_ssh_command() {
  local value="$1"
  if [[ -z "$value" ]]; then
    die_usage "--ssh-command must not be empty"
  fi
  if [[ "$value" =~ [[:space:]] ]]; then
    die_usage "--ssh-command must be a single command token"
  fi
}

safe_first_line() {
  local value="$1"
  printf '%s\n' "$value" | sed -n '1p' | tr -d '\r'
}

while (($# > 0)); do
  case "$1" in
    -t|--target)
      require_value "$1" "${2:-}"
      SSH_TARGET="$2"
      shift 2
      ;;
    --ssh-command)
      require_value "$1" "${2:-}"
      SSH_COMMAND="$2"
      shift 2
      ;;
    -p|--ssh-port)
      require_value "$1" "${2:-}"
      SSH_PORT="$2"
      shift 2
      ;;
    -i|--identity)
      require_value "$1" "${2:-}"
      IDENTITY_FILE="$2"
      shift 2
      ;;
    --ssh-option)
      require_value "$1" "${2:-}"
      SSH_OPTIONS+=("$2")
      shift 2
      ;;
    --strict-host-key-checking)
      require_value "$1" "${2:-}"
      STRICT_HOST_KEY_CHECKING="$2"
      shift 2
      ;;
    --connect-timeout-seconds)
      require_value "$1" "${2:-}"
      CONNECT_TIMEOUT_SECONDS="$2"
      shift 2
      ;;
    --dry-run)
      DRY_RUN="true"
      shift
      ;;
    -h|--help)
      print_help
      exit "$EXIT_OK"
      ;;
    *)
      die_usage "unknown argument: $1 (use --help)"
      ;;
  esac
done

validate_target "$SSH_TARGET"
validate_ssh_command "$SSH_COMMAND"
validate_port "--ssh-port" "$SSH_PORT"
validate_timeout "$CONNECT_TIMEOUT_SECONDS"
validate_on_off "$STRICT_HOST_KEY_CHECKING"

if ! command -v "$SSH_COMMAND" >/dev/null 2>&1; then
  die_local_ssh "ssh command not found: ${SSH_COMMAND}"
fi

if [[ -n "$IDENTITY_FILE" ]]; then
  if [[ ! -f "$IDENTITY_FILE" ]]; then
    die_usage "identity file does not exist"
  fi
  if [[ ! -r "$IDENTITY_FILE" ]]; then
    die_usage "identity file is not readable"
  fi
fi

printf 'PASS local: input validation\n'
printf 'PASS local: ssh command available\n'

if [[ "$DRY_RUN" == "true" ]]; then
  printf 'PASS dry-run: remote checks not executed\n'
  printf 'INFO target=%s port=%s strict_host_key_checking=%s timeout=%ss identity=%s extra_ssh_options=%s\n' \
    "$SSH_TARGET" \
    "$SSH_PORT" \
    "$STRICT_HOST_KEY_CHECKING" \
    "$CONNECT_TIMEOUT_SECONDS" \
    "$([[ -n "$IDENTITY_FILE" ]] && echo "configured" || echo "default")" \
    "${#SSH_OPTIONS[@]}"
  exit "$EXIT_OK"
fi

remote_command='command -v tmux >/dev/null 2>&1 && tmux -V && node -v'
ssh_cmd=(
  "$SSH_COMMAND"
  -T
  -p "$SSH_PORT"
  -o BatchMode=yes
  -o ConnectTimeout="$CONNECT_TIMEOUT_SECONDS"
  -o LogLevel=ERROR
)

if [[ -n "$IDENTITY_FILE" ]]; then
  ssh_cmd+=(-i "$IDENTITY_FILE")
fi

if [[ "$STRICT_HOST_KEY_CHECKING" == "on" ]]; then
  ssh_cmd+=(-o StrictHostKeyChecking=yes)
else
  ssh_cmd+=(-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null)
fi

for ssh_option in "${SSH_OPTIONS[@]}"; do
  ssh_cmd+=(-o "$ssh_option")
done

ssh_cmd+=(
  "$SSH_TARGET"
  sh -lc "$remote_command"
)

remote_output=""
if remote_output="$("${ssh_cmd[@]}" 2>&1)"; then
  tmux_version="$(printf '%s\n' "$remote_output" | awk '/^tmux[[:space:]]/{print; exit}')"
  node_version="$(printf '%s\n' "$remote_output" | awk '/^v[0-9]+\./{print; exit}')"

  if [[ -z "$tmux_version" || -z "$node_version" ]]; then
    printf 'PASS remote: runtime command set executed\n'
  else
    printf 'PASS remote: tmux runtime detected (%s)\n' "$tmux_version"
    printf 'PASS remote: node runtime detected (%s)\n' "$node_version"
  fi
  exit "$EXIT_OK"
else
  status="$?"
  first_line="$(safe_first_line "$remote_output")"
  printf 'FAIL remote: runtime validation command failed (ssh exit %s)\n' "$status" >&2
  if [[ -n "$first_line" ]]; then
    printf 'FAIL detail: %s\n' "$first_line" >&2
  fi
  exit "$EXIT_REMOTE_CHECK"
fi

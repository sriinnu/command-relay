#!/usr/bin/env bash
set -euo pipefail

readonly SCRIPT_NAME="$(basename "$0")"

LOCAL_HOST="127.0.0.1"
LOCAL_PORT="8787"
REMOTE_HOST="127.0.0.1"
REMOTE_PORT="8787"
SSH_PORT="22"
SSH_TARGET=""
IDENTITY_FILE=""
DRY_RUN="false"
SSH_OPTIONS=()

print_help() {
  cat <<'EOF'
Open an SSH local tunnel for CommandRelay HTTP/WebSocket access.

Usage:
  open-tunnel.sh --target <user@host> [options]

Required:
  -t, --target <user@host>     SSH target (user@host or SSH config host alias)

Options:
      --local-host <host>      Local bind host (default: 127.0.0.1)
  -l, --local-port <port>      Local bind port (default: 8787)
      --remote-host <host>     Remote forward host (default: 127.0.0.1)
  -r, --remote-port <port>     Remote forward port (default: 8787)
  -p, --ssh-port <port>        SSH server port (default: 22)
  -i, --identity <path>        SSH identity key path
      --ssh-option <option>    Extra SSH option passed as '-o <option>' (repeatable)
      --dry-run                Print resolved command and exit
  -h, --help                   Show this help

Examples:
  ./scripts/ssh/open-tunnel.sh --target dev@relay-host
  ./scripts/ssh/open-tunnel.sh --target dev@relay-host --local-port 9878
  ./scripts/ssh/open-tunnel.sh --target relay-prod --identity ~/.ssh/id_ed25519
EOF
}

die() {
  printf 'Error: %s\n' "$1" >&2
  exit 1
}

require_value() {
  local flag="$1"
  local value="${2:-}"
  if [[ -z "$value" || "$value" == -* ]]; then
    die "Missing value for ${flag}"
  fi
}

validate_port() {
  local label="$1"
  local value="$2"
  if ! [[ "$value" =~ ^[0-9]+$ ]]; then
    die "${label} must be a numeric port (1-65535): ${value}"
  fi
  if ((value < 1 || value > 65535)); then
    die "${label} must be in range 1-65535: ${value}"
  fi
}

validate_host() {
  local label="$1"
  local value="$2"
  if [[ -z "$value" ]]; then
    die "${label} must not be empty"
  fi
  if [[ "$value" =~ [[:space:]] ]]; then
    die "${label} must not contain whitespace: ${value}"
  fi
}

validate_target() {
  local value="$1"
  if [[ -z "$value" ]]; then
    die "--target is required"
  fi
  if [[ "$value" =~ [[:space:]] ]]; then
    die "--target must not contain whitespace: ${value}"
  fi
  if [[ "$value" == -* ]]; then
    die "--target must not start with '-': ${value}"
  fi
}

is_local_port_busy() {
  local port="$1"

  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"${port}" -sTCP:LISTEN >/dev/null 2>&1
    return
  fi

  if command -v ss >/dev/null 2>&1; then
    ss -H -ltn "( sport = :${port} )" 2>/dev/null | grep -q .
    return
  fi

  return 2
}

while (($# > 0)); do
  case "$1" in
    -t|--target)
      require_value "$1" "${2:-}"
      SSH_TARGET="$2"
      shift 2
      ;;
    --local-host)
      require_value "$1" "${2:-}"
      LOCAL_HOST="$2"
      shift 2
      ;;
    -l|--local-port)
      require_value "$1" "${2:-}"
      LOCAL_PORT="$2"
      shift 2
      ;;
    --remote-host)
      require_value "$1" "${2:-}"
      REMOTE_HOST="$2"
      shift 2
      ;;
    -r|--remote-port)
      require_value "$1" "${2:-}"
      REMOTE_PORT="$2"
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
    --dry-run)
      DRY_RUN="true"
      shift
      ;;
    -h|--help)
      print_help
      exit 0
      ;;
    *)
      die "Unknown argument: $1 (use --help)"
      ;;
  esac
done

command -v ssh >/dev/null 2>&1 || die "ssh command not found"

validate_target "$SSH_TARGET"
validate_host "Local host" "$LOCAL_HOST"
validate_host "Remote host" "$REMOTE_HOST"
validate_port "Local port" "$LOCAL_PORT"
validate_port "Remote port" "$REMOTE_PORT"
validate_port "SSH port" "$SSH_PORT"

if [[ -n "$IDENTITY_FILE" ]]; then
  if [[ ! -f "$IDENTITY_FILE" ]]; then
    die "Identity file does not exist: ${IDENTITY_FILE}"
  fi
  if [[ ! -r "$IDENTITY_FILE" ]]; then
    die "Identity file is not readable: ${IDENTITY_FILE}"
  fi
fi

if [[ "$DRY_RUN" != "true" ]]; then
  port_check_state=0
  if is_local_port_busy "$LOCAL_PORT"; then
    die "Local port ${LOCAL_PORT} is already in use"
  else
    port_check_state=$?
  fi
  if ((port_check_state == 2)); then
    printf 'Warning: unable to check local port availability (lsof/ss not found)\n' >&2
  fi
fi

forward_spec="${LOCAL_HOST}:${LOCAL_PORT}:${REMOTE_HOST}:${REMOTE_PORT}"
ssh_cmd=(
  ssh
  -N
  -p "$SSH_PORT"
  -o ExitOnForwardFailure=yes
  -o ServerAliveInterval=30
  -o ServerAliveCountMax=3
  -o TCPKeepAlive=yes
)

if [[ -n "$IDENTITY_FILE" ]]; then
  ssh_cmd+=(-i "$IDENTITY_FILE")
fi

for ssh_option in "${SSH_OPTIONS[@]}"; do
  ssh_cmd+=(-o "$ssh_option")
done

ssh_cmd+=(
  -L "$forward_spec"
  "$SSH_TARGET"
)

printf 'Opening CommandRelay tunnel\n'
printf '  SSH target: %s (port %s)\n' "$SSH_TARGET" "$SSH_PORT"
printf '  Forward: %s -> %s:%s\n' "${LOCAL_HOST}:${LOCAL_PORT}" "$REMOTE_HOST" "$REMOTE_PORT"
printf '  Local URLs: http://%s:%s and ws://%s:%s/ws\n' "$LOCAL_HOST" "$LOCAL_PORT" "$LOCAL_HOST" "$LOCAL_PORT"

if [[ "$DRY_RUN" == "true" ]]; then
  printf 'Dry run command: '
  printf '%q ' "${ssh_cmd[@]}"
  printf '\n'
  exit 0
fi

printf 'Tunnel active. Press Ctrl+C to close.\n'
trap 'printf "\nTunnel closed.\n"' EXIT
"${ssh_cmd[@]}"

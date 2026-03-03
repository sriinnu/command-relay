#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: scripts/release/safety-gate.sh [--quiet] [--command "<command string>"] [command ...]

Reject commands that match high-risk patterns or touch protected paths.

Examples:
  scripts/release/safety-gate.sh npm run ci:test
  scripts/release/safety-gate.sh --command "rm -rf artifacts/"
USAGE
}

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

reject_command() {
  local reason="$1"
  printf 'safety-gate: reject: %s\n' "${reason}" >&2
  printf 'safety-gate: command=%s\n' "${COMMAND}" >&2
  exit 1
}

command_matches() {
  local pattern="$1"
  printf '%s\n' "${LOWER_COMMAND}" | grep -Eq -- "${pattern}"
}

has_rm_rf_pattern() {
  if ! command_matches '(^|[[:space:];|&])rm([[:space:]]|$)'; then
    return 1
  fi

  if command_matches '(^|[[:space:]])-[[:alnum:]]*r[[:alnum:]]*f[[:alnum:]]*([[:space:]]|$)'; then
    return 0
  fi

  if command_matches '(^|[[:space:]])-[[:alnum:]]*f[[:alnum:]]*r[[:alnum:]]*([[:space:]]|$)'; then
    return 0
  fi

  if command_matches '--recursive' && command_matches '--force'; then
    return 0
  fi

  return 1
}

has_broad_path_scope() {
  command_matches '(^|[[:space:]])(/|\*|\.|\.\.|~|/\*|\./\*|\.\./\*|~/\*)([[:space:];]|$)'
}

QUIET=0
COMMAND=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --command)
      [[ -n "${2:-}" ]] || die "--command requires a value"
      COMMAND="${2:-}"
      shift 2
      ;;
    --quiet)
      QUIET=1
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    --)
      shift
      break
      ;;
    -*)
      die "unknown option: $1"
      ;;
    *)
      break
      ;;
  esac
done

if [[ -z "${COMMAND}" ]]; then
  [[ $# -gt 0 ]] || die "missing command input"
  COMMAND="$*"
elif [[ $# -gt 0 ]]; then
  die "do not pass positional args when --command is used"
fi

LOWER_COMMAND="${COMMAND,,}"

if command_matches '(^|[[:space:];|&])sudo([[:space:]]|$)'; then
  reject_command "sudo is not allowed"
fi

if has_rm_rf_pattern; then
  reject_command "rm -rf style deletion is blocked"
fi

if command_matches '(^|[[:space:];|&])chown([[:space:]]|$)'; then
  if command_matches '(^|[[:space:]])(-r|--recursive)([[:space:]]|$)' || has_broad_path_scope; then
    reject_command "broad chown patterns are blocked"
  fi
fi

if command_matches '(^|[[:space:];|&])chmod([[:space:]]|$)'; then
  if command_matches '(^|[[:space:]])(-r|--recursive)([[:space:]]|$)' || has_broad_path_scope; then
    reject_command "broad chmod patterns are blocked"
  fi
  if command_matches '(^|[[:space:]])(777|666|000)([[:space:]]|$)'; then
    reject_command "unsafe chmod mode is blocked"
  fi
fi

if command_matches '(^|[[:space:]/])\.env([.][a-z0-9_-]+)?($|[[:space:]/])'; then
  reject_command "protected path match: .env*"
fi

if command_matches '(^|[[:space:]/])\.git(/|$)'; then
  reject_command "protected path match: .git/"
fi

if command_matches '(^|[[:space:]/])node_modules(/|$)'; then
  reject_command "protected path match: node_modules/"
fi

if command_matches '(^|[[:space:]])(\./)?artifacts(/|$)'; then
  reject_command "protected path match: artifacts/"
fi

if command_matches '(^|[[:space:]])(\./)?scripts/checkpoints/runs(/|$)'; then
  reject_command "protected path match: scripts/checkpoints/runs/"
fi

if [[ "${QUIET}" -ne 1 ]]; then
  printf 'safety-gate: allow: %s\n' "${COMMAND}"
fi

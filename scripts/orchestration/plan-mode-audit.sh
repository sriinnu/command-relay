#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: scripts/orchestration/plan-mode-audit.sh --step <n> --label <text> -- <read-only command...>

Runs one read-only audit step under a strict allowlist and prints a completion marker:
  [DONE:<n>] <label>

Examples:
  scripts/orchestration/plan-mode-audit.sh --step 1 --label "List open release gates" -- rg -n "Gate" docs/TODO.md
  scripts/orchestration/plan-mode-audit.sh --step 2 --label "Inspect latest checkpoint" -- sed -n 1,120p scripts/checkpoints/runs/2026-03-03-proxy-publish-dry-run.md
USAGE
}

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

require_value() {
  local flag="$1"
  local value="${2:-}"
  if [[ -z "${value}" || "${value}" == -* ]]; then
    die "${flag} requires a value"
  fi
}

is_numeric() {
  [[ "$1" =~ ^[0-9]+$ ]]
}

contains_blocked_token() {
  local token
  for token in "$@"; do
    case "${token}" in
      ">"|">>"|"<"|"<<"|"|"|"||"|"&&"|";")
        return 0
        ;;
    esac
    if [[ "${token}" == *'$('* || "${token}" == *'`'* || "${token}" == *'*'* ]]; then
      return 0
    fi
  done
  return 1
}

is_allowed_command() {
  local cmd="$1"
  shift || true
  case "${cmd}" in
    rg|ls|find|sed|cat|head|tail|wc|sort|pwd|date)
      return 0
      ;;
    git)
      case "${1:-}" in
        status|log|show|diff|branch|rev-parse)
          return 0
          ;;
      esac
      return 1
      ;;
  esac
  return 1
}

STEP=""
LABEL=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --step)
      require_value "$1" "${2:-}"
      STEP="$2"
      shift 2
      ;;
    --label)
      require_value "$1" "${2:-}"
      LABEL="$2"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    --)
      shift
      break
      ;;
    *)
      die "unknown option: $1"
      ;;
  esac
done

[[ -n "${STEP}" ]] || die "--step is required"
[[ -n "${LABEL}" ]] || die "--label is required"
is_numeric "${STEP}" || die "--step must be numeric"
[[ $# -gt 0 ]] || die "missing command after --"

if contains_blocked_token "$@"; then
  die "blocked shell token detected; use plain read-only argv command without shell operators"
fi

if ! is_allowed_command "$@"; then
  die "command not allowed in plan-mode audit: $*"
fi

"$@"
printf '[DONE:%s] %s\n' "${STEP}" "${LABEL}"

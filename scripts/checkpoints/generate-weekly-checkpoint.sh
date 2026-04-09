#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
TEMPLATE_PATH="${SCRIPT_DIR}/templates/weekly-cross-platform-checkpoint.md"
RUNS_DIR="${SCRIPT_DIR}/runs"

DATE_INPUT="$(date +%F)"
FACILITATOR="TBD"
OUTPUT_PATH=""
FORCE_WRITE=0

usage() {
  cat <<'USAGE'
Usage: scripts/checkpoints/generate-weekly-checkpoint.sh [options]

Create a weekly cross-platform checkpoint markdown file from the canonical template.

Options:
  --date <YYYY-MM-DD>    Checkpoint date (default: today)
  --facilitator <name>   Name of checkpoint facilitator (default: TBD)
  --output <path>        Output file path (default: scripts/checkpoints/runs/<date>-weekly-cross-platform-checkpoint.md)
  --force                Overwrite output file if it already exists
  --help, -h             Show this help

Examples:
  scripts/checkpoints/generate-weekly-checkpoint.sh
  scripts/checkpoints/generate-weekly-checkpoint.sh --date 2026-03-06 --facilitator "Platform Lead"
USAGE
}

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

require_value_arg() {
  local option_name="$1"
  local option_value="${2:-}"

  if [[ -z "${option_value}" ]]; then
    die "${option_name} requires a value"
  fi
}

is_gnu_date() {
  date --version >/dev/null 2>&1
}

normalize_date() {
  local candidate="$1"

  if is_gnu_date; then
    date -d "${candidate}" +%F 2>/dev/null || return 1
  else
    date -j -f "%Y-%m-%d" "${candidate}" "+%F" 2>/dev/null || return 1
  fi
}

format_date() {
  local base_date="$1"
  local format="$2"

  if is_gnu_date; then
    date -d "${base_date}" "${format}"
  else
    date -j -f "%Y-%m-%d" "${base_date}" "${format}"
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --date)
      require_value_arg "--date" "${2:-}"
      DATE_INPUT="${2:-}"
      shift 2
      ;;
    --facilitator)
      require_value_arg "--facilitator" "${2:-}"
      FACILITATOR="${2:-}"
      shift 2
      ;;
    --output)
      require_value_arg "--output" "${2:-}"
      OUTPUT_PATH="${2:-}"
      shift 2
      ;;
    --force)
      FORCE_WRITE=1
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

[[ -f "${TEMPLATE_PATH}" ]] || die "template not found: ${TEMPLATE_PATH}"

CHECKPOINT_DATE="$(normalize_date "${DATE_INPUT}")" || die "invalid --date value: ${DATE_INPUT} (expected YYYY-MM-DD)"
ISO_WEEK="$(format_date "${CHECKPOINT_DATE}" "+%G-W%V")"
CHECKPOINT_ID="${ISO_WEEK}-${CHECKPOINT_DATE}"

if [[ -z "${OUTPUT_PATH}" ]]; then
  OUTPUT_PATH="${RUNS_DIR}/${CHECKPOINT_DATE}-weekly-cross-platform-checkpoint.md"
elif [[ "${OUTPUT_PATH}" != /* ]]; then
  OUTPUT_PATH="${REPO_ROOT}/${OUTPUT_PATH}"
fi

if [[ -f "${OUTPUT_PATH}" ]] && [[ "${FORCE_WRITE}" -ne 1 ]]; then
  die "output already exists: ${OUTPUT_PATH} (use --force to overwrite)"
fi

mkdir -p "$(dirname "${OUTPUT_PATH}")"

# Render template tokens using awk to keep this script dependency-light.
awk \
  -v checkpoint_date="${CHECKPOINT_DATE}" \
  -v iso_week="${ISO_WEEK}" \
  -v checkpoint_id="${CHECKPOINT_ID}" \
  -v facilitator="${FACILITATOR}" \
  '{
    gsub(/\{\{CHECKPOINT_DATE\}\}/, checkpoint_date)
    gsub(/\{\{ISO_WEEK\}\}/, iso_week)
    gsub(/\{\{CHECKPOINT_ID\}\}/, checkpoint_id)
    gsub(/\{\{FACILITATOR\}\}/, facilitator)
    print
  }' "${TEMPLATE_PATH}" > "${OUTPUT_PATH}"

printf 'weekly checkpoint created\n'
printf 'date=%s\n' "${CHECKPOINT_DATE}"
printf 'week=%s\n' "${ISO_WEEK}"
printf 'file=%s\n' "${OUTPUT_PATH}"

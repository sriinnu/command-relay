#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./common.sh
source "${SCRIPT_DIR}/common.sh"

usage() {
  cat <<'USAGE'
Usage: scripts/chitragupta/delegation-preflight.sh [options]

Checks delegation readiness for co-orchestrator prompt execution:
  - provider signals (CLI providers, API key providers, Ollama local runtime)
  - smoke timeout bounds
  - optional end-to-end prompt smoke check

Options:
  --chitragupta-dir <path>  Path to chitragupta repo (default: ../chitragupta)
  --project <path>          Project path for smoke check context (default: terminal root)
  --smoke                   Run end-to-end delegation smoke check
  --provider <id>           Optional provider override for smoke check
  --timeout-seconds <n>     Smoke timeout seconds (default: 45 or CHITRAGUPTA_DELEGATION_TIMEOUT_SECONDS)
  --prompt <text>           Smoke prompt (default: "Reply with OK only.")
  -h, --help                Show this help
USAGE
}

strip_ansi_file() {
  local path="$1"
  sed -E 's/\x1b\[[0-9;]*[[:alpha:]]//g' "${path}"
}

describe_provider_signals() {
  local cli_desc="${1}"
  local api_desc="${2}"
  local ollama_desc="${3}"
  print_info "Provider signals: cli=[${cli_desc}] api_keys=[${api_desc}] ollama=${ollama_desc}"
}

print_no_provider_guidance() {
  cat >&2 <<'EOF'
Actionable fixes:
1) Sign in to at least one CLI provider (examples: `claude auth login`, `codex auth login`, `gemini auth login`).
2) Or set one API key (`ANTHROPIC_API_KEY` or `OPENAI_API_KEY`) in the shell that starts MCP.
3) Or start a local model runtime (`ollama serve`) on http://127.0.0.1:11434.
4) Re-run with smoke validation:
   scripts/chitragupta/delegation-preflight.sh --smoke
EOF
}

classify_smoke_failure() {
  local log_path="$1"
  local exit_code="$2"
  local timeout_seconds="$3"
  local cleaned_log
  cleaned_log="$(strip_ansi_file "${log_path}")"

  if [[ "${exit_code}" -eq 124 || "${exit_code}" -eq 137 || "${exit_code}" -eq 143 ]] || grep -Eiq 'timed out|timeout' <<<"${cleaned_log}"; then
    print_error "Delegation smoke check failed: request timed out after ${timeout_seconds}s."
    cat >&2 <<EOF
Actionable fixes:
1) Increase timeout for slow providers: --timeout-seconds $((timeout_seconds + 30))
2) Verify provider/network reachability.
3) Re-run smoke:
   scripts/chitragupta/delegation-preflight.sh --smoke --timeout-seconds $((timeout_seconds + 30))
EOF
  elif grep -Eiq 'EACCES|permission denied' <<<"${cleaned_log}"; then
    print_error "Delegation smoke check failed: filesystem permissions blocked provider execution."
    cat >&2 <<'EOF'
Actionable fixes:
1) Ensure the MCP runtime user can read/write under ~/.chitragupta.
2) Re-run smoke in the same shell/context used to launch MCP.
3) If running inside a restricted sandbox, rerun outside the sandbox for this check.
EOF
  elif grep -Eiq 'environment variable is not set|API_KEY.*not set|not configured.*provider|provider add' <<<"${cleaned_log}"; then
    print_error "Delegation smoke check failed: provider credentials are not configured."
    cat >&2 <<'EOF'
Actionable fixes:
1) Export the provider API key required by your target provider (for example `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`).
2) Verify provider setup with:
   node /mnt/c/sriinnu/personal/Kaala-brahma/AUriva/chitragupta/packages/cli/dist/cli.js provider list
3) Re-run smoke:
   scripts/chitragupta/delegation-preflight.sh --smoke
EOF
  elif grep -Eiq 'No provider available|No AI provider detected|No API keys available|No CLIs available' <<<"${cleaned_log}"; then
    print_error "Delegation smoke check failed: no usable provider path was detected."
    print_no_provider_guidance
  elif grep -Eiq 'auth expired|not logged in|authenticate|auth login|token expired|credentials' <<<"${cleaned_log}"; then
    print_error "Delegation smoke check failed: provider auth is missing or expired."
    cat >&2 <<'EOF'
Actionable fixes:
1) Re-authenticate your CLI provider (`claude auth login`, `codex auth login`, `gemini auth login`).
2) Or switch to API-key mode with `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`.
3) Re-run smoke:
   scripts/chitragupta/delegation-preflight.sh --smoke
EOF
  elif grep -Eiq 'E2BIG|spawn E2BIG' <<<"${cleaned_log}"; then
    print_error "Delegation smoke check failed: provider spawn payload too large (E2BIG)."
    cat >&2 <<'EOF'
Actionable fixes:
1) Keep delegation prompts short in smoke/preflight checks.
2) Clear oversized environment variables in the MCP launch shell.
3) Re-run smoke with default prompt:
   scripts/chitragupta/delegation-preflight.sh --smoke
EOF
  else
    print_error "Delegation smoke check failed (exit ${exit_code})."
  fi

  print_error "Failure excerpt:"
  tail -n 20 "${log_path}" >&2
}

CHITRAGUPTA_DIR=""
PROJECT_DIR=""
RUN_SMOKE=false
PROVIDER_OVERRIDE=""
SMOKE_TIMEOUT_SECONDS="${CHITRAGUPTA_DELEGATION_TIMEOUT_SECONDS:-45}"
SMOKE_PROMPT="${CHITRAGUPTA_DELEGATION_SMOKE_PROMPT:-Reply with OK only.}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --chitragupta-dir)
      CHITRAGUPTA_DIR="${2:-}"
      shift 2
      ;;
    --project)
      PROJECT_DIR="${2:-}"
      shift 2
      ;;
    --smoke)
      RUN_SMOKE=true
      shift
      ;;
    --provider)
      PROVIDER_OVERRIDE="${2:-}"
      shift 2
      ;;
    --timeout-seconds)
      SMOKE_TIMEOUT_SECONDS="${2:-}"
      shift 2
      ;;
    --prompt)
      SMOKE_PROMPT="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      print_error "Unknown option: $1"
      usage
      exit 2
      ;;
  esac
done

if ! command_exists node; then
  print_error "node is required but not installed."
  exit 1
fi
if ! command_exists pnpm; then
  print_error "pnpm is required but not installed."
  exit 1
fi
if ! validate_numeric_range "--timeout-seconds" "${SMOKE_TIMEOUT_SECONDS}" 5 180; then
  exit 1
fi

CHITRAGUPTA_DIR="$(resolve_chitragupta_dir "${CHITRAGUPTA_DIR}")"
PROJECT_DIR="$(resolve_project_dir "${PROJECT_DIR}")"
CLI_SRC_ENTRY="$(cli_src_entry_path "${CHITRAGUPTA_DIR}")"
CLI_DIST_ENTRY="$(cli_dist_entry_path "${CHITRAGUPTA_DIR}")"

if [[ ! -f "${CLI_DIST_ENTRY}" && ! -f "${CLI_SRC_ENTRY}" ]]; then
  print_error "Missing chitragupta CLI entrypoint (dist or source)."
  print_error "Expected one of: ${CLI_DIST_ENTRY} or ${CLI_SRC_ENTRY}"
  exit 1
fi

CLI_MODE=""
CLI_CMD=()
if [[ -f "${CLI_DIST_ENTRY}" ]]; then
  CLI_MODE="dist"
  CLI_CMD=(node "${CLI_DIST_ENTRY}")
elif tsx_is_available "${CHITRAGUPTA_DIR}"; then
  CLI_MODE="tsx"
  CLI_CMD=(pnpm --dir "${CHITRAGUPTA_DIR}" exec node --import tsx "${CLI_SRC_ENTRY}")
else
  print_error "Cannot run chitragupta CLI: dist entrypoint missing and tsx is unavailable."
  show_missing_tsx_recovery "${CHITRAGUPTA_DIR}" "${PROJECT_DIR}"
  exit 1
fi

CLI_PROVIDER_COMMANDS=(claude codex gemini copilot aider zai minimax)
API_KEY_PROVIDER_VARS=(ANTHROPIC_API_KEY OPENAI_API_KEY)
AVAILABLE_CLI_PROVIDERS=()
AVAILABLE_API_KEY_PROVIDERS=()
OLLAMA_READY=false

for provider_cmd in "${CLI_PROVIDER_COMMANDS[@]}"; do
  if command_exists "${provider_cmd}"; then
    AVAILABLE_CLI_PROVIDERS+=("${provider_cmd}")
  fi
done

for api_key_var in "${API_KEY_PROVIDER_VARS[@]}"; do
  if nonempty_env_var "${api_key_var}"; then
    AVAILABLE_API_KEY_PROVIDERS+=("${api_key_var}")
  fi
done

if command_exists curl; then
  if curl --silent --show-error --max-time 2 http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
    OLLAMA_READY=true
  fi
else
  print_warn "curl not found; skipping Ollama endpoint probe."
fi

cli_desc="none"
if [[ "${#AVAILABLE_CLI_PROVIDERS[@]}" -gt 0 ]]; then
  cli_desc="$(IFS=,; echo "${AVAILABLE_CLI_PROVIDERS[*]}")"
fi

api_desc="none"
if [[ "${#AVAILABLE_API_KEY_PROVIDERS[@]}" -gt 0 ]]; then
  api_desc="$(IFS=,; echo "${AVAILABLE_API_KEY_PROVIDERS[*]}")"
fi

ollama_desc="not_detected"
if [[ "${OLLAMA_READY}" == "true" ]]; then
  ollama_desc="ready"
fi

describe_provider_signals "${cli_desc}" "${api_desc}" "${ollama_desc}"
print_info "Delegation smoke timeout: ${SMOKE_TIMEOUT_SECONDS}s"
print_info "CLI launch mode: ${CLI_MODE}"

if [[ "${#AVAILABLE_CLI_PROVIDERS[@]}" -eq 0 && "${#AVAILABLE_API_KEY_PROVIDERS[@]}" -eq 0 && "${OLLAMA_READY}" != "true" ]]; then
  print_error "Delegation preflight failed: no provider signal detected."
  print_no_provider_guidance
  exit 1
fi

if [[ "${RUN_SMOKE}" != "true" ]]; then
  print_info "Delegation preflight: PASS (provider signals present)."
  print_info "Run with --smoke for end-to-end provider execution validation."
  exit 0
fi

smoke_log="$(mktemp)"
trap 'rm -f "${smoke_log}"' EXIT
SMOKE_CMD=("${CLI_CMD[@]}" -p "${SMOKE_PROMPT}")

if [[ -n "${PROVIDER_OVERRIDE}" ]]; then
  SMOKE_CMD+=(--provider "${PROVIDER_OVERRIDE}")
fi

print_info "Running delegation smoke check..."
set +e
if command_exists timeout; then
  (
    cd "${PROJECT_DIR}"
    timeout --preserve-status "${SMOKE_TIMEOUT_SECONDS}" "${SMOKE_CMD[@]}"
  ) >"${smoke_log}" 2>&1
  smoke_exit=$?
else
  print_warn "`timeout` command not found; smoke run will not be hard-bounded."
  (
    cd "${PROJECT_DIR}"
    "${SMOKE_CMD[@]}"
  ) >"${smoke_log}" 2>&1
  smoke_exit=$?
fi
set -e

if [[ "${smoke_exit}" -ne 0 ]]; then
  classify_smoke_failure "${smoke_log}" "${smoke_exit}" "${SMOKE_TIMEOUT_SECONDS}"
  exit 1
fi

smoke_output="$(strip_ansi_file "${smoke_log}" | sed -n '1,3p')"
if [[ -n "${smoke_output}" ]]; then
  print_info "Smoke output (first lines):"
  printf '%s\n' "${smoke_output}" >&2
fi
print_info "Delegation smoke check: PASS"

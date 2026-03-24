# Production Test Runbook (Environment-Split, Auto-Sectioned)

Use this runbook to validate production readiness for:

- Namespace migration (`@commandrelay/*`)
- Release gate/lockstep scripts
- Package build + test quality
- Relay runtime + TLS rotation observability

Scope: `/mnt/c/sriinnu/personal/Kaala-brahma/terminal`

## Preflight assumptions (run in any environment)

```bash
# From repo root
cd /mnt/c/sriinnu/personal/Kaala-brahma/terminal
pnpm install --frozen-lockfile
node -v
pnpm -v
git status --short
```

Expected:

- Node/pnpm commands succeed.
- `git status --short` output is clean for release-gate runs.

## Common matrix (run all relevant OS sections)

- Linux: runs from native Linux terminal or Linux-based container.
- macOS: native terminal on macOS host.
- WSL: Bash shell under Windows WSL.
- Windows: PowerShell (`pwsh`) on Windows.

## One-click command runner (recommended)

- Full production QA from repository root:
  - Linux/macOS/WSL:
    - `bash scripts/ops/run-production-qa.sh`
  - Windows:
    - `pwsh -File scripts/ops/run-production-qa.ps1`
  - Via TUI package CLI:
    - `pnpm --filter @commandrelay/tui run cli -- --qa`
    - `pnpm --filter @commandrelay/tui run qa`
- Run only selected sections:
  - Linux/macOS/WSL:
    - `bash scripts/ops/run-production-qa.sh --section deps --section ci`
  - Windows:
    - `pwsh -File scripts/ops/run-production-qa.ps1 -Section deps,ci`
  - CLI:
    - `pnpm --filter @commandrelay/tui run cli -- --qa --qa-sections deps,ci`
    - `commandrelay-tui --qa --qa-sections deps,ci`
    - `commandrelay-tui --qa --qa-sections all --qa-artifact artifacts/qa-2026-03-20T00-00-00Z.json`
- Available sections:
  - `deps`, `ci`, `release`, `relay`, `smoke`
- Keep in mind `--section` (Bash) / `-Section` (PowerShell) supports repeating and comma-separated values.

### Phase A: Dependency + workspace integrity

Run in all environments where pnpm is available:

```bash
pnpm install --frozen-lockfile
pnpm run check:all
pnpm run build:packages
pnpm run test:packages
pnpm run verify:consumer-smoke
```

Expected:

- All commands exit `0`.
- Release-grade artifacts and smoke checks are generated.

### Phase B: CI-equivalent verification

```bash
pnpm run ci:check
pnpm run ci:build
pnpm run ci:test
pnpm run ci:all
```

Expected:

- Every command passes.
- No unexpected environment-specific skips.

### Phase C: Release guardrails

```bash
pnpm run release:proxy:lockstep
pnpm run release:proxy:preflight -- --batch-date 2026-03-20
pnpm run release:proxy:deterministic-validate -- --with-build
```

Expected:

- Lockstep checks are green.
- Preflight includes clean-worktree and evidence checks.
- Deterministic validation completes successfully.

### Phase D: Relay functional hardening (cross-platform)

Build relay package first:

```bash
pnpm --filter @commandrelay/relay-proxy run build
pnpm --filter @commandrelay/relay-proxy run test
```

Smoke command (shared):

```bash
COMMANDRELAY_RELAY_REQUIRED_TOKEN=my-token \
node ./packages/commandrelay-relay-proxy/dist/cli.js \
  --port 8788 \
  --upstream ws://127.0.0.1:8787/ws \
  --relay-path /ws \
  --health-path /health \
  --upstream-tls-watch-interval-ms 1500 \
  --upstream-tls-restart-on-change true
```

From a second shell:

```bash
curl -sS -H "Authorization: Bearer my-token" "http://127.0.0.1:8788/health"
curl -sS -H "Authorization: Bearer my-token" "http://127.0.0.1:8788/status"
curl -i -H "Authorization: Bearer my-token" "http://127.0.0.1:8788/status"
curl -sS "http://127.0.0.1:8788/status"
```

Expected:

- `/health` returns JSON (`status: "ok"` in current runtime).
- `/status` returns JSON with:
  - `statusContractVersion: 2`
  - `configFingerprint` non-empty
  - `heartbeat` object
  - `upstream.rotation` object
- Unauthorized `/status` call returns `401`.

## Linux (Ubuntu/Debian/CentOS)

Additional commands:

```bash
cd /mnt/c/sriinnu/personal/Kaala-brahma/terminal

# Namespace sweep
rg -n "@termina/" .

# Release workflow artifact check (optional)
pnpm run release:proxy:guardrails -- --batch-date 2026-03-20 --package-selector "@commandrelay/proxy-*,@commandrelay/relay-proxy,@commandrelay/proxy-*"

# Relay status check scripts
bash packages/commandrelay-relay-proxy/deploy/systemd/check-status.sh "http://127.0.0.1:8788/status"
```

### Linux package-by-package smoke list

```bash
pnpm --filter @commandrelay/cli-proxy run test
pnpm --filter @commandrelay/proxy-core run test
pnpm --filter @commandrelay/proxy-agent run test
pnpm --filter @commandrelay/proxy-http-client run test
pnpm --filter @commandrelay/proxy-fetch run test
pnpm --filter @commandrelay/proxy-undici run test
pnpm --filter @commandrelay/proxy-axios run test
pnpm --filter @commandrelay/proxy-got run test
pnpm --filter @commandrelay/proxy-runtime run test
pnpm --filter @commandrelay/relay-proxy run test
pnpm --filter @commandrelay/client run test
pnpm --filter @commandrelay/protocol run test
pnpm --filter @commandrelay/tui run test
```

## macOS

```bash
cd /path/to/Kaala-brahma/terminal
node -v && pnpm -v && git status --short

# Check launchd deploy preset scripts for local launch checks
bash packages/commandrelay-relay-proxy/deploy/macos/check-relay-proxy-status.sh
```

Notes for macOS:

- For service tests use `deploy/macos/install-relay-proxy-service.sh` and pass local env file.
- Keep path references POSIX-style.

## WSL

In WSL shell:

```bash
cd /mnt/c/sriinnu/personal/Kaala-brahma/terminal
lsb_release -a || cat /etc/os-release
pnpm -v

# Prefer Linux section for most checks
pnpm run release:proxy:lockstep
```

Windows interop checks:

```bash
ls /mnt/c/Windows/System32/WindowsPowerShell/v1.0/
```

Note:

- WSL generally follows Linux section commands.
- Use Linux-style paths for repo checkout path and scripts.
- For native Windows service checks, switch to Windows section.

## Windows (PowerShell)

```powershell
Set-Location C:\path\to\Kaala-brahma\terminal
$PSVersionTable.PSVersion
node -v
pnpm -v
git status --short
```

### Windows package/release checks

```powershell
pnpm install --frozen-lockfile
pnpm run check:all
pnpm run build:packages
pnpm run test:packages
pnpm run release:proxy:lockstep
pnpm run release:proxy:preflight -- --batch-date 2026-03-20 --package-selector @commandrelay/proxy-*,@commandrelay/relay-proxy,@commandrelay/proxy-*
```

### Relay checks (Windows shell)

```powershell
Set-Location C:\path\to\Kaala-brahma\terminal
$env:COMMANDRELAY_RELAY_REQUIRED_TOKEN = "my-token"
node .\packages\commandrelay-relay-proxy\dist\cli.js `
  --port 8788 `
  --upstream ws://127.0.0.1:8787/ws `
  --relay-path /ws `
  --health-path /health `
  --upstream-tls-watch-interval-ms 1500 `
  --upstream-tls-restart-on-change true
```

```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:8788/health" -Headers @{ Authorization = "Bearer my-token" }
Invoke-RestMethod -Uri "http://127.0.0.1:8788/status" -Headers @{ Authorization = "Bearer my-token" }
```

```powershell
# If using deployment preset scripts
.\packages\commandrelay-relay-proxy\deploy\windows\check-relay-proxy-status.ps1
```

## Minimal “go/no-go” checklist

Use this for all environments:

- [ ] `node`, `pnpm`, and git available
- [ ] `pnpm install --frozen-lockfile` succeeds (if needed)
- [ ] `pnpm run ci:all` succeeds
- [ ] `pnpm run release:proxy:lockstep` succeeds
- [ ] `pnpm run release:proxy:preflight` succeeds (or clean failure reasons documented)
- [ ] Relay `/health` + `/status` assertions pass
- [ ] `/status` includes `statusContractVersion`, `configFingerprint`, `heartbeat`
- [ ] Relay rotation block includes stable status (`disabled|monitoring|restart_required|unavailable|unsupported`)
- [ ] `rg -n "@termina/"` sweep shows no production references remaining

## Reporting format

Paste this block after testing:

- `check:all`: ✅/❌
- `build:packages`: ✅/❌
- `test:packages`: ✅/❌
- `release:proxy:lockstep`: ✅/❌
- `release:proxy:preflight`: ✅/❌
- `release:proxy:deterministic-validate`: ✅/❌
- `relay /health`: ✅/❌
- `relay /status`: ✅/❌
- `statusContractVersion`: 2
- `namespace sweep`: ✅/❌
- `first-failure`: `<exact log line>`

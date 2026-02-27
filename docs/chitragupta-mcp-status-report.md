# Chitragupta MCP Status Investigation Report

Date: 2026-02-27
Scope: branch/session-local evidence in this workspace, plus non-destructive local checks.

## Current Health and Mesh State

- `health_status` is stable: `Sattva=0.6000`, `Rajas=0.3000`, `Tamas=0.1000`, alerts `none`.
- Mesh is running but not operationally bootstrapped:
  - `p2pBootstrapped: false`
  - `nodeId: null`
  - `connectedPeers: 0`
  - `capabilityRouterActive: false`
  - `mesh_peers` reports only dead local system peers and prints `P2P: not bootstrapped`.

## Reproducible Failures Seen

### 1) Prompt delegation failure (`spawn E2BIG`)

Evidence from branch checkpoint:
- [scripts/checkpoints/runs/2026-02-27-feat-ssh-exploration-validation-checkpoint.md](../scripts/checkpoints/runs/2026-02-27-feat-ssh-exploration-validation-checkpoint.md) (`Co-Orchestrator Check` section) records delegated prompt calls failing with `spawn E2BIG`.

Reproduced in-session:
```bash
mcp__chitragupta__chitragupta_prompt
message: "Return exactly: OK"
```
Observed error:
- `Agent prompt failed: ... CLI "claude" failed to spawn: spawn E2BIG | codex-cli ... spawn E2BIG ...`

### 2) Non-bootstrapped mesh

Reproduced in-session:
```bash
mcp__chitragupta__mesh_status
mcp__chitragupta__mesh_topology
mcp__chitragupta__mesh_peers
```
Observed state:
- Mesh process is `running: true` but `p2pBootstrapped: false`.
- No node identity (`nodeId: null`), no connected peers, and no active capability router.

### 3) Health script path mismatch (default path fails)

Reproduced in-session:
```bash
scripts/chitragupta/health.sh
```
Observed error:
- `Chitragupta directory not found: /mnt/c/sriinnu/personal/Kaala-brahma/terminal/../chitragupta`

Path evidence:
- `.mcp.json` points MCP startup to `/mnt/c/sriinnu/personal/Kaala-brahma/AUriva/chitragupta/...`
- `../chitragupta` does not exist from this repo root.

Control check (same script succeeds with explicit dir):
```bash
scripts/chitragupta/health.sh \
  --chitragupta-dir /mnt/c/sriinnu/personal/Kaala-brahma/AUriva/chitragupta \
  --project /mnt/c/sriinnu/personal/Kaala-brahma/terminal
```
Result: `MCP diagnostics: PASS`.

## Impact

- Delegation path is unreliable/unavailable: co-orchestrator prompt routing cannot execute agent tasks (`spawn E2BIG`).
- Mesh-based collaboration features are effectively offline (no bootstrapped P2P/capability routing).
- Local health checks produce false negatives unless operators pass explicit paths, reducing trust in operational scripts.

## Probable Causes

1. `spawn E2BIG`:
- Provider CLIs are likely launched with oversized argument/environment payloads.
- Fallback providers are not effectively available once spawn fails (`No provider available` chain appears in the same error).

2. Mesh not bootstrapped:
- P2P bootstrap prerequisites are missing or not configured at runtime (node identity/bootstrap transport never initialized).

3. Health path mismatch:
- Script default assumes adjacent repo `../chitragupta`, but actual environment uses `AUriva/chitragupta`.
- Multiple path sources (`.mcp.json` vs script defaults) are diverged.

## Prioritized Remediation Actions

1. P0: Single source of truth for Chitragupta repo path.
- Introduce one canonical env/config value (for example `CHITRAGUPTA_DIR`) and consume it in `health.sh`, `start-mcp.sh`, bootstrap docs, and `.mcp.json` generation.
- Keep current explicit override flags, but stop relying on stale hardcoded defaults.

2. P0: Stabilize delegation spawn path.
- Reduce spawn payload size (trim inherited env; avoid large arg blobs; prefer stdin/temp-file handoff for long prompts).
- Add a preflight spawn-size self-check in MCP diagnostics and fail with actionable guidance before delegation attempts.

3. P1: Make mesh bootstrap health explicit.
- Extend health checks to fail when `p2pBootstrapped=false` in environments expecting mesh.
- Add startup logging that clearly states bootstrap mode and why router is inactive.

4. P1: Add regression checks for these exact failure signatures.
- Script-level check: default path resolves to existing repo or emits fix hint with detected `.mcp.json` path.
- Delegation check: minimal `chitragupta_prompt` smoke test in checkpoint workflow.
- Mesh check: assert expected bootstrapped state for designated environments.

5. P2: Operator runbook hardening.
- Add a short troubleshooting matrix to docs/operations for `spawn E2BIG`, `p2pBootstrapped=false`, and path mismatch failures with copy-paste fixes.

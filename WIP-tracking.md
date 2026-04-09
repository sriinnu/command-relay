# WIP Tracking

This file tracks the remaining work after the current durable-run and branding pass.

## Durable Runs

1. Fix real tmux completion reconciliation.
   Current local live smoke still lands in `lost` instead of `completed`, and no `exit.json` is written under the run entry directory.
   Repro:
   `pnpm --filter @commandrelay/tui exec tsx src/cli.ts run --runtime tmux --run-dir /tmp/commandrelay-smoke --title smoke -- true`
   Then:
   `pnpm --filter @commandrelay/tui exec tsx src/cli.ts runs inspect <run-id> --run-dir /tmp/commandrelay-smoke`
   Result:
   `status=lost`, `exitCode=null`, no `exit.json`.

2. Rework exit markers from inline shell wrapping to wrapper/payload artifacts.
   The current inline wrapper in [packages/run-orchestrator/src/run-exit-marker.ts](/mnt/c/sriinnu/personal/Kaala-brahma/command-relay/packages/run-orchestrator/src/run-exit-marker.ts) is only partially validated.
   Best next design:
   local ledger under `.commandrelay/runs/<runId>/`
   payload and wrapper files beside it
   atomic `exit.json.tmp -> exit.json`
   shell-side payload contains the original command
   wrapper records only `exitCode`
   reconciliation stamps `endedAt` locally

3. Add true remote exit-marker support for `ssh-tmux`.
   The current marker path is local.
   A real `ssh-tmux` implementation needs:
   remote run directory
   remote file write/read helpers in [packages/runtime-ssh/src/index.ts](/mnt/c/sriinnu/personal/Kaala-brahma/command-relay/packages/runtime-ssh/src/index.ts)
   POSIX-only remote path handling

4. Add stronger live reconciliation semantics.
   `completed` and `failed` are now part of the schema, but only the marker path can legitimately promote runs into those states.
   `lost` should remain reserved for pane disappearance with no exit marker.

5. Add operator-facing `runs gc` or equivalent cleanup later.
   Not required for this pass, but durable stores will accumulate stale entries.

## Live E2E

1. `tmux` unit/build coverage is green, but the live smoke still exposes the completion gap above.
2. `oly` / managed live E2E was not run in this environment because `oly` is not installed.
3. `ssh-tmux` live E2E was not run because no test target was configured.
4. GUI opener E2E was not run for Ghostty, Terminal.app, Windows Terminal, PowerShell, cmd, or WSL.

## Packaging

1. Built standalone CLI resolution is still not robust in this workspace.
   Direct execution of:
   `node packages/commandrelay-tui/dist/cli.js ...`
   still fails to resolve `@commandrelay/run-orchestrator/dist/index.js` under the local workspace layout.

2. Repo-wide root typecheck is still red on a pre-existing issue:
   [packages/proxy-agent/src/proxy-settings.ts](/mnt/c/sriinnu/personal/Kaala-brahma/command-relay/packages/proxy-agent/src/proxy-settings.ts)
   Missing module:
   `@commandrelay/proxy-core`

## Branding

1. SVG logos were generated for the root package and every package under `packages/`.
2. Minimal README brand blurbs were added where the package already had a README.
3. No functional validation was run for the asset-only branding changes.

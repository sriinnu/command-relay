# SKILL: CommandRelay TUI (`packages/commandrelay-tui`)

## Purpose
`@commandrelay/tui` is the interactive operator terminal for live remote sessions over CommandRelay WebSockets.

- Works with persistent profiles and per-profile auth tokens.
- Supports local runtime choice (`tmux`, `ghostty`, `console`) and reconnect policies.
- Exposes structured slash commands for status, profiles, attach/detach, and input gating.

## Execution Matrix (Modern AI-friendly)
### Workspace scripts
- `pnpm --filter @commandrelay/tui run check`
- `pnpm --filter @commandrelay/tui run build`
- `pnpm --filter @commandrelay/tui run cli -- --help`
- `pnpm --filter @commandrelay/tui run qa`
- `pnpm --filter @commandrelay/tui run cli -- --qa`

### Extension commands
- `npm run extension:run -- commandrelay-tui info`
- `npm run extension:run -- commandrelay-tui check`
- `npm run extension:run -- commandrelay-tui build`
- `npm run extension:run -- commandrelay-tui cli -- --help`

## Direct CLI usage
```bash
commandrelay-tui --help
commandrelay-tui --url ws://127.0.0.1:8788/ws
commandrelay-tui --profile work --backend ghostty
commandrelay-tui --backend console
commandrelay-tui --qa
commandrelay-tui --qa --qa-sections deps,ci,release,relay,smoke
commandrelay-tui --qa --qa-sections 1,3 --qa-skip-install
commandrelay-tui --qa --qa-artifact artifacts/qa-run.json
```

## Launch-time arguments
- `--url <ws-url>` endpoint override
- `--profile <name>` activate named profile
- `--backend <tmux|ghostty|console>` local terminal integration
- `--help` prints syntax and exits
- `--qa` run production check mode with terminal check-off checklist
- `--qa-sections <deps|ci|release|relay|smoke|all|1,2,3..>` section selection
- `--qa-skip-install` passes the skip flag to subsequent sections
- `--qa-artifact <path>` writes a JSON QA execution artifact

## Interactive command reference (`/` commands)
These commands are handled in-session:
- `/help` command list and runtime hints
- `/profiles`, `/profile add|use|rm|token`
- `/list` to refresh sessions
- `/attach <pane-id>` and `/detach`
- `/enable`, `/disable` for input policy
- `/token` to store/update auth token
- `/open [path]`, `/status`, `/health`
- `/reconnect`, `/quit`, `/exit`

## Example automation flow
```bash
# start a profile-based session in deterministic mode
commandrelay-tui --profile default --backend tmux --url ws://127.0.0.1:8788/ws
# then at prompt:
# /status
# /profiles
# /attach session-01
```

### Production QA checklist mode
```bash
commandrelay-tui --qa
commandrelay-tui --qa --qa-sections all
commandrelay-tui --qa --qa-sections 1,4 --qa-skip-install
commandrelay-tui --qa --qa-sections deps,relay,smoke
```

Behavior:
- Check marks are shown as `[ ]` pending, `[…]` running, `[✔]` pass, `[✖]` fail.
- Each section runs through `scripts/ops/run-production-qa.*` and updates the status list live.
- Final output renders a production-ready pass/fail summary.
- Artifact JSON is updated after each section and includes per-section timing, status, and exit code.

### Scriptable status check example
The TUI writes status/readable lines in-session; for service-level checks use the relay `/status` endpoint (see relay skill).

## References
- `packages/commandrelay-tui/src/cli.ts`
- `packages/commandrelay-tui/src/cli-commands.ts`
- `packages/commandrelay-tui/src/connection-profile.ts`
- `packages/commandrelay-tui/src/backend.ts`

## Operational notes for AI agents
- After token failures, the client is blocked from reconnect loops and requests token via `/token`.
- If `/attach` keeps failing, verify active session list and current policy flags (`inputEnabled`, `globalInputDisabled`).
- Use `/detach` and `/reconnect` when remote pane state drifts after upgrades.

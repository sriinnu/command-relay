# Branch Validation Checkpoint - 2026-02-27

- Branch: `feat/ssh-exploration`
- Commit baseline: `b30944a`
- Captured (UTC): `2026-02-27T14:28:14Z`
- Scope: latest branch-local validation evidence for P1 checkpoint tracking.

## Validation Summary

- Pass: `5`
- Fail: `0`
- Pending: `0`

## Command Evidence

| Command | Status | Evidence |
| --- | --- | --- |
| `npm run check` | `pass` | Exit code `0`; ran `check:root` (`tsc --noEmit`) and `check:orchestration` (`tsc --noEmit -p tsconfig.orchestration.json`). |
| `npm test` | `pass` | Exit code `0`; `node --import tsx --test src/**/*.test.ts` reported `tests 195`, `pass 195`, `fail 0`. |
| `npm run test:ci:all` | `pass` | Exit code `0`; CI targets passed (`root`, `web-smoke`, `package:cli-proxy`, `package:proxy-agent`, `package:proxy-core`, `package:proxy-fetch`, `package:proxy-http-client`, `package:proxy-undici`). TAP artifacts written to `.ci-artifacts/tap/`. |
| `node --import tsx --test src/server/ws-contract-matrix.test.ts src/server/bridge-server.policy.test.ts src/server/input-policy.test.ts` | `pass` | Exit code `0`; `tests 3`, `pass 3`, `fail 0`. |
| `node --import tsx --test src/control-plane/control-plane-client.test.ts src/net/proxy-agent-factory.test.ts src/net/proxy-router.test.ts` | `pass` | Exit code `0`; `tests 3`, `pass 3`, `fail 0`. |

## Operator Safety Runbook Evidence

- [Controlled-input safety incident runbook (kill switch + lane lockout)](../../../docs/operations.md#controlled-input-safety-incident-runbook)
- [TODO safety milestone link (A4)](../../../docs/TODO.md#a4-safety)
- [Execution-owned ticket `CR-P1-004`](../../../docs/execution-owned-tickets.md#cr-p1-004-publish-operator-safety-runbook-kill-switch--lane-lockout)

## Co-Orchestrator Check

- Chitragupta health check passed (`Sattva=0.6000`, `Rajas=0.3000`, `Tamas=0.1000`; alerts: none).
- Delegated prompt calls failed with provider spawn error (`spawn E2BIG`); docs update completed via direct local authoring fallback.

## Next Blockers

- Audit metadata + lane-release work is no longer blocked (audit contract documented in `docs/controlled-input-audit.md`; `lane_owner_released` emitted for `detach`/`disconnect`/socket close in `src/server/bridge-server.ts`; related policy/contract suites are green in this checkpoint).
- Remaining blocker: publish dry-run commands are still blocked by local npm cache `EACCES` on `/home/sriinnu/.npm` (see [2026-02-27-proxy-publish-dry-run.md](./2026-02-27-proxy-publish-dry-run.md) and `docs/execution-owned-tickets.md` ticket `CR-P1-003` status `blocked`).

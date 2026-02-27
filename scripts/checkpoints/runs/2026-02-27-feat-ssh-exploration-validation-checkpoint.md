# Branch Validation Checkpoint - 2026-02-27

- Branch: `feat/ssh-exploration`
- Commit baseline: `18f2526`
- Captured (UTC): `2026-02-27`
- Scope: latest branch-local validation evidence for P1 checkpoint tracking.

## Validation Summary

- Pass: `5`
- Fail: `0`
- Pending: `0`

## Command Evidence

| Command | Status | Evidence |
| --- | --- | --- |
| `npm run check` | `pass` | Exit code `0`; ran `check:root` (`tsc --noEmit`) and `check:orchestration` (`tsc --noEmit -p tsconfig.orchestration.json`). |
| `npm test` | `pass` | Exit code `0`; `node --import tsx --test src/**/*.test.ts` reported `tests 185`, `pass 185`, `fail 0`. |
| `npm run test:ci:all` | `pass` | Exit code `0`; CI targets passed (`root`, `web-smoke`, `package:cli-proxy`, `package:proxy-agent`, `package:proxy-core`, `package:proxy-fetch`, `package:proxy-http-client`, `package:proxy-undici`). TAP artifacts written to `.ci-artifacts/tap/`. |
| `node --import tsx --test src/server/ws-contract-matrix.test.ts src/server/bridge-server.policy.test.ts src/server/input-policy.test.ts` | `pass` | Exit code `0`; `tests 3`, `pass 3`, `fail 0`. |
| `node --import tsx --test src/control-plane/control-plane-client.test.ts src/net/proxy-agent-factory.test.ts src/net/proxy-router.test.ts` | `pass` | Exit code `0`; `tests 3`, `pass 3`, `fail 0`. |

## Next Blockers

- Publish dry-run evidence for `@commandrelay/proxy-*` is still required to close P1.

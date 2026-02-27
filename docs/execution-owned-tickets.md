# Execution-Owned Tickets (Immediate P0/P1)

Last updated: 2026-02-27 (status reconciliation after merged SSH/proxy/host-state work + latest evidence check)
Source: `docs/TODO.md` -> `Prioritized Immediate Actions (Do Next)`

## Ticket Conventions

- Owner placeholders must be replaced before execution begins.
- Status values: `todo`, `in_progress`, `blocked`, `done`.
- File scope is explicit and limits where each owner should edit.

## P0 Tickets (Today -> next 48h)

### CR-P0-001 Convert Immediate P0/P1 Plan Into Owned Tickets

- Owner: `@owner-tbd`
- Priority: `P0`
- Status: `done`
- File scope:
  - `docs/TODO.md`
  - `docs/execution-owned-tickets.md`
- Acceptance criteria:
  - [x] Every immediate P0/P1 item is represented as an explicit ticket.
  - [x] Each ticket has owner placeholder, file scope, acceptance criteria, and status.
  - [x] `docs/TODO.md` links this execution board under prioritized actions.

### CR-P0-002 Land SSH Transport Contract Doc + Test Plan References

- Owner: `@owner-tbd`
- Priority: `P0`
- Status: `done`
- File scope:
  - `docs/ssh-transport-contract.md`
  - `docs/protocol-v1.md`
  - `src/server/ws-contract-matrix.test.ts`
  - `src/server/bridge-server.policy.test.ts`
- Acceptance criteria:
  - [x] SSH connect/auth/list/attach/replay/input/ack/error semantics are documented.
  - [x] Reconnect behavior with `lastSeq` is explicitly defined.
  - [x] Contract docs reference the corresponding conformance test plan/files.
  - [x] SSH/WebSocket compatibility notes are captured or linked.
- Evidence:
  - [Operation Contract Matrix](./ssh-transport-contract.md#operation-contract-matrix)
  - [Explicit reconnect semantics](./ssh-transport-contract.md#explicit-reconnect-semantics)
  - [Protocol strict/conformance profile](./protocol-v1.md)
  - [Contract matrix tests](../src/server/ws-contract-matrix.test.ts)
  - [Reconnect replay e2e tests](../src/server/bridge-server.replay.e2e.test.ts)
### CR-P0-003 Start Host-State Authority Implementation Plan

- Owner: `@owner-tbd`
- Priority: `P0`
- Status: `done`
- File scope:
  - `docs/architecture/host-state-authority-plan.md`
  - `docs/architecture.md`
  - `src/server/bridge-server.ts`
  - `src/server/bridge-server-utils.ts`
  - `src/server/audit-log.ts`
  - `src/server/bridge-server.policy.test.ts`
  - `src/server/bridge-server.replay.e2e.test.ts`
- Acceptance criteria:
  - [x] Plan defines host ownership for lane owner, replay offsets, and capability flags.
  - [x] Audit schema fields are specified for enable/disable/input/takeover flows.
  - [x] Host-side input audit records include actor (`clientId`), pane scope, `commandHash`, `previewPolicy`, timestamp (`ts`), and result metadata.
  - [x] Rollout sequence and fallback behavior are documented.
  - [x] At least one implementation slice is linked to validating tests.
- Evidence:
  - [Host-state authority plan](./architecture/host-state-authority-plan.md)
  - [Bridge audit payload writes (`input`, `input_takeover`, `lane_owner_released`)](../src/server/bridge-server.ts)
  - [Audit logger implementation](../src/server/audit-log.ts)
  - [Bridge e2e audit flow assertions](../src/server/bridge-server.e2e.test.ts)
  - [Lane ownership + reconnect read-only policy tests](../src/server/bridge-server.policy.test.ts)
  - [Replay resume semantics e2e tests](../src/server/bridge-server.replay.e2e.test.ts)

### CR-P0-004 Expand Proxy Negative Tests for Malformed Env/Config

- Owner: `@owner-tbd`
- Priority: `P0`
- Status: `done`
- File scope:
  - `src/net/proxy-agent-factory.test.ts`
  - `src/net/proxy-router.test.ts`
  - `src/net/proxy-agent-factory.ts`
  - `docs/proxy-ecosystem-roadmap.md`
- Acceptance criteria:
  - [x] Negative tests cover malformed proxy URLs and invalid auth fragments.
  - [x] Negative tests cover `NO_PROXY` edge cases and fallback behavior.
  - [x] PAC failure behavior is asserted and documented ([PAC fail-closed assertion](../src/net/proxy-agent-factory.test.ts), [failure-mode matrix](./proxy/package-model.md#failure-mode-matrix)).
  - [x] Test report notes expected vs actual handling for each malformed input class ([proxy negative input report](../scripts/checkpoints/runs/proxy-negative-input-report-2026-02-27.md)).
- Evidence:
  - [Proxy routing malformed env + NO_PROXY tests](../src/net/proxy-router.test.ts)
  - [Proxy agent malformed credential/fallback tests](../src/net/proxy-agent-factory.test.ts)
  - [PAC fail-closed behavior matrix](./proxy/package-model.md#failure-mode-matrix)
  - [Proxy hardening roadmap intent](./proxy-ecosystem-roadmap.md)

## P1 Tickets (This week)

### CR-P1-001 Run + Archive Core Validation Suites

- Owner: `@owner-tbd`
- Priority: `P1`
- Status: `done`
- File scope:
  - `package.json`
  - `src/server/ws-contract-matrix.test.ts`
  - `src/server/bridge-server.policy.test.ts`
  - `src/server/input-policy.test.ts`
  - `src/control-plane/control-plane-client.test.ts`
  - `src/net/proxy-agent-factory.test.ts`
  - `src/net/proxy-router.test.ts`
  - `scripts/checkpoints/runs/`
- Acceptance criteria:
  - [x] The following commands run from a clean workspace and results are captured:
    - `npm run check`
    - `npm test`
    - `npm run test:ci:all`
    - `node --import tsx --test src/server/ws-contract-matrix.test.ts src/server/bridge-server.policy.test.ts src/server/input-policy.test.ts`
    - `node --import tsx --test src/control-plane/control-plane-client.test.ts src/net/proxy-agent-factory.test.ts src/net/proxy-router.test.ts`
  - [x] Output summary is archived in a dated checkpoint artifact.
  - [x] Any failures include owner + next action in the artifact.
- Evidence:
  - [2026-02-27 validation checkpoint](../scripts/checkpoints/runs/2026-02-27-feat-ssh-exploration-validation-checkpoint.md)

### CR-P1-002 Update Weekly Checkpoint + Mirror Milestone Decisions

- Owner: `@owner-tbd`
- Priority: `P1`
- Status: `todo`
- File scope:
  - `scripts/checkpoints/generate-weekly-checkpoint.sh`
  - `scripts/checkpoints/templates/weekly-cross-platform-checkpoint.md`
  - `scripts/checkpoints/runs/`
  - `docs/TODO.md`
  - `docs/proxy-ecosystem-roadmap.md`
- Acceptance criteria:
  - [ ] Weekly checkpoint artifact is generated or updated for the current cycle.
  - [ ] Milestone decisions are mirrored into roadmap docs with concrete dates/status.
  - [ ] Evidence links in the checkpoint resolve to existing files/artifacts.

### CR-P1-003 Run Proxy Publish Dry-Run + Capture Artifact Links

- Owner: `@owner-tbd`
- Priority: `P1`
- Status: `blocked`
- File scope:
  - `docs/release/proxy-publish.md`
  - `scripts/checkpoints/runs/`
  - `docs/proxy-ecosystem-roadmap.md`
- Acceptance criteria:
  - [x] Dry-run executes with explicit package selector and dist-tag policy (`@commandrelay/proxy-*`, `latest`) via local CLI workflow.
  - [x] Artifact links include selected packages, dry-run logs, and policy checks.
  - [x] Publish blockers are documented (local npm cache `EACCES` on `/home/sriinnu/.npm`).
- Evidence:
  - [2026-02-27 proxy publish local dry-run checkpoint](../scripts/checkpoints/runs/2026-02-27-proxy-publish-dry-run.md)
  - [Proxy publish runbook follow-up](./release/proxy-publish.md)

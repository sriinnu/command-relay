# Execution-Owned Tickets (Immediate P0/P1)

Last updated: 2026-02-27 (status reconciliation for A2 startup profile + tmux fixture harness evidence)
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

### CR-P0-005 Validate Proxy Interoperability Matrix Coverage

- Owner: `@owner-tbd`
- Priority: `P0`
- Status: `done`
- File scope:
  - `src/net/proxy-interoperability-matrix.test.ts`
  - `src/net/proxy-agent-factory.test.ts`
  - `src/net/proxy-router.test.ts`
  - `packages/proxy-fetch/test/proxy-fetch-client-env-matrix.test.ts`
  - `packages/proxy-undici/test/proxy-undici-dispatcher-factory.test.ts`
  - `packages/proxy-http-client/test/request-json-proxy-agent-interoperability.test.ts`
  - `docs/TODO.md`
  - `docs/execution-owned-tickets.md`
- Acceptance criteria:
  - [x] Interoperability matrix covers env permutations across `HTTP_PROXY`/`HTTPS_PROXY`/`ALL_PROXY`/`NO_PROXY` with uppercase/lowercase precedence scenarios.
  - [x] Matrix assertions validate resolved proxy URL behavior across `http`/`https`/`ws`/`wss`.
  - [x] Matrix assertions validate direct-vs-proxy outcomes and expected proxy agent class selection.
  - [x] Matrix coverage extends to concrete Node client adapters (`fetch`, `undici`, `http(s)`) and proxy-chaining expectations.
  - [x] Current matrix + negative suites are passing in targeted validation (`node --import tsx --test src/net/proxy-interoperability-matrix.test.ts src/net/proxy-agent-factory.test.ts src/net/proxy-router.test.ts`).
- Evidence:
  - [Proxy interoperability matrix suite](../src/net/proxy-interoperability-matrix.test.ts)
  - [Proxy routing malformed env + NO_PROXY tests](../src/net/proxy-router.test.ts)
  - [Proxy agent malformed credential/fallback tests](../src/net/proxy-agent-factory.test.ts)
  - [Proxy fetch adapter env matrix](../packages/proxy-fetch/test/proxy-fetch-client-env-matrix.test.ts)
  - [Proxy undici adapter env matrix and unsupported chaining assertions](../packages/proxy-undici/test/proxy-undici-dispatcher-factory.test.ts)
  - [Proxy http-client resolver interoperability](../packages/proxy-http-client/test/request-json-proxy-agent-interoperability.test.ts)

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

### CR-P1-004 Publish Operator Safety Runbook (Kill-Switch + Lane Lockout)

- Owner: `@owner-tbd`
- Priority: `P1`
- Status: `done`
- File scope:
  - `docs/operations.md`
  - `docs/TODO.md`
  - `docs/execution-owned-tickets.md`
  - `scripts/checkpoints/runs/2026-02-27-feat-ssh-exploration-validation-checkpoint.md`
- Acceptance criteria:
  - [x] Operations doc includes a concrete incident runbook for kill-switch and lane lockout paths.
  - [x] TODO safety lane links to the runbook section and checkpoint evidence.
  - [x] Checkpoint artifact records latest validation baseline commit and runbook evidence links.
- Evidence:
  - [Controlled-input safety incident runbook](./operations.md#controlled-input-safety-incident-runbook)
  - [TODO safety reference](./TODO.md#a4-safety)
  - [2026-02-27 validation checkpoint](../scripts/checkpoints/runs/2026-02-27-feat-ssh-exploration-validation-checkpoint.md)

### CR-P1-005 Define Observability Metrics Contract + Weekly Evidence Pack Minimum

- Owner: `@owner-tbd`
- Priority: `P1`
- Status: `done`
- File scope:
  - `docs/observability-evidence-contract.md`
  - `docs/operations.md`
  - `docs/TODO.md`
  - `docs/execution-owned-tickets.md`
- Acceptance criteria:
  - [x] Six canonical observability metrics are documented with schema, labels, and rollup semantics.
  - [x] Dashboard baseline panel set and weekly threshold table are documented.
  - [x] Weekly checkpoint minimum evidence pack is defined with concrete artifact paths.
  - [x] Command-to-evidence mapping is documented with pass signals.
  - [x] TODO observability items are marked complete with direct references.
- Evidence:
  - [Metrics contract v1](./observability-evidence-contract.md#metrics-contract-v1)
  - [Dashboard baseline v1](./observability-evidence-contract.md#dashboard-baseline-v1)
  - [Minimum weekly evidence pack v1](./observability-evidence-contract.md#minimum-weekly-evidence-pack-v1)
  - [Command-to-evidence mapping v1](./observability-evidence-contract.md#command-to-evidence-mapping-v1)
  - [Operations weekly evidence flow](./operations.md#weekly-observability-baseline-and-evidence-pack)
  - [TODO observability lane](./TODO.md#a5-observability)

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

## B2 Status Reconciliation (Docs + Readiness Evidence)

### CR-P1-006 Reconcile B2 Productization Status with Link-Backed Evidence

- Owner: `@owner-tbd`
- Priority: `P1`
- Status: `done`
- File scope:
  - `docs/TODO.md`
  - `docs/execution-owned-tickets.md`
  - `docs/proxy/package-docs-matrix.md`
- Acceptance criteria:
  - [x] Add central per-package docs coverage matrix (README/NOTES/examples) with direct evidence links.
  - [x] Mark B2 TODO items as `done` only where substantiated by links.
  - [x] Mark incomplete B2 items as `partial` with explicit remaining gaps.
  - [x] Record reconciliation result in execution-owned tickets.
- B2 reconciliation result:
  - `B2.1 docs pack per package`: `done` ([matrix](./proxy/package-docs-matrix.md)); evidence confirms README usage matrix + NOTES + migration/compat + troubleshooting coverage for all six packages.
  - `B2.2 runnable examples + expected snapshots`: `done` ([matrix](./proxy/package-docs-matrix.md)); evidence confirms snapshot-backed runnable examples across all six packages.
  - `B2.3 CI gates explicit/reproducible at root + packages`: `done` ([root scripts](../package.json), [package scripts](./TODO.md#b2-productization-readiness)).
  - `B2.4 publish workflow dry-run path (selector + dist-tag)`: `partial` ([workflow](../.github/workflows/publish-proxy-packages.yml), [dry-run checkpoint](../scripts/checkpoints/runs/2026-02-27-proxy-publish-dry-run.md)); remaining gaps: successful unblocked dry-run artifact run still needed.
  - `B2.5 npm publish governance validation`: `partial` ([workflow guards](../.github/workflows/publish-proxy-packages.yml), [runbook config checklist](./release/proxy-publish.md#required-github-configuration)); remaining gaps: repository/environment policy verification evidence not yet captured in-repo.

### CR-P1-007 Reconcile A2 Runtime Status with Link-Backed Evidence

- Owner: `@owner-tbd`
- Priority: `P1`
- Status: `done`
- File scope:
  - `docs/TODO.md`
  - `docs/execution-owned-tickets.md`
  - `scripts/checkpoints/runs/`
- Acceptance criteria:
  - [x] Reconcile A2 startup-profile status using direct code/test evidence links.
  - [x] Reconcile A2 fixture-harness status without over-claiming; keep `partial` where execution evidence is missing.
  - [x] Capture remaining gaps as explicit evidence asks in TODO/ticket docs.
- A2 reconciliation result:
  - `A2 startup validation profile for remote host environments`: `done` ([config startup policy](../src/config.ts), [startup validation tests](../src/server/startup-validation.test.ts), [remote runtime validator](../scripts/ssh/validate-remote-runtime.sh), [ops validator runbook](./operations.md#ssh-runtime-validator-reference), [checkpoint command evidence](../scripts/checkpoints/runs/2026-02-27-feat-ssh-exploration-validation-checkpoint.md#command-evidence)).
  - `A2 tmux fixture harness deterministic replay + multi-pane ordering`: `partial` ([tmux fixture harness runbook](../scripts/tmux-fixtures/README.md), [fixture create script](../scripts/tmux-fixtures/create-fixture.sh), [weekly checkpoint risk/follow-up](../scripts/checkpoints/runs/2026-02-25-weekly-cross-platform-checkpoint.md)); remaining gaps: no linked checkpoint run currently records `create-fixture -> emit-fixture-output -> teardown-fixture` plus replay-order assertions across multiple panes.
- Evidence:
  - [TODO A2 runtime lane](./TODO.md#a2-runtime-host-state-ownership)
  - [W2 replay-ordering acceptance item](./TODO.md#milestone-w2-2026-03-09-to-2026-03-15)
- Operational note:
  - Chitragupta co-orchestrator health check result: default path failed (`../chitragupta` not found), explicit path check passed via `scripts/chitragupta/health.sh --chitragupta-dir /mnt/c/sriinnu/personal/Kaala-brahma/AUriva/chitragupta --project /mnt/c/sriinnu/personal/Kaala-brahma/terminal`.
  - Delegation smoke test succeeded via `pnpm chitragupta -p "Co-orchestrator delegation smoke test: reply with OK only."` (response: `OK`).

# CommandRelay Execution TODO (SSH-First + Proxy Hardening)

Last reviewed: 2026-03-04
Primary strategy: SSH-first transport, tmux-first runtime, remote state owned by host.

## Vision Reset (SSH-First)

- CommandRelay is a host-adjacent remote operations product, not a mobile-first product.
- SSH is the default control/data transport for production use; WebSocket remains for compatibility and controlled environments.
- `tmux` on the remote host is the source of truth for live session state.
- Host runtime owns replay/order state (`streamSeq`, `lastSeq`, lane ownership, audit trail); clients only render and request actions.
- iOS, Android, web, and macOS menu bar are thin clients over one contract; no client-specific protocol forks.
- Safety posture remains strict: read-only default, explicit input enable, lane conflict controls, global kill switch, and auditable input history.

## Two-Track Plan (Run in Parallel)

- Track A ships the SSH-first CommandRelay product baseline.
- Track B hardens and productizes the `proxy-*` ecosystem used by CommandRelay and external consumers.
- Merge/release gate: no Track A GA candidate without Track B publish/process hardening at release-ready status.

## Track A: SSH-First CommandRelay Product

### A1) Transport

- [x] Finalize SSH transport contract for connect/auth/list/attach/replay/input/ack/error with explicit reconnect semantics. Status: `done` ([SSH transport contract](./ssh-transport-contract.md), [protocol references](./protocol-v1.md#11-contract-compatibility-test-plan-references), [contract matrix tests](../src/server/ws-contract-matrix.test.ts)).
- [x] Specify host identity + trust model (host key verification mode, fingerprint surfacing, rotation handling). Status: `done` ([SSH trust controls contract](./ssh-transport-contract.md#ssh-host-trust-controls), [strict/fingerprint interplay](./ssh-transport-contract.md#strict-host-key--fingerprint-interplay), [SSH env startup guide](./getting-started.md#ssh-transport-environment), [operations trust runbook](./operations.md#ssh-transport-startup-env-contract), [runtime strict-host-key args](../src/runtime/ssh-tmux-adapter.ts), [startup env parsing tests](../src/server/startup-validation.test.ts)).
- [x] Lock protocol compatibility matrix for SSH transport and existing WebSocket transport. Status: `done` ([contract matrix tests](../src/server/ws-contract-matrix.test.ts), [operation matrix](./ssh-transport-contract.md#operation-contract-matrix)).
- [x] Add transport conformance tests covering: Status: `done` ([replay e2e](../src/server/bridge-server.replay.e2e.test.ts), [policy conflict/takeover coverage](../src/server/bridge-server.policy.test.ts), [active-lane kill-switch conformance](../src/server/bridge-server.policy.active-lane-kill-switch.test.ts)).
  - happy path attach + replay resume
  - reconnect with `lastSeq`
  - lane conflict + explicit takeover
  - kill-switch enforcement on active lane

### A2) Runtime (Host-State Ownership)

- [x] Make host runtime authoritative for session metadata, lane owner, replay offsets, and capability flags. Status: `done` ([session-list runtime metadata builder](../src/server/session-list-runtime-metadata.ts), [bridge list_sessions host-state wiring](../src/server/bridge-server.ts), [lane ownership snapshots](../src/server/bridge-server-utils.ts), [replay offset snapshots](../src/bridge/bridge-engine.ts), [runtime metadata e2e](../src/server/bridge-server.runtime-metadata.e2e.test.ts)).
- [x] Validate tmux fixture harness for deterministic replay and multi-pane ordering. Status: `done` ([tmux fixture harness runbook](../scripts/tmux-fixtures/README.md), [fixture evidence runner](../scripts/tmux-fixtures/run-fixture-evidence.ts), [2026-02-27 fixture harness evidence run](../scripts/checkpoints/runs/2026-02-27-a2-tmux-fixture-harness-evidence.md)).
- [x] Add startup validation profile for remote host environments (Node runtime, tmux availability, permissions, env policy). Status: `done` ([startup profile checks](../src/startup/startup-profile.ts), [startup profile tests](../src/startup/startup-profile.test.ts), [remote runtime validator script](../scripts/ssh/validate-remote-runtime.sh), [runtime validator runbook](./operations.md#ssh-runtime-validator-reference), [validation checkpoint command evidence](../scripts/checkpoints/runs/2026-02-27-feat-ssh-exploration-validation-checkpoint.md#command-evidence)).
- [x] Ensure runtime failure modes are explicit and recoverable (auth reject, transport drop, tmux session loss, stale lane owner). Status: `done` ([runtime failure classifier](../src/server/bridge-runtime-failures.ts), [bridge handler wiring](../src/server/bridge-server.ts), [bridge attach failure propagation](../src/bridge/bridge-engine.ts), [failure-mode e2e tests](../src/server/bridge-server.failure-modes.e2e.test.ts), [classifier unit tests](../src/server/bridge-runtime-failures.test.ts)).

### A3) UX (Thin Clients)

- [ ] Keep one interaction model across iOS/web/macOS menu bar:
  - read-only attach by default
  - explicit input arm/disarm
  - lane conflict message with owner context
  - explicit takeover confirmation
- [ ] Complete parity checklist for connect/auth/list/attach/replay/enable/disable/input/conflict/takeover.
- [ ] Finish accessibility baseline in active clients (labels, focus order, dynamic type, keyboard paths where applicable).

### A4) Safety

- [x] Controlled-input baseline exists (`enable_input`, `input`, `disable_input`, kill switch, size/rate limit payload metadata).
- [x] Add host-side input audit log record (actor, pane, command hash/preview policy, timestamp, result) ([runtime audit writes](../src/server/bridge-server.ts), [audit timestamp envelope](../src/server/audit-log.ts), [policy audit assertions](../src/server/bridge-server.policy.test.ts), [e2e audit flow assertions](../src/server/bridge-server.e2e.test.ts)).
- [x] Add policy tests for default read-only on reconnect, lane lease expiry, and takeover audit event ([policy tests](../src/server/bridge-server.policy.test.ts), [arbiter lease tests](../src/server/bridge-server-utils.test.ts)).
- [x] Add operator safety runbook for kill-switch and lane lockout incidents ([runbook](./operations.md#controlled-input-safety-incident-runbook), [checkpoint evidence](../scripts/checkpoints/runs/2026-02-27-feat-ssh-exploration-validation-checkpoint.md#operator-safety-runbook-evidence)).

### A5) Observability

- [x] Define metrics contract and dashboards ([metrics contract v1](./observability-evidence-contract.md#metrics-contract-v1), [dashboard baseline v1](./observability-evidence-contract.md#dashboard-baseline-v1), [operations weekly flow](./operations.md#weekly-observability-baseline-and-evidence-pack)):
  - connect latency
  - replay lag
  - reconnect count
  - input ack latency
  - lane conflict frequency
  - kill-switch blocks
- [x] Add structured logs for lifecycle events (connect, attach, replay resume, input enabled/disabled, takeover, policy reject) ([connect audit emit](../src/server/bridge-server.ts), [lifecycle log assertions](../src/server/bridge-server.lifecycle-logging.test.ts)).
- [x] Replay resume/fallback behavior is implemented and currently test-covered ([bridge replay unit](../src/bridge/bridge-engine.replay.test.ts), [bridge replay e2e](../src/server/bridge-server.replay.e2e.test.ts)).
- [x] Dedicated replay audit actions `replay_resume` and `replay_gap_snapshot_fallback` are emitted from attach flow and asserted in replay e2e coverage ([audit contract](./controlled-input-audit.md), [attach audit writes](../src/server/bridge-server.ts), [replay audit assertions](../src/server/bridge-server.replay.e2e.test.ts)).
- [x] Set minimum evidence pack for weekly checkpoint artifacts ([minimum artifact set](./observability-evidence-contract.md#minimum-weekly-evidence-pack-v1), [command-to-evidence mapping](./observability-evidence-contract.md#command-to-evidence-mapping-v1), [operations weekly flow](./operations.md#weekly-observability-baseline-and-evidence-pack)).
- [x] Publish layered telemetry status in `/health` (transport/runtime/replay/safety/observability severity + issue list). Status: `done` ([status derivation module](../src/telemetry/bridge-status.ts), [telemetry snapshot collector](../src/telemetry/bridge-telemetry.ts), [/health integration](../src/server/bridge-server.ts), [telemetry health tests](../src/server/bridge-server.telemetry.test.ts)).

### A6) Release Criteria (Track A)

- [ ] 7-day stability window with no Sev-1 SSH transport regressions in checkpoint evidence.
- [x] 30-minute flaky-network stream test passes with replay correctness. Status: `done` ([soak runner](../scripts/checkpoints/run-flaky-network-soak.ts), [30-minute soak summary](../scripts/checkpoints/runs/2026-03-03-flaky-network-soak-summary.json), [A6 evidence checkpoint](../scripts/checkpoints/runs/2026-03-03-a6-flaky-network-soak-and-live-bench.md)).
- [ ] Controlled input remains opt-in on every reconnect path.
- [ ] Full parity checklist is green across active clients.
- [ ] On-call incident/runbook document is complete and reviewed.

## Track B: `proxy-*` Ecosystem Hardening and Productization

### B1) Current Package Line Hardening

- [x] Baseline line exists and is in active use:
  - `@commandrelay/proxy-core`
  - `@commandrelay/proxy-agent`
  - `@commandrelay/proxy-http-client`
- [ ] Complete API stability review and public surface lock for v0.1.
- [x] Add negative tests for malformed proxy URLs, auth variants, NO_PROXY edge cases, PAC failures, and fallback behavior ([proxy factory negative + PAC suite](../src/net/proxy-agent-factory.test.ts), [proxy router malformed + NO_PROXY suite](../src/net/proxy-router.test.ts), [expected-vs-actual malformed input report](../scripts/checkpoints/runs/proxy-negative-input-report-2026-02-27.md)).
- [x] Add interoperability matrix validation (Node fetch/undici/http(s), env var permutations, proxy chaining expectations) ([core env + routing matrix](../src/net/proxy-interoperability-matrix.test.ts), [fetch adapter matrix](../packages/proxy-fetch/test/proxy-fetch-client-env-matrix.test.ts), [undici dispatcher matrix + unsupported chaining expectations](../packages/proxy-undici/test/proxy-undici-dispatcher-factory.test.ts), [http(s) request resolver interoperability](../packages/proxy-http-client/test/request-json-proxy-agent-interoperability.test.ts)).

### B2) Productization Readiness

- [x] Complete docs pack per package: README usage matrix, NOTES, migration/compat notes, troubleshooting. Status: `done` ([coverage matrix](./proxy/package-docs-matrix.md)); evidence confirms all six packages now satisfy this set.
- [x] Add runnable examples with expected output snapshots. Status: `done` ([coverage matrix](./proxy/package-docs-matrix.md)); evidence confirms all six packages now include runnable examples plus expected snapshot artifacts.
- [x] Ensure CI gates are explicit and reproducible (`check`, `build`, `test`) at root and per package ([root scripts](../package.json), [cli-proxy scripts](../packages/cli-proxy/package.json), [proxy-core scripts](../packages/proxy-core/package.json), [proxy-agent scripts](../packages/proxy-agent/package.json), [proxy-fetch scripts](../packages/proxy-fetch/package.json), [proxy-http-client scripts](../packages/proxy-http-client/package.json), [proxy-undici scripts](../packages/proxy-undici/package.json)).
- [x] Confirm local publish dry-run path with selector and dist-tag policy. Status: `done` ([workflow dispatch + selector/dist-tag logic](../.github/workflows/publish-proxy-packages.yml), [release runbook](./release/proxy-publish.md), [2026-03-03 local dry-run checkpoint](../scripts/checkpoints/runs/2026-03-03-proxy-publish-dry-run.md), [dry-run artifacts](../artifacts/2026-03-03-proxy-publish-dry-run), [2026-03-03 governance+gate checkpoint](../scripts/checkpoints/runs/2026-03-03-proxy-governance-gates.md)); GitHub Actions dry-run is now verified as successful (run `22670960699`) in the 2026-03-04 evidence update.
- [x] Add release guardrail scripts for proxy lockstep/version evidence preflight (`release:proxy:lockstep`, `release:proxy:preflight`, `release:proxy:guardrails`) and document expected pass/fail outputs ([root scripts](../package.json), [preflight script](../scripts/release/proxy-preflight.sh), [lockstep script](../scripts/release/check-proxy-lockstep-versions.ts), [release runbook](./release/proxy-publish.md#release-guardrails-commands)).
- [x] Validate npm publish governance (`NPM_TOKEN`, `npm-publish` environment reviewers, branch protections). Status: `done` ([workflow token/env guards](../.github/workflows/publish-proxy-packages.yml), [governance checklist](./release/proxy-publish.md#required-github-configuration), [governance evidence contract + required artifacts](./release/proxy-publish.md#governance-evidence-contract), [governance capture script](../scripts/release/capture-governance-evidence.sh), [governance artifacts](../artifacts/2026-03-03-proxy-publish-governance), [2026-03-03 governance+gate checkpoint](../scripts/checkpoints/runs/2026-03-03-proxy-governance-gates.md)); 2026-03-04 recapture confirms compliant state (`contains_NPM_TOKEN=true`, `npm_publish_environment_present=true`, `environment_details_status=ok`, branch protection configured).

### B3) Parallel Ecosystem Wave

- [x] P1 completed:
  - `@termina/cli-proxy`
  - `@termina/proxy-undici`
  - `@termina/proxy-fetch`
- [ ] P2 hardening wave (parallelizable):
  - `@termina/proxy-axios`
  - `@termina/proxy-got`
  - `@termina/proxy-runtime`
- [ ] P3 exploration gate:
  - `@termina/proxy-ssh` feasibility + threat model (explicit go/no-go decision doc)

### B4) Release Criteria (Track B)

- [ ] Gate 0: `npm run release:proxy:guardrails -- --batch-date <YYYY-MM-DD> --package-selector <current-batch-selector>` is green with evidence files present. Status: `partial` ([guardrails command wiring](../package.json), [preflight guardrails contract](../scripts/release/proxy-preflight.sh), [governance artifacts](../artifacts/2026-03-03-proxy-publish-governance), [2026-03-03 governance+gate checkpoint](../scripts/checkpoints/runs/2026-03-03-proxy-governance-gates.md)); as of 2026-03-04, governance and branch-protection checks are compliant, but active-branch runs can still fail on dirty-tree guardrails during in-flight edits.
- [ ] Gate 1: version and changelog readiness confirmed for all release candidates. Status: `partial` ([current-batch versions/changelog confirmation](./release/proxy-publish.md#internal-v01-gate-checklist-tag-prep-only), [2026-03-03 dry-run checkpoint selected packages](../scripts/checkpoints/runs/2026-03-03-proxy-publish-dry-run.md)); blocker: confirmation is recorded for current `@commandrelay/proxy-*` batch only, not all pending release candidates across Track B.
- [ ] Gate 2: `check/build/test` green on designated Mac validation environment. Status: `open` ([runbook follow-up item](./release/proxy-publish.md#current-batch-follow-up)); blocker: designated home-Mac validation run (`npm run check && npm test && npm run test:ci:all`) is still unchecked.
- [x] Gate 3: publish dry-run green with expected selector + dist-tag. Status: `done` ([2026-03-03 local dry-run checkpoint](../scripts/checkpoints/runs/2026-03-03-proxy-publish-dry-run.md), [dry-run artifacts](../artifacts/2026-03-03-proxy-publish-dry-run), [2026-03-03 governance+gate checkpoint](../scripts/checkpoints/runs/2026-03-03-proxy-governance-gates.md), [runbook current-batch follow-up](./release/proxy-publish.md#current-batch-follow-up)); GitHub Actions dry-run run `22670960699` completed `success` on 2026-03-04.
- [ ] Gate 4: release notes and rollback notes approved before publish-mode is allowed. Status: `open` ([runbook publish flow and gate checklist](./release/proxy-publish.md#internal-v01-gate-checklist-tag-prep-only)); blocker: no approval artifact/release note record is linked yet.
- [x] Gate 5: support/troubleshooting docs linked from package READMEs. Status: `done` ([docs coverage matrix](./proxy/package-docs-matrix.md), [B2 docs-pack evidence](#b2-productization-readiness)); evidence confirms README troubleshooting coverage plus supporting NOTES/docs examples across proxy packages.

## Next 2-4 Week Milestones (Execution-Ready)

### Milestone W1 (2026-03-02 to 2026-03-08)

- Track A goals:
  - freeze SSH transport contract + compatibility matrix
  - complete host-state authority spec for lane/replay ownership
  - add first-pass SSH conformance tests
- Track B goals:
  - finish proxy API surface audit for v0.1 candidates
  - close negative-test gaps for proxy env parsing/fallback
- Acceptance criteria:
  - [x] SSH contract/spec document merged and referenced by tests ([contract](./ssh-transport-contract.md), [matrix test](../src/server/ws-contract-matrix.test.ts)).
  - [x] At least one automated suite exercises SSH reconnect with `lastSeq` replay ([replay e2e](../src/server/bridge-server.replay.e2e.test.ts)).
  - [x] Proxy test report includes malformed URL + NO_PROXY + PAC failure cases with expected results ([proxy negative input report](../scripts/checkpoints/runs/proxy-negative-input-report-2026-02-27.md), [proxy factory tests](../src/net/proxy-agent-factory.test.ts), [proxy router tests](../src/net/proxy-router.test.ts)).

### Milestone W2 (2026-03-09 to 2026-03-15)

- Track A goals:
  - implement host audit log events and lane/takeover policy assertions
  - complete tmux fixture replay ordering validation
  - advance parity checklist coverage
- Track B goals:
  - complete docs/examples pack for `@commandrelay/proxy-*`
  - execute publish workflow dry-run and archive artifacts
- Acceptance criteria:
  - [x] Audit log records are emitted for enable/disable/input/takeover flows, and `input` records include command metadata policy fields (`commandHash`, `previewPolicy`) ([runtime audit writes](../src/server/bridge-server.ts), [e2e audit flow assertions](../src/server/bridge-server.e2e.test.ts), [policy audit assertions](../src/server/bridge-server.policy.test.ts)).
  - [x] Replay ordering suite passes under fixture harness without manual intervention ([tmux fixture harness runbook](../scripts/tmux-fixtures/README.md), [fixture harness evidence run](../scripts/checkpoints/runs/2026-02-27-a2-tmux-fixture-harness-evidence.md), [CR-P1-002 weekly evidence lane checkpoint](../scripts/checkpoints/runs/2026-02-27-cr-p1-002-weekly-evidence-lane.md)).
- [x] Dry-run artifacts contain selected package set, dist-tag, and no publish-policy blockers. Status: `done` ([2026-03-03 proxy publish local dry-run checkpoint](../scripts/checkpoints/runs/2026-03-03-proxy-publish-dry-run.md), [pack dry-run artifacts](../artifacts/2026-03-03-proxy-publish-dry-run), [A6/soak + command evidence](../scripts/checkpoints/runs/2026-03-03-a6-flaky-network-soak-and-live-bench.md)).

### Milestone W3 (2026-03-16 to 2026-03-22)

- Track A goals:
  - finalize observability metrics + dashboard baseline
  - run 30-minute flaky-network soak for stream/replay behavior
  - close critical UX parity gaps (conflict + takeover messaging)
- Track B goals:
  - complete P2 package scaffolds and core adapter conformance tests
  - resolve docs/troubleshooting gaps found in dry-run review
- Acceptance criteria:
  - [ ] Weekly checkpoint includes metrics export and soak summary.
  - [ ] No Sev-1/Sev-2 unresolved bugs in lane safety path.
  - [ ] P2 packages have passing base check/build/test and minimal docs skeleton.

### Milestone W4 (2026-03-23 to 2026-03-29)

- Track A goals:
  - run release-candidate gate review for SSH-first baseline
  - publish incident/runbook docs for transport and safety operations
- Track B goals:
  - run final pre-release gate review for proxy line
  - prepare release notes + rollback notes for v0.1 internal release decision
- Acceptance criteria:
  - [ ] Track A release criteria checklist is fully green or has explicit blocker list with owners.
  - [ ] Track B gates 1-5 reviewed with evidence links and go/no-go status.
  - [ ] Combined checkpoint artifact documents cross-track dependencies and release decision.

## Prioritized Immediate Actions (Do Next)

- Execution board: [Execution-Owned Tickets](./execution-owned-tickets.md)

### P0 (Today -> next 48h)

- [x] Convert this TODO into owned tickets with single owners and explicit file scope ([execution board](./execution-owned-tickets.md)).
- [x] Land SSH transport contract doc + test plan references ([contract](./ssh-transport-contract.md), [protocol references](./protocol-v1.md#11-contract-compatibility-test-plan-references), [contract tests](../src/server/ws-contract-matrix.test.ts)).
- [x] Start host-state authority implementation plan (lane owner + replay offsets + audit schema) ([plan](./architecture/host-state-authority-plan.md), [policy tests](../src/server/bridge-server.policy.test.ts)).
- [x] Execute proxy negative-test expansion for malformed env/config inputs ([proxy factory tests](../src/net/proxy-agent-factory.test.ts), [proxy router tests](../src/net/proxy-router.test.ts), [expected-vs-actual report](../scripts/checkpoints/runs/proxy-negative-input-report-2026-02-27.md)).

### P1 (This week)

- Latest checkpoint evidence: [2026-03-03-proxy-publish-dry-run.md](../scripts/checkpoints/runs/2026-03-03-proxy-publish-dry-run.md), [2026-03-03-a6-flaky-network-soak-and-live-bench.md](../scripts/checkpoints/runs/2026-03-03-a6-flaky-network-soak-and-live-bench.md), [2026-02-27-cr-p1-002-weekly-evidence-lane.md](../scripts/checkpoints/runs/2026-02-27-cr-p1-002-weekly-evidence-lane.md), [2026-02-27-feat-ssh-exploration-validation-checkpoint.md](../scripts/checkpoints/runs/2026-02-27-feat-ssh-exploration-validation-checkpoint.md)

- [x] Run and archive core validation suites:
  - `npm run check`
  - `npm test`
  - `npm run test:ci:all`
  - `node --import tsx --test src/server/ws-contract-matrix.test.ts src/server/bridge-server.policy.test.ts src/server/input-policy.test.ts`
  - `node --import tsx --test src/control-plane/control-plane-client.test.ts src/net/proxy-agent-factory.test.ts src/net/proxy-router.test.ts`
- [x] Validate replay resume/fallback behavior and current audit coverage for this branch (`node --import tsx --test src/bridge/bridge-engine.replay.test.ts src/server/bridge-server.replay.e2e.test.ts src/server/bridge-server.audit.test.ts`).
- [x] Update weekly checkpoint artifact and mirror milestone decisions into roadmap docs. Status: `done` for the docs evidence lane on 2026-02-27; tracked milestone outcomes remain `partial` where execution blockers persist ([CR-P1-002 weekly evidence lane checkpoint](../scripts/checkpoints/runs/2026-02-27-cr-p1-002-weekly-evidence-lane.md), [proxy roadmap decision mirror](./proxy-ecosystem-roadmap.md#milestone-decision-mirror-2026-02-27-cr-p1-002)).
- [x] Run publish dry-run for `@commandrelay/proxy-*` and capture artifact links ([proxy publish checkpoint](../scripts/checkpoints/runs/2026-03-03-proxy-publish-dry-run.md), [artifact logs](../artifacts/2026-03-03-proxy-publish-dry-run)).

### P2 (Next 2 weeks)

- [ ] Complete remaining parity matrix items including menu bar handoff cases.
- [ ] Complete observability dashboard baseline and alert thresholds.
- [ ] Finalize release-notes template for combined SSH-first + proxy hardening increment.

## Retained Context (Still Relevant)

### Completed Baselines

- [x] TypeScript gateway runtime on Node.js `>=22` (`tsx` entrypoint and `tsc --noEmit` checks).
- [x] WebSocket baseline via `ws` remains available as compatibility transport.
- [x] Proxy agent baseline via `http-proxy-agent`, `https-proxy-agent`, `socks-proxy-agent`, `pac-proxy-agent`.
- [x] Controlled-input runtime baseline is implemented and test-covered.
- [x] iOS controlled-input baseline exists with safety gate wiring.
- [x] Weekly checkpoint workflow script/template exists.
- [x] Deterministic validation wrapper exists for reproducible `check/test` runs with default credential scrubbing ([deterministic validator](../scripts/release/deterministic-validate.sh)).
- [x] Command safety gate exists for high-risk command/pathed-asset blocking ([safety gate](../scripts/release/safety-gate.sh)).
- [x] Weekly checkpoint template uses compact section contract (`Goal`, `Constraints`, `Done`, `In Progress`, `Blocked`, `Next Steps`, `Files/Artifacts`) ([template](../scripts/checkpoints/templates/weekly-cross-platform-checkpoint.md)).
- [x] Distilled capsule build/brief/dispatch wiring is documented.

### Open Dependencies and Risks

- [ ] Stable private network path for low-friction host connectivity (Tailscale or equivalent).
- [ ] Test environments: tmux fixtures + replay data kept fresh.
- [ ] Observability stack completion (logs, metrics, crash reporting).
- [ ] Risk: transport/protocol churn slows clients.
- [ ] Mitigation: versioned contract + conformance suite as release gate.
- [ ] Risk: accidental destructive commands.
- [ ] Mitigation: read-only default, explicit input enable, kill switch, audit trail.
- [ ] Risk: reconnect instability under poor networks.
- [ ] Mitigation: replay chaos tests + soak checkpoints + backoff tuning.

## Key References

- `docs/macos-menu-bar-control-lane-spec.md`
- `docs/control-lane-parity-checklist.md`
- `docs/proxy-ecosystem-roadmap.md`
- `docs/release/proxy-publish.md`
- `scripts/checkpoints/generate-weekly-checkpoint.sh`
- `scripts/checkpoints/templates/weekly-cross-platform-checkpoint.md`
- `scripts/release/deterministic-validate.sh`
- `scripts/release/safety-gate.sh`

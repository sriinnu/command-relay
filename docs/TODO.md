# CommandRelay Execution TODO (SSH-First + Proxy Hardening)

Last reviewed: 2026-02-27
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

- [ ] Finalize SSH transport contract for connect/auth/list/attach/replay/input/ack/error with explicit reconnect semantics.
- [ ] Specify host identity + trust model (host key verification mode, fingerprint surfacing, rotation handling).
- [ ] Lock protocol compatibility matrix for SSH transport and existing WebSocket transport.
- [ ] Add transport conformance tests covering:
  - happy path attach + replay resume
  - reconnect with `lastSeq`
  - lane conflict + explicit takeover
  - kill-switch enforcement on active lane

### A2) Runtime (Host-State Ownership)

- [ ] Make host runtime authoritative for session metadata, lane owner, replay offsets, and capability flags.
- [ ] Validate tmux fixture harness for deterministic replay and multi-pane ordering.
- [ ] Add startup validation profile for remote host environments (Node runtime, tmux availability, permissions, env policy).
- [ ] Ensure runtime failure modes are explicit and recoverable (auth reject, transport drop, tmux session loss, stale lane owner).

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
- [ ] Add host-side input audit log record (actor, pane, command hash/preview policy, timestamp, result).
- [ ] Add policy tests for default read-only on reconnect, lane lease expiry, and takeover audit event.
- [ ] Add operator safety runbook for kill-switch and lane lockout incidents.

### A5) Observability

- [ ] Define metrics contract and dashboards:
  - connect latency
  - replay lag
  - reconnect count
  - input ack latency
  - lane conflict frequency
  - kill-switch blocks
- [ ] Add structured logs for lifecycle events (connect, attach, replay resume, input enabled/disabled, takeover, policy reject).
- [ ] Set minimum evidence pack for weekly checkpoint artifacts.

### A6) Release Criteria (Track A)

- [ ] 7-day stability window with no Sev-1 SSH transport regressions in checkpoint evidence.
- [ ] 30-minute flaky-network stream test passes with replay correctness.
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
- [ ] Add negative tests for malformed proxy URLs, auth variants, NO_PROXY edge cases, PAC failures, and fallback behavior.
- [ ] Add interoperability matrix validation (Node fetch/undici/http(s), env var permutations, proxy chaining expectations).

### B2) Productization Readiness

- [ ] Complete docs pack per package: README usage matrix, NOTES, migration/compat notes, troubleshooting.
- [ ] Add runnable examples with expected output snapshots.
- [ ] Ensure CI gates are explicit and reproducible (`check`, `build`, `test`) at root and per package.
- [ ] Confirm publish workflow dry-run path with selector and dist-tag policy.
- [ ] Validate npm publish governance (`NPM_TOKEN`, `npm-publish` environment reviewers, branch protections).

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

- [ ] Gate 1: version and changelog readiness confirmed for all release candidates.
- [ ] Gate 2: `check/build/test` green on designated Mac validation environment.
- [ ] Gate 3: publish dry-run green with expected selector + dist-tag.
- [ ] Gate 4: release notes and rollback notes approved before publish-mode is allowed.
- [ ] Gate 5: support/troubleshooting docs linked from package READMEs.

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
  - [x] Audit log records are emitted for enable/disable/input/takeover flows.
  - [ ] Replay ordering suite passes under fixture harness without manual intervention.
  - [ ] Dry-run artifacts contain selected package set, dist-tag, and no publish-policy blockers.

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

- Latest checkpoint evidence: [2026-02-27-feat-ssh-exploration-validation-checkpoint.md](../scripts/checkpoints/runs/2026-02-27-feat-ssh-exploration-validation-checkpoint.md)

- [x] Run and archive core validation suites:
  - `npm run check`
  - `npm test`
  - `npm run test:ci:all`
  - `node --import tsx --test src/server/ws-contract-matrix.test.ts src/server/bridge-server.policy.test.ts src/server/input-policy.test.ts`
  - `node --import tsx --test src/control-plane/control-plane-client.test.ts src/net/proxy-agent-factory.test.ts src/net/proxy-router.test.ts`
- [ ] Update weekly checkpoint artifact and mirror milestone decisions into roadmap docs.
- [x] Run publish dry-run for `@commandrelay/proxy-*` and capture artifact links ([proxy publish checkpoint](../scripts/checkpoints/runs/2026-02-27-proxy-publish-dry-run.md); local dry-run blocked by npm cache `EACCES`, blocker documented in [release runbook](./release/proxy-publish.md)).

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

# CommandRelay Execution TODO (Native-First)

Last reviewed: 2026-02-26
Owner scope: iOS first, Android second, web fallback last.

## Gateway Runtime Baseline

- [x] TypeScript gateway runtime on Node.js `>=22` (`tsx` entrypoint and `tsc --noEmit` checks).
- [x] WebSocket transport baseline via `ws`.
- [x] Proxy agent package baseline via `http-proxy-agent`, `https-proxy-agent`, `socks-proxy-agent`, and `pac-proxy-agent`.

## Priority Order

1. iOS Swift app (primary delivery target).
2. Android app (feature-parity follow-up).
3. Web fallback (minimum viable control surface).

## Current Milestones

## Controlled-Input Status Snapshot

- [x] Gateway controlled-input runtime is implemented and test-covered (`enable_input`, `input`, `disable_input`, kill switch enforcement).
- [x] iOS controlled-input baseline is implemented (`enable_input`, `input`, `disable_input` wiring + UX safety gate); Mac runtime validation is pending.

## M0 - Gateway and Mobile Contract Baseline (Target: 2026-03-13)

- [x] Freeze mobile event contract (`auth`, `list_sessions`, `attach`, `output`, `input`, `ack`, `error`).
- [x] Define replay/ordering guarantees (`streamSeq`, reconnect with `lastSeq`).
- [x] Finalize read-only-by-default and explicit input-enable policy.
- [x] Add API conformance checks for protocol envelope and event types.
- [x] Publish v1 contract doc for native clients.
- [x] Add CI Node 22 gate for root/package typecheck + TAP test artifacts.
- [ ] Exit criteria met:
- [ ] iOS can consume mocked gateway events without schema drift for 7 days.
- [x] Command input path can be disabled globally and per-session.

## M1 - iOS Alpha (Read-Only Streaming) (Target: 2026-04-03)

- [x] Create Swift app shell (auth, session list, pane viewer).
- [x] Implement WebSocket connection + reconnect with backoff.
- [x] Implement pane attach, output render, replay resume.
- [ ] Add accessibility baseline (VoiceOver labels, dynamic type, focus order).
- [ ] Add telemetry for connect latency, reconnect count, stream lag.
- [ ] Exit criteria met:
- [ ] 30-minute stable stream under flaky network simulation.
- [ ] Crash-free rate >= 99% on TestFlight alpha cohort.

## M2 - iOS Beta (Controlled Input) (Target: 2026-04-24)

- [x] Implement explicit `enable_input` UX with clear risk gate.
- [x] Implement input send/ack path with timeout/error handling.
- [x] Add safeguards: per-command length limits, rate limit feedback, kill switch handling (`input_too_large` + `input_rate_limited` payload metadata, 2026-02-26).
- [ ] Add audit event surfacing for sent commands.
- [ ] Exit criteria met:
- [ ] Read-only mode remains default on every reconnect.
- [ ] Input commands are fully auditable by pane and timestamp.

## M3 - iOS GA (Target: 2026-05-15)

- [ ] Complete reliability pass (background/foreground, idle resume, token refresh).
- [ ] Complete App Store readiness (privacy manifest, permission copy, support docs).
- [ ] Produce on-call runbook for gateway + mobile incidents.
- [ ] Exit criteria met:
- [ ] 14 days beta with no Sev-1 mobile-to-gateway regression.
- [ ] Median command round-trip latency <= 250ms on Tailscale path.

## M4 - Android Alpha/Beta (Target: 2026-06-12)

- [ ] Port protocol client and session UX in Kotlin (read-only first).
- [ ] Add controlled input flow matching iOS safety model.
- [ ] Validate device/network matrix and background limits.
- [ ] Exit criteria met:
- [ ] Functional parity with iOS core flows (`list`, `attach`, `replay`, guarded `input`).

## M5 - Web Fallback (Last) (Target: 2026-07-03)

- [ ] Build minimal responsive web console for emergency access.
- [ ] Support auth, session list, pane attach, read-only stream.
- [ ] Add guarded input behind explicit enable flow.
- [ ] Keep web control lane on the same v1 envelope/event set as native clients (no web-only protocol fork).
- [ ] Implement lane conflict UX: block send on `input_lane_conflict`, show owner context, require explicit takeover action.
- [ ] Add takeover path using `override=true`/`takeOwnership=true` with clear operator confirmation.
- [ ] Add multi-tab tests for single-writer lane ownership, detach/disconnect release, and takeover behavior.
- [ ] Exit criteria met:
- [ ] Works on modern mobile browsers as fallback only.
- [ ] iOS + web lane handoff scenarios pass shared fixture suite without schema drift.

## M6 - macOS Menu Bar + iOS/Web Parity Follow-Through (Target: 2026-07-24)

- [x] Define macOS menu bar scope: quick connect, session pick, read-only attach, explicit input arm/disarm (`docs/macos-menu-bar-control-lane-spec.md`, completed 2026-02-25).
- [x] Specify menu bar lane-state indicators (`read-only`, `input-enabled`, `lane-conflict`, `kill-switch-blocked`) (`docs/macos-menu-bar-control-lane-spec.md`, completed 2026-02-25).
- [x] Reuse the same gateway client contract/events used by iOS/web (`hello`, `policy_update`, `ack`, `error`) in spec mapping (`docs/macos-menu-bar-control-lane-spec.md`, completed 2026-02-25).
- [ ] Build parity matrix covering iOS/web/menu bar for connect/auth/list/attach/replay/enable/disable/input/conflict/takeover (baseline iOS/web matrix: `docs/control-lane-parity-checklist.md`).
- [ ] Add remaining cross-client fixture cases:
  - [x] iOS writer -> web takeover (`src/server/bridge-server.policy.test.ts`, completed 2026-02-25)
  - [x] web writer -> iOS takeover (`src/server/bridge-server.policy.test.ts`, completed 2026-02-25)
  - menu bar observer -> iOS writer handoff
  - menu bar writer -> web takeover
- [ ] Exit criteria met:
- [ ] Menu bar flow can attach read-only and complete guarded input handoff without protocol drift.
- [ ] iOS/web/menu bar parity checklist is fully green in weekly checkpoint artifact.

## Dependencies

- [x] Stable gateway protocol and auth policy.
- [ ] Tailscale network path for low-friction private connectivity.
- [ ] Test environments: tmux session fixtures + replay test data.
- [ ] Apple/Google developer accounts and release pipelines.
- [ ] Observability stack (logs, metrics, crash reporting).

## Top Risks and Mitigations

- [ ] Risk: protocol churn blocks native velocity.
- [ ] Mitigation: lock v1 schema in M0; version all event changes.
- [ ] Risk: accidental destructive remote commands.
- [ ] Mitigation: default read-only, explicit enable input, kill switch, audit trail.
- [ ] Risk: mobile reconnect instability on poor networks.
- [ ] Mitigation: replay buffer tests, chaos simulation, backoff tuning.
- [ ] Risk: app store review delays.
- [ ] Mitigation: submit early TestFlight/Internal tracks and stage approvals.

## Immediate Next Actions (Rolling)

- [x] Create `v1` protocol contract tests in gateway repo.
- [x] Build iOS spike for WebSocket connect/list/attach/output, then extend with controlled-input baseline.
- [x] Define iOS screen map and navigation for three core flows.
- [x] Decide telemetry schema (connect time, replay time, input ack latency).
- [x] Implement weekly checkpoint workflow artifacts (`scripts/checkpoints/generate-weekly-checkpoint.sh` + template) and document tracking in `docs/roadmap-native.md`.
- [x] Wire the existing proxy stack into auth/pairing/telemetry outbound clients and add integration tests for `HTTP_PROXY`/`HTTPS_PROXY`/`ALL_PROXY`/`NO_PROXY`.
- [x] Draft macOS menu bar control-lane spec and state diagram (`docs/macos-menu-bar-control-lane-spec.md`, completed 2026-02-25).
- [x] Author iOS/web parity checklist for control-lane flows and map each item to an automated/manual test (`docs/control-lane-parity-checklist.md`, completed 2026-02-25).
- [x] Add two gateway fixture scenarios for lane conflict + explicit takeover (iOS writer -> web takeover, web writer -> iOS takeover) (`src/server/bridge-server.policy.test.ts`, completed 2026-02-25).
- [x] Document distilled capsule-to-brief wiring (`npm run capsule:build --` -> `npm run capsule:brief --`) in operations/docs/skill guidance (`docs/operations.md`, `docs/README.md`, `skills/termina-orchestrator/SKILL.md`, completed 2026-02-26).

## Weekly Cross-Platform Checkpoint Runbook

- [x] Workflow script: `scripts/checkpoints/generate-weekly-checkpoint.sh`
- [x] Template: `scripts/checkpoints/templates/weekly-cross-platform-checkpoint.md`
- [x] Weekly command:
  `scripts/checkpoints/generate-weekly-checkpoint.sh --date YYYY-MM-DD --facilitator "Owner Name"`
- [x] Weekly artifact to track in git:
  `scripts/checkpoints/runs/YYYY-MM-DD-weekly-cross-platform-checkpoint.md`
- [ ] Post-sync tracking rule:
  checkpoint is complete only after sign-off boxes are checked and milestone decisions are mirrored in `docs/roadmap-native.md` + `docs/TODO.md`.

## Mac Validation Acceptance Checklist

- [ ] Node.js runtime is `v22.x` on Mac validation machine.
- [ ] `npm run check` passes.
- [ ] `node --import tsx --test src/protocol.conformance.test.ts` passes.
- [ ] `node --import tsx --test src/server/ws-contract-matrix.test.ts src/server/bridge-server.policy.test.ts src/server/input-policy.test.ts` passes.
- [ ] `node --import tsx --test src/server/startup-validation.test.ts` passes.
- [ ] `node --import tsx --test src/control-plane/control-plane-client.test.ts src/net/proxy-agent-factory.test.ts src/net/proxy-router.test.ts` passes.
- [ ] `cd apps/ios/M0ProtocolMockClient && swift test` passes.
- [ ] `npm run test:ci:all` passes on Mac.
- [ ] Live smoke (kill switch off) passes: `COMMANDRELAY_INPUT_KILL_SWITCH=off npm run start` + `npm run bench:input -- --iterations 5`.
- [ ] Live smoke (kill switch on) blocks input: `COMMANDRELAY_INPUT_KILL_SWITCH=on npm run start` + `npm run bench:input -- --iterations 3` fails with input-disabled behavior.
- [ ] Nightly evidence captured: TAP artifacts + swift test log + short smoke summary.

## Home Pickup TODO

- [ ] Copy MCP template and set absolute paths: `cp mcp.example.json .mcp.json` then edit paths.
- [ ] Verify Chitragupta MCP starts with the workaround command from `docs/operations.md`.
- [ ] Run full gateway test pack: `npm run check && npm test && npm run test:ci:all`.
- [ ] Run replay-focused suites:
  - `node --import tsx --test src/bridge/bridge-engine.replay.test.ts`
  - `node --import tsx --test src/server/bridge-server.replay.e2e.test.ts`
- [ ] Run iOS transport tests:
  - `cd apps/ios/M0ProtocolMockClient && swift test --filter M0WebSocketTransportClientTests`
  - `swift test`
- [ ] Run Android parity module tests (requires Gradle wrapper or local Gradle):
  - `cd apps/android/M0ProtocolMockClient && ./gradlew test` (or `gradle test`)
- [ ] Run tmux fixture harness smoke:
  - `scripts/tmux-fixtures/create-fixture.sh --session fixture_smoke --panes 2`
  - `scripts/tmux-fixtures/emit-fixture-output.sh --session fixture_smoke --profile replay --cycles 5`
  - `scripts/tmux-fixtures/teardown-fixture.sh --session fixture_smoke`
- [ ] Run perf smoke benchmarks:
  - `npm run bench:connect -- --iterations 20`
  - `npm run bench:list -- --iterations 20`
  - `npm run bench:input -- --iterations 20`
- [ ] If all green, open/update PR notes with:
  - replay coverage results
  - iOS/Android local test results
  - perf summary (`p50/p95/p99`)

## Home-Mac Continuation Checklist

### Session Bootstrap (single owner)

- [ ] Confirm Node.js `v22.x` and clean install: `node -v && npm ci`.
- [ ] Confirm local MCP wiring and Chitragupta launch command from `docs/operations.md`.
- [ ] Start evidence log for this run (tests, perf, publish dry-run outputs).

### Parallel Track A: tmux Engine Follow-up

- [ ] Run replay/ordering suites:
  - `node --import tsx --test src/bridge/bridge-engine.replay.test.ts`
  - `node --import tsx --test src/server/bridge-server.replay.e2e.test.ts`
- [ ] Run tmux fixture harness:
  - `scripts/tmux-fixtures/create-fixture.sh --session fixture_smoke --panes 2`
  - `scripts/tmux-fixtures/emit-fixture-output.sh --session fixture_smoke --profile replay --cycles 5`
  - `scripts/tmux-fixtures/teardown-fixture.sh --session fixture_smoke`
- [ ] Run perf smoke (`connect`, `list`, `input`) with `--iterations 20`; record `p50/p95/p99`.
- [ ] Mark tmux track complete only when replay + fixture + perf evidence is captured.

### Parallel Track B: iOS Follow-up

- [ ] `cd apps/ios/M0ProtocolMockClient && swift test --filter M0WebSocketTransportClientTests`.
- [ ] `cd apps/ios/M0ProtocolMockClient && swift test`.
- [ ] Validate controlled-input safety behavior against gateway kill-switch on/off runs.
- [ ] Capture iOS evidence summary (pass/fail, flaky tests, retry count).

### Merge Gate (both tracks)

- [ ] Run full aggregate check: `npm run check && npm test && npm run test:ci:all`.
- [ ] Update `scripts/checkpoints/runs/2026-02-25-weekly-cross-platform-checkpoint.md` with outcomes.
- [ ] Update proxy release gate status in `docs/release/proxy-publish.md`.

## Proxy Package Release Gates (for internal v0.1 prep)

- [x] Gate 1: version readiness confirmed for each `@commandrelay/proxy-*` package (`@commandrelay/proxy-core@0.1.0`, `@commandrelay/proxy-agent@0.1.0`, `@commandrelay/proxy-http-client@0.1.0`).
- [ ] Gate 2: root/package `check`, `build`, `test` all green on Mac run.
  - Batch evidence (2026-02-25): TAP green in current environment (`root 14/14`, `proxy-core 1/1`, `proxy-agent 2/2`, `proxy-http-client 1/1`).
- [ ] Gate 3: publish workflow dry-run green with expected package selector and `dist_tag`.
  - Home Mac action: run `Publish Proxy Packages` with `mode=dry-run`, `package_selector=@commandrelay/proxy-*`, `dist_tag=latest`.
- [ ] Gate 4: `NPM_TOKEN` + `npm-publish` environment policy verified.
  - Home Mac action: verify `NPM_TOKEN` secret, `npm-publish` reviewers, and default-branch restrictions.
- [ ] Gate 5: release notes/changelog draft reviewed before any publish-mode trigger.
  - Home Mac action: append dry-run URL + artifact summary + go/no-go note.

## Internal v0.1 Tag Plan (proposal only; do not create tags yet)

- [ ] Step 1: complete tmux + iOS follow-up tracks and evidence capture.
- [ ] Step 2: run proxy publish dry-run gate review and resolve blockers.
- [ ] Step 3: freeze internal v0.1 candidate scope and finalize release notes draft.
- [ ] Step 4: run final go/no-go check (tests, perf, release gates, checkpoint sign-off).
- [ ] Step 5: if all gates stay green, prepare internal `v0.1` tag request in PR/release notes (no tag creation in this step).

## Proxy Ecosystem Expansion Backlog

Reference roadmap: `docs/proxy-ecosystem-roadmap.md`.

- [x] Harden current package line for external use (`@commandrelay/proxy-core`, `@commandrelay/proxy-agent`, `@commandrelay/proxy-http-client`) with reusable docs/assets/examples.
- [ ] Publish/validate adapter ecosystem package plan and naming contract (`@termina/proxy-*`).
- [ ] P1 package wave (active):
  - [x] `@termina/cli-proxy` (`packages/cli-proxy`, diagnostics CLI + JSON/human modes + tests/docs/assets completed on 2026-02-26)
  - [x] `@termina/proxy-undici` (`packages/proxy-undici`, check/build/test + docs/assets/examples complete on 2026-02-26)
  - [x] `@termina/proxy-fetch` (`packages/proxy-fetch`, fetch adapter + JSON/timeout/size guards + tests/docs/assets completed on 2026-02-26)
- [x] P1 exit criteria: `@termina/cli-proxy` + `@termina/proxy-fetch` both pass check/build/test and include README + NOTES + SVG branding assets.
- [ ] P2 package wave:
  - `@termina/proxy-axios`
  - `@termina/proxy-got`
  - `@termina/proxy-runtime`
- [ ] P3 exploration:
  - `@termina/proxy-ssh` (`ssh-proxy`) feasibility and threat model.
- [ ] External compatibility checks against ecosystem dependencies/counterparts:
  - `agent-base`
  - `data-uri-to-buffer`
  - `degenerator`
  - `get-uri`
  - `http-proxy-agent`
  - `https-proxy-agent`
  - `pac-proxy-agent`
  - `pac-resolver`
  - `proxy-agent`
  - `proxy`
  - `socks-proxy-agent`

## Research-Backed Next Wave (Home Pickup)

Reference notes: `docs/research-next-opportunities.md`.

- [ ] Cross-platform command safety contract:
  - shared `input` timeout/retry semantics for iOS, Android, macOS, and web fallback
  - shared telemetry keys for `enable_input` -> `input` -> `ack/error`
  - deterministic kill-switch and lane-conflict behavior across clients
- [ ] Multi-session UX + handoff model:
  - session switch rules while preserving read-only default
  - explicit takeover UX with owner visibility and confirmation
  - per-pane activity/audit indicators in native clients
- [ ] Reliability + SLO matrix:
  - reconnect success target, command RTT target, replay catch-up target
  - failover behavior when current writer disconnects mid-command
  - weekly checkpoint artifact includes SLO trend deltas
- [ ] Proxy family hardening gates (pre external publish):
  - mandatory benchmark budgets (latency, throughput, memory/socket growth)
  - dependency/license/SBOM/vulnerability gate in release flow
  - interoperability matrix for `fetch`, `undici`, `axios`, `got`, and CLI adapters
- [ ] Advanced transport exploration (feature-flagged):
  - evaluate QUIC/WebTransport lane for degraded-network resilience
  - compare against current WebSocket lane with controlled benchmark harness
  - adopt only if reliability and operability improve without security regression
- [ ] Remote-control trust model upgrades:
  - short-lived pairing via QR + signed challenge response
  - step-up confirmation for risky command classes
  - immutable command audit stream export for incident review

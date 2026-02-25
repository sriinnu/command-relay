# CommandRelay Execution TODO (Native-First)

Last updated: 2026-02-25
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

- [ ] Create Swift app shell (auth, session list, pane viewer).
- [ ] Implement WebSocket connection + reconnect with backoff.
- [ ] Implement pane attach, output render, replay resume.
- [ ] Add accessibility baseline (VoiceOver labels, dynamic type, focus order).
- [ ] Add telemetry for connect latency, reconnect count, stream lag.
- [ ] Exit criteria met:
- [ ] 30-minute stable stream under flaky network simulation.
- [ ] Crash-free rate >= 99% on TestFlight alpha cohort.

## M2 - iOS Beta (Controlled Input) (Target: 2026-04-24)

- [ ] Implement explicit `enable_input` UX with clear risk gate.
- [ ] Implement input send/ack path with timeout/error handling.
- [ ] Add safeguards: per-command length limits, rate limit feedback, kill switch handling.
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
- [ ] Exit criteria met:
- [ ] Works on modern mobile browsers as fallback only.

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

## Immediate Next Actions (This Week)

- [x] Create `v1` protocol contract tests in gateway repo.
- [x] Build iOS spike for WebSocket connect/list/attach/output (no input yet).
- [x] Define iOS screen map and navigation for three core flows.
- [x] Decide telemetry schema (connect time, replay time, input ack latency).
- [x] Implement weekly checkpoint workflow artifacts (`scripts/checkpoints/generate-weekly-checkpoint.sh` + template) and document tracking in `docs/roadmap-native.md`.
- [x] Wire the existing proxy stack into auth/pairing/telemetry outbound clients and add integration tests for `HTTP_PROXY`/`HTTPS_PROXY`/`ALL_PROXY`/`NO_PROXY`.

## Weekly Cross-Platform Checkpoint Runbook

- [x] Workflow script: `scripts/checkpoints/generate-weekly-checkpoint.sh`
- [x] Template: `scripts/checkpoints/templates/weekly-cross-platform-checkpoint.md`
- [ ] Weekly command:
  `scripts/checkpoints/generate-weekly-checkpoint.sh --date YYYY-MM-DD --facilitator "Owner Name"`
- [ ] Weekly artifact to track in git:
  `scripts/checkpoints/runs/YYYY-MM-DD-weekly-cross-platform-checkpoint.md`
- [ ] Post-sync tracking rule:
  checkpoint is complete only after sign-off boxes are checked and milestone decisions are mirrored in `docs/roadmap-native.md` + `TODO.md`.

## Tonight Test Acceptance Checklist (Mac Validation - 2026-02-24)

- [ ] Node.js runtime is `v22.x` on Mac validation machine.
- [ ] `npm run check` passes.
- [ ] `node --import tsx --test src/protocol.conformance.test.ts` passes.
- [ ] `node --import tsx --test src/server/ws-contract-matrix.test.ts src/server/bridge-server.policy.test.ts src/server/input-policy.test.ts` passes.
- [ ] `node --import tsx --test src/control-plane/control-plane-client.test.ts src/net/proxy-agent-factory.test.ts src/net/proxy-router.test.ts` passes.
- [ ] `cd apps/ios/M0ProtocolMockClient && swift test` passes.
- [ ] `npm run test:ci:all` passes on Mac.
- [ ] Manual smoke passes: auth -> list_sessions -> attach -> replay from `lastSeq` works; kill switch blocks input enable.
- [ ] Nightly evidence captured: TAP artifacts + swift test log + short smoke summary.

## Home Pickup TODO (MacBook Session - 2026-02-24 Night)

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

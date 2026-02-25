# CommandRelay Native-First Roadmap

Last updated: 2026-02-25
Execution order: iOS Swift app -> Android app -> web fallback.

## Goal

Ship reliable and safe remote terminal control on mobile first, with web as a contingency path rather than the primary product surface.

## Milestones

## M0 - Contract and Platform Baseline (2026-02-24 to 2026-03-13)

Deliverables:
1. Versioned protocol contract (`v1`) for all required events.
2. Replay and ordering guarantees documented and testable.
3. Security defaults locked: read-only by default, explicit input enable, global kill switch.

Acceptance criteria:
1. Contract tests pass for all required client and server events.
2. No unversioned protocol changes merged after milestone close.
3. Mobile clients can run against mocked gateway fixtures with zero schema errors.

Dependencies:
1. Gateway event schema ownership and review workflow.
2. Tailscale connectivity available in dev and staging.

Status snapshot (2026-02-24):
- [x] Protocol `v1` contract published with required events (`docs/protocol-v1.md`).
- [x] Replay and ordering rules documented (`streamSeq`, `attach(lastSeq)` replay behavior).
- [x] Read-only default, explicit input enable, and global kill switch enforcement are implemented and tested.
- [x] Gateway contract suites exist for protocol envelope and WebSocket event matrix.
- [x] CI Node 22 workflow enforces typecheck/test gates and uploads TAP artifacts.
- [ ] 7-day iOS mock-client schema drift burn-in still pending before M0 close.

## M1 - iOS Alpha (Read-Only Core) (2026-03-16 to 2026-04-03)

Deliverables:
1. Swift app with auth, session list, pane attach, output stream.
2. Reconnect with replay from `lastSeq`.
3. Accessibility baseline (labels, focus order, dynamic text).

Acceptance criteria:
1. 30 minutes continuous stream without manual reconnect.
2. Reconnect recovery under packet loss resumes without output gaps.
3. Crash-free sessions >= 99% in alpha cohort.

Dependencies:
1. Stable `v1` protocol from M0.
2. iOS test devices and TestFlight distribution.

## M2 - iOS Beta (Guarded Input) (2026-04-06 to 2026-04-24)

Deliverables:
1. Input enable/disable flow with explicit user intent.
2. Command send/ack timeout handling and user feedback.
3. Audit event visibility in client and backend logs.

Acceptance criteria:
1. Read-only remains default after reconnect/app restart.
2. Every input action includes pane target and timestamp in audit logs.
3. Kill switch immediately blocks new input attempts.

Dependencies:
1. Gateway audit pipeline.
2. Policy update events and real-time enforcement.

Status snapshot (2026-02-25):
- [x] Gateway controlled-input policy path is implemented and covered by contract/policy tests.
- [x] iOS controlled-input UX + transport baseline is implemented; Mac runtime validation is pending.
- [x] Current gateway semantics documented: pane-level input ownership arbitration with controlled takeover path.

## M3 - iOS GA (2026-04-27 to 2026-05-15)

Deliverables:
1. Reliability hardening for background/foreground and token refresh.
2. App Store readiness: compliance artifacts and support path.
3. Incident runbook for mobile and gateway failures.

Acceptance criteria:
1. 14-day beta period without Sev-1 regression.
2. Median input round-trip latency <= 250ms on private mesh.
3. Support docs cover auth, reconnect, and input safety controls.

Dependencies:
1. Observability dashboards and alerting thresholds.
2. Release automation for signed iOS builds.

## M4 - Android Buildout (2026-05-18 to 2026-06-12)

Deliverables:
1. Kotlin app with parity for auth/list/attach/replay.
2. Guarded input flow matching iOS policy and UX intent.
3. Device matrix validation for background behavior and network handoff.

Acceptance criteria:
1. Functional parity with iOS core features.
2. Same safety invariants enforced (read-only default, explicit input enable, kill switch).
3. Crash-free sessions >= 99% in beta cohort.

Dependencies:
1. Shared protocol conformance suite.
2. Google Play internal testing setup.

## M5 - Web Fallback (2026-06-15 to 2026-07-03)

Deliverables:
1. Minimal responsive web console for emergency access.
2. Read-only streaming primary, guarded input secondary.
3. Browser compatibility baseline for modern mobile and desktop.
4. Web control lane behavior documented and implemented on the same v1 envelope (`enable_input`/`input`/`disable_input`, lane conflict, explicit takeover).

Acceptance criteria:
1. Core fallback flows work on Chrome/Safari current versions.
2. Web remains explicitly non-primary in roadmap and release comms.
3. Multi-tab lane conflict and takeover behavior is validated against gateway fixtures and contract tests.

Dependencies:
1. Existing gateway + protocol stack from mobile milestones.
2. Basic frontend hosting and auth integration.
3. Shared parity matrix maintained across iOS and web control-lane flows.

## M6 - macOS Menu Bar + iOS/Web Parity Follow-Through (2026-07-06 to 2026-07-24)

Deliverables:
1. macOS menu bar companion surface for quick session attach and explicit input arm/disarm status.
2. Shared iOS/web control-lane parity matrix (connect/auth/attach/replay/enable/disable/input/conflict/takeover).
3. Regression fixture pack proving lane handoff between iOS and web clients on the same pane.

Acceptance criteria:
1. Menu bar flow can complete read-only attach and guarded input handoff without opening full app shell.
2. iOS and web clients pass the same control-lane fixture suite with no schema or policy drift.
3. Incident runbook includes menu bar + iOS/web handoff recovery procedure.

Dependencies:
1. Stable web fallback implementation from M5.
2. Existing iOS controlled-input baseline and telemetry wiring.
3. Gateway fixture harness for multi-client lane arbitration.

## Cross-Milestone Dependencies

1. Protocol governance: single owner for event schema changes.
2. Security controls: global input disable and per-session authorization.
3. Test strategy: mocked event fixtures + end-to-end tmux integration tests.
4. Observability: client crash reporting, gateway latency metrics, replay health.
5. Release operations: signed builds, staged rollout, rollback paths.
6. Multi-client operations: enforce single-writer tab/client runbook for shared panes.

## Key Risks

1. Protocol churn across milestones.
Mitigation: strict versioning and backward-compatible deprecation windows.
2. Unsafe command execution paths.
Mitigation: read-only default, explicit enable, rate/size limits, kill switch.
3. Mobile network instability causing stream gaps.
Mitigation: replay buffer SLAs, reconnect backoff tuning, chaos network tests.
4. Store approval and release timing slippage.
Mitigation: early internal track submissions and pre-review checklists.
5. Team focus drift to web too early.
Mitigation: enforce milestone gates; block web work before M4 exit.
6. Concurrent input from multiple clients on same pane.
Mitigation: operator handoff runbook (disable -> enable) and kill-switch emergency fallback.

## Immediate Next Actions (Next 10 Working Days)

1. Freeze and publish protocol `v1` schema and examples.
2. Implement gateway conformance tests for required events.
3. Start iOS spike: auth + session list + attach + output stream. (Completed 2026-02-25)
4. Define iOS UX copy for input safety and confirmation states.
5. Set SLOs for connect time, replay catch-up time, and input ack latency.
6. Run and commit the first scripted weekly cross-platform checkpoint artifact. (Completed 2026-02-25)
7. Publish web control-lane user flow addendum in protocol docs with conflict/takeover handling. (Completed 2026-02-25)
8. Draft macOS menu bar companion spec with lane state model and quick-action constraints.
9. Build iOS/web parity checklist for control-lane flows and map each row to tests/fixtures.
10. Add cross-client fixture scenarios for iOS-writer/web-takeover and web-writer/iOS-takeover.

## Weekly Cross-Platform Checkpoint Workflow

1. Run checkpoint generation before the weekly sync:
`scripts/checkpoints/generate-weekly-checkpoint.sh --date YYYY-MM-DD --facilitator "Owner Name"`.
2. Default output path is `scripts/checkpoints/runs/YYYY-MM-DD-weekly-cross-platform-checkpoint.md`.
3. During the sync, fill iOS, Android, web fallback, and shared gateway sections from the template.
4. Track completion by checking all `Sign-off` boxes in the generated checkpoint note.
5. Commit the checkpoint note in the same change that updates roadmap/TODO decisions for that week.
6. Use checkpoint ID format `YYYY-Www-YYYY-MM-DD` as the source-of-truth reference in review notes.

## Tonight Test Acceptance Checklist (Mac Validation - 2026-02-25)

- [ ] Node 22 is active on the Mac validation host (`node -v` reports `v22.x`).
- [ ] Root typecheck gate passes (`npm run check`).
- [ ] Protocol v1 conformance suite passes (`node --import tsx --test src/protocol.conformance.test.ts`).
- [ ] Gateway policy/contract suites pass (`node --import tsx --test src/server/ws-contract-matrix.test.ts src/server/bridge-server.policy.test.ts src/server/input-policy.test.ts`).
- [ ] Startup validation suite passes (`node --import tsx --test src/server/startup-validation.test.ts`).
- [ ] Proxy and outbound routing coverage passes (`node --import tsx --test src/control-plane/control-plane-client.test.ts src/net/proxy-agent-factory.test.ts src/net/proxy-router.test.ts`).
- [ ] iOS M0 mock contract package passes on Mac (`cd apps/ios/M0ProtocolMockClient && swift test`).
- [ ] CI parity run passes locally (`npm run test:ci:all`).
- [ ] Live smoke with kill switch off passes (`COMMANDRELAY_INPUT_KILL_SWITCH=off npm run start` + `npm run bench:input -- --iterations 5`).
- [ ] Live smoke with kill switch on blocks input (`COMMANDRELAY_INPUT_KILL_SWITCH=on npm run start` + `npm run bench:input -- --iterations 3` exits non-zero).
- [ ] Validation artifacts are captured (TAP logs + `swift test` output) and linked in nightly notes.

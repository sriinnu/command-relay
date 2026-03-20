# Home Pickup: Remaining TODOs (Branch Seed)

Last synced from `docs/TODO.md` on 2026-02-27.
Source of truth: `docs/TODO.md`.

## Progress Snapshot

- Done: `34`
- Open: `35`
- Total tracked: `69`
- Completion: `49.3%`

## Track A (SSH-First Product)

- [ ] Finalize SSH transport contract for connect/auth/list/attach/replay/input/ack/error with explicit reconnect semantics.
- [ ] Specify host identity + trust model (host key verification mode, fingerprint surfacing, rotation handling).
- [ ] Lock protocol compatibility matrix for SSH transport and existing WebSocket transport.
- [ ] Add transport conformance tests covering attach/replay resume, reconnect with `lastSeq`, lane conflict/takeover, kill-switch enforcement.
- [ ] Make host runtime authoritative for session metadata, lane owner, replay offsets, and capability flags.
- [ ] Keep one interaction model across iOS/web/macOS menu bar.
- [ ] Complete parity checklist for connect/auth/list/attach/replay/enable/disable/input/conflict/takeover.
- [ ] Finish accessibility baseline in active clients.
- [ ] 7-day stability window with no Sev-1 SSH transport regressions in checkpoint evidence.
- [ ] 30-minute flaky-network stream test passes with replay correctness.
- [ ] Controlled input remains opt-in on every reconnect path.
- [ ] Full parity checklist is green across active clients.
- [ ] On-call incident/runbook document is complete and reviewed.

## Track B (Proxy Ecosystem)

- [ ] Complete API stability review and public surface lock for v0.1.
- [ ] Confirm publish workflow dry-run path with selector and dist-tag policy (currently partial; blocked env rerun needed).
- [ ] Validate npm publish governance (`NPM_TOKEN`, environment reviewers, branch protections) with in-repo evidence.
- [ ] P2 hardening wave (`@commandrelay/proxy-axios`, `@commandrelay/proxy-got`, `@commandrelay/proxy-runtime`).
- [ ] P3 exploration gate (`@commandrelay/proxy-ssh` feasibility + threat model + go/no-go doc).
- [ ] Gate 1: version and changelog readiness confirmed for all release candidates.
- [ ] Gate 2: `check/build/test` green on designated Mac validation environment.
- [ ] Gate 3: publish dry-run green with expected selector + dist-tag.
- [ ] Gate 4: release notes and rollback notes approved before publish-mode is allowed.
- [ ] Gate 5: support/troubleshooting docs linked from package READMEs.

## Near-Term P2 Execution Lane

- [ ] Complete remaining parity matrix items including menu bar handoff cases.
- [ ] Complete observability dashboard baseline and alert thresholds.
- [ ] Finalize release-notes template for combined SSH-first + proxy hardening increment.

## Retained Risks/Dependencies Still Open

- [ ] Stable private network path for low-friction host connectivity (Tailscale or equivalent).
- [ ] Test environments: tmux fixtures + replay data kept fresh.
- [ ] Observability stack completion (logs, metrics, crash reporting).
- [ ] Risk: transport/protocol churn slows clients.
- [ ] Mitigation: versioned contract + conformance suite as release gate.
- [ ] Risk: accidental destructive commands.
- [ ] Mitigation: read-only default, explicit input enable, kill switch, audit trail.
- [ ] Risk: reconnect instability under poor networks.
- [ ] Mitigation: replay chaos tests + soak checkpoints + backoff tuning.

## Suggested First Home Session Pull

1. Close Track B publish blockers (`dry-run` env + governance evidence).
2. Lock Track A transport contract/matrix/conformance tests.
3. Run parity/accessibility pass for active clients.

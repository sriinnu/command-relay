# Research-Backed Next Opportunities

Last updated: 2026-02-25

This document captures high-impact next capabilities for CommandRelay and the `@commandrelay/*` proxy package family.

## Objectives

1. Improve remote-control reliability for long idle windows and unstable links.
2. Keep bi-directional command execution safe by default across all clients.
3. Harden proxy packages for external reuse and production publishing.
4. Prioritize changes with measurable performance, security, and operability outcomes.

## Opportunity Map

### 1) Unified Cross-Client Command Safety Contract

Current behavior is implemented, but policy details are spread across platform docs.

Next additions:

1. One shared contract for `enable_input`, `input`, `ack`, `error`, `disable_input`, and kill-switch outcomes.
2. One timeout/retry matrix for iOS, Android, macOS menu bar, and web fallback.
3. One telemetry schema for command lifecycle (send, ack/error, timeout, ownership conflict).

Expected impact:

1. Lower cross-platform drift and fewer incident surprises.
2. Faster debugging when ownership conflicts or kill-switch events occur.

### 2) Multi-Session UX and Writer Handoff Model

Current flows are mostly single-session focused.

Next additions:

1. Shared pane/session state machine (`read-only`, `writer-armed`, `writer-active`, `conflict`, `blocked`).
2. Explicit ownership handoff rules for multi-client environments.
3. Native UI affordances for active writer identity, pending takeover, and audit breadcrumbs.

Expected impact:

1. Safer concurrent operations from iOS/macOS/web.
2. Better operator confidence during handoffs across devices.

### 3) Reliability + SLO Program

Current tests are strong, but release gates need direct SLO budgets.

Next additions:

1. SLOs for reconnect success, stream continuity, command round-trip latency, and replay catch-up.
2. Weekly checkpoint automation that records p50/p95/p99 deltas.
3. Failure-class taxonomy shared across all clients and server runtime.

Expected impact:

1. Earlier regression detection.
2. Better go/no-go decisions for mobile and proxy releases.

### 4) Proxy Ecosystem Externalization Hardening

Current package baseline is production-ready, but external adoption requires stricter gates.

Next additions:

1. Adapter interoperability matrix:
   - `fetch`, `undici`, `axios`, `got`, CLI.
2. Security and supply-chain gates:
   - dependency vulnerability scans
   - license review
   - SBOM artifact generation
3. Performance budgets and regression alarms:
   - resolver latency
   - request throughput
   - memory/socket growth under churn

Expected impact:

1. Trustworthy `@commandrelay/proxy-*` adoption in other repos.
2. Faster support/debug for external users.

### 5) Advanced Transport Exploration (Flagged)

Explore a transport lane alternative only behind a feature flag.

Next additions:

1. Evaluate QUIC/WebTransport for degraded networks and roaming clients.
2. Run side-by-side benchmark against current WebSocket lane.
3. Keep protocol envelope parity and strict fallback path.

Expected impact:

1. Potential resilience gains on lossy networks.
2. Clear data-driven decision on transport roadmap.

### 6) Trust Model Enhancements for Remote Control

Next additions:

1. Short-lived device pairing via QR + signed challenge response.
2. Step-up confirmation for risky command classes.
3. Immutable command audit export for review and incident response.

Expected impact:

1. Stronger safety for long unattended sessions.
2. Better forensic visibility for remote operations.

## Suggested Delivery Waves

1. Wave A (near-term): command safety contract + multi-session UX state model + SLO schema.
2. Wave B: proxy interoperability matrix + security/compliance release gates.
3. Wave C: transport experiments and trust-model upgrades under feature flags.

## References

1. CommandRelay internal docs:
   - `docs/proxy-agent-research.md`
   - `docs/proxy-ecosystem-roadmap.md`
   - `docs/control-lane-parity-checklist.md`
   - `docs/macos-menu-bar-control-lane-spec.md`
2. Proxy ecosystem baseline:
   - https://github.com/TooTallNate/proxy-agents
3. Protocol/security standards:
   - RFC 9110: https://www.rfc-editor.org/rfc/rfc9110
   - RFC 7230: https://www.rfc-editor.org/rfc/rfc7230
   - RFC 1928: https://www.rfc-editor.org/rfc/rfc1928
   - RFC 9000: https://www.rfc-editor.org/rfc/rfc9000
4. Security guidance:
   - OWASP SSRF Prevention Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html
5. Research papers already used in this repo:
   - Formal Analysis of the API Proxy Problem: https://arxiv.org/abs/2302.13525
   - Fuzzing Frameworks for Server-side Web Applications: https://arxiv.org/pdf/2406.03208
   - Early Detection of Performance Regressions: https://arxiv.org/pdf/2408.08148

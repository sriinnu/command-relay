# Proxy Ecosystem Roadmap

Last updated: 2026-03-04

This roadmap expands `@commandrelay/proxy-*` for external reuse in other projects (`commandrelay/*`, proxy-agents-style stacks, service SDKs).

## Design Goals

1. Keep transport policy in one place (`proxy-core`).
2. Keep adapters thin and framework-specific (`proxy-<transport>`).
3. Keep hardening/security defaults explicit and testable.
4. Publish packages so they are reusable outside this repo with stable root exports.

## Current Published/Ready Set

| Package | Status | Purpose |
| --- | --- | --- |
| `@commandrelay/proxy-core` | Ready | Env parsing + routing decision (`HTTP_PROXY`/`HTTPS_PROXY`/`ALL_PROXY`/`NO_PROXY`). |
| `@commandrelay/proxy-agent` | Ready | Node agent resolution for `http/https/socks/pac` with cache + lifecycle controls. |
| `@commandrelay/proxy-http-client` | Ready | JSON HTTP boundary with timeouts, size guards, typed errors, and proxy resolver support. |
| `@commandrelay/proxy-fetch` | Ready (internal) | Fetch adapter helper with proxy-aware request composition. |
| `@commandrelay/proxy-undici` | Ready (internal) | Undici dispatcher resolution for HTTP/HTTPS targets with cache + lifecycle controls. |
| `@commandrelay/proxy-axios` | Created (internal) | Axios adapter helper + resolver for proxy-aware config wiring. |
| `@commandrelay/proxy-got` | Created (internal) | Got adapter helper + resolver for protocol-scoped agent wiring. |
| `@commandrelay/proxy-runtime` | Created (internal) | Runtime controller for settings rotation, metadata, and lifecycle. |

## Ecosystem Expansion Matrix

The following matrix maps the user-requested package family and next candidates.

| Package | Role | Planned Namespace | Priority |
| --- | --- | --- | --- |
| `agent-base` | Shared agent abstraction helper | external dependency | P1 |
| `data-uri-to-buffer` | Parse PAC/data-URI assets | external dependency | P2 |
| `degenerator` | PAC/runtime transform support | external dependency | P2 |
| `get-uri` | URI retrieval backend | external dependency | P2 |
| `http-proxy-agent` | HTTP proxy agent | external dependency | P0 |
| `https-proxy-agent` | HTTPS proxy agent | external dependency | P0 |
| `socks-proxy-agent` | SOCKS proxy agent | external dependency | P0 |
| `pac-proxy-agent` | PAC proxy agent | external dependency | P0 |
| `pac-resolver` | PAC resolution runtime | external dependency | P2 |
| `proxy-agent` | auto protocol resolver | external dependency + compatibility target | P1 |
| `proxy` | generic proxy utility surface | `@commandrelay/proxy-runtime` (created) | P2 |
| `cli-proxy` | operator CLI for proxy diagnostics (internal ready) | `@commandrelay/cli-proxy` | P1 |
| `ssh-proxy` | SSH tunnel proxy transport | `@commandrelay/proxy-ssh` | P3 |
| `@commandrelay/proxy-undici` | Undici dispatcher adapter (internal ready) | internal new package | P1 |
| `@commandrelay/proxy-fetch` | Fetch adapter (internal ready) | internal new package | P1 |
| `@commandrelay/proxy-got` | Got adapter | internal new package (created) | P2 |
| `@commandrelay/proxy-axios` | Axios adapter | internal new package (created) | P2 |
| `@commandrelay/proxy-runtime` | Runtime controller wrapper | internal new package (created) | P2 |

Priority scale:
- `P0`: already in critical path / shipped dependency.
- `P1`: next batch for broad external adoption.
- `P2`: useful adapter/runtime expansion after P1.
- `P3`: exploratory/advanced.

## P1 Progress Snapshot (2026-02-26)

1. `@commandrelay/proxy-undici`: complete and internally ready.
2. `@commandrelay/cli-proxy`: complete and internally ready.
3. `@commandrelay/proxy-fetch`: complete and internally ready.
4. `P2` package creation is complete (`proxy-axios`, `proxy-got`, `proxy-runtime`) and is now in hardening/release-gate evidence mode.

## P2 Creation Snapshot (2026-03-04)

1. `@commandrelay/proxy-axios`: package scaffold + docs/examples + tests are present in repo.
2. `@commandrelay/proxy-got`: package scaffold + docs/examples + tests are present in repo.
3. `@commandrelay/proxy-runtime`: package scaffold + docs/examples + tests are present in repo.
4. Release readiness remains gate-bound: Mac validation and approval artifacts are still open in Track B runbooks/checklists.

## Milestone Decision Mirror 2026-02-27 CR-P1-002

This section mirrors the 2026-02-27 weekly evidence-lane decisions into the proxy roadmap without claiming blocked execution steps as complete.

| Decision | Date | Status | Evidence | Blocker/Next Step |
| --- | --- | --- | --- | --- |
| W2 Track B docs/examples pack for `@commandrelay/proxy-*` remains complete. | 2026-02-27 | `done` | [TODO B2 status](./TODO.md#b2-productization-readiness), [package docs coverage matrix](./proxy/package-docs-matrix.md) | Maintain coverage as package APIs change. |
| W2 publish dry-run evidence contains selector + dist-tag, but remains blocked from clean dry-run success. | 2026-02-27 | `partial` | [2026-02-27 proxy publish local dry-run checkpoint](../scripts/checkpoints/runs/2026-02-27-proxy-publish-dry-run.md), [TODO W2 acceptance status](./TODO.md#milestone-w2-2026-03-09-to-2026-03-15) | Clear local npm cache ownership issue (`EACCES`) and rerun `npm pack/publish --dry-run` artifact capture. |
| W2 replay-ordering acceptance is now proven by a fixture-harness pass artifact. | 2026-02-27 | `done` | [2026-02-27 fixture harness evidence run](../scripts/checkpoints/runs/2026-02-27-a2-tmux-fixture-harness-evidence.md), [tmux fixture runbook](../scripts/tmux-fixtures/README.md), [TODO W2 acceptance status](./TODO.md#milestone-w2-2026-03-09-to-2026-03-15) | Keep run in weekly checkpoint rotation and alert on assertion regressions. |
| CR-P1-002 docs synchronization is complete for this cycle. | 2026-02-27 | `done` | [CR-P1-002 ticket status](./execution-owned-tickets.md#cr-p1-002-update-weekly-checkpoint--mirror-milestone-decisions), [2026-02-27 weekly evidence lane artifact](../scripts/checkpoints/runs/2026-02-27-cr-p1-002-weekly-evidence-lane.md) | Re-open next cycle if milestones change. |

## Package Discovery and Use Strategy

1. Start with `@commandrelay/proxy-core` for environment parsing and route decisions.
2. Add only one adapter layer per caller runtime:
   - Node agent clients: `@commandrelay/proxy-agent`
   - Undici clients: `@commandrelay/proxy-undici`
   - Fetch clients: `@commandrelay/proxy-fetch`
   - Operator diagnostics CLI: `@commandrelay/cli-proxy`
3. Use `@commandrelay/proxy-http-client` only when you need the guarded JSON boundary (typed errors, timeouts, body limits).
4. Keep integrations on root exports only and avoid stacking multiple adapter packages in the same call path.

## Proposed Build Order

1. Stabilize current 3-package line (`proxy-core`, `proxy-agent`, `proxy-http-client`) and publish `0.1.x`.
2. Keep `@commandrelay/proxy-undici` as the completed reference adapter for P1.
3. Complete P2 package creation for `@commandrelay/proxy-axios`, `@commandrelay/proxy-got`, and `@commandrelay/proxy-runtime`.
4. Harden P2 adapters/runtime with conformance evidence and release-gate checklist coverage.
5. Evaluate `@commandrelay/proxy-ssh` feasibility after runtime telemetry and threat model review.

## Security and Hardening Baseline

Every package in this family should pass the same baseline gates:

1. Strictly bounded request/response memory behavior.
2. Explicit lifecycle controls (`destroy`/`dispose`) for network resources.
3. No deep-import dependency in public docs.
4. Typed, documented error surface for boundary failures.
5. Root export-only API policy and CI consumer smoke verification.
6. Protocol and environment regression tests (`HTTP_PROXY`/`HTTPS_PROXY`/`ALL_PROXY`/`NO_PROXY`).

## Release Criteria for New Packages

1. `check/build/test` green in workspace and standalone consumer smoke.
2. README + NOTES + SVG branding + adapter example before first publish.
3. Security notes include credential redaction guidance and trust-boundary caveats.
4. Minimum one integration fixture proving behavior with a real client adapter.

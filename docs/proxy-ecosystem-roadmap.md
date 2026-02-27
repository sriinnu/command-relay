# Proxy Ecosystem Roadmap

Last updated: 2026-02-27

This roadmap expands `@commandrelay/proxy-*` for external reuse in other projects (`termina/*`, proxy-agents-style stacks, service SDKs).

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
| `@termina/proxy-undici` | Ready (internal) | Undici dispatcher resolution for HTTP/HTTPS targets with cache + lifecycle controls. |

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
| `proxy` | generic proxy utility surface | `@termina/proxy-runtime` candidate | P2 |
| `cli-proxy` | operator CLI for proxy diagnostics (internal ready) | `@termina/cli-proxy` | P1 |
| `ssh-proxy` | SSH tunnel proxy transport | `@termina/proxy-ssh` | P3 |
| `@termina/proxy-undici` | Undici dispatcher adapter (internal ready) | internal new package | P1 |
| `@termina/proxy-fetch` | Fetch adapter (internal ready) | internal new package | P1 |
| `@termina/proxy-got` | Got adapter | internal new package | P2 |
| `@termina/proxy-axios` | Axios adapter | internal new package | P2 |

Priority scale:
- `P0`: already in critical path / shipped dependency.
- `P1`: next batch for broad external adoption.
- `P2`: useful adapter/runtime expansion after P1.
- `P3`: exploratory/advanced.

## P1 Progress Snapshot (2026-02-26)

1. `@termina/proxy-undici`: complete and internally ready.
2. `@termina/cli-proxy`: complete and internally ready.
3. `@termina/proxy-fetch`: complete and internally ready.
4. `P2` can proceed (`proxy-axios`, `proxy-got`) once publish/release gates are cleared.

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
   - Undici clients: `@termina/proxy-undici`
   - Fetch clients: `@termina/proxy-fetch`
   - Operator diagnostics CLI: `@termina/cli-proxy`
3. Use `@commandrelay/proxy-http-client` only when you need the guarded JSON boundary (typed errors, timeouts, body limits).
4. Keep integrations on root exports only and avoid stacking multiple adapter packages in the same call path.

## Proposed Build Order

1. Stabilize current 3-package line (`proxy-core`, `proxy-agent`, `proxy-http-client`) and publish `0.1.x`.
2. Keep `@termina/proxy-undici` as the completed reference adapter for P1.
3. Start P2 adapters: `@termina/proxy-axios` and `@termina/proxy-got` based on adoption demand.
4. Add optional `@termina/proxy-runtime` (refresh hooks, metrics, structured diagnostics).
5. Evaluate `@termina/proxy-ssh` feasibility after runtime telemetry and threat model review.

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

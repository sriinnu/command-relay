# Proxy Ecosystem Roadmap

Last updated: 2026-02-25

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
| `cli-proxy` | operator CLI for proxy diagnostics | `@termina/cli-proxy` | P1 |
| `ssh-proxy` | SSH tunnel proxy transport | `@termina/proxy-ssh` | P3 |
| `@termina/proxy-undici` | Undici dispatcher adapter | internal new package | P1 |
| `@termina/proxy-fetch` | Fetch adapter | internal new package | P1 |
| `@termina/proxy-got` | Got adapter | internal new package | P2 |
| `@termina/proxy-axios` | Axios adapter | internal new package | P2 |

Priority scale:
- `P0`: already in critical path / shipped dependency.
- `P1`: next batch for broad external adoption.
- `P2`: useful adapter/runtime expansion after P1.
- `P3`: exploratory/advanced.

## Proposed Build Order

1. Stabilize current 3-package line (`proxy-core`, `proxy-agent`, `proxy-http-client`) and publish `0.1.x`.
2. Add `@termina/cli-proxy` diagnostics package (env dump, route explain, test target command).
3. Add `@termina/proxy-undici` and `@termina/proxy-fetch` as first adapter line.
4. Add `@termina/proxy-axios` and `@termina/proxy-got` based on adoption demand.
5. Add optional `@termina/proxy-runtime` (refresh hooks, metrics, structured diagnostics).
6. Evaluate `@termina/proxy-ssh` feasibility after runtime telemetry and threat model review.

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

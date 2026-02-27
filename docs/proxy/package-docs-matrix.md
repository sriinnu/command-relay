# Proxy Package Docs Coverage Matrix (B2 Evidence)

Last reviewed: 2026-02-27
Scope: `packages/*` proxy ecosystem documentation coverage for B2 productization checks.

## Criteria

- `README usage matrix`: README should provide explicit usage mapping across supported integration modes.
- `NOTES + migration/compat/troubleshooting`: package docs should include integration notes plus migration/compatibility and troubleshooting guidance.
- `Runnable examples + expected output snapshots`: examples should be executable and include expected output/result snapshots.

## Per-Package Coverage

| Package | README usage matrix | NOTES + migration/compat/troubleshooting | Runnable examples + expected output snapshots | Evidence | Remaining gaps |
| --- | --- | --- | --- | --- | --- |
| `@termina/cli-proxy` | `done` | `done` | `done` | [README usage matrix](../../packages/cli-proxy/README.md#usage-matrix), [README migration](../../packages/cli-proxy/README.md#migration), [README troubleshooting](../../packages/cli-proxy/README.md#troubleshooting), [NOTES](../../packages/cli-proxy/NOTES.md), [examples index](../../packages/cli-proxy/docs/examples/README.md), [env human snapshot](../../packages/cli-proxy/docs/examples/snapshots/env.human.expected.txt) | None. |
| `@commandrelay/proxy-agent` | `done` | `done` | `done` | [README usage matrix](../../packages/proxy-agent/README.md#usage-matrix), [README migration/compat](../../packages/proxy-agent/README.md#migration-and-compatibility), [README troubleshooting](../../packages/proxy-agent/README.md#troubleshooting), [NOTES](../../packages/proxy-agent/NOTES.md), [examples index](../../packages/proxy-agent/docs/examples/README.md), [axios snapshot](../../packages/proxy-agent/docs/examples/snapshots/axios.expected.json), [undici snapshot](../../packages/proxy-agent/docs/examples/snapshots/undici.expected.json), [got snapshot](../../packages/proxy-agent/docs/examples/snapshots/got.expected.json), [fetch snapshot](../../packages/proxy-agent/docs/examples/snapshots/fetch.expected.json) | None. |
| `@commandrelay/proxy-core` | `done` | `done` | `done` | [README usage matrix](../../packages/proxy-core/README.md#usage-matrix), [README migration/compat](../../packages/proxy-core/README.md#migration-and-compatibility), [README troubleshooting](../../packages/proxy-core/README.md#troubleshooting), [NOTES](../../packages/proxy-core/NOTES.md), [examples index](../../packages/proxy-core/docs/examples/README.md), [settings snapshot](../../packages/proxy-core/docs/examples/snapshots/settings.expected.json), [resolve snapshot](../../packages/proxy-core/docs/examples/snapshots/resolve.expected.json) | None. |
| `@termina/proxy-fetch` | `done` | `done` | `done` | [README usage matrix](../../packages/proxy-fetch/README.md#usage-matrix), [README migration](../../packages/proxy-fetch/README.md#migration), [README troubleshooting](../../packages/proxy-fetch/README.md#troubleshooting), [NOTES](../../packages/proxy-fetch/NOTES.md), [examples index](../../packages/proxy-fetch/docs/examples/README.md), [one-shot snapshot](../../packages/proxy-fetch/docs/examples/snapshots/one-shot.expected.json), [client snapshot](../../packages/proxy-fetch/docs/examples/snapshots/client.expected.json) | None. |
| `@commandrelay/proxy-http-client` | `done` | `done` | `done` | [README usage matrix](../../packages/proxy-http-client/README.md#usage-matrix), [README migration/compat](../../packages/proxy-http-client/README.md#migration-and-compatibility), [README troubleshooting](../../packages/proxy-http-client/README.md#troubleshooting), [NOTES](../../packages/proxy-http-client/NOTES.md), [examples index](../../packages/proxy-http-client/docs/examples/README.md), [axios snapshot](../../packages/proxy-http-client/docs/examples/snapshots/axios.expected.json), [undici snapshot](../../packages/proxy-http-client/docs/examples/snapshots/undici.expected.json), [got snapshot](../../packages/proxy-http-client/docs/examples/snapshots/got.expected.json), [fetch snapshot](../../packages/proxy-http-client/docs/examples/snapshots/fetch.expected.json) | None. |
| `@termina/proxy-undici` | `done` | `done` | `done` | [README usage matrix](../../packages/proxy-undici/README.md#usage-matrix), [README migration](../../packages/proxy-undici/README.md#migration), [README troubleshooting](../../packages/proxy-undici/README.md#troubleshooting), [NOTES](../../packages/proxy-undici/NOTES.md), [examples index](../../packages/proxy-undici/docs/examples/README.md), [request snapshot](../../packages/proxy-undici/docs/examples/snapshots/request.expected.json), [fetch snapshot](../../packages/proxy-undici/docs/examples/snapshots/fetch.expected.json) | None. |

## B2 Decision Inputs

- B2 docs-pack status: `done` (all six packages include README usage matrix, NOTES, migration/compatibility guidance, and troubleshooting guidance).
- B2 runnable-examples status: `done` (all six packages include runnable examples with expected output snapshots in package example docs).
- Evidence above is limited to repository files and now reflects the latest package doc/example snapshot updates.

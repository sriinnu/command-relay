# 2026-04-10 Proxy Publish Local Dry-Run Checkpoint

## Scope

- Branch: `feat/durable-run-hardening-branding`
- Commit: `f257481`
- Selector: `@commandrelay/proxy-*,@commandrelay/relay-proxy,@commandrelay/proxy-*`
- Dist-tag: `latest`
- Mode: local CLI dry-run evidence (`npm pack --dry-run --json`, `npm publish --dry-run`)
- Publish safety: dry-run only, no registry mutation

## Environment

- `pwd`: `/Users/srinivaspendela/Sriinnu/Personal/command-relay`
- `node -v`: `v25.8.1`
- `npm -v`: `11.11.0`
- cache strategy: scoped npm cache under `artifacts/2026-04-10-proxy-publish-dry-run/.npm-cache`
- root TAP evidence: `generated`
- root TAP file: [root TAP](../../../artifacts/tap-local/root.tap)

## Selected Packages

1. `@commandrelay/relay-proxy@0.1.0`
2. `@commandrelay/proxy-agent@0.1.0`
3. `@commandrelay/proxy-axios@0.1.0`
4. `@commandrelay/proxy-core@0.1.0`
5. `@commandrelay/proxy-fetch@0.1.0`
6. `@commandrelay/proxy-got@0.1.0`
7. `@commandrelay/proxy-http-client@0.1.0`
8. `@commandrelay/proxy-runtime@0.1.0`
9. `@commandrelay/proxy-undici@0.1.0`

## Validation Results

| Package | `check` | `build` | `test` |
| --- | --- | --- | --- |
| `@commandrelay/relay-proxy` | pass | pass | pass |
| `@commandrelay/proxy-agent` | pass | pass | pass |
| `@commandrelay/proxy-axios` | pass | pass | pass |
| `@commandrelay/proxy-core` | pass | pass | pass |
| `@commandrelay/proxy-fetch` | pass | pass | pass |
| `@commandrelay/proxy-got` | pass | pass | pass |
| `@commandrelay/proxy-http-client` | pass | pass | pass |
| `@commandrelay/proxy-runtime` | pass | pass | pass |
| `@commandrelay/proxy-undici` | pass | pass | pass |

Validation logs:

- `commandrelay-relay-proxy`: [check](../../../artifacts/2026-04-10-proxy-publish-dry-run/commandrelay-relay-proxy-check.log), [build](../../../artifacts/2026-04-10-proxy-publish-dry-run/commandrelay-relay-proxy-build.log), [test](../../../artifacts/2026-04-10-proxy-publish-dry-run/commandrelay-relay-proxy-test.log)
- `proxy-agent`: [check](../../../artifacts/2026-04-10-proxy-publish-dry-run/proxy-agent-check.log), [build](../../../artifacts/2026-04-10-proxy-publish-dry-run/proxy-agent-build.log), [test](../../../artifacts/2026-04-10-proxy-publish-dry-run/proxy-agent-test.log)
- `proxy-axios`: [check](../../../artifacts/2026-04-10-proxy-publish-dry-run/proxy-axios-check.log), [build](../../../artifacts/2026-04-10-proxy-publish-dry-run/proxy-axios-build.log), [test](../../../artifacts/2026-04-10-proxy-publish-dry-run/proxy-axios-test.log)
- `proxy-core`: [check](../../../artifacts/2026-04-10-proxy-publish-dry-run/proxy-core-check.log), [build](../../../artifacts/2026-04-10-proxy-publish-dry-run/proxy-core-build.log), [test](../../../artifacts/2026-04-10-proxy-publish-dry-run/proxy-core-test.log)
- `proxy-fetch`: [check](../../../artifacts/2026-04-10-proxy-publish-dry-run/proxy-fetch-check.log), [build](../../../artifacts/2026-04-10-proxy-publish-dry-run/proxy-fetch-build.log), [test](../../../artifacts/2026-04-10-proxy-publish-dry-run/proxy-fetch-test.log)
- `proxy-got`: [check](../../../artifacts/2026-04-10-proxy-publish-dry-run/proxy-got-check.log), [build](../../../artifacts/2026-04-10-proxy-publish-dry-run/proxy-got-build.log), [test](../../../artifacts/2026-04-10-proxy-publish-dry-run/proxy-got-test.log)
- `proxy-http-client`: [check](../../../artifacts/2026-04-10-proxy-publish-dry-run/proxy-http-client-check.log), [build](../../../artifacts/2026-04-10-proxy-publish-dry-run/proxy-http-client-build.log), [test](../../../artifacts/2026-04-10-proxy-publish-dry-run/proxy-http-client-test.log)
- `proxy-runtime`: [check](../../../artifacts/2026-04-10-proxy-publish-dry-run/proxy-runtime-check.log), [build](../../../artifacts/2026-04-10-proxy-publish-dry-run/proxy-runtime-build.log), [test](../../../artifacts/2026-04-10-proxy-publish-dry-run/proxy-runtime-test.log)
- `proxy-undici`: [check](../../../artifacts/2026-04-10-proxy-publish-dry-run/proxy-undici-check.log), [build](../../../artifacts/2026-04-10-proxy-publish-dry-run/proxy-undici-build.log), [test](../../../artifacts/2026-04-10-proxy-publish-dry-run/proxy-undici-test.log)

## Pack Dry-Run Results

- `@commandrelay/relay-proxy@0.1.0`: [pack JSON](../../../artifacts/2026-04-10-proxy-publish-dry-run/commandrelay-relay-proxy-pack-dry-run.json), tarball `commandrelay-relay-proxy-0.1.0.tgz`, `entryCount=12`
- `@commandrelay/proxy-agent@0.1.0`: [pack JSON](../../../artifacts/2026-04-10-proxy-publish-dry-run/proxy-agent-pack-dry-run.json), tarball `commandrelay-proxy-agent-0.1.0.tgz`, `entryCount=19`
- `@commandrelay/proxy-axios@0.1.0`: [pack JSON](../../../artifacts/2026-04-10-proxy-publish-dry-run/proxy-axios-pack-dry-run.json), tarball `commandrelay-proxy-axios-0.1.0.tgz`, `entryCount=25`
- `@commandrelay/proxy-core@0.1.0`: [pack JSON](../../../artifacts/2026-04-10-proxy-publish-dry-run/proxy-core-pack-dry-run.json), tarball `commandrelay-proxy-core-0.1.0.tgz`, `entryCount=7`
- `@commandrelay/proxy-fetch@0.1.0`: [pack JSON](../../../artifacts/2026-04-10-proxy-publish-dry-run/proxy-fetch-pack-dry-run.json), tarball `commandrelay-proxy-fetch-0.1.0.tgz`, `entryCount=31`
- `@commandrelay/proxy-got@0.1.0`: [pack JSON](../../../artifacts/2026-04-10-proxy-publish-dry-run/proxy-got-pack-dry-run.json), tarball `commandrelay-proxy-got-0.1.0.tgz`, `entryCount=28`
- `@commandrelay/proxy-http-client@0.1.0`: [pack JSON](../../../artifacts/2026-04-10-proxy-publish-dry-run/proxy-http-client-pack-dry-run.json), tarball `commandrelay-proxy-http-client-0.1.0.tgz`, `entryCount=10`
- `@commandrelay/proxy-runtime@0.1.0`: [pack JSON](../../../artifacts/2026-04-10-proxy-publish-dry-run/proxy-runtime-pack-dry-run.json), tarball `commandrelay-proxy-runtime-0.1.0.tgz`, `entryCount=25`
- `@commandrelay/proxy-undici@0.1.0`: [pack JSON](../../../artifacts/2026-04-10-proxy-publish-dry-run/proxy-undici-pack-dry-run.json), tarball `commandrelay-proxy-undici-0.1.0.tgz`, `entryCount=19`

## Publish Dry-Run Results

All selected packages completed `npm publish --dry-run --access public --tag latest` successfully.

- `commandrelay-relay-proxy`: [publish log](../../../artifacts/2026-04-10-proxy-publish-dry-run/commandrelay-relay-proxy-publish-dry-run.log)
- `proxy-agent`: [publish log](../../../artifacts/2026-04-10-proxy-publish-dry-run/proxy-agent-publish-dry-run.log)
- `proxy-axios`: [publish log](../../../artifacts/2026-04-10-proxy-publish-dry-run/proxy-axios-publish-dry-run.log)
- `proxy-core`: [publish log](../../../artifacts/2026-04-10-proxy-publish-dry-run/proxy-core-publish-dry-run.log)
- `proxy-fetch`: [publish log](../../../artifacts/2026-04-10-proxy-publish-dry-run/proxy-fetch-publish-dry-run.log)
- `proxy-got`: [publish log](../../../artifacts/2026-04-10-proxy-publish-dry-run/proxy-got-publish-dry-run.log)
- `proxy-http-client`: [publish log](../../../artifacts/2026-04-10-proxy-publish-dry-run/proxy-http-client-publish-dry-run.log)
- `proxy-runtime`: [publish log](../../../artifacts/2026-04-10-proxy-publish-dry-run/proxy-runtime-publish-dry-run.log)
- `proxy-undici`: [publish log](../../../artifacts/2026-04-10-proxy-publish-dry-run/proxy-undici-publish-dry-run.log)

## Conclusion

- Local dry-run evidence for batch `2026-04-10` is complete.
- This checkpoint satisfies the package/version references required by `release:proxy:preflight`.

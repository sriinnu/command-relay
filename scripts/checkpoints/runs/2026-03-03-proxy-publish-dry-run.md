# 2026-03-03 Proxy Publish Local Dry-Run Checkpoint

## Scope

- Branch: `feat/home-pickup-remaining-todos`
- Commit: `6c7d2e5`
- Selector: `@commandrelay/proxy-*`
- Dist-tag: `latest`
- Mode: local CLI dry-run evidence (`npm pack --dry-run --json`, `npm publish --dry-run`)
- Publish safety: dry-run only, no registry mutation

## Environment

- `pwd`: `/mnt/c/sriinnu/personal/Kaala-brahma/terminal`
- `node -v`: `v22.20.0`
- `npm -v`: `10.9.3`
- cache strategy: scoped npm cache (`NPM_CONFIG_CACHE`) for dry-run commands

## Selected Packages

1. `@commandrelay/proxy-core@0.1.0`
2. `@commandrelay/proxy-agent@0.1.0`
3. `@commandrelay/proxy-http-client@0.1.0`

## Validation Results

| Package | `check` | `build` | `test` |
| --- | --- | --- | --- |
| `@commandrelay/proxy-core` | pass | pass | pass (`14/14`) |
| `@commandrelay/proxy-agent` | pass | pass | pass (`39/39`) |
| `@commandrelay/proxy-http-client` | pass | pass | pass (`22/22`) |

Validation logs:

- `proxy-core`: [check](../../../artifacts/2026-03-03-proxy-publish-dry-run/proxy-core-check.log), [build](../../../artifacts/2026-03-03-proxy-publish-dry-run/proxy-core-build.log), [test](../../../artifacts/2026-03-03-proxy-publish-dry-run/proxy-core-test.log)
- `proxy-agent`: [check](../../../artifacts/2026-03-03-proxy-publish-dry-run/proxy-agent-check.log), [build](../../../artifacts/2026-03-03-proxy-publish-dry-run/proxy-agent-build.log), [test](../../../artifacts/2026-03-03-proxy-publish-dry-run/proxy-agent-test.log)
- `proxy-http-client`: [check](../../../artifacts/2026-03-03-proxy-publish-dry-run/proxy-http-client-check.log), [build](../../../artifacts/2026-03-03-proxy-publish-dry-run/proxy-http-client-build.log), [test](../../../artifacts/2026-03-03-proxy-publish-dry-run/proxy-http-client-test.log)

## Pack Dry-Run Results

- `@commandrelay/proxy-core@0.1.0`: [pack JSON](../../../artifacts/2026-03-03-proxy-publish-dry-run/proxy-core-pack-dry-run.json), tarball `commandrelay-proxy-core-0.1.0.tgz`, `entryCount=5`
- `@commandrelay/proxy-agent@0.1.0`: [pack JSON](../../../artifacts/2026-03-03-proxy-publish-dry-run/proxy-agent-pack-dry-run.json), tarball `commandrelay-proxy-agent-0.1.0.tgz`, `entryCount=14`
- `@commandrelay/proxy-http-client@0.1.0`: [pack JSON](../../../artifacts/2026-03-03-proxy-publish-dry-run/proxy-http-client-pack-dry-run.json), tarball `commandrelay-proxy-http-client-0.1.0.tgz`, `entryCount=8`

## Publish Dry-Run Results

All selected packages completed `npm publish --dry-run --access public --tag latest` successfully.

- `proxy-core`: [publish log](../../../artifacts/2026-03-03-proxy-publish-dry-run/proxy-core-publish-dry-run.log)
- `proxy-agent`: [publish log](../../../artifacts/2026-03-03-proxy-publish-dry-run/proxy-agent-publish-dry-run.log)
- `proxy-http-client`: [publish log](../../../artifacts/2026-03-03-proxy-publish-dry-run/proxy-http-client-publish-dry-run.log)

## Blocker Reconciliation

- Previous blocker (2026-02-27): local npm cache `EACCES` on `/home/sriinnu/.npm`.
- Current run (2026-03-03): no `EACCES`; dry-run pack/publish passed for all selected packages.

## Conclusion

- `B2.4 publish workflow dry-run path` local evidence is now `done`.
- `B2.5 governance verification` remains open pending repository-level policy evidence (`NPM_TOKEN`, environment reviewers, branch protection).

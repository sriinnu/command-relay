# Proxy Package Publish Runbook

This repository ships scoped npm packages under `@commandrelay/proxy-*`, `@commandrelay/relay-proxy`, and `@commandrelay/proxy-*`.
The publish workflow is `.github/workflows/publish-proxy-packages.yml`.

## Safety model

- Publish scope is limited to selector-matched package names under proxy scopes (default selector: `@commandrelay/proxy-*,@commandrelay/relay-proxy,@commandrelay/proxy-*`).
- Manual publish requires:
  - `mode=publish`
  - `confirm_publish=publish-proxy-packages`
  - running from the default branch
- `release.published` only triggers publish when the release tag starts with `proxy-`.
- Production publish job uses the `npm-publish` environment and npm provenance (`--provenance`).
- Existing versions are detected and skipped to avoid republish failures.

## Dist artifact policy

- `packages/proxy-core/dist/`, `packages/proxy-agent/dist/`, `packages/proxy-http-client/dist/`, `packages/commandrelay-relay-proxy/dist/`, `packages/proxy-runtime/dist/`, and `packages/proxy-fetch/dist/` are generated build outputs and must remain untracked in git.
- The publish workflow builds package outputs in CI (`npm --prefix <package> run build`) before `npm pack`, so tracked `dist/` files are not required for release.
- Package tarballs still include `dist/` because each package `package.json` keeps `"files": ["dist"]`.

If a `dist/` path is accidentally staged or tracked, clean the index with:

```bash
git rm -r --cached --ignore-unmatch \
  packages/proxy-core/dist \
  packages/proxy-agent/dist \
  packages/proxy-http-client/dist \
  packages/commandrelay-relay-proxy/dist \
  packages/proxy-runtime/dist \
  packages/proxy-fetch/dist
```

## Required GitHub configuration

1. Add repository secret `NPM_TOKEN` with publish rights for `@commandrelay`.
2. Configure environment `npm-publish` (recommended):
   - required reviewers
   - branch restrictions to default branch
3. Keep workflow permissions unchanged (`id-token: write` is required for provenance).

## Governance Evidence Contract

Release preflight checks both governance placeholders in this runbook and concrete governance artifact files for the batch date.

Required placeholders (do not remove):

- `<!-- proxy-release-governance:npm-token -->`
- `<!-- proxy-release-governance:npm-publish-environment -->`
- `<!-- proxy-release-governance:default-branch-protection -->`

Required governance artifacts per batch date (`<YYYY-MM-DD>`):

- `artifacts/<YYYY-MM-DD>-proxy-publish-governance/npm-token-presence.txt`
- `artifacts/<YYYY-MM-DD>-proxy-publish-governance/npm-publish-environment.txt`
- `artifacts/<YYYY-MM-DD>-proxy-publish-governance/default-branch-protection.json`

Governance placeholders for this runbook:

- `<!-- proxy-release-governance:npm-token -->` Capture evidence that `NPM_TOKEN` exists for publish automation.
- `<!-- proxy-release-governance:npm-publish-environment -->` Capture `npm-publish` environment restrictions/reviewers evidence.
- `<!-- proxy-release-governance:default-branch-protection -->` Capture default branch protection evidence.

## Release Guardrails Commands

Run these before any publish-mode trigger:

```bash
npm run release:proxy:capture-governance -- --batch-date 2026-03-03 --repo sriinnu/command-relay --default-branch main
npm run release:proxy:lockstep
npm run release:proxy:preflight -- --batch-date 2026-03-03 --package-selector @commandrelay/proxy-*,@commandrelay/relay-proxy,@commandrelay/proxy-*
```

`release:proxy:capture-governance` writes the required governance artifact files under `artifacts/<batch>-proxy-publish-governance` without exposing secret values.

`release:proxy:lockstep` verifies all `@commandrelay/proxy-*`, `@commandrelay/relay-proxy`, and `@commandrelay/proxy-*` package versions are aligned.

Expected lockstep pass output (all proxy packages):

```text
PASS lockstep: 9 proxy package(s) aligned at version 0.1.0 (@commandrelay=9)
```

Expected lockstep fail output:

```text
FAIL lockstep: version drift detected
INFO version buckets:
- 0.1.0: @commandrelay/proxy-agent, @commandrelay/proxy-core
- 0.1.1: @commandrelay/proxy-fetch
```

`release:proxy:preflight` hard-fails if the git tree is dirty, governance placeholders/artifacts are missing, or dry-run artifacts are missing for the selected batch.

Expected preflight pass output:

```text
PASS git tree clean
PASS selector matched 9 package(s)
PASS preflight: all release guardrails satisfied for batch 2026-03-03
```

Expected preflight fail output:

```text
FAIL git tree is dirty (commit/stash changes before publish preflight)
FAIL governance artifact missing (artifacts/2026-03-03-proxy-publish-governance/npm-token-presence.txt)
FAIL preflight: 2 guardrail(s) failed for batch 2026-03-03
```

## Dry run (recommended before every publish)

Trigger `Publish Proxy Packages` with:

- `mode`: `dry-run`
- `package_selector`: default `@commandrelay/proxy-*,@commandrelay/relay-proxy,@commandrelay/proxy-*` or a specific package (for example `@commandrelay/relay-proxy`)
- `dist_tag`: usually `latest` (or `next` for prerelease validation)

Dry run performs:

- package selection + guard checks
- `check`, `build`, `test`
- tarball creation (`npm pack`)
- `npm publish --dry-run --access public --tag <dist_tag>`

No package is published in dry-run mode.

## Production publish (manual)

Trigger `Publish Proxy Packages` with:

- `mode`: `publish`
- `package_selector`: package wildcard (default publishes all proxy packages)
- `dist_tag`: `latest` or `next`
- `confirm_publish`: `publish-proxy-packages`

Publish flow:

1. Verify job builds/tests each selected package and stores tarballs as artifacts.
2. Publish job downloads tarballs and runs:
   - `npm publish <tarball> --provenance --access public --tag <dist_tag>`
3. Any already-published package version is skipped automatically.

## Release-triggered publish

Creating a GitHub release with a tag starting `proxy-` triggers publish mode automatically.

- prerelease release -> `dist_tag=next`
- normal release -> `dist_tag=latest`

Use this only when your release process already guarantees approval and version readiness.

## Current Batch Follow-up

- [x] Record package versions for the current cut:
  - `@commandrelay/proxy-core@0.1.0`
  - `@commandrelay/proxy-agent@0.1.0`
  - `@commandrelay/proxy-http-client@0.1.0`
  - `@commandrelay/relay-proxy@0.1.0`
  - `@commandrelay/proxy-fetch@0.1.0`
  - `@commandrelay/proxy-undici@0.1.0`
  - `@commandrelay/proxy-axios@0.1.0`
  - `@commandrelay/proxy-got@0.1.0`
  - `@commandrelay/proxy-runtime@0.1.0`
- [x] Record validation evidence for the current environment:
  - root TAP `22/22` pass ([root TAP](../../artifacts/tap-local/root.tap))
  - `proxy-core` package test summary `14/14` pass ([test log](../../artifacts/2026-03-03-proxy-publish-dry-run/proxy-core-test.log))
  - `proxy-agent` package test summary `39/39` pass ([test log](../../artifacts/2026-03-03-proxy-publish-dry-run/proxy-agent-test.log))
  - `proxy-http-client` package test summary `22/22` pass ([test log](../../artifacts/2026-03-03-proxy-publish-dry-run/proxy-http-client-test.log))
- [ ] Run full validation on home Mac: `npm run check && npm test && npm run test:ci:all`.
- [x] Trigger GitHub Actions dry-run publish (`mode=dry-run`, `package_selector=@commandrelay/proxy-*,@commandrelay/relay-proxy,@commandrelay/proxy-*`, `dist_tag=latest`). Status (2026-03-04): run `22670960699` completed `success` on `main` ([Gate 0/1/3 checkpoint](../../scripts/checkpoints/runs/2026-03-03-proxy-governance-gates.md)).
- [x] Verify GitHub policy (`NPM_TOKEN`, `npm-publish` reviewers, default-branch protections). Status (2026-03-04): governance recapture is compliant (`contains_NPM_TOKEN=true`, `npm_publish_environment_present=true`, `environment_details_status=ok`, branch protection configured) ([governance capture log](../../artifacts/2026-03-03-proxy-governance-gates/release-proxy-capture-governance.log), [npm-token evidence](../../artifacts/2026-03-03-proxy-publish-governance/npm-token-presence.txt), [environment evidence](../../artifacts/2026-03-03-proxy-publish-governance/npm-publish-environment.txt), [branch protection evidence](../../artifacts/2026-03-03-proxy-publish-governance/default-branch-protection.json)).
- [x] Capture dry-run artifact summary in checkpoint/release notes before any publish-mode trigger. Artifact: [`scripts/checkpoints/runs/2026-03-03-proxy-publish-dry-run.md`](../../scripts/checkpoints/runs/2026-03-03-proxy-publish-dry-run.md). Status: `done` (`check/build/test` passed for all selected packages; `npm pack --dry-run --json` and `npm publish --dry-run` succeeded for all selected packages with scoped cache artifacts in [`artifacts/2026-03-03-proxy-publish-dry-run`](../../artifacts/2026-03-03-proxy-publish-dry-run)).
- [x] Capture Gate 0/1/3 status checkpoint for the batch. Artifact: [`scripts/checkpoints/runs/2026-03-03-proxy-governance-gates.md`](../../scripts/checkpoints/runs/2026-03-03-proxy-governance-gates.md). Status: `done` (Gate 0 `partial`, Gate 1 `partial`, Gate 3 `pass`, all with command evidence links).
- [x] Capture governance artifacts for current batch:
  - [`artifacts/2026-03-03-proxy-publish-governance/npm-token-presence.txt`](../../artifacts/2026-03-03-proxy-publish-governance/npm-token-presence.txt)
  - [`artifacts/2026-03-03-proxy-publish-governance/npm-publish-environment.txt`](../../artifacts/2026-03-03-proxy-publish-governance/npm-publish-environment.txt)
  - [`artifacts/2026-03-03-proxy-publish-governance/default-branch-protection.json`](../../artifacts/2026-03-03-proxy-publish-governance/default-branch-protection.json)
  - Generated by: `npm run release:proxy:capture-governance -- --batch-date 2026-03-03 --repo sriinnu/command-relay --default-branch main`.
- [x] Run release guardrails for current batch:
  - `npm run release:proxy:lockstep`
  - `npm run release:proxy:preflight -- --batch-date 2026-03-03 --package-selector @commandrelay/proxy-*,@commandrelay/relay-proxy,@commandrelay/proxy-*`
  - Status (2026-03-03): lockstep is green ([lockstep log](../../artifacts/2026-03-03-proxy-governance-gates/release-proxy-lockstep.log)); preflight is green on a clean worktree ([clean-worktree preflight log](../../artifacts/2026-03-03-proxy-governance-gates/release-proxy-preflight-clean-worktree.log)) and fails only on dirty-tree guardrail in active in-flight workspace ([active-tree preflight log](../../artifacts/2026-03-03-proxy-governance-gates/release-proxy-preflight-active-tree.log)).

## Internal v0.1 Gate Checklist (tag prep only)

This checklist is for internal `v0.1` readiness planning. It does not create git tags.

- [x] Confirm proxy package versions/changelog entries are final for this cut.
- [ ] Run full validation on home Mac: `npm run check && npm test && npm run test:ci:all`.
- [x] Run publish workflow in `dry-run` mode for `@commandrelay/proxy-*,@commandrelay/relay-proxy,@commandrelay/proxy-*` with target `dist_tag`. Status (2026-03-04): Gate 3 run `22670960699` succeeded.
- [x] Verify `NPM_TOKEN`, `npm-publish` environment reviewers, and default-branch protections. Status (2026-03-04): governance recapture is compliant.
- [ ] Record dry-run artifacts and approval outcome in release notes before any publish-mode trigger.

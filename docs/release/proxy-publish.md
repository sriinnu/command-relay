# Proxy Package Publish Runbook

This repository ships scoped npm packages under `@commandrelay/proxy-*`.
The publish workflow is `.github/workflows/publish-proxy-packages.yml`.

## Safety model

- Publish scope is hard-limited to package names matching `@commandrelay/proxy-*`.
- Manual publish requires:
  - `mode=publish`
  - `confirm_publish=publish-proxy-packages`
  - running from the default branch
- `release.published` only triggers publish when the release tag starts with `proxy-`.
- Production publish job uses the `npm-publish` environment and npm provenance (`--provenance`).
- Existing versions are detected and skipped to avoid republish failures.

## Required GitHub configuration

1. Add repository secret `NPM_TOKEN` with publish rights for `@commandrelay`.
2. Configure environment `npm-publish` (recommended):
   - required reviewers
   - branch restrictions to default branch
3. Keep workflow permissions unchanged (`id-token: write` is required for provenance).

## Dry run (recommended before every publish)

Trigger `Publish Proxy Packages` with:

- `mode`: `dry-run`
- `package_selector`: default `@commandrelay/proxy-*` or a specific package (for example `@commandrelay/proxy-agent`)
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

## Internal v0.1 Gate Checklist (tag prep only)

This checklist is for internal `v0.1` readiness planning. It does not create git tags.

1. Confirm proxy package versions/changelog entries are final for this cut.
2. Run full validation on home Mac: `npm run check && npm test && npm run test:ci:all`.
3. Run publish workflow in `dry-run` mode for `@commandrelay/proxy-*` with target `dist_tag`.
4. Verify `NPM_TOKEN`, `npm-publish` environment reviewers, and default-branch protections.
5. Record dry-run artifacts and approval outcome in release notes before any publish-mode trigger.

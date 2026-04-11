# OpenAI Review Playbook

This runbook is the standard process for preparing a clean, reproducible review package for OpenAI or any external reviewer.

Current target commit:

- `0b5c314` (`chore: unify release workflow and complete package docs/assets`)

## Goals

- Isolate the intended change from unrelated branch noise.
- Produce deterministic technical evidence.
- Provide a review packet with clear scope, commands, and outcomes.

## Scope for commit `0b5c314`

- Remove root no-op release workflow (`.github/workflows/release-publish.yml`).
- Keep release automation in `.github/workflows/publish-proxy-packages.yml` with explicit `proxy-<semver>` behavior.
- Update `docs/release/proxy-publish.md` to match actual release semantics.
- Ensure all `packages/*` contain:
  - `README.md`
  - `SKILL.md`
  - `docs/assets/logo-pixel.svg`

## Environment prerequisites

- Node 22+
- pnpm 10+
- GitHub CLI (`gh`) authenticated for this repository

## Review procedure

### 1. Create an isolated review branch from `origin/main`

```bash
cd /Users/srinivaspendela/Sriinnu/Personal/command-relay
git fetch origin
git switch -c sriinnu/openai-review-0b5c314 origin/main
git cherry-pick 0b5c314
```

If cherry-pick conflicts, resolve conflicts before continuing.

### 2. Confirm intended file scope

```bash
git show --name-status --oneline HEAD
```

Expected high-level shape:

- `D .github/workflows/release-publish.yml`
- `M .github/workflows/publish-proxy-packages.yml`
- `M docs/release/proxy-publish.md`
- `A packages/*/SKILL.md` (for previously missing packages)
- `A packages/*/docs/assets/logo-pixel.svg` (all packages)

### 3. Validate package completeness contract

```bash
for p in packages/*; do
  [ -f "$p/package.json" ] || continue
  [ -f "$p/README.md" ] || echo "MISSING README: $p"
  [ -f "$p/SKILL.md" ] || echo "MISSING SKILL: $p"
  [ -f "$p/docs/assets/logo-pixel.svg" ] || echo "MISSING LOGO: $p"
done
```

Pass condition: no output.

Count sanity:

```bash
find packages -mindepth 1 -maxdepth 2 -name package.json | wc -l
find packages -mindepth 1 -maxdepth 2 -name SKILL.md | wc -l
find packages -type f -name logo-pixel.svg | wc -l
```

Pass condition: all three counts are equal.

### 4. Validate release architecture semantics

```bash
test ! -f .github/workflows/release-publish.yml && echo "OK: root release workflow removed"
rg -n "private root package|proxy-<semver>|Release tag" .github/workflows/publish-proxy-packages.yml docs/release/proxy-publish.md
```

Pass condition:

- Root no-op workflow is absent.
- Publish workflow and docs both declare:
  - root package is private and not published
  - automated publish requires `proxy-<semver>` release tag

### 5. Run local technical checks

```bash
pnpm install --frozen-lockfile
pnpm run check:root
pnpm run test:packages
```

Optional:

```bash
pnpm run verify:consumer-smoke
```

### 6. Trigger GitHub Actions dry-run for publish workflow

```bash
git push -u origin sriinnu/openai-review-0b5c314
gh workflow run publish-proxy-packages.yml \
  --ref sriinnu/openai-review-0b5c314 \
  -f mode=dry-run \
  -f package_selector='@commandrelay/proxy-*,@commandrelay/relay-proxy,@commandrelay/proxy-*' \
  -f dist_tag='latest'
```

Then inspect:

```bash
gh run list --workflow "Publish Proxy Packages" --limit 5
gh run view <run-id> --log
```

Pass condition: dry-run path completes, no real publish is attempted.

## Evidence checklist (copy/paste template)

```markdown
# External Review Evidence - <YYYY-MM-DD>

- Repo: `sriinnu/command-relay`
- Review branch: `sriinnu/openai-review-0b5c314`
- Commit under review: `0b5c314`

## Scope integrity
- [ ] `git show --name-status --oneline HEAD` captured
- [ ] No unrelated files included in isolated branch

## Package completeness
- [ ] README/SKILL/logo completeness check run
- [ ] Missing-file output is empty
- [ ] package.json count == SKILL.md count == logo-pixel.svg count

## Release architecture
- [ ] `.github/workflows/release-publish.yml` absent
- [ ] publish workflow contains explicit non-root publish semantics
- [ ] docs/release/proxy-publish.md matches workflow behavior

## Local validation
- [ ] `pnpm run check:root` pass
- [ ] `pnpm run test:packages` pass
- [ ] `pnpm run verify:consumer-smoke` pass or intentionally skipped with reason

## GitHub workflow validation
- [ ] Dry-run workflow triggered from isolated branch
- [ ] Run URL recorded
- [ ] Log review confirms no real publish occurred

## Reviewer packet links
- PR URL: <url>
- Workflow run URL: <url>
- Commit URL: <url>
- Evidence artifact path(s): <path/list>
```

## Reviewer packet format

Provide this in your OpenAI handoff:

1. One-paragraph architecture summary.
2. Commit hash and PR link.
3. Workflow run URL from dry-run.
4. Checklist results (pass/fail) with exact command outputs attached.

## Go/No-Go criteria

Go:

- All checklist items above pass.

No-Go:

- Isolated branch includes unrelated changes.
- Completeness checks show missing package docs/assets.
- Release semantics differ between workflow and docs.
- Local checks fail or workflow dry-run fails.

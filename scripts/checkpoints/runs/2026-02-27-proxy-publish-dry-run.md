# 2026-02-27 Proxy Publish Local Dry-Run Checkpoint

## Scope

- Branch: `feat/ssh-exploration`
- Selector: `@commandrelay/proxy-*`
- Dist-tag: `latest`
- Mode: local `npm publish --dry-run` evidence only (no actual publish)

## Environment

- `pwd`: `/mnt/c/sriinnu/personal/Kaala-brahma/terminal`
- `git branch --show-current`: `feat/ssh-exploration`
- `node -v`: `v22.20.0`
- `npm -v`: `10.9.3`

## Selected Packages

1. `@commandrelay/proxy-core@0.1.0`
2. `@commandrelay/proxy-agent@0.1.0`
3. `@commandrelay/proxy-http-client@0.1.0`

## Validation Results

| Package | `check` | `build` | `test` | TAP summary |
| --- | --- | --- | --- | --- |
| `@commandrelay/proxy-core` | pass | pass | pass | `1/1` pass |
| `@commandrelay/proxy-agent` | pass | pass | pass | `3/3` pass |
| `@commandrelay/proxy-http-client` | pass | pass | pass | `4/4` pass |

## Dry-Run Publish Results

For all three packages, both commands failed with the same environment blocker:

1. `(cd packages/<pkg> && npm pack --dry-run --json)` -> `exit 243`
2. `(cd packages/<pkg> && npm publish --dry-run --access public --tag latest)` -> `exit 243`

Common error details:

- `npm ERR! code EACCES`
- cache path under `/home/sriinnu/.npm/_cacache/tmp/*`
- remediation suggested by npm:

```bash
sudo chown -R 1000:1000 "/home/sriinnu/.npm"
```

## Conclusion

- Local dry-run verification is `partial`.
- Package quality gates (`check/build/test`) are green.
- Publish dry-run commands are blocked by local npm cache ownership, not package logic.

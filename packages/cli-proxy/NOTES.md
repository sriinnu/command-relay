# cli-proxy Integration Notes

Use `@termina/cli-proxy` for proxy diagnostics in CI jobs, runtime startup checks, or support bundles.

## Quick start checklist

1. Run `termina-cli-proxy env` during startup validation.
2. Run `termina-cli-proxy explain <urls...>` for target-specific routing checks.
3. Use `--json` in automation and parse the result object.
4. Install `@commandrelay/proxy-agent` only when agent-class detail is useful.

## Suggested CI usage

```bash
termina-cli-proxy env --json > proxy-env-report.json
termina-cli-proxy explain --json https://api.example.com https://telemetry.example.com > proxy-route-report.json
```

## Operational notes

- Lowercase proxy variables override uppercase values.
- In CGI mode (`REQUEST_METHOD` set), uppercase `HTTP_PROXY` is ignored.
- Invalid URL inputs are reported per-route with `decision=error` and `error=invalid_target_url`.
- `NO_PROXY` matches are surfaced explicitly in explain output.

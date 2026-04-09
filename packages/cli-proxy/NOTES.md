# cli-proxy Integration Notes

Use `@commandrelay/cli-proxy` for proxy diagnostics in CI jobs, runtime startup checks, or support bundles.

## Compatibility Checklist

- Node.js `>=18`.
- ESM package consumption/runtime.
- Optional `@commandrelay/proxy-agent` peer dependency only for agent enrichment in `explain`.

## Migration Checklist

1. Replace one-off shell parsing with `env --json` output.
2. Replace custom route checks with `explain --json --no-agent` for deterministic CI artifacts.
3. Store output snapshots in build artifacts for incident triage.
4. Treat CLI parse errors as usage/configuration failures (exit code `2`).

## Quick start checklist

1. Run `commandrelay-cli-proxy env` during startup validation.
2. Run `commandrelay-cli-proxy explain <urls...>` for target-specific routing checks.
3. Use `--json` in automation and parse the result object.
4. Install `@commandrelay/proxy-agent` only when agent-class detail is useful.

## Suggested CI usage

```bash
commandrelay-cli-proxy env --json > proxy-env-report.json
commandrelay-cli-proxy explain --json --no-agent https://api.example.com https://telemetry.example.com > proxy-route-report.json
```

## Troubleshooting Playbook

- Unexpected uppercase precedence:
  - Lowercase proxy variables override uppercase values.
- CGI behavior surprises:
  - In CGI mode (`REQUEST_METHOD` set), uppercase `HTTP_PROXY` is ignored.
- Bad URL input:
  - Invalid URL inputs are reported per-route with `decision=error` and `error=invalid_target_url`.
- `NO_PROXY` ambiguity:
  - `NO_PROXY` matches are surfaced explicitly in explain output (`matchedNoProxyRule`).

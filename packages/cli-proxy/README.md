# @commandrelay/cli-proxy

![cli-proxy brand](./docs/assets/cli-proxy-brand.svg)

Proxy diagnostics CLI for inspecting proxy-related environment variables and explaining route decisions for outbound URLs.

Compact command-line insight into proxy routing and environment state.

## Install

```bash
npm install @commandrelay/cli-proxy @commandrelay/proxy-core
```

Optional agent-level explain details:

```bash
npm install @commandrelay/proxy-agent
```

## Runtime

- Node.js `>=18`
- npm `>=9`
- ESM package (`"type": "module"`)

## Compatibility

- CLI/runtime package for Node environments.
- `@commandrelay/proxy-agent` is an optional peer dependency used only for agent-level explain details.
- Lowercase proxy env vars override uppercase variants.
- In CGI mode (`REQUEST_METHOD` set), uppercase `HTTP_PROXY` is ignored for safety.

## Migration

`@commandrelay/cli-proxy` is currently `0.1.x`; there is no prior package-specific breaking release. Typical migration is from shell scripts or custom debug tooling.

1. Replace custom env debug scripts with `commandrelay-cli-proxy env --json`.
2. Replace hand-written routing checks with `commandrelay-cli-proxy explain --json <urls...>`.
3. If you do not need optional agent metadata, run with `--no-agent` for deterministic output in CI.
4. Update automation to treat parse/usage failures as exit code `2`.

## CLI

Binary names:

- `commandrelay-cli-proxy`
- `commandrelay-proxy`

### Commands

```bash
commandrelay-cli-proxy env [--json]
commandrelay-cli-proxy explain [--json] [--with-agent|--no-agent] <url...>
commandrelay-cli-proxy help
```

### `env`

Inspects:

- `http_proxy` / `HTTP_PROXY`
- `https_proxy` / `HTTPS_PROXY`
- `all_proxy` / `ALL_PROXY`
- `no_proxy` / `NO_PROXY`
- `REQUEST_METHOD` / `request_method`

Then shows normalized `@commandrelay/proxy-core` settings.

### `explain`

For each URL, reports:

- route decision (`proxy`, `direct`, or `error`)
- selected proxy URL and source setting
- matched `NO_PROXY` rule (if any)
- optional `@commandrelay/proxy-agent` agent class metadata

### JSON mode

Use `--json` for machine-readable output:

```bash
commandrelay-cli-proxy explain --json --no-agent https://example.com https://api.internal.local
```

## Usage Matrix

| Operational need | Command/API path | Why |
| --- | --- | --- |
| Validate effective proxy env in CI or containers | `commandrelay-cli-proxy env --json` | Emits normalized settings from runtime env with stable machine output |
| Explain route decisions for specific outbound URLs | `commandrelay-cli-proxy explain [--json] <url...>` | Shows proxy/direct choice, source, and matched `NO_PROXY` rule |
| Keep output deterministic without optional agent dependency | `commandrelay-cli-proxy explain --no-agent ...` | Avoids optional peer loading and agent metadata variance |
| Embed diagnostics in Node scripts | Programmatic `inspectProxyEnvironment` / `explainProxyRoutes` | Reuses CLI logic without shelling out |

## Programmatic API

```ts
import {
  inspectProxyEnvironment,
  explainProxyRoutes,
  parseCliArgs,
  runCli
} from "@commandrelay/cli-proxy";

const inspection = inspectProxyEnvironment(process.env);
const explain = await explainProxyRoutes(["https://example.com"], {
  env: process.env,
  enableAgent: true
});

console.log(inspection.settings.httpProxy, explain.routes[0]?.decision);
```

## Troubleshooting

- `Unknown command` or `Unknown option`:
  - Use `commandrelay-cli-proxy help`; parse failures return exit code `2`.
- Route output does not match expected proxy:
  - Re-check `NO_PROXY` inputs and whether lowercase env vars shadow uppercase values.
- `agentSupport: unavailable` in explain output:
  - Install optional `@commandrelay/proxy-agent` or run with `--no-agent`.
- Invalid URL route entries:
  - `decision=error` and `error=invalid_target_url` indicate malformed URL input.

## Examples

- Overview: [docs/examples/README.md](./docs/examples/README.md)
- Environment inspection + snapshots: [docs/examples/env.md](./docs/examples/env.md)
- Route explanation + snapshots: [docs/examples/explain.md](./docs/examples/explain.md)

## Notes

See [NOTES.md](./NOTES.md) for integration guidance.

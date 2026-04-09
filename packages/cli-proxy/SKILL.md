# SKILL: @commandrelay/cli-proxy

`@commandrelay/cli-proxy` is an operator + CI-friendly CLI for inspecting proxy environment state and explaining route decisions.

## Install

```bash
npm install @commandrelay/cli-proxy @commandrelay/proxy-core
```

## Execution (Modern AI-ready)

- Type check: `pnpm --filter @commandrelay/cli-proxy run check`
- Build: `pnpm --filter @commandrelay/cli-proxy run build`
- Tests: `pnpm --filter @commandrelay/cli-proxy run test`
- Package metadata: `npm run extension:run -- cli-proxy info`
- Workspace check: `npm run extension:run -- cli-proxy check`
- Workspace build: `npm run extension:run -- cli-proxy build`
- Workspace test: `npm run extension:run -- cli-proxy test`
- Direct CLI: `npm run extension:run -- cli-proxy cli -- --help`

## Command Matrix

- `env`: inspect normalized env-derived settings.
  - `npm run extension:run -- cli-proxy cli -- env --json`
- `explain`: explain per-target routing decisions.
  - `npm run extension:run -- cli-proxy cli -- explain --json https://api.example.com`
  - `npm run extension:run -- cli-proxy cli -- explain --no-agent http://internal.service`
- `help`: command discovery.

## Programmatic API

Exports:
- `inspectProxyEnvironment(env)`
- `explainProxyRoutes(urls, options)`
- `runCli(input, output?)`
- `parseCliArgs(argv)`
- `format*` helpers in `formatter.ts` exports

## Reference Snippet

```ts
import {
  inspectProxyEnvironment,
  explainProxyRoutes,
  type ExplainRoutesOptions
} from "@commandrelay/cli-proxy";

const snapshot = inspectProxyEnvironment(process.env);
console.log(snapshot.envKeysSeen, snapshot.settings.httpProxy, snapshot.settings.noProxy.length);

const explainOptions: ExplainRoutesOptions = {
  env: process.env,
  enableAgent: true
};

const result = await explainProxyRoutes(["https://api.example.com/health", "http://localhost:8080"], explainOptions);
for (const entry of result.routes) {
  console.log(entry.target, entry.decision, entry.proxyUrl ?? "direct");
}
```

## Operations

- In CI, prefer structured output (`--json`) and assert `decision` + `viaProxy` fields.
- Use `--no-agent` in strict reproducibility contexts.
- Optional `@commandrelay/proxy-agent` increases output richness; failure fallback emits `agentSupport: unavailable` when missing.

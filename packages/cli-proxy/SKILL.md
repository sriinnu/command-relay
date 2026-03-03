# SKILL: CLI Proxy (`packages/cli-proxy`)

## Purpose
`@termina/cli-proxy` provides proxy diagnostics CLIs for route explanation and environment inspection.

## Key Commands
- Type check: `npm run --workspace @termina/cli-proxy check`
- Build: `npm run --workspace @termina/cli-proxy build`
- Tests: `npm run --workspace @termina/cli-proxy test`

## Extension CLI Command
- Metadata/help: `npm run extension:run -- cli-proxy info`
- Run package checks: `npm run extension:run -- cli-proxy check`
- Execute CLI directly: `npm run extension:run -- cli-proxy cli -- --help`

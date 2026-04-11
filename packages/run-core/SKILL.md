# SKILL: @commandrelay/run-core

`@commandrelay/run-core` defines the durable run contract shared by CLI and orchestration layers. It is the canonical type surface for run metadata and lifecycle states.

## Install

```bash
npm install @commandrelay/run-core
```

## Execution (Modern AI-ready)

- Type check: `pnpm --filter @commandrelay/run-core run check`
- Build: `pnpm --filter @commandrelay/run-core run build`
- Tests: `pnpm --filter @commandrelay/run-core run test`
- Package metadata: `npm run extension:run -- run-core info`

## API Surface

Exports are type-only:

- `RunRuntime`
- `RunOpenTarget`
- `RunStatus`
- `RunSpec`
- `RunLedgerRecord`

## Reference Snippet

```ts
import type { RunSpec, RunLedgerRecord } from "@commandrelay/run-core";

const spec: RunSpec = {
  title: "nightly-index",
  command: "pnpm run index:nightly",
  runtime: "tmux",
  cwd: process.cwd(),
  detach: true
};

const toAuditRow = (record: RunLedgerRecord) => ({
  runId: record.runId,
  runtime: record.runtime,
  status: record.status,
  paneId: record.paneId
});
```

## Operational Notes

- Keep this package as the single source of durable-run types.
- Avoid duplicating run status enums in consumers.
- Import from package root only; avoid `dist/*` path imports.

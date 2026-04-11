# SKILL: @commandrelay/run-orchestrator (`packages/run-orchestrator`)

`@commandrelay/run-orchestrator` manages durable run lifecycle over pluggable runtime backends (`managed`, `tmux`, `ssh-tmux`) with persisted ledger state.

## Install

```bash
npm install @commandrelay/run-orchestrator
```

## Execution Matrix (Modern AI-ready)

### Workspace scripts
- `pnpm --filter @commandrelay/run-orchestrator run check`
- `pnpm --filter @commandrelay/run-orchestrator run build`
- `pnpm --filter @commandrelay/run-orchestrator run test`

### Extension commands
- `npm run extension:run -- run-orchestrator info`
- `npm run extension:run -- run-orchestrator check`
- `npm run extension:run -- run-orchestrator build`
- `npm run extension:run -- run-orchestrator test`

## API Surface

- `RunOrchestratorOptions`
- `RunOrchestrator`
  - `startRun`
  - `listRuns`
  - `inspectRun`
  - `reconcileRuns`
  - `reconcileRun`
  - `stopRun`

## Reference Snippet

```ts
import { RunOrchestrator } from "@commandrelay/run-orchestrator";
import { ManagedRuntimeAdapter } from "@commandrelay/runtime-managed";

const orchestrator = new RunOrchestrator({
  managedRuntime: new ManagedRuntimeAdapter()
});

const record = await orchestrator.startRun({
  runtime: "managed",
  command: "npm run test",
  title: "ci-smoke",
  cwd: process.cwd()
});

await orchestrator.reconcileRun(record.runId);
await orchestrator.stopRun(record.runId);
```

## Operational notes

- Use `COMMANDRELAY_RUN_DIR` to override the default run directory location.
- Reconciliation compares ledger records with live backend pane state and marks stale runs as `lost`.
- Default storage root is `.commandrelay/runs` relative to detected project root.

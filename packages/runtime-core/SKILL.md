# SKILL: @commandrelay/runtime-core (`packages/runtime-core`)

`@commandrelay/runtime-core` is the shared execution-contract layer for runtime adapters.

## Install

```bash
npm install @commandrelay/runtime-core
```

## Execution Matrix (Modern AI-ready)

### Workspace scripts
- `pnpm --filter @commandrelay/runtime-core run check`
- `pnpm --filter @commandrelay/runtime-core run build`
- `pnpm --filter @commandrelay/runtime-core run test`

### Extension commands
- `npm run extension:run -- runtime-core info`
- `npm run extension:run -- runtime-core check`
- `npm run extension:run -- runtime-core build`
- `npm run extension:run -- runtime-core test`

## API Surface

- Types: `RuntimeBackend`, `RuntimePane`, `RuntimeLaunchRequest`, `RuntimeStartedPane`, `RuntimeCommandOptions`, `RuntimeCommandRunner`, `RuntimeCommandRunnerWithInput`, `RuntimeShellFamily`, `RuntimeShellInvocation`
- Types: `RunnableRuntimeBackend`
- Functions: `buildRuntimeShellInvocation`, `resolveDefaultRuntimeShell`, `resolveRuntimeShellFamily`, `isRunnableRuntimeBackend`, `execRuntimeCommand`, `execRuntimeCommandWithInput`, `normalizeRuntimeLineCount`
- Classes: `RuntimeMultiplexer`

## Reference Snippet

```ts
import {
  execRuntimeCommand,
  resolveDefaultRuntimeShell,
  RuntimeMultiplexer
} from "@commandrelay/runtime-core";

const shell = resolveDefaultRuntimeShell();
await execRuntimeCommand("node", ["-v"], { timeoutMs: 3_000 });

void shell;
void RuntimeMultiplexer;
```

## Notes

- Keep runtime adapter implementations as the only consumers of shell and transport specifics.
- Re-exported contracts are the stable integration boundary for managed, tmux, cmux, and ssh runtimes.

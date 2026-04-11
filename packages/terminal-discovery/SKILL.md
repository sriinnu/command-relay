# SKILL: @commandrelay/terminal-discovery (`packages/terminal-discovery`)

`@commandrelay/terminal-discovery` detects platform, shell, and available runtime terminals to guide backend selection.

## Install

```bash
npm install @commandrelay/terminal-discovery
```

## Execution Matrix (Modern AI-ready)

### Workspace scripts
- `pnpm --filter @commandrelay/terminal-discovery run check`
- `pnpm --filter @commandrelay/terminal-discovery run build`
- `pnpm --filter @commandrelay/terminal-discovery run test`

### Extension commands
- `npm run extension:run -- terminal-discovery info`
- `npm run extension:run -- terminal-discovery check`
- `npm run extension:run -- terminal-discovery build`
- `npm run extension:run -- terminal-discovery test`

## API Surface

- Types: `HostPlatform`, `TerminalKind`, `ShellFamily`, `TerminalDiscoverySnapshot`, `TerminalDiscoveryOptions`
- Functions: `detectTerminalEnvironment`, `detectAvailableTerminals`

## Reference Snippet

```ts
import { detectTerminalEnvironment } from "@commandrelay/terminal-discovery";

const snapshot = detectTerminalEnvironment({
  platform: process.platform,
  env: process.env
});

console.log(snapshot.platform, snapshot.terminalKind, snapshot.preferredRuntimeBackends);
```

## Operational notes

- `detectTerminalEnvironment` is side-effect free and useful before runtime construction.
- It returns prioritized `preferredRuntimeBackends` (commonly `tmux`, `cmux`, `managed`).
- Keep `platform`, `env`, and `hasExecutable` overrides for deterministic tests.

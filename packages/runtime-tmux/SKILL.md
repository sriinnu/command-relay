# SKILL: @commandrelay/runtime-tmux (`packages/runtime-tmux`)

`@commandrelay/runtime-tmux` connects CommandRelay to tmux backends for persistent pane-based terminal control.

## Install

```bash
npm install @commandrelay/runtime-tmux
```

## Execution Matrix (Modern AI-ready)

### Workspace scripts
- `pnpm --filter @commandrelay/runtime-tmux run check`
- `pnpm --filter @commandrelay/runtime-tmux run build`
- `pnpm --filter @commandrelay/runtime-tmux run test`

### Extension commands
- `npm run extension:run -- runtime-tmux info`
- `npm run extension:run -- runtime-tmux check`
- `npm run extension:run -- runtime-tmux build`
- `npm run extension:run -- runtime-tmux test`

## API Surface

- `TmuxRuntimeAdapter`
- `TmuxRuntimeAdapterOptions`
- `TmuxRuntimePane`
- Methods: `isAvailable`, `listPanes`, `capturePane`, `sendInput`, `startCommand`, `stopCommand`, `buildAttachCommand`

## Reference Snippet

```ts
import { TmuxRuntimeAdapter } from "@commandrelay/runtime-tmux";

const runtime = new TmuxRuntimeAdapter();
const pane = await runtime.startCommand({
  title: "tmux-run",
  cwd: process.cwd(),
  command: "node server.js",
  shell: "bash"
});

await runtime.capturePane(pane.paneId, 80);
```

## Notes

- Handles the common "no tmux server running" case by returning an empty pane list.
- `buildAttachCommand` returns a local attach command (`tmux attach-session -t ...`).

# SKILL: @commandrelay/runtime-managed (`packages/runtime-managed`)

`@commandrelay/runtime-managed` provides the managed PTY adapter for CommandRelay-owned terminal lifecycles.

## Install

```bash
npm install @commandrelay/runtime-managed
```

## Execution Matrix (Modern AI-ready)

### Workspace scripts
- `pnpm --filter @commandrelay/runtime-managed run check`
- `pnpm --filter @commandrelay/runtime-managed run build`
- `pnpm --filter @commandrelay/runtime-managed run test`

### Extension commands
- `npm run extension:run -- runtime-managed info`
- `npm run extension:run -- runtime-managed check`
- `npm run extension:run -- runtime-managed build`
- `npm run extension:run -- runtime-managed test`

## API Surface

- `ManagedRuntimeAdapter`
- `ManagedRuntimeAdapterOptions`
- `ManagedRuntimePane`
- Runtime methods: `isAvailable`, `listPanes`, `capturePane`, `sendInput`, `startCommand`, `stopCommand`, `buildAttachCommand`

## Reference Snippet

```ts
import { ManagedRuntimeAdapter } from "@commandrelay/runtime-managed";

const runtime = new ManagedRuntimeAdapter({
  autoStartDaemon: true,
  commandTimeoutMs: 8_000
});

if (await runtime.isAvailable()) {
  const pane = await runtime.startCommand({
    title: "session-01",
    cwd: process.cwd(),
    command: "sleep 15",
    shell: "bash"
  });
  await runtime.capturePane(pane.paneId, 40);
  await runtime.sendInput(pane.paneId, "exit\n");
}
```

## Notes

- Uses managed CLI daemon readiness checks (`oly` defaults).
- Keep managed adapter behavior scoped to owned-session lifecycle and attach-command shape.

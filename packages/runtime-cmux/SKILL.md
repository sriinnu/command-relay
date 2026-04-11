# SKILL: @commandrelay/runtime-cmux (`packages/runtime-cmux`)

`@commandrelay/runtime-cmux` provides a cmux-backed runtime adapter with normalized pane discovery, capture, and input dispatch.

## Install

```bash
npm install @commandrelay/runtime-cmux
```

## Execution Matrix (Modern AI-ready)

### Workspace scripts
- `pnpm --filter @commandrelay/runtime-cmux run check`
- `pnpm --filter @commandrelay/runtime-cmux run build`
- `pnpm --filter @commandrelay/runtime-cmux run test`

### Extension commands
- `npm run extension:run -- runtime-cmux info`
- `npm run extension:run -- runtime-cmux check`
- `npm run extension:run -- runtime-cmux build`
- `npm run extension:run -- runtime-cmux test`

## API Surface

- `CmuxRuntimeAdapter`
- `CmuxRuntimeAdapterOptions`
- `CmuxRuntimePane`
- Methods on `CmuxRuntimeAdapter`: `isAvailable`, `listPanes`, `capturePane`, `sendInput`

## Reference Snippet

```ts
import { CmuxRuntimeAdapter } from "@commandrelay/runtime-cmux";

const runtime = new CmuxRuntimeAdapter();
if (await runtime.isAvailable()) {
  const panes = await runtime.listPanes();
  if (panes[0]) {
    await runtime.capturePane(panes[0].paneId, 120);
    await runtime.sendInput(panes[0].paneId, "echo ok\n");
  }
}
```

## Notes

- Keep cmux parsing and translation concerns in this adapter only.
- Pair with `@commandrelay/runtime-core` for shell and runtime abstractions.

# SKILL: @commandrelay/runtime-ssh (`packages/runtime-ssh`)

`@commandrelay/runtime-ssh` implements a tmux runtime adapter over SSH, including pane lifecycle and host-fingerprint verification options.

## Install

```bash
npm install @commandrelay/runtime-ssh
```

## Execution Matrix (Modern AI-ready)

### Workspace scripts
- `pnpm --filter @commandrelay/runtime-ssh run check`
- `pnpm --filter @commandrelay/runtime-ssh run build`
- `pnpm --filter @commandrelay/runtime-ssh run test`

### Extension commands
- `npm run extension:run -- runtime-ssh info`
- `npm run extension:run -- runtime-ssh check`
- `npm run extension:run -- runtime-ssh build`
- `npm run extension:run -- runtime-ssh test`

## API Surface

- `SshTmuxRuntimeAdapter`
- `SshTmuxRuntimeAdapterOptions` (requires `sshTarget`)
- `SshTmuxRuntimePane`
- Methods: `isAvailable`, `listPanes`, `capturePane`, `sendInput`, `startCommand`, `stopCommand`, `buildAttachCommand`

## Reference Snippet

```ts
import { SshTmuxRuntimeAdapter } from "@commandrelay/runtime-ssh";

const runtime = new SshTmuxRuntimeAdapter({
  sshTarget: "ops@host.example.com",
  sshPort: 22,
  strictHostKeyChecking: true
});

if (await runtime.isAvailable()) {
  const panes = await runtime.listPanes();
  if (panes[0]) {
    await runtime.capturePane(panes[0].paneId, 80);
  }
}
```

## Notes

- Runtime command execution is proxied through SSH around tmux commands.
- Treat SSH security options (`expectedFingerprintSha256`, host-key checks) as production defaults.

# @commandrelay/terminal-discovery

![terminal-discovery brand mark](./docs/assets/terminal-discovery-brand.svg)

`terminal-discovery` detects host platform, shell family, terminal kind, and the most plausible runtime backends for the current environment.
Use it when you want CommandRelay to choose a sensible backend before any runtime work starts.

Environment discovery that picks the most plausible CommandRelay backend early.

## Install

```bash
npm install @commandrelay/terminal-discovery
```

## Runtime

- Node.js `>=18`
- npm `>=9`
- ESM only (`"type": "module"`)

## Product Surface

- Host platform detection
- Shell family detection
- Available terminal discovery
- Preferred runtime backend ranking

## Use When

- You need to inspect the current terminal environment.
- You want to pick a runtime backend automatically.
- You want one snapshot that explains platform, shell, and terminal shape.

## Source Layout

- `src/index.ts`: discovery entrypoint and public helpers
- `detectTerminalEnvironment`: environment snapshot builder
- `detectAvailableTerminals`: terminal availability helper

## Notes

- Keep this package side-effect free.
- Feed its output into the runtime adapter selection layer.

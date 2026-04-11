# @commandrelay/runtime-core

![runtime-core brand mark](./docs/assets/runtime-core-brand.svg)

`runtime-core` defines the shared contracts and execution helpers used by the CommandRelay runtime adapters.
Build against this package when you need the stable layer that sits below managed, tmux, cmux, and ssh backends.

The shared runtime contract layer beneath managed, tmux, cmux, and ssh backends.

## Install

```bash
npm install @commandrelay/runtime-core
```

## Runtime

- Node.js `>=18`
- npm `>=9`
- ESM only (`"type": "module"`)

## Product Surface

- Runtime backend contracts
- Command execution helpers
- Pane capture and input plumbing
- Multiplexer-oriented coordination primitives

## Use When

- You are building a new runtime adapter.
- You want one shared execution model across local and remote backends.
- You need typed primitives for command dispatch and pane state.

## Pair With

- `@commandrelay/runtime-managed`
- `@commandrelay/runtime-tmux`
- `@commandrelay/runtime-cmux`
- `@commandrelay/runtime-ssh`
- `@commandrelay/terminal-discovery`

## Source Layout

- `src/runtime-backend.ts`: backend contracts and lifecycle shape
- `src/runtime-command.ts`: command execution helpers
- `src/runtime-multiplexer.ts`: multiplexing and pane coordination

## Notes

- Keep imports at the package root.
- Treat this package as the common contract layer for backend implementations.

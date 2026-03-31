# @commandrelay/secure-chat

Terminal-only encrypted chat server/client for the CommandRelay mono-repo.

## Install

From this repository root:

```bash
pnpm install
```

## Usage

The package exposes one executable: `commandrelay-secure-chat`.
If no command is supplied, `serve` is used.

Start a server:

```bash
commandrelay-secure-chat serve --password "<shared-passphrase>"
```

Show usage and options:

```bash
commandrelay-secure-chat --help
```

Connect a client:

```bash
commandrelay-secure-chat connect \
  --username "<name>" \
  --password "<shared-passphrase>"
```

Optional arguments:

- `--host` (default: `127.0.0.1`)
- `--port` (default: `8787`)

Environment variables:

- `COMMANDRELAY_SECURE_CHAT_HOST`
- `COMMANDRELAY_SECURE_CHAT_PORT`
- `COMMANDRELAY_SECURE_CHAT_PASSWORD`
- `COMMANDRELAY_SECURE_CHAT_USERNAME`

When omitted, host and port fall back to defaults and username falls back to `USER`.

## Build and check

```bash
npm run check --prefix packages/commandrelay-secure-chat
npm run build --prefix packages/commandrelay-secure-chat
```

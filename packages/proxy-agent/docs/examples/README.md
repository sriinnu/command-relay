# proxy-agent Examples

Copy-paste-ready client integrations for `@commandrelay/proxy-agent`.

Each example includes a runnable snippet and an expected output snapshot.
Snapshots are stored under [`./snapshots`](./snapshots/).

## Choose an adapter

- [Axios](./axios.md)
  - Snapshot: [`./snapshots/axios.expected.json`](./snapshots/axios.expected.json)
- [Undici](./undici.md)
  - Snapshot: [`./snapshots/undici.expected.json`](./snapshots/undici.expected.json)
- [Got](./got.md)
  - Snapshot: [`./snapshots/got.expected.json`](./snapshots/got.expected.json)
- [Fetch (Node.js)](./fetch.md)
  - Snapshot: [`./snapshots/fetch.expected.json`](./snapshots/fetch.expected.json)

## Notes

- Keep one long-lived `ProxyAgentFactory` per process.
- Call `factory.destroy()` during shutdown.
- For `undici`/`fetch`, use `proxyUrl` from `factory.resolve(...)` and build an Undici `ProxyAgent` dispatcher.

# proxy-agent Examples

Copy-paste-ready client integrations for `@commandrelay/proxy-agent`.

## Choose an adapter

- [Axios](./axios.md)
- [Undici](./undici.md)
- [Got](./got.md)
- [Fetch (Node.js)](./fetch.md)

## Notes

- Keep one long-lived `ProxyAgentFactory` per process.
- Call `factory.destroy()` during shutdown.
- For `undici`/`fetch`, use `proxyUrl` from `factory.resolve(...)` and build an Undici `ProxyAgent` dispatcher.

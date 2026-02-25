# proxy-agent Integration Notes

Use this file when integrating `@commandrelay/proxy-agent` into external libraries/services.

## Quick Start Checklist

- Create one long-lived `ProxyAgentFactory` per process.
- Resolve agent per request target (`factory.resolve(target)`).
- Pass `agent ?? undefined` to your HTTP client.
- Disable built-in client proxy layers when they conflict (for example Axios `proxy: false`).
- Refresh settings on rotation with `reloadFromEnvironment()`.
- Call `destroy()` during graceful shutdown.

## Minimal Adapter Contract

If your package wants to stay HTTP-client agnostic, expose a tiny resolver boundary:

```ts
export interface AgentResolver {
  resolve(target: string | URL): import("node:http").Agent | undefined;
}
```

Implementation with this package:

```ts
import { ProxyAgentFactory } from "@commandrelay/proxy-agent";

const factory = new ProxyAgentFactory();

export const resolver = {
  resolve(target: string | URL) {
    return factory.resolve(target).agent ?? undefined;
  }
};
```

## Operational Notes

- `fromCache` can be used for lightweight observability.
- `viaProxy=false` indicates direct routing (no matching proxy settings).
- Invalid env proxy values are sanitized and ignored.

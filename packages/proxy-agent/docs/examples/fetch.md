# Fetch (Node.js) + proxy-agent

## Install

```bash
npm install undici @commandrelay/proxy-agent
```

## Run

```bash
node --import tsx <<'TS'
import { createServer } from "node:http";
import {
  Agent as UndiciAgent,
  ProxyAgent as UndiciProxyAgent,
  type Dispatcher
} from "undici";
import { ProxyAgentFactory } from "@commandrelay/proxy-agent";

const server = createServer((_request, response) => {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify({ service: "fetch-example" }));
});

await new Promise<void>((resolve) => {
  server.listen(0, "127.0.0.1", resolve);
});

const address = server.address();
if (!address || typeof address === "string") {
  throw new Error("address_unavailable");
}

const target = `http://127.0.0.1:${address.port}/health`;
const routingFactory = new ProxyAgentFactory({
  env: {
    https_proxy: "http://secure-proxy.local:8443",
    no_proxy: "127.0.0.1,localhost"
  }
});
const directDispatcher = new UndiciAgent();
const proxyDispatchers = new Map<string, UndiciProxyAgent>();

type NodeFetchRequestInit = RequestInit & { dispatcher?: Dispatcher };

function resolveDispatcher(targetUrl: string | URL): Dispatcher {
  const { proxyUrl } = routingFactory.resolve(targetUrl);
  if (!proxyUrl) {
    return directDispatcher;
  }

  let dispatcher = proxyDispatchers.get(proxyUrl);
  if (!dispatcher) {
    dispatcher = new UndiciProxyAgent(proxyUrl);
    proxyDispatchers.set(proxyUrl, dispatcher);
  }

  return dispatcher;
}

try {
  const localRouting = routingFactory.resolve(target);
  const response = await fetch(
    target,
    {
      method: "GET",
      dispatcher: resolveDispatcher(target)
    } as NodeFetchRequestInit
  );

  const payload = (await response.json()) as { service: string };
  const cacheProbeFirst = routingFactory.resolve("https://public.example.com");
  const cacheProbeSecond = routingFactory.resolve("https://public.example.com");

  console.log(
    JSON.stringify(
      {
        status: response.status,
        ok: response.ok,
        service: payload.service,
        localRouting: {
          viaProxy: localRouting.viaProxy,
          proxyUrl: localRouting.proxyUrl,
          fromCache: localRouting.fromCache
        },
        cacheProbe: {
          firstFromCache: cacheProbeFirst.fromCache,
          secondFromCache: cacheProbeSecond.fromCache
        }
      },
      null,
      2
    )
  );
} finally {
  await Promise.all(Array.from(proxyDispatchers.values(), (dispatcher) => dispatcher.close()));
  await directDispatcher.close();
  routingFactory.destroy();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
TS
```

## Expected output snapshot

Snapshot file: [`./snapshots/fetch.expected.json`](./snapshots/fetch.expected.json)

```json
{
  "status": 200,
  "ok": true,
  "service": "fetch-example",
  "localRouting": {
    "viaProxy": false,
    "proxyUrl": null,
    "fromCache": false
  },
  "cacheProbe": {
    "firstFromCache": false,
    "secondFromCache": true
  }
}
```

## Runtime note

The `dispatcher` option is Node/Undici behavior and is not available in browser `fetch`.

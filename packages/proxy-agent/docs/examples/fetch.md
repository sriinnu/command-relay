# Fetch (Node.js) + proxy-agent

## Install

```bash
npm install undici @commandrelay/proxy-agent
```

## Example

```ts
import {
  Agent as UndiciAgent,
  ProxyAgent as UndiciProxyAgent,
  type Dispatcher
} from "undici";
import { ProxyAgentFactory } from "@commandrelay/proxy-agent";

const routingFactory = new ProxyAgentFactory();
const directDispatcher = new UndiciAgent();
const proxyDispatchers = new Map<string, UndiciProxyAgent>();

type NodeFetchRequestInit = RequestInit & { dispatcher?: Dispatcher };

function resolveDispatcher(target: string | URL): Dispatcher {
  const { proxyUrl } = routingFactory.resolve(target);
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

const target = "https://httpbin.org/get";

try {
  const response = await fetch(
    target,
    {
      method: "GET",
      dispatcher: resolveDispatcher(target)
    } as NodeFetchRequestInit
  );

  console.log(response.status, await response.text());
} finally {
  await Promise.all(Array.from(proxyDispatchers.values(), (dispatcher) => dispatcher.close()));
  await directDispatcher.close();
  routingFactory.destroy();
}
```

## Runtime note

The `dispatcher` option is Node/Undici behavior and is not available in browser `fetch`.

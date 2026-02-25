# Undici + proxy-agent

## Install

```bash
npm install undici @commandrelay/proxy-agent
```

## Example

```ts
import {
  Agent as UndiciAgent,
  ProxyAgent as UndiciProxyAgent,
  request,
  type Dispatcher
} from "undici";
import { ProxyAgentFactory } from "@commandrelay/proxy-agent";

const routingFactory = new ProxyAgentFactory();
const directDispatcher = new UndiciAgent();
const proxyDispatchers = new Map<string, UndiciProxyAgent>();

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
  const { statusCode, body } = await request(target, {
    dispatcher: resolveDispatcher(target)
  });

  console.log(statusCode, await body.text());
} finally {
  await Promise.all(Array.from(proxyDispatchers.values(), (dispatcher) => dispatcher.close()));
  await directDispatcher.close();
  routingFactory.destroy();
}
```

## Why not pass `factory.resolve(...).agent` directly?

`undici` expects a `Dispatcher`, not a Node `http.Agent`. Use `proxyUrl` from `proxy-agent` as the routing decision and create Undici dispatchers.

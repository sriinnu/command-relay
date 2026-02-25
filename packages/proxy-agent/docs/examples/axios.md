# Axios + proxy-agent

## Install

```bash
npm install axios @commandrelay/proxy-agent
```

## Example

```ts
import axios from "axios";
import { ProxyAgentFactory } from "@commandrelay/proxy-agent";

const factory = new ProxyAgentFactory();
const target = "https://httpbin.org/get";

try {
  const { agent } = factory.resolve(target);

  const response = await axios.get(target, {
    proxy: false,
    httpAgent: agent ?? undefined,
    httpsAgent: agent ?? undefined,
    timeout: 10_000
  });

  console.log(response.status, response.data.url);
} finally {
  factory.destroy();
}
```

## Why `proxy: false`?

Axios has built-in proxy handling. Disable it so `@commandrelay/proxy-agent` is the single routing source.

# Got + proxy-agent

## Install

```bash
npm install got @commandrelay/proxy-agent
```

## Example

```ts
import got from "got";
import { ProxyAgentFactory } from "@commandrelay/proxy-agent";

const factory = new ProxyAgentFactory();
const target = "https://httpbin.org/get";

try {
  const { agent } = factory.resolve(target);

  const body = await got(target, {
    timeout: { request: 10_000 },
    agent: {
      http: agent ?? undefined,
      https: agent ?? undefined
    }
  }).text();

  console.log(body.length);
} finally {
  factory.destroy();
}
```

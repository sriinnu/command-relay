# Got + proxy-agent

## Install

```bash
npm install got @commandrelay/proxy-agent
```

## Run

```bash
node --import tsx <<'TS'
import { createServer } from "node:http";
import got from "got";
import { ProxyAgentFactory } from "@commandrelay/proxy-agent";

const server = createServer((_request, response) => {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify({ service: "got-example" }));
});

await new Promise<void>((resolve) => {
  server.listen(0, "127.0.0.1", resolve);
});

const address = server.address();
if (!address || typeof address === "string") {
  throw new Error("address_unavailable");
}

const target = `http://127.0.0.1:${address.port}/health`;
const factory = new ProxyAgentFactory({
  env: {
    http_proxy: "http://proxy.local:8080",
    no_proxy: "127.0.0.1,localhost"
  }
});

try {
  const localRouting = factory.resolve(target);

  const response = await got(target, {
    timeout: { request: 5_000 },
    responseType: "json",
    agent: {
      http: localRouting.agent ?? undefined,
      https: localRouting.agent ?? undefined
    }
  });

  const cacheProbeFirst = factory.resolve("http://public.example.com");
  const cacheProbeSecond = factory.resolve("http://public.example.com");

  console.log(
    JSON.stringify(
      {
        statusCode: response.statusCode,
        service: (response.body as { service: string }).service,
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
  factory.destroy();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
TS
```

## Expected output snapshot

Snapshot file: [`./snapshots/got.expected.json`](./snapshots/got.expected.json)

```json
{
  "statusCode": 200,
  "service": "got-example",
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

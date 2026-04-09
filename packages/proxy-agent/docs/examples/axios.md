# Axios + proxy-agent

## Install

```bash
npm install axios @commandrelay/proxy-agent
```

## Run

```bash
node --import tsx <<'TS'
import { createServer } from "node:http";
import axios from "axios";
import { ProxyAgentFactory } from "@commandrelay/proxy-agent";

const server = createServer((_request, response) => {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify({ service: "axios-example" }));
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
  const response = await axios.get<{ service: string }>(target, {
    proxy: false,
    httpAgent: localRouting.agent ?? undefined,
    httpsAgent: localRouting.agent ?? undefined,
    timeout: 5_000
  });

  const cacheProbeFirst = factory.resolve("http://public.example.com");
  const cacheProbeSecond = factory.resolve("http://public.example.com");

  console.log(
    JSON.stringify(
      {
        status: response.status,
        service: response.data.service,
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

Snapshot file: [`./snapshots/axios.expected.json`](./snapshots/axios.expected.json)

```json
{
  "status": 200,
  "service": "axios-example",
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

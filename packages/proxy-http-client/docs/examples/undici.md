# Undici-style adapter with proxy-http-client

## Install

```bash
npm install @commandrelay/proxy-http-client @commandrelay/proxy-agent
```

## Run

```bash
node --import tsx <<'TS'
import { createServer } from "node:http";
import type { IncomingHttpHeaders } from "node:http";
import { ProxyAgentFactory } from "@commandrelay/proxy-agent";
import { requestJson } from "@commandrelay/proxy-http-client";

type UndiciLikeResult<T> = {
  statusCode: number;
  headers: IncomingHttpHeaders;
  body: T | null;
  rawBody: string;
};

const proxyFactory = new ProxyAgentFactory({
  env: {
    https_proxy: "http://secure-proxy.local:8443",
    no_proxy: "127.0.0.1,localhost"
  }
});

async function undiciLikeRequest<T>(
  url: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: unknown;
    signal?: AbortSignal;
  } = {}
): Promise<UndiciLikeResult<T>> {
  const result = await requestJson<T>(url, {
    method: options.method ?? "GET",
    headers: options.headers,
    body: options.body,
    signal: options.signal,
    timeoutMs: 8_000,
    proxyResolver: proxyFactory
  });

  return {
    statusCode: result.status,
    headers: result.headers,
    body: result.body,
    rawBody: result.rawBody
  };
}

const server = createServer((_request, response) => {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify({ service: "undici-like-example" }));
});

await new Promise<void>((resolve) => {
  server.listen(0, "127.0.0.1", resolve);
});

const address = server.address();
if (!address || typeof address === "string") {
  throw new Error("address_unavailable");
}

const target = `http://127.0.0.1:${address.port}/health`;

try {
  const localRouting = proxyFactory.resolve(target);
  const response = await undiciLikeRequest<{ service: string }>(target);
  const cacheProbeFirst = proxyFactory.resolve("https://public.example.com");
  const cacheProbeSecond = proxyFactory.resolve("https://public.example.com");

  console.log(
    JSON.stringify(
      {
        statusCode: response.statusCode,
        service: response.body?.service ?? null,
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
  proxyFactory.destroy();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
TS
```

## Expected output snapshot

Snapshot file: [`./snapshots/undici.expected.json`](./snapshots/undici.expected.json)

```json
{
  "statusCode": 200,
  "service": "undici-like-example",
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

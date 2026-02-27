# Axios-style adapter with proxy-http-client

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

type AxiosLikeResponse<T> = {
  data: T | null;
  status: number;
  headers: IncomingHttpHeaders;
};

const proxyFactory = new ProxyAgentFactory({
  env: {
    http_proxy: "http://proxy.local:8080",
    no_proxy: "127.0.0.1,localhost"
  }
});

async function axiosLikeGet<T>(
  url: string,
  options: {
    headers?: Record<string, string>;
    timeout?: number;
    signal?: AbortSignal;
  } = {}
): Promise<AxiosLikeResponse<T>> {
  const result = await requestJson<T>(url, {
    method: "GET",
    headers: options.headers,
    timeoutMs: options.timeout ?? 8_000,
    signal: options.signal,
    proxyResolver: proxyFactory
  });

  return {
    data: result.body,
    status: result.status,
    headers: result.headers
  };
}

const server = createServer((_request, response) => {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify({ service: "axios-like-example" }));
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
  const response = await axiosLikeGet<{ service: string }>(target);
  const cacheProbeFirst = proxyFactory.resolve("http://public.example.com");
  const cacheProbeSecond = proxyFactory.resolve("http://public.example.com");

  console.log(
    JSON.stringify(
      {
        status: response.status,
        service: response.data?.service ?? null,
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

Snapshot file: [`./snapshots/axios.expected.json`](./snapshots/axios.expected.json)

```json
{
  "status": 200,
  "service": "axios-like-example",
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

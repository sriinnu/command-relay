# Undici-style adapter with proxy-http-client

## Install

```bash
npm install @commandrelay/proxy-http-client @commandrelay/proxy-agent
```

## Example

```ts
import type { IncomingHttpHeaders } from "node:http";
import { ProxyAgentFactory } from "@commandrelay/proxy-agent";
import { requestJson } from "@commandrelay/proxy-http-client";

type UndiciLikeResult<T> = {
  statusCode: number;
  headers: IncomingHttpHeaders;
  body: T | null;
  rawBody: string;
};

const proxyFactory = new ProxyAgentFactory();

export async function undiciLikeRequest<T>(
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

const response = await undiciLikeRequest<{ url: string }>("https://httpbin.org/get");
console.log(response.statusCode, response.body?.url);

proxyFactory.destroy();
```

# Fetch-style adapter with proxy-http-client

## Install

```bash
npm install @commandrelay/proxy-http-client @commandrelay/proxy-agent
```

## Example

```ts
import type { IncomingHttpHeaders } from "node:http";
import { ProxyAgentFactory } from "@commandrelay/proxy-agent";
import { requestJson } from "@commandrelay/proxy-http-client";

type FetchLikeResponse<T> = {
  ok: boolean;
  status: number;
  headers: IncomingHttpHeaders;
  json: () => Promise<T | null>;
  text: () => Promise<string>;
};

const proxyFactory = new ProxyAgentFactory();

export async function fetchLikeJson<T>(
  url: string,
  init: {
    method?: string;
    headers?: Record<string, string>;
    body?: unknown;
    signal?: AbortSignal;
  } = {}
): Promise<FetchLikeResponse<T>> {
  const result = await requestJson<T>(url, {
    method: init.method ?? "GET",
    headers: init.headers,
    body: init.body,
    signal: init.signal,
    timeoutMs: 8_000,
    proxyResolver: proxyFactory,
    throwOnHttpError: false
  });

  return {
    ok: result.status >= 200 && result.status < 300,
    status: result.status,
    headers: result.headers,
    json: async () => result.body,
    text: async () => result.rawBody
  };
}

const response = await fetchLikeJson<{ url: string }>("https://httpbin.org/get");
console.log(response.status, response.ok, await response.json());

proxyFactory.destroy();
```

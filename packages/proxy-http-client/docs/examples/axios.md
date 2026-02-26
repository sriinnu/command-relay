# Axios-style adapter with proxy-http-client

## Install

```bash
npm install @commandrelay/proxy-http-client @commandrelay/proxy-agent
```

## Example

```ts
import type { IncomingHttpHeaders } from "node:http";
import { ProxyAgentFactory } from "@commandrelay/proxy-agent";
import { requestJson } from "@commandrelay/proxy-http-client";

type AxiosLikeResponse<T> = {
  data: T | null;
  status: number;
  headers: IncomingHttpHeaders;
};

const proxyFactory = new ProxyAgentFactory();

export async function axiosLikeGet<T>(
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

const response = await axiosLikeGet<{ url: string }>("https://httpbin.org/get");
console.log(response.status, response.data?.url);

proxyFactory.destroy();
```

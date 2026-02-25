# Got-style adapter with proxy-http-client

## Install

```bash
npm install @commandrelay/proxy-http-client @commandrelay/proxy-agent
```

## Example

```ts
import { ProxyAgentFactory } from "@commandrelay/proxy-agent";
import { requestJson } from "@commandrelay/proxy-http-client";

const proxyFactory = new ProxyAgentFactory();

export async function gotLikeJson<T>(
  url: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: unknown;
    timeout?: number;
    signal?: AbortSignal;
  } = {}
): Promise<T | null> {
  const result = await requestJson<T>(url, {
    method: options.method ?? "GET",
    headers: options.headers,
    body: options.body,
    timeoutMs: options.timeout ?? 8_000,
    signal: options.signal,
    proxyResolver: proxyFactory
  });

  return result.body;
}

const payload = await gotLikeJson<{ url: string }>("https://httpbin.org/get");
console.log(payload?.url);

proxyFactory.destroy();
```

# Undici request

```ts
import { request } from "undici";
import { ProxyUndiciDispatcherFactory } from "@termina/proxy-undici";

const factory = new ProxyUndiciDispatcherFactory();
const resolved = factory.resolve("https://httpbin.org/get");

const response = await request("https://httpbin.org/get", {
  method: "GET",
  dispatcher: resolved.dispatcher
});

console.log(resolved.viaProxy, resolved.proxyUrl);
console.log(await response.body.json());
factory.destroy();
```

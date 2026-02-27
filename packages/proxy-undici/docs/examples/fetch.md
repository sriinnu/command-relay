# Node fetch with Undici dispatcher

```ts
import { ProxyUndiciDispatcherFactory } from "@termina/proxy-undici";

const factory = new ProxyUndiciDispatcherFactory();
const resolved = factory.resolve("https://httpbin.org/json");

const response = await fetch("https://httpbin.org/json", {
  dispatcher: resolved.dispatcher as never
});

console.log(resolved.viaProxy, resolved.proxyUrl);
console.log(await response.json());
factory.destroy();
```

`dispatcher` is a Node/Undici option and is not supported in browsers.

# Integration Note: External Apps

Use this package as your app's HTTP boundary adapter.

## Minimal Checklist

- Keep calls in one module (for example `src/infra/http/client.ts`).
- Set `timeoutMs` per upstream SLA; do not rely on defaults for critical flows.
- Set `maxResponseBytes` to realistic payload ceilings per endpoint.
- Map library errors to app-domain errors in one place.
- Inject `proxyResolver` only when your runtime requires proxy routing.
- Avoid logging full response bodies for failures in production.

## Copy/Paste Starter

```ts
import { requestJson } from "@commandrelay/proxy-http-client";

export async function getJson<T>(url: string, signal?: AbortSignal): Promise<T | null> {
  const result = await requestJson<T>(url, {
    timeoutMs: 4_000,
    maxResponseBytes: 512_000,
    signal
  });
  return result.body;
}
```

## Related

- [Package README](./README.md)
- [Brand SVG](./docs/assets/proxy-http-client-brand.svg)

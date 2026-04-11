# Integration Note: External Apps

Use this package as your app's HTTP boundary adapter.

## Minimal Checklist

- Keep calls in one module (for example `src/infra/http/client.ts`).
- Set `timeoutMs` per upstream SLA; do not rely on defaults for critical flows.
- Set `maxResponseBytes` to realistic payload ceilings per endpoint.
- Large payloads are blocked early when upstream sends an oversized `content-length`.
- Map library errors to app-domain errors in one place.
- Inject `proxyResolver` only when your runtime requires proxy routing.
- Avoid logging full response bodies for failures in production.

## Migration and Compatibility

- Migrate from scattered HTTP calls to one boundary wrapper around `requestJson`.
- Make timeout, payload limit, and error translation explicit in that wrapper to avoid per-call drift.
- Add `proxyResolver` only at boundary level when corporate/network policy requires it.
- Use package root exports only; avoid deep imports for compatibility stability.
- While pre-`1.0`, pin minor versions (`~0.1.x`) during staged rollouts.

## Troubleshooting

- `HttpStatusError` handling too aggressive: set `throwOnHttpError: false` when callers need non-2xx payload inspection.
- Missing request cancellation: pass `AbortSignal` through wrapper APIs and upstream call chains.
- Large responses rejected: verify endpoint payload size and adjust `maxResponseBytes` intentionally.
- Intermittent proxy failures: validate resolver behavior and ensure proxy env/agent settings are refreshed.

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

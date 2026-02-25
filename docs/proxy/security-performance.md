# Proxy Security and Performance Guidance

This guide captures current security and performance behavior for `@commandrelay/proxy-*` and runtime adapters.

## Security Controls Implemented Today

- Proxy env parsing hardening
  - Package contract: lowercase proxy env vars override uppercase variants.
  - Uppercase `HTTP_PROXY` is ignored when `REQUEST_METHOD` is present (CGI mitigation).
  - Sanitization rejects unsupported schemes and malformed proxy URLs.
  - Allowed schemes: `http`, `https`, `socks`, `socks4`, `socks4a`, `socks5`, `socks5h`, `pac+http`, `pac+https`, `pac+file`, `pac+data`.
- Route selection safety
  - `NO_PROXY` supports host/domain, wildcard-style subdomain tokens, IPv4/IPv6, port-scoped entries, and URL-like tokens.
  - Default ports used for matching: `http/ws=80`, `https/wss=443`.
  - Invalid `NO_PROXY` tokens are ignored safely.
- Request path hardening (`proxy-http-client`)
  - Only `http:` and `https:` request URLs are accepted.
  - `ws:` and `wss:` requests are rejected before proxy resolution.
  - Timeout and abort controls are enforced in transport flow.
  - Typed errors include protocol, proxy-resolution, timeout, abort, HTTP status, and JSON parse failures.

## Runtime Integration Caveats

- `src/net/proxy-router.ts` keeps legacy fallback (`HTTP_PROXY || http_proxy`), so uppercase can win unless uppercase is empty.
- `src/index.ts` initializes proxy settings/factory and logs detection, but does not make outbound control-plane requests in startup flow.
- Malformed proxy env values are sanitized to `null`; they do not hard-fail startup.

## Production Security Guidance

- Keep `COMMANDRELAY_HOST` loopback unless `COMMANDRELAY_AUTH_TOKEN` is set.
- Do not log raw proxy URLs containing credentials.
- Add explicit `NO_PROXY` entries for internal control-plane and telemetry hosts.
- Enforce egress policy outside the process:
  - Allowlist expected external destinations.
  - Deny internal CIDR access unless explicitly required.
- Treat PAC sources as executable policy:
  - Restrict PAC origin.
  - Monitor PAC host integrity.

## Performance Baseline

- `ProxyAgentFactory` cache key is `proxyUrl|targetProtocol`.
- Cache default is `256` entries with LRU-style eviction (`maxCacheEntries=0` disables cache).
- `proxy-http-client` default timeout is `8000ms` (`timeoutMs=0` disables request timeout).
- Existing runtime perf scripts remain in `scripts/perf/*`.

## Tuning Guidance

| Control | Default | Guidance |
| --- | --- | --- |
| `maxCacheEntries` | `256` | Lower for small stable route sets; raise for high proxy/target cardinality |
| `timeoutMs` | `8000` | Tune by endpoint SLO; avoid `0` unless an upstream deadline exists |
| `NO_PROXY` | unset | Add explicit bypass entries for low-latency internal paths |

## Observability Signals

- Route outcomes: direct vs proxied counts, plus cache hit rate (`fromCache`) where surfaced.
- Error classes:
  - `RequestTimeoutError`, `RequestAbortedError`
  - `ProxyResolutionError`
  - `HttpStatusError` and `JsonParseError`
  - `ControlPlaneHttpError` in control-plane adapter path
- Latency: p50/p95 by target host and route type (direct/proxied).

## Release Validation Gate

- Package and integration tests:
  - `npm --prefix packages/proxy-core test`
  - `npm --prefix packages/proxy-agent test`
  - `npm --prefix packages/proxy-http-client test`
  - `node --import tsx --test src/net/proxy-router.test.ts src/net/proxy-agent-factory.test.ts src/control-plane/control-plane-client.test.ts`
- Publish runbook:
  - Run `Publish Proxy Packages` workflow in `dry-run` mode for `@commandrelay/proxy-*`.
  - Verify check/build/test and dry-run publish output before production publish.

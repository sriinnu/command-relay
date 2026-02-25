# Proxy Security and Performance Guidance

This guide covers production security and performance practices for `@commandrelay/proxy-*`.

## Security Controls Implemented In Packages

- Proxy env parsing hardening
  - Lowercase env variables override uppercase variants
  - Uppercase `HTTP_PROXY` is ignored when `REQUEST_METHOD` is set
  - Unsupported proxy URL schemes are rejected during sanitization
- Route selection safety
  - `NO_PROXY` supports exact host, wildcard subdomain, IPv4/IPv6, and port-scoped entries
  - Default protocol ports are applied for bypass matching (`http/ws=80`, `https/wss=443`)
  - Invalid `NO_PROXY` tokens are ignored safely
- Request path hardening
  - `proxy-http-client` accepts only `http:` and `https:` request URLs
  - Timeout and abort are enforced in transport flow
  - Typed errors surface timeout, transport, status, and parse failures

## Security Guidance For Production

- Keep `COMMANDRELAY_HOST` loopback unless `COMMANDRELAY_AUTH_TOKEN` is present
- Do not log raw proxy URLs containing credentials; log redacted endpoints only
- Add explicit `NO_PROXY` entries for internal control-plane and telemetry hosts
- Enforce egress policy outside the app:
  - Allowlist expected external destinations
  - Deny internal CIDR access unless intentionally required
- Treat PAC sources as executable policy:
  - Restrict PAC origin
  - Pin and monitor PAC hosting integrity

## Performance Baseline

- `ProxyAgentFactory` caches by `proxyUrl|targetProtocol`
- Default cache size is `256` entries with LRU-style eviction
- `proxy-http-client` default timeout is `8000ms`
- Existing runtime perf scripts are available in `scripts/perf/*`

## Tuning Guidance

| Control | Default | Guidance |
| --- | --- | --- |
| `maxCacheEntries` | `256` | Lower for fixed route sets, raise for high target cardinality |
| `timeoutMs` | `8000` | Tune per endpoint SLO; avoid unbounded waits |
| `NO_PROXY` | unset | Add explicit bypass for low-latency internal paths |

## Observability Signals

- Proxy route outcomes
  - direct vs proxied request count
  - cache hit rate (`fromCache`) where captured
- Request failures
  - timeout rate (`RequestTimeoutError`)
  - HTTP status failure rate (`HttpStatusError`)
  - JSON parse failure rate (`JsonParseError`)
- Latency
  - p50/p95 by target host and route type (direct/proxied)
  - connect/handshake regression after deploy or proxy configuration change

## Release Validation Gate

- Package and integration tests:
  - `npm --prefix packages/proxy-core test`
  - `npm --prefix packages/proxy-agent test`
  - `npm --prefix packages/proxy-http-client test`
  - `node --import tsx --test src/net/proxy-router.test.ts src/net/proxy-agent-factory.test.ts src/control-plane/control-plane-client.test.ts`
- Publish runbook:
  - Run `Publish Proxy Packages` workflow in `dry-run` mode for `@commandrelay/proxy-*`
  - Verify check/build/test and dry-run publish output before production publish

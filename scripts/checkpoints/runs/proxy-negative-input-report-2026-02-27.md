# Proxy Negative Input Report (2026-02-27)

- Command: `node --import tsx --test src/net/proxy-agent-factory.test.ts`
- Result: pass (`# pass 1`, `# fail 0`)

| Scenario | Test Name | Expected | Actual | Status |
| --- | --- | --- | --- | --- |
| Malformed URL handling | `throws invalid_proxy_url for malformed credential-bearing proxy URLs` | Factory rejects malformed proxy URLs with `invalid_proxy_url` instead of silently proxying. | `factory.resolve("https://example.com")` throws and matches `/invalid_proxy_url/` for malformed HTTP, SOCKS, and PAC credential-bearing URLs. | PASS |
| NO_PROXY edge precedence | `keeps uppercase NO_PROXY precedence over lowercase no_proxy` | Uppercase `NO_PROXY` should control matching when both vars are set; lowercase wildcard should not override it. | `http://example.com` bypasses proxy, while `http://external.local` still proxies via `HTTP_PROXY`. | PASS |
| PAC failure path (explicit runtime assertion) | `surfaces PAC resolver failures during connect attempts` | PAC resolver/script failures should surface as connection errors when the PAC agent is used, not appear as successful direct routing. | A `PacProxyAgent` is created from `pac+data:` input, and `connect()` rejects on invalid PAC source with a non-empty error message. | PASS |
| Fallback behavior for invalid env proxies | `falls back to direct mode when env proxy values are invalid or unsupported` | Invalid/unsupported env proxy values should degrade to direct mode (`viaProxy=false`, no agent) rather than throw at call sites. | For both `http://example.com` and `https://example.com`, resolution is direct (`viaProxy=false`, `proxyUrl=null`, `agent=null`). | PASS |

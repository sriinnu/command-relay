# Proxy-Agent Research Notes

Last updated: 2026-02-24

## Objective

Design and implement a first-party, reusable proxy-agent ecosystem that is:

1. Functionally complete (`http`, `https`, `ws/wss`, `socks`, `pac`)
2. Secure by default
3. High performance and observable
4. Testable, modular, and scalable across projects

## Primary Sources Reviewed

1. TooTallNate proxy-agents monorepo (architecture and package split)
   - https://github.com/TooTallNate/proxy-agents
2. proxy-agent package behavior summary (protocol mapping + env selection + caching)
   - https://npm.io/package/proxy-agent
3. proxy-from-env behavior (NO_PROXY matching semantics)
   - https://www.npmjs.com/package/proxy-from-env
   - https://raw.githubusercontent.com/Rob--W/proxy-from-env/master/index.js
4. HTTP semantics for proxies and CONNECT tunnel behavior
   - RFC 7230: https://www.rfc-editor.org/rfc/rfc7230
   - RFC 9110: https://www.rfc-editor.org/rfc/rfc9110
   - RFC 2817: https://www.rfc-editor.org/rfc/rfc2817
5. SOCKS5 protocol requirements
   - RFC 1928: https://www.rfc-editor.org/rfc/rfc1928
6. ArXiv: Formal Analysis of the API Proxy Problem (threat model implications)
   - https://arxiv.org/abs/2302.13525
   - https://ar5iv.org/pdf/2302.13525
7. ArXiv: Fuzzing Frameworks for Server-side Web Applications: A Survey (test strategy implications)
   - https://arxiv.org/pdf/2406.03208
8. ArXiv: Early Detection of Performance Regressions by Bridging Local Performance Data and Architectural Models
   - https://www.arxiv.org/pdf/2408.08148

## Key Findings

### From proxy-agents ecosystem

1. Separation of concerns works: one umbrella package (`proxy-agent`) over protocol-specific agents.
2. Env-based proxy selection + reusable agent cache is core to production utility.
3. Lazy loading expensive dependencies (notably PAC) is a practical performance win.

### From RFCs

1. Proxy request-target handling is strict:
   - absolute-form for proxied HTTP requests (RFC 7230)
   - authority-form for CONNECT tunnel requests (RFC 7230 / RFC 9110)
2. CONNECT semantics must be treated as a protocol mode switch after 2xx (RFC 9110 / RFC 2817).
3. SOCKS5 authentication/address handling must follow protocol constraints (RFC 1928).

### From ArXiv literature

1. API-proxy security is hard at scale and exact discovery can be computationally intractable (NP-complete framing in 2302.13525).
   - Inference: our security model should favor conservative over-approximation (deny/guard more routes) over incomplete exactness.
2. Web/API fuzzing literature highlights that black-box-only happy-path tests are insufficient for security regressions (2406.03208).
   - Inference: protocol/state fuzzing and malformed input coverage should be first-class in CI.
3. Performance-regression research supports combining local microbenchmarks with architecture-level checks (2408.08148).
   - Inference: package-level perf tests should be paired with end-to-end connection pool behavior tests.

## Recommended Package Architecture

1. `@commandrelay/proxy-core`
   - env parsing (`HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, `NO_PROXY`)
   - no_proxy parser/matcher
   - URL -> proxy resolution policy
2. `@commandrelay/proxy-http-agent`
   - HTTP over proxy (absolute-form semantics)
3. `@commandrelay/proxy-https-agent`
   - CONNECT tunnel + TLS handling
4. `@commandrelay/proxy-socks-agent`
   - SOCKS4/4a/5 support
5. `@commandrelay/proxy-pac-agent`
   - PAC resolver + sandbox strategy
6. `@commandrelay/proxy-agent`
   - umbrella resolver, lazy loading, LRU agent cache

## Security Requirements (Non-Negotiable)

1. No secret logging in errors/debug paths (proxy creds, auth headers).
2. Strict URL/proxy URL validation with explicit protocol allowlist.
3. SSRF-resistant defaults in PAC resolution and outbound target checks.
4. Timeouts on DNS, connect, TLS handshake, and request lifetime.
5. Per-target and per-proxy connection caps to limit blast radius.
6. Deterministic handling of bypass (`NO_PROXY`) with exact test vectors.

## Performance Requirements

1. Agent reuse cache (LRU) keyed by `(proxy-url, target-protocol, tls-profile)`.
2. Lazy import/load for expensive agent types (PAC resolver stack).
3. KeepAlive defaults tuned for high-throughput clients.
4. Benchmarks for:
   - cold connect latency
   - steady-state req/s
   - memory/socket growth under churn

## Test Strategy

1. Contract tests for env semantics and bypass rules.
2. RFC behavior tests for absolute-form and CONNECT authority-form.
3. Proxy auth tests (basic credentials, malformed credentials).
4. Fault-injection tests (proxy drops, half-open sockets, timeout storms).
5. Fuzz tests for parser and state transitions (message, URL, headers).
6. Perf regression checks in CI (micro + integration).

## Implementation Plan (Next)

1. Stabilize TypeScript baseline for current bridge runtime.
2. Finish `@commandrelay/proxy-core` and `@commandrelay/proxy-agent` as publishable packages.
3. Add protocol-specific packages incrementally (`http`, `https`, `socks`, `pac`).
4. Add conformance matrix tests + benchmark suite.
5. Publish internal prerelease tags and integrate in bridge runtime.

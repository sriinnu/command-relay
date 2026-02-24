# CommandRelay Proxy Ecosystem Design

Last updated: 2026-02-24
Status: Draft for implementation
Ownership: This document only covers `proxy-core`, `proxy-agent`, `proxy-http-client`.

## 1. Why this exists

CommandRelay needs a reusable outbound proxy stack that is:

1. Correct against HTTP proxy semantics.
2. Safe under hostile or misconfigured network environments.
3. Fast under sustained agent/tool traffic.
4. Reliable for autonomous retry/fallback behavior.

Current repository state (observed):

- `@commandrelay/proxy-core` exists and already parses proxy env vars.
- Proxy-agent behavior currently lives in app runtime (`src/net/proxy-agent-factory.ts`) instead of a package.
- Outbound HTTP JSON client (`src/net/outbound-http.ts`) is not yet a standalone package.

[Inference] This doc proposes package extraction and hardening, not a greenfield implementation.

## 2. Evidence model

Tag meaning used throughout this document:

- `[Source]` Directly grounded in a linked specification or paper.
- `[Inference]` Design choice derived from sources plus current codebase constraints.

## 3. Research references

### 3.1 Protocol and standards references

1. HTTP Semantics (RFC 9110): https://www.rfc-editor.org/rfc/rfc9110
2. HTTP/1.1 messaging and request-target forms (RFC 9112): https://www.rfc-editor.org/rfc/rfc9112
3. HTTP/2 CONNECT and resource considerations (RFC 9113): https://www.rfc-editor.org/rfc/rfc9113
4. SOCKS5 protocol (RFC 1928): https://www.rfc-editor.org/rfc/rfc1928
5. Forwarded header (RFC 7239): https://www.rfc-editor.org/rfc/rfc7239
6. TLS/DTLS BCP recommendations (RFC 9325): https://www.rfc-editor.org/rfc/rfc9325
7. W3C Trace Context: https://www.w3.org/TR/trace-context/

### 3.2 arXiv references

1. Formal Analysis of the API Proxy Problem (arXiv:2302.13525): https://arxiv.org/abs/2302.13525
2. Fuzzing Frameworks for Server-side Web Applications: A Survey (arXiv:2406.03208): https://arxiv.org/abs/2406.03208
3. Early Detection of Performance Regressions by Bridging Local Performance Data and Architectural Models (arXiv:2408.08148): https://arxiv.org/abs/2408.08148
4. Reflexion: Language Agents with Verbal Reinforcement Learning (arXiv:2303.11366): https://arxiv.org/abs/2303.11366

### 3.3 Ecosystem behavior references

1. TooTallNate proxy-agents monorepo: https://github.com/TooTallNate/proxy-agents
2. `proxy-agent` package behavior and LRU reuse: https://www.npmjs.com/package/proxy-agent
3. `proxy-from-env` NO_PROXY conventions: https://www.npmjs.com/package/proxy-from-env

[Inference] Item 3.3 is not a formal standard, but is de facto Node.js behavior and should be treated as compatibility baseline.

## 4. Source-backed requirements

1. [Source] Clients talking to HTTP/1.1 proxies MUST use absolute-form for non-CONNECT requests (RFC 9112, Section 3.2.2).
2. [Source] CONNECT requests use authority-form host:port semantics (RFC 9112, Section 3.2.3; RFC 9110, Section 9.3.6).
3. [Source] Proxies forwarding requests must rewrite/handle host authority correctly and attach `Via` when forwarding (RFC 9112 Section 3.2.2, RFC 9110 Section 7.6.3).
4. [Source] `Proxy-Authorization` is hop-by-hop and consumed by next inbound proxy (RFC 9110, Section 11.7.2).
5. [Source] SOCKS5 has strict method negotiation and address typing (`METHOD`, `ATYP`) (RFC 1928).
6. [Source] HTTP/2 CONNECT turns one stream into a tunnel and can create disproportionate load if unbounded (RFC 9113, Sections 8.5 and 10.5.2).
7. [Source] Trace context headers should be created/propagated consistently when intermediaries forward requests (W3C Trace Context, Section 4).
8. [Source] Secure defaults should follow modern TLS guidance with preference toward TLS 1.3 baseline policies (RFC 9325).
9. [Source] API-proxy discovery is NP-complete in general; safe overapproximation can trade utility for security (arXiv:2302.13525).
10. [Source] Web/API fuzzing needs robust generation beyond happy paths and must address microservice complexity (arXiv:2406.03208).
11. [Source] Early performance regression detection improves when local component metrics are bridged to architecture-level models (arXiv:2408.08148).
12. [Source] Agent loops improve with explicit feedback memory in trial-and-error settings (arXiv:2303.11366).

## 5. Proposed package architecture

### 5.1 Package responsibilities

### `@commandrelay/proxy-core`

Responsibility:

- Parse and normalize env proxy config.
- Resolve proxy route for URL/protocol.
- Evaluate NO_PROXY bypass rules.
- Provide redaction helpers for safe telemetry.
- Provide policy primitives, no network I/O.

Public surface (target):

- `loadProxySettings(env?): ProxySettings`
- `resolveProxyForUrl(target, settings): string | null`
- `shouldBypassProxy(target, rules): boolean`
- `sanitizeProxyUrl(value): string | null`
- `redactProxyCredentials(url): string`

[Inference] `proxy-core` remains dependency-free so it can run in runtime, CLI, and tests.

### `@commandrelay/proxy-agent`

Responsibility:

- Map resolved proxy scheme to concrete agent implementation.
- Build and cache reusable agent/tunnel instances.
- Enforce connection bounds and timeout policies.
- Emit structured diagnostics (no secrets).

Public surface (target):

- `new ProxyAgentFactory(options)`
- `factory.resolve(target): AgentResolution`
- `factory.clear()`
- `factory.stats(): ProxyAgentStats`

[Inference] Existing `src/net/proxy-agent-factory.ts` moves here with tighter policy controls.

### `@commandrelay/proxy-http-client`

Responsibility:

- Provide high-level HTTP(S) request client integrated with `proxy-agent`.
- Implement retry classification, deadlines, and circuit protection.
- Propagate trace headers and stable request IDs.
- Return rich typed result/errors for callers.

Public surface (target):

- `requestJson(url, options, deps?): Promise<Response<T>>`
- `requestStream(url, options, deps?): Promise<StreamResponse>`
- `class ProxyHttpError extends Error`

[Inference] `proxy-http-client` owns reliability policy so agent construction remains transport-focused.

### 5.2 Dependency graph

```text
+-------------------------------+
| @commandrelay/proxy-http-client|
| - retries/deadlines/tracing   |
+---------------+---------------+
                |
                v
+-------------------------------+
| @commandrelay/proxy-agent     |
| - scheme mapping              |
| - cache + limits              |
+---------------+---------------+
                |
                v
+-------------------------------+
| @commandrelay/proxy-core      |
| - env parse + NO_PROXY        |
| - pure policy logic           |
+-------------------------------+
```

### 5.3 Request flow (HTTP target via HTTP proxy)

```text
Caller
  |
  | requestJson("https://api.example.com")
  v
proxy-http-client
  | resolve + classify request
  v
proxy-agent
  | resolveProxyForUrl(target)
  v
proxy-core
  | env + no_proxy decision
  v
proxy-agent
  | choose HttpsProxyAgent (CONNECT)
  | cache key = proxyUrl + targetProtocol + tlsProfile
  v
Node transport
  | CONNECT proxy -> target:443
  v
Target service
```

## 6. Performance design

### 6.1 Key concerns

1. [Source] HTTP/2 CONNECT can overconsume proxy resources if only stream count is bounded (RFC 9113 Section 10.5.2).
2. [Inference] Large unique target/proxy combinations can cause unbounded agent cache growth.
3. [Inference] PAC and DNS resolution can dominate p95 latency for short RPC calls.
4. [Inference] Retry storms can amplify connection churn and queueing under partial outages.
5. [Source] Early regression detection works better when component metrics are tied to architecture model expectations (arXiv:2408.08148).

### 6.2 Performance controls

1. Bounded LRU cache with max entries and eviction telemetry.
2. Per-proxy and global concurrent CONNECT limits.
3. Separate connect timeout, TLS handshake timeout, response timeout.
4. Keep-alive defaults with idle socket caps.
5. Adaptive retry budget at client level, not transport level.
6. Benchmarks in two layers: micro (parse/resolve/cache hit/miss costs) and integration (req/s, p95, socket growth under churn and failure).

[Inference] Use the architecture-bridging idea from arXiv:2408.08148 as CI gate: fail PR if component regressions predict end-to-end SLA breach.

## 7. Security design

### 7.1 Threat-focused concerns

1. [Source] CONNECT to unsafe ports can turn proxies into abuse relays (RFC 9110 Section 9.3.6).
2. [Source] Proxy credentials are hop-specific and sensitive (RFC 9110 Section 11.7.2).
3. [Source] Message forwarding must handle hop-by-hop behavior correctly (RFC 9110 Section 7.6).
4. [Source] TLS hardening should track BCP updates (RFC 9325).
5. [Source] Exact API-proxy discovery is computationally hard; missing alternate paths is realistic (arXiv:2302.13525).

### 7.2 Required safeguards

1. Denylist or allowlist CONNECT destination ports.
2. Redact `userinfo`, `Proxy-Authorization`, and auth query tokens in all logs/errors.
3. Strict proxy URL scheme allowlist (`http`, `https`, `socks*`, `pac+*` only).
4. Enforce max header size and body limits for proxy control paths.
5. Default to TLS verification enabled; no insecure fallback modes by default.
6. Disable implicit credential forwarding across proxy hops.
7. Add explicit SSRF guard hooks for internal CIDR deny policies.
8. Preserve trace context but allow proxy-side `tracestate` pruning per W3C guidance.

[Inference] Because of the NP-complete proxy-relationship result (arXiv:2302.13525), security policy should favor conservative overapproximation (block more ambiguous flows, then carve out explicit allow rules).

## 8. Agentic reliability model

`proxy-agent` in this design is a transport component, not an LLM planner. Agentic reliability here means autonomous control loops in networking behavior.

Reliability loop:

```text
attempt request
   |
   v
classify result -> success / retryable / terminal
   |
   +--> terminal: return typed error
   |
   +--> retryable: update per-endpoint feedback memory
                     |
                     v
                 choose next action
                 (backoff, alternate proxy, direct)
                     |
                     v
                 retry within budget
```

[Source] Reflexion (arXiv:2303.11366) supports explicit feedback memory for better trial-and-error behavior.
[Inference] Apply that concept without model fine-tuning: maintain deterministic in-memory "failure memory" keyed by `(proxy, host, error-class)` to avoid repeating known-bad routes during short windows.

## 9. Testing strategy tied to evidence

1. RFC conformance tests: HTTP/1.1 absolute-form and CONNECT authority-form vectors, proxy-auth hop behavior checks, and SOCKS5 method/address negotiation edge cases.

2. Security tests: parser/state fuzzing for env vars, URLs, headers; malformed CONNECT targets; restricted-port enforcement; redaction invariants in logs/errors.

3. Reliability tests: fault injection (timeouts, half-open sockets, RST storms, DNS failures) plus retry budget correctness and anti-storm behavior.

4. Performance tests: micro + integration benchmarks and a regression prediction gate aligned with the architecture model.

[Source] Fuzzing breadth and stateful complexity concerns: arXiv:2406.03208.

## 10. Rollout plan

1. Extract current core logic into publishable `@commandrelay/proxy-core` with zero behavior change.
2. Move `ProxyAgentFactory` into `@commandrelay/proxy-agent` and add limits, telemetry, redaction.
3. Extract `requestJson` path into `@commandrelay/proxy-http-client` and add retry/deadline policies.
4. Add conformance, fuzz, and benchmark suites.
5. Gate release on security and performance checks.

## 11. Open decisions

1. Should `proxy-http-client` support HTTP/2 and HTTP/3 from v1, or ship HTTP/1.1 first?
2. Should PAC resolution be in-process or isolated worker process for blast-radius reduction?
3. Should alternate-proxy fallback be opt-in per request class (control-plane vs telemetry)?
4. Which trace keys are allowed to survive proxy boundary by default?

## 12. Summary

This ecosystem keeps policy in `proxy-core`, transport mapping in `proxy-agent`, and reliability behavior in `proxy-http-client`. It is grounded in RFC proxy semantics and augmented by research on proxy security complexity, fuzzing strategy, performance regression detection, and feedback-driven reliability loops.

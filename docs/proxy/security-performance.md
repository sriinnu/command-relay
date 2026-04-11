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

## Negative-Case Guarantees

- Malformed or unsupported proxy URL env values are sanitized to `null` and never throw during settings load.
- Malformed `NO_PROXY` tokens are ignored safely; valid tokens in the same list still apply.
- `NO_PROXY` suffix matching enforces label boundaries (`badexample.com` does not match `example.com`).
- Invalid `NO_PROXY` ports (for example `:99999`) degrade to host-only matching without parser failure.
- Fallback behavior is explicit:
  - `https`/`wss`: `HTTPS_PROXY -> HTTP_PROXY -> ALL_PROXY`
  - `http`/`ws`: `HTTP_PROXY -> ALL_PROXY`
  - unknown schemes: `ALL_PROXY` only (otherwise direct)

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

## TLS Trust and Handshake Model (Production Reference)

- `@commandrelay/relay-proxy` uses `ws` with `wss://` when available for the upstream hop.
- During upstream connect, the standard TLS handshake sequence is:
  - TCP connect to the upstream endpoint.
  - `ClientHello` from relay client carrying supported ciphers and supported key-exchange groups.
  - `ServerHello` + certificate chain.
  - Optional server authentication (chain/path + hostname check) and optionally client authentication.
  - Ephemeral key exchange to derive a symmetric session key.
  - Finished messages and encrypted traffic using symmetric keys.
- When using `COMMANDRELAY_RELAY_UPSTREAM_TLS_REJECT_UNAUTHORIZED` (default `true`), certificate validation is strict and rejected if trust is invalid.
- For mTLS, set `..._CA_FILE`, `..._CERT_FILE`, and `..._KEY_FILE` to provide chain and client identity to the upstream `wss` dialer.
- TLS material validation rules at startup:
  - `CERT` and `KEY` must be provided together.
  - `PFX` cannot be combined with `CERT`/`KEY`.
  - `MIN_VERSION` and `MAX_VERSION` must be one of `TLSv1.1|TLSv1.2|TLSv1.3` and honor ordering (`min <= max`).
- At runtime, the relay only decrypts and re-encrypts at each endpoint boundary:
  - Frames from relay client to relay server are decrypted by relay server.
  - Frames from relay server to upstream are separately encrypted/decrypted under upstream TLS keys.
- For HTTP proxy CONNECT flows:
  - TLS between relay and destination is established after CONNECT negotiation.
  - The proxy sees CONNECT metadata (host/port), not application plaintext when tunnel mode is active.

## Runtime Status and Heartbeat

- `@commandrelay/relay-proxy` always exposes a status endpoint at `GET /status` in addition to the configured `COMMANDRELAY_RELAY_HEALTH_PATH` (default `/health`).
- Health responses return:
  - `status` (`open` for `/status`, `ok` for `/health`)
  - `heartbeat.checkedAtMs` (or `heartbeat` value on `/health`)
  - active/total connection counters
  - upstream target and selected TLS trust settings
- Use this for CI/operator checks:
  - Poll `curl -sS http://127.0.0.1:8788/status`
  - Verify `status=open` and `heartbeat.checkedAtMs` increments
  - Verify `activeConnections` is expected and no unexpected `proxyUrl` path is open if behind token gate.

## Build/Test Proof and Certificate-Rotation Exercises

- Deterministic package verification:
  - `npm --prefix packages/commandrelay-relay-proxy test`
  - `npm --prefix packages/commandrelay-relay-proxy run check`
  - `npm --prefix packages/commandrelay-relay-proxy run build`
  - Ensure `packages/commandrelay-relay-proxy/dist/index.js` and `dist/cli.js` are recreated after build.
- End-to-end runtime smoke checks (quick):
  - `node packages/commandrelay-relay-proxy/agent1-smoke.mjs`
  - `node packages/commandrelay-relay-proxy/agent2-lifecycle.mjs`
  - `node packages/commandrelay-relay-proxy/agent3-cli-build.mjs`
- Relay upstream TLS validation tests:
  - Test with valid CA bundle:
    - Start upstream with server cert signed by private CA.
    - Start relay with `--upstream-tls-ca-file`, `--upstream-tls-cert-file`, `--upstream-tls-key-file`.
    - Confirm `/status` reports `upstream.tls.hasClientIdentity=true` and connection succeeds.
  - Test trust rejection:
    - Run without CA/with wrong CA and `--upstream-tls-reject-unauthorized true`; expect upstream handshake failure.
  - Test forced trust:
    - Set `--upstream-tls-reject-unauthorized false` only for rollback drill; confirm relay starts and connects while recording risk decision.
- Certificate rotation playbook:
  - Keep old and new CA/certs on disk side-by-side (`ca-old.pem`, `ca-new.pem`).
  - Roll relay by updating `COMMANDRELAY_RELAY_UPSTREAM_TLS_CA_FILE` and restarting (`SIGHUP` is not wired today).
  - For zero-downtime rollout, run a second relay instance with the new cert set, drain old sessions, then shift upstream route to the new relay.
  - After cutover, verify both:
    - `/status` shows expected active session counts and open/close transitions.
    - client reconnects remain green while old cert windows expire.

## Windows PowerShell (native)

- Native status/heartbeat checks:
  - `Invoke-RestMethod http://127.0.0.1:8788/status`
  - `if ((Invoke-RestMethod http://127.0.0.1:8788/status).status -eq 'open') { 'OPEN' }`
  - Poll loop:
    ```powershell
    while ($true) {
      $s = Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:8788/status"
      Write-Host "$([DateTime]::UtcNow.ToString('o')) status=$($s.status) checkedAtMs=$($s.heartbeat.checkedAtMs) active=$($s.activeConnections) total=$($s.totalConnections)"
      Start-Sleep -Seconds 2
    }
    ```
- Equivalent build/test commands:
  - `npm --prefix packages\commandrelay-relay-proxy run check`
  - `npm --prefix packages\commandrelay-relay-proxy run build`
  - `npm --prefix packages\commandrelay-relay-proxy test`
  - `node packages\commandrelay-relay-proxy\agent1-smoke.mjs`
  - `node packages\commandrelay-relay-proxy\agent2-lifecycle.mjs`
  - `node packages\commandrelay-relay-proxy\agent3-cli-build.mjs`
- TLS env vars and rotation in PowerShell:
  - `Setx` for persistent environment, or inline session vars:
    ```powershell
    $env:COMMANDRELAY_RELAY_UPSTREAM_TLS_CA_FILE = "C:\certs\ca-new.pem"
    $env:COMMANDRELAY_RELAY_UPSTREAM_TLS_CERT_FILE = "C:\certs\client-new.pem"
    $env:COMMANDRELAY_RELAY_UPSTREAM_TLS_KEY_FILE = "C:\certs\client-new.key"
    $env:COMMANDRELAY_RELAY_UPSTREAM_TLS_REJECT_UNAUTHORIZED = "true"
    ```
  - Restart relay host process/service after switching to new files and confirm heartbeat resumes normal on `/status`.
- Replace `curl`/`watch` on Windows-native path:
  - Use `Invoke-RestMethod` + `Start-Sleep` loops as shown above.

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

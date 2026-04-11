import assert from "node:assert/strict";
import test from "node:test";

import {
  loadProxySettings,
  parseNoProxy,
  resolveProxyForUrl,
  resolveProxyForUrlFromEnv,
  shouldBypassProxy
} from "../src/index.js";

test("loadProxySettings prefers lowercase variables and normalizes proxy URLs", () => {
  const settings = loadProxySettings({
    http_proxy: "proxy.local:8080",
    HTTP_PROXY: "http://ignored.local:3000",
    HTTPS_PROXY: "https://secure.local:443",
    ALL_PROXY: "socks5://fallback.local:1080"
  });

  assert.equal(settings.httpProxy, "http://proxy.local:8080/");
  assert.equal(settings.httpsProxy, "https://secure.local/");
  assert.equal(settings.allProxy, "socks5://fallback.local:1080");
});

test("loadProxySettings ignores uppercase HTTP_PROXY in CGI-like environments", () => {
  const settings = loadProxySettings({
    REQUEST_METHOD: "GET",
    HTTP_PROXY: "http://attacker.local:9999",
    HTTPS_PROXY: "https://secure.local:443"
  });

  assert.equal(settings.httpProxy, null);
  assert.equal(settings.httpsProxy, "https://secure.local/");
});

test("loadProxySettings drops unsupported proxy protocols", () => {
  const settings = loadProxySettings({
    http_proxy: "ftp://unsupported.local:2121",
    https_proxy: "gopher://legacy.local:70",
    all_proxy: "ssh://bastion.local:22"
  });

  assert.equal(settings.httpProxy, null);
  assert.equal(settings.httpsProxy, null);
  assert.equal(settings.allProxy, null);
});

test("parseNoProxy supports wildcard, domain, port, localhost, URL tokens, and IPv6", () => {
  const rules = parseNoProxy(
    "*.example.com,.svc.local:8443,localhost,http://service.internal:8080,[::1]:9090"
  );

  assert.deepEqual(rules, [
    { host: "example.com", port: null, matchSubdomains: true },
    { host: "svc.local", port: 8443, matchSubdomains: true },
    { host: "localhost", port: null, matchSubdomains: false },
    { host: "service.internal", port: 8080, matchSubdomains: true },
    { host: "::1", port: 9090, matchSubdomains: false }
  ]);
});

test("parseNoProxy drops invalid and empty entries", () => {
  const rules = parseNoProxy(
    " , [broken, host with spaces:8080, ::1, [::1]:bad, ok.local:8080"
  );

  assert.deepEqual(rules, [
    { host: "ok.local", port: 8080, matchSubdomains: true }
  ]);
});

test("shouldBypassProxy enforces exact suffix boundaries and optional port matching", () => {
  const rules = parseNoProxy("example.com,example.net:8443,localhost");

  assert.equal(shouldBypassProxy(new URL("https://api.example.com"), rules), true);
  assert.equal(shouldBypassProxy(new URL("https://badexample.com"), rules), false);
  assert.equal(shouldBypassProxy(new URL("https://example.net:8443"), rules), true);
  assert.equal(shouldBypassProxy(new URL("https://example.net:9443"), rules), false);
  assert.equal(shouldBypassProxy(new URL("http://localhost"), rules), true);
  assert.equal(shouldBypassProxy(new URL("http://dev.localhost"), rules), false);
});

test("shouldBypassProxy supports bracketed IPv6 NO_PROXY values", () => {
  const rules = parseNoProxy("[::1]");

  assert.equal(shouldBypassProxy(new URL("http://[::1]"), rules), true);
  assert.equal(shouldBypassProxy(new URL("http://[::2]"), rules), false);
});

test("resolveProxyForUrl uses protocol-specific precedence and NO_PROXY bypass", () => {
  const settings = loadProxySettings({
    http_proxy: "http://http-proxy.local:8080",
    https_proxy: "http://https-proxy.local:8443",
    all_proxy: "socks5://fallback.local:1080",
    no_proxy: "internal.local"
  });

  assert.equal(
    resolveProxyForUrl("http://public.local", settings),
    "http://http-proxy.local:8080/"
  );
  assert.equal(
    resolveProxyForUrl("https://public.local", settings),
    "http://https-proxy.local:8443/"
  );
  assert.equal(
    resolveProxyForUrl("wss://public.local", settings),
    "http://https-proxy.local:8443/"
  );
  assert.equal(
    resolveProxyForUrl("ftp://public.local", settings),
    "socks5://fallback.local:1080"
  );
  assert.equal(resolveProxyForUrl("https://api.internal.local", settings), null);
});

test("resolveProxyForUrl handles ws/wss protocol precedence and fallback", () => {
  const explicit = loadProxySettings({
    http_proxy: "http://http-proxy.local:8080",
    https_proxy: "http://https-proxy.local:8443",
    all_proxy: "socks5://fallback.local:1080"
  });

  assert.equal(
    resolveProxyForUrl("ws://socket.public.local", explicit),
    "http://http-proxy.local:8080/"
  );
  assert.equal(
    resolveProxyForUrl("wss://socket.public.local", explicit),
    "http://https-proxy.local:8443/"
  );

  const fallback = loadProxySettings({
    http_proxy: "http://http-proxy.local:8080",
    all_proxy: "socks5://fallback.local:1080"
  });

  assert.equal(
    resolveProxyForUrl("wss://socket.public.local", fallback),
    "http://http-proxy.local:8080/"
  );
  assert.equal(
    resolveProxyForUrl("ws://socket.public.local", loadProxySettings({
      all_proxy: "socks5://fallback.local:1080"
    })),
    "socks5://fallback.local:1080"
  );
});

test("resolveProxyForUrl honors NO_PROXY defaults for ws/wss ports", () => {
  const settings = loadProxySettings({
    http_proxy: "http://proxy.local:8080",
    https_proxy: "http://proxy.local:8443",
    no_proxy: "socket.local:80,secure-socket.local:443"
  });

  assert.equal(resolveProxyForUrl("ws://socket.local", settings), null);
  assert.equal(resolveProxyForUrl("wss://secure-socket.local", settings), null);
  assert.equal(
    resolveProxyForUrl("ws://socket.local:81", settings),
    "http://proxy.local:8080/"
  );
  assert.equal(
    resolveProxyForUrl("wss://secure-socket.local:444", settings),
    "http://proxy.local:8443/"
  );
});

test("parseNoProxy supports ws/wss URL tokens and trailing-dot hosts", () => {
  const rules = parseNoProxy("ws://stream.local:8080,wss://secure.local,.corp.local.");

  assert.deepEqual(rules, [
    { host: "stream.local", port: 8080, matchSubdomains: true },
    { host: "secure.local", port: null, matchSubdomains: true },
    { host: "corp.local", port: null, matchSubdomains: true }
  ]);
});

test("shouldBypassProxy short-circuits for wildcard NO_PROXY", () => {
  const rules = parseNoProxy("*");

  assert.equal(shouldBypassProxy(new URL("ws://anything.local"), rules), true);
  assert.equal(shouldBypassProxy(new URL("wss://secure.anything.local"), rules), true);
});

test("resolveProxyForUrlFromEnv loads env and resolves in one step", () => {
  const proxy = resolveProxyForUrlFromEnv("http://example.com", {
    http_proxy: "proxy.local:3128"
  });

  assert.equal(proxy, "http://proxy.local:3128/");
});

test("exports stable proxy-core root APIs", async () => {
  const module = await import("../src/index.js");

  assert.equal(module.loadProxySettings, loadProxySettings);
  assert.equal(module.parseNoProxy, parseNoProxy);
  assert.equal(module.resolveProxyForUrl, resolveProxyForUrl);
  assert.equal(module.resolveProxyForUrlFromEnv, resolveProxyForUrlFromEnv);
  assert.equal(module.shouldBypassProxy, shouldBypassProxy);
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  loadProxySettings,
  parseNoProxy,
  resolveProxyForUrl,
  shouldBypassProxy
} from "../src/proxy-settings.js";

test("resolves protocol-specific proxy settings with fallback", () => {
  const settings = loadProxySettings({
    HTTP_PROXY: "http://http-proxy.local:8080",
    HTTPS_PROXY: "http://https-proxy.local:8443"
  });

  assert.equal(
    resolveProxyForUrl("http://example.com", settings),
    "http://http-proxy.local:8080/"
  );
  assert.equal(
    resolveProxyForUrl("https://example.com", settings),
    "http://https-proxy.local:8443/"
  );
});

test("falls back to all_proxy when protocol proxy is absent", () => {
  const settings = loadProxySettings({
    ALL_PROXY: "socks5://127.0.0.1:1080"
  });

  assert.equal(
    resolveProxyForUrl("ftp://example.com", settings),
    "socks5://127.0.0.1:1080"
  );
  assert.equal(
    resolveProxyForUrl("ws://example.com", settings),
    "socks5://127.0.0.1:1080"
  );
});

test("honors no_proxy exact and wildcard-subdomain matching", () => {
  const exact = loadProxySettings({
    HTTPS_PROXY: "http://proxy.local:9000",
    NO_PROXY: "example.com:443"
  });

  assert.equal(resolveProxyForUrl("https://example.com", exact), null);
  assert.equal(
    resolveProxyForUrl("https://example.com:9443", exact),
    "http://proxy.local:9000/"
  );

  const wildcard = loadProxySettings({
    HTTP_PROXY: "http://proxy.local:8080",
    NO_PROXY: ".internal.local"
  });

  assert.equal(resolveProxyForUrl("http://api.internal.local", wildcard), null);
  assert.equal(
    resolveProxyForUrl("http://external.local", wildcard),
    "http://proxy.local:8080/"
  );
});

test("resolves websocket proxies with wss fallback to http_proxy", () => {
  const settings = loadProxySettings({
    HTTP_PROXY: "http://proxy.local:8080",
    ALL_PROXY: "socks5://127.0.0.1:1080"
  });

  assert.equal(
    resolveProxyForUrl("ws://example.com", settings),
    "http://proxy.local:8080/"
  );
  assert.equal(
    resolveProxyForUrl("wss://example.com", settings),
    "http://proxy.local:8080/"
  );
});

test("honors no_proxy wildcard and default websocket ports", () => {
  const wildcard = loadProxySettings({
    HTTP_PROXY: "http://proxy.local:8080",
    HTTPS_PROXY: "http://proxy.local:8443",
    NO_PROXY: "*"
  });

  assert.equal(resolveProxyForUrl("ws://any.local", wildcard), null);
  assert.equal(resolveProxyForUrl("wss://any.local", wildcard), null);

  const portScoped = loadProxySettings({
    HTTP_PROXY: "http://proxy.local:8080",
    HTTPS_PROXY: "http://proxy.local:8443",
    NO_PROXY: "socket.local:80,secure.local:443"
  });

  assert.equal(resolveProxyForUrl("ws://socket.local", portScoped), null);
  assert.equal(resolveProxyForUrl("wss://secure.local", portScoped), null);
  assert.equal(
    resolveProxyForUrl("ws://socket.local:81", portScoped),
    "http://proxy.local:8080/"
  );
  assert.equal(
    resolveProxyForUrl("wss://secure.local:444", portScoped),
    "http://proxy.local:8443/"
  );
});

test("parses no_proxy entries safely", () => {
  const rules = parseNoProxy("example.com, .corp.local:8443, *, bad:99999");

  assert.equal(rules.length, 4);
  assert.equal(rules[0]?.host, "example.com");
  assert.equal(rules[1]?.host, "corp.local");
  assert.equal(rules[1]?.port, 8443);
  assert.equal(rules[2]?.host, "*");
  assert.equal(rules[3]?.port, null);
});

test("throws invalid_target_url for malformed target strings", () => {
  const settings = loadProxySettings({
    HTTP_PROXY: "http://proxy.local:8080"
  });

  assert.throws(
    () => resolveProxyForUrl("::not-a-url::", settings),
    (error: unknown) => error instanceof TypeError && error.message === "invalid_target_url"
  );
});

test("preserves wildcardSubdomains compatibility in shouldBypassProxy", () => {
  const rules = [
    {
      host: "internal.local",
      port: null,
      wildcardSubdomains: true
    }
  ];

  assert.equal(shouldBypassProxy(new URL("https://api.internal.local"), rules), true);
  assert.equal(shouldBypassProxy(new URL("https://external.local"), rules), false);
});

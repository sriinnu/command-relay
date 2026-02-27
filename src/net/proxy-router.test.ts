/**
 * @file Tests for proxy routing utility.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { loadProxySettings, parseNoProxy, resolveProxyForUrl } from "./proxy-router.js";

test("resolves https and http proxies with fallback", () => {
  const settings = loadProxySettings({
    HTTP_PROXY: "http://http-proxy.local:8080",
    HTTPS_PROXY: "http://https-proxy.local:8443"
  });

  assert.equal(
    resolveProxyForUrl("https://example.com", settings),
    "http://https-proxy.local:8443/"
  );
  assert.equal(
    resolveProxyForUrl("http://example.com", settings),
    "http://http-proxy.local:8080/"
  );
  assert.equal(
    resolveProxyForUrl("ws://stream.example.com", settings),
    "http://http-proxy.local:8080/"
  );
  assert.equal(
    resolveProxyForUrl("wss://stream.example.com", settings),
    "http://https-proxy.local:8443/"
  );
});

test("falls back to all_proxy for unknown schemes", () => {
  const settings = loadProxySettings({
    ALL_PROXY: "socks5://127.0.0.1:1080"
  });

  assert.equal(
    resolveProxyForUrl("ftp://example.com", settings),
    "socks5://127.0.0.1:1080"
  );
});

test("drops malformed and unsupported proxy URLs", () => {
  const settings = loadProxySettings({
    HTTP_PROXY: "http://[::1",
    HTTPS_PROXY: "ssh://bastion.local:22",
    ALL_PROXY: "socks5://fallback.local:1080"
  });

  assert.equal(settings.httpProxy, null);
  assert.equal(settings.httpsProxy, null);
  assert.equal(settings.allProxy, "socks5://fallback.local:1080");
  assert.equal(
    resolveProxyForUrl("http://example.com", settings),
    "socks5://fallback.local:1080"
  );
  assert.equal(
    resolveProxyForUrl("https://example.com", settings),
    "socks5://fallback.local:1080"
  );
});

test("keeps wrapper fallback precedence when uppercase proxy is malformed", () => {
  const settings = loadProxySettings({
    HTTP_PROXY: "http://[::1",
    http_proxy: "http://lowercase-http-proxy.local:8080",
    ALL_PROXY: "socks5://fallback.local:1080"
  });

  assert.equal(settings.httpProxy, null);
  assert.equal(
    resolveProxyForUrl("http://example.com", settings),
    "socks5://fallback.local:1080"
  );
});

test("falls back from malformed https proxy to http proxy for https and wss", () => {
  const settings = loadProxySettings({
    HTTP_PROXY: "http://http-proxy.local:8080",
    HTTPS_PROXY: "http://[::1",
    ALL_PROXY: "socks5://fallback.local:1080"
  });

  assert.equal(
    resolveProxyForUrl("https://example.com", settings),
    "http://http-proxy.local:8080/"
  );
  assert.equal(
    resolveProxyForUrl("wss://stream.example.com", settings),
    "http://http-proxy.local:8080/"
  );
});

test("honors NO_PROXY exact and port-specific rules", () => {
  const settings = loadProxySettings({
    HTTPS_PROXY: "http://proxy.local:9000",
    NO_PROXY: "example.com:443"
  });

  assert.equal(resolveProxyForUrl("https://example.com", settings), null);
  assert.equal(
    resolveProxyForUrl("https://example.com:8443", settings),
    "http://proxy.local:9000/"
  );
});

test("honors NO_PROXY wildcard and subdomain rules", () => {
  const settings = loadProxySettings({
    HTTP_PROXY: "http://proxy.local:8080",
    NO_PROXY: "*,.internal.local"
  });

  assert.equal(resolveProxyForUrl("http://anything.example", settings), null);

  const specific = loadProxySettings({
    HTTP_PROXY: "http://proxy.local:8080",
    NO_PROXY: ".internal.local"
  });
  assert.equal(resolveProxyForUrl("http://api.internal.local", specific), null);
  assert.equal(
    resolveProxyForUrl("http://external.local", specific),
    "http://proxy.local:8080/"
  );
  assert.equal(
    resolveProxyForUrl("wss://api.internal.local", {
      ...specific,
      httpsProxy: "http://proxy.local:8443"
    }),
    null
  );
});

test("ignores malformed NO_PROXY tokens and enforces host boundaries", () => {
  const settings = loadProxySettings({
    HTTP_PROXY: "http://proxy.local:8080",
    NO_PROXY: " , [broken, host with spaces:8080, example.com"
  });

  assert.equal(resolveProxyForUrl("http://api.example.com", settings), null);
  assert.equal(
    resolveProxyForUrl("http://badexample.com", settings),
    "http://proxy.local:8080/"
  );
  assert.equal(
    resolveProxyForUrl("http://unrelated.local", settings),
    "http://proxy.local:8080/"
  );
});

test("treats NO_PROXY entries with invalid ports as host-only rules", () => {
  const settings = loadProxySettings({
    HTTPS_PROXY: "http://proxy.local:8443",
    NO_PROXY: "secure.local:99999"
  });

  assert.equal(resolveProxyForUrl("https://secure.local:9443", settings), null);
  assert.equal(
    resolveProxyForUrl("https://external.local:9443", settings),
    "http://proxy.local:8443/"
  );
});

test("returns null for unknown schemes when all_proxy is unavailable", () => {
  const settings = loadProxySettings({
    HTTP_PROXY: "http://http-proxy.local:8080",
    ALL_PROXY: ""
  });

  assert.equal(resolveProxyForUrl("ftp://example.com", settings), null);
});

test("uses lowercase proxy env vars when uppercase variants are empty", () => {
  const settings = loadProxySettings({
    HTTP_PROXY: "",
    http_proxy: "http://lowercase-http-proxy.local:8080",
    HTTPS_PROXY: "",
    https_proxy: "http://lowercase-https-proxy.local:8443",
    ALL_PROXY: "",
    all_proxy: "socks5://127.0.0.1:1080"
  });

  assert.equal(
    resolveProxyForUrl("http://example.com", settings),
    "http://lowercase-http-proxy.local:8080/"
  );
  assert.equal(
    resolveProxyForUrl("https://example.com", settings),
    "http://lowercase-https-proxy.local:8443/"
  );
  assert.equal(
    resolveProxyForUrl("ftp://example.com", settings),
    "socks5://127.0.0.1:1080"
  );
});

test("uses lowercase no_proxy when uppercase NO_PROXY is empty", () => {
  const settings = loadProxySettings({
    HTTP_PROXY: "http://proxy.local:8080",
    NO_PROXY: "",
    no_proxy: ".internal.local"
  });

  assert.equal(resolveProxyForUrl("http://api.internal.local", settings), null);
  assert.equal(
    resolveProxyForUrl("http://external.local", settings),
    "http://proxy.local:8080/"
  );
});

test("keeps uppercase NO_PROXY precedence over lowercase no_proxy", () => {
  const settings = loadProxySettings({
    HTTP_PROXY: "http://proxy.local:8080",
    NO_PROXY: "example.com",
    no_proxy: "*"
  });

  assert.equal(resolveProxyForUrl("http://example.com", settings), null);
  assert.equal(
    resolveProxyForUrl("http://external.local", settings),
    "http://proxy.local:8080/"
  );
});

test("parses no_proxy entries safely", () => {
  const rules = parseNoProxy("example.com, .corp.local:8443, *, bad:99999");
  assert.equal(rules.length, 4);
  assert.equal(rules[1].host, "corp.local");
  assert.equal(rules[1].port, 8443);
  assert.equal(rules[2].host, "*");
  assert.equal(rules[3].port, null);
});

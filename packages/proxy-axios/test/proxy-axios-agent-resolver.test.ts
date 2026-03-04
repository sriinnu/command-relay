import assert from "node:assert/strict";
import test from "node:test";
import { ProxyAxiosAgentResolver } from "../src/index.js";

test("resolve returns direct mode when proxy env is empty", () => {
  const resolver = new ProxyAxiosAgentResolver({ env: {} });

  const result = resolver.resolve("https://service.local/health");
  assert.equal(result.viaProxy, false);
  assert.equal(result.proxyUrl, null);
  assert.equal(result.agent, null);
  assert.equal(result.fromCache, false);
  assert.equal(resolver.cacheSize, 0);

  resolver.destroy();
});

test("resolve routes through proxy and returns cached agent for repeated protocol", () => {
  const resolver = new ProxyAxiosAgentResolver({
    env: {
      https_proxy: "http://proxy-https.local:8443"
    }
  });

  const first = resolver.resolve("https://service.local/v1");
  const second = resolver.resolve("https://service.local/v2");

  assert.equal(first.viaProxy, true);
  assert.equal(first.fromCache, false);
  assert.equal(first.proxyUrl, "http://proxy-https.local:8443/");
  assert.equal(first.agent?.constructor.name, "HttpsProxyAgent");

  assert.equal(second.viaProxy, true);
  assert.equal(second.fromCache, true);
  assert.equal(second.proxyUrl, "http://proxy-https.local:8443/");
  assert.equal(second.agent, first.agent);
  assert.equal(resolver.cacheSize, 1);

  resolver.destroy();
});

test("resolve respects NO_PROXY bypass while still proxying other hosts", () => {
  const resolver = new ProxyAxiosAgentResolver({
    env: {
      https_proxy: "http://proxy-https.local:8443",
      no_proxy: "internal.local"
    }
  });

  const bypassed = resolver.resolve("https://api.internal.local/health");
  const proxied = resolver.resolve("https://api.external.local/health");

  assert.equal(bypassed.viaProxy, false);
  assert.equal(bypassed.proxyUrl, null);
  assert.equal(bypassed.agent, null);

  assert.equal(proxied.viaProxy, true);
  assert.equal(proxied.proxyUrl, "http://proxy-https.local:8443/");
  assert.equal(proxied.agent?.constructor.name, "HttpsProxyAgent");

  resolver.destroy();
});

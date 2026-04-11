import assert from "node:assert/strict";
import test from "node:test";
import { ProxyGotAgentResolver } from "../src/index.js";
import type { ProxySettings } from "@commandrelay/proxy-agent";

function createSettings(overrides: Partial<ProxySettings>): ProxySettings {
  return {
    httpProxy: null,
    httpsProxy: null,
    allProxy: null,
    noProxy: [],
    ...overrides
  };
}

test("routes direct when no proxy configuration exists", () => {
  const resolver = new ProxyGotAgentResolver({
    settings: createSettings({})
  });

  const result = resolver.resolve("https://api.example.com/health");
  assert.equal(result.protocol, "https");
  assert.equal(result.viaProxy, false);
  assert.equal(result.proxyUrl, null);
  assert.equal(result.fromCache, false);
  assert.equal(result.agent, undefined);
});

test("routes through configured proxy and reports cache metadata", () => {
  const resolver = new ProxyGotAgentResolver({
    settings: createSettings({
      httpsProxy: "http://secure-proxy.local:8443"
    })
  });

  const first = resolver.resolve("https://api.example.com/profile");
  const second = resolver.resolve("https://api.example.com/orders");

  assert.equal(first.protocol, "https");
  assert.equal(first.viaProxy, true);
  assert.equal(first.proxyUrl, "http://secure-proxy.local:8443");
  assert.equal(first.fromCache, false);
  assert.equal(first.agent?.constructor.name, "HttpsProxyAgent");

  assert.equal(second.viaProxy, true);
  assert.equal(second.proxyUrl, "http://secure-proxy.local:8443");
  assert.equal(second.fromCache, true);
  assert.equal(second.agent, first.agent);
});

test("honors no_proxy rules for direct routing", () => {
  const resolver = new ProxyGotAgentResolver({
    settings: createSettings({
      httpsProxy: "http://secure-proxy.local:8443",
      noProxy: [{ host: "internal.local", port: null, wildcardSubdomains: true }]
    })
  });

  const bypassed = resolver.resolve("https://api.internal.local/health");
  const proxied = resolver.resolve("https://api.external.local/health");

  assert.equal(bypassed.viaProxy, false);
  assert.equal(bypassed.proxyUrl, null);
  assert.equal(bypassed.fromCache, false);
  assert.equal(bypassed.agent, undefined);

  assert.equal(proxied.viaProxy, true);
  assert.equal(proxied.proxyUrl, "http://secure-proxy.local:8443");
});

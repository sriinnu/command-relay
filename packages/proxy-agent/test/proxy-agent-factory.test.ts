import assert from "node:assert/strict";
import test from "node:test";
import { ProxyAgentFactory, createProxyAgent } from "../src/proxy-agent-factory.js";
import type { ProxySettings } from "../src/proxy-settings.js";

function createSettings(overrides: Partial<ProxySettings>): ProxySettings {
  return {
    httpProxy: null,
    httpsProxy: null,
    allProxy: null,
    noProxy: [],
    ...overrides
  };
}

test("returns direct mode when no proxy is configured", () => {
  const factory = new ProxyAgentFactory({
    settings: createSettings({})
  });

  const result = factory.resolve("https://example.com");
  assert.equal(result.viaProxy, false);
  assert.equal(result.proxyUrl, null);
  assert.equal(result.agent, null);
});

test("creates HttpProxyAgent for http targets", () => {
  const factory = new ProxyAgentFactory({
    settings: createSettings({
      httpProxy: "http://proxy.local:8080"
    })
  });

  const result = factory.resolve("http://example.com");
  assert.equal(result.viaProxy, true);
  assert.equal(result.agent?.constructor.name, "HttpProxyAgent");
});

test("creates HttpsProxyAgent for https targets", () => {
  const factory = new ProxyAgentFactory({
    settings: createSettings({
      httpsProxy: "http://proxy.local:8080"
    })
  });

  const result = factory.resolve("https://example.com");
  assert.equal(result.viaProxy, true);
  assert.equal(result.agent?.constructor.name, "HttpsProxyAgent");
});

test("creates SocksProxyAgent for socks proxy protocols", () => {
  const factory = new ProxyAgentFactory({
    settings: createSettings({
      allProxy: "socks5://127.0.0.1:1080"
    })
  });

  const result = factory.resolve("https://example.com");
  assert.equal(result.viaProxy, true);
  assert.equal(result.agent?.constructor.name, "SocksProxyAgent");
});

test("creates PacProxyAgent for pac proxy protocols", () => {
  const factory = new ProxyAgentFactory({
    settings: createSettings({
      allProxy: "pac+http://proxy-config.local/proxy.pac"
    })
  });

  const result = factory.resolve("https://example.com");
  assert.equal(result.viaProxy, true);
  assert.equal(result.agent?.constructor.name, "PacProxyAgent");
});

test("reuses cached agent for same proxy URL and target protocol", () => {
  const factory = new ProxyAgentFactory({
    settings: createSettings({
      httpProxy: "http://proxy.local:8080"
    })
  });

  const first = factory.resolve("http://example.com");
  const second = factory.resolve("http://another.example");

  assert.equal(first.fromCache, false);
  assert.equal(second.fromCache, true);
  assert.equal(first.agent, second.agent);
  assert.equal(factory.cacheSize, 1);
});

test("enforces bounded cache eviction", () => {
  const factory = new ProxyAgentFactory({
    settings: createSettings({
      httpProxy: "http://proxy.local:8080",
      httpsProxy: "http://proxy.local:8080"
    }),
    maxCacheEntries: 1
  });

  const firstHttp = factory.resolve("http://example.com");
  const httpsEntry = factory.resolve("https://example.com");
  const secondHttp = factory.resolve("http://example.com");

  assert.equal(firstHttp.fromCache, false);
  assert.equal(httpsEntry.fromCache, false);
  assert.equal(secondHttp.fromCache, false);
  assert.notEqual(firstHttp.agent, secondHttp.agent);
  assert.equal(factory.cacheSize, 1);
});

test("honors no_proxy bypass rules", () => {
  const factory = new ProxyAgentFactory({
    settings: createSettings({
      httpsProxy: "http://proxy.local:8080",
      noProxy: [{ host: "internal.local", port: null, wildcardSubdomains: true }]
    })
  });

  const bypassed = factory.resolve("https://api.internal.local");
  const proxied = factory.resolve("https://api.external.local");

  assert.equal(bypassed.viaProxy, false);
  assert.equal(bypassed.agent, null);
  assert.equal(proxied.viaProxy, true);
});

test("throws for unsupported proxy protocols", () => {
  assert.throws(
    () => createProxyAgent("ftp://proxy.local:21", "https:"),
    /unsupported_proxy_protocol:ftp:/
  );
});

test("throws for invalid proxy URL", () => {
  assert.throws(() => createProxyAgent("::not-a-url::", "http:"), /invalid_proxy_url/);
});

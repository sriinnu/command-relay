/**
 * @file Tests for proxy agent factory behavior.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { ProxyAgentFactory } from "./proxy-agent-factory.js";

function withPatchedEnv<T>(
  patch: Readonly<Record<string, string | undefined>>,
  run: () => T
): T {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(patch)) {
    previous.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
      continue;
    }
    process.env[key] = value;
  }

  try {
    return run();
  } finally {
    // Ensure test-local env values never leak to other tests.
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
        continue;
      }
      process.env[key] = value;
    }
  }
}

test("returns direct mode when no proxy is configured", () => {
  const factory = new ProxyAgentFactory({
    settings: {
      httpProxy: null,
      httpsProxy: null,
      allProxy: null,
      noProxy: []
    }
  });

  const result = factory.resolve("https://example.com");
  assert.equal(result.viaProxy, false);
  assert.equal(result.proxyUrl, null);
  assert.equal(result.agent, null);
});

test("selects HTTP proxy agent for http target", () => {
  const factory = new ProxyAgentFactory({
    settings: {
      httpProxy: "http://proxy.local:8080",
      httpsProxy: null,
      allProxy: null,
      noProxy: []
    }
  });

  const result = factory.resolve("http://example.com");
  assert.equal(result.viaProxy, true);
  assert.equal(result.proxyUrl, "http://proxy.local:8080");
  assert.equal(result.agent.constructor.name, "HttpProxyAgent");
});

test("selects HTTP proxy agent for ws target", () => {
  const factory = new ProxyAgentFactory({
    settings: {
      httpProxy: "http://proxy.local:8080",
      httpsProxy: null,
      allProxy: null,
      noProxy: []
    }
  });

  const result = factory.resolve("ws://example.com/socket");
  assert.equal(result.viaProxy, true);
  assert.equal(result.proxyUrl, "http://proxy.local:8080");
  assert.equal(result.agent.constructor.name, "HttpProxyAgent");
});

test("selects HTTPS proxy agent for https target", () => {
  const factory = new ProxyAgentFactory({
    settings: {
      httpProxy: null,
      httpsProxy: "http://secure-proxy.local:8443",
      allProxy: null,
      noProxy: []
    }
  });

  const result = factory.resolve("https://example.com");
  assert.equal(result.viaProxy, true);
  assert.equal(result.agent.constructor.name, "HttpsProxyAgent");
});

test("selects HTTPS proxy agent for wss target", () => {
  const factory = new ProxyAgentFactory({
    settings: {
      httpProxy: null,
      httpsProxy: "http://secure-proxy.local:8443",
      allProxy: null,
      noProxy: []
    }
  });

  const result = factory.resolve("wss://example.com/socket");
  assert.equal(result.viaProxy, true);
  assert.equal(result.agent.constructor.name, "HttpsProxyAgent");
});

test("selects socks proxy agent for socks scheme", () => {
  const factory = new ProxyAgentFactory({
    settings: {
      httpProxy: null,
      httpsProxy: null,
      allProxy: "socks5://127.0.0.1:1080",
      noProxy: []
    }
  });

  const result = factory.resolve("https://example.com");
  assert.equal(result.viaProxy, true);
  assert.equal(result.agent.constructor.name, "SocksProxyAgent");
});

test("reuses cached agent for identical proxy+protocol pair", () => {
  const factory = new ProxyAgentFactory({
    settings: {
      httpProxy: "http://proxy.local:8080",
      httpsProxy: null,
      allProxy: null,
      noProxy: []
    }
  });

  const a = factory.resolve("http://example.com");
  const b = factory.resolve("http://another.example");

  assert.equal(a.agent, b.agent);
});

test("honors no_proxy bypass rules", () => {
  const factory = new ProxyAgentFactory({
    settings: {
      httpProxy: "http://proxy.local:8080",
      httpsProxy: "http://proxy.local:8080",
      allProxy: null,
      noProxy: [{ host: "internal.local", port: null, wildcardSubdomains: true }]
    }
  });

  const bypassed = factory.resolve("https://api.internal.local");
  assert.equal(bypassed.viaProxy, false);
  assert.equal(bypassed.agent, null);

  const proxied = factory.resolve("https://external.local");
  assert.equal(proxied.viaProxy, true);

  const bypassedWss = factory.resolve("wss://api.internal.local");
  assert.equal(bypassedWss.viaProxy, false);
  assert.equal(bypassedWss.agent, null);
});

test("uses lowercase env proxy vars when uppercase variants are empty", () => {
  withPatchedEnv(
    {
      HTTP_PROXY: "",
      http_proxy: "http://lower-http-proxy.local:8080",
      HTTPS_PROXY: "",
      https_proxy: "http://lower-https-proxy.local:8443",
      ALL_PROXY: "",
      all_proxy: undefined,
      NO_PROXY: "",
      no_proxy: undefined
    },
    () => {
      const factory = new ProxyAgentFactory();

      const http = factory.resolve("http://example.com");
      assert.equal(http.viaProxy, true);
      assert.equal(http.proxyUrl, "http://lower-http-proxy.local:8080/");
      assert.equal(http.agent?.constructor.name, "HttpProxyAgent");

      const https = factory.resolve("https://example.com");
      assert.equal(https.viaProxy, true);
      assert.equal(https.proxyUrl, "http://lower-https-proxy.local:8443/");
      assert.equal(https.agent?.constructor.name, "HttpsProxyAgent");
    }
  );
});

test("uses lowercase no_proxy when uppercase NO_PROXY is empty", () => {
  withPatchedEnv(
    {
      HTTP_PROXY: "http://proxy.local:8080",
      http_proxy: undefined,
      HTTPS_PROXY: "http://proxy.local:8443",
      https_proxy: undefined,
      ALL_PROXY: undefined,
      all_proxy: undefined,
      NO_PROXY: "",
      no_proxy: ".internal.local"
    },
    () => {
      const factory = new ProxyAgentFactory();

      const bypassed = factory.resolve("https://api.internal.local");
      assert.equal(bypassed.viaProxy, false);
      assert.equal(bypassed.agent, null);

      const proxied = factory.resolve("https://external.local");
      assert.equal(proxied.viaProxy, true);
      assert.equal(proxied.proxyUrl, "http://proxy.local:8443/");
    }
  );
});

test("keeps uppercase NO_PROXY precedence over lowercase no_proxy", () => {
  withPatchedEnv(
    {
      HTTP_PROXY: "http://proxy.local:8080",
      http_proxy: undefined,
      HTTPS_PROXY: undefined,
      https_proxy: undefined,
      ALL_PROXY: undefined,
      all_proxy: undefined,
      NO_PROXY: "example.com",
      no_proxy: "*"
    },
    () => {
      const factory = new ProxyAgentFactory();

      const bypassed = factory.resolve("http://example.com");
      assert.equal(bypassed.viaProxy, false);
      assert.equal(bypassed.proxyUrl, null);

      const proxied = factory.resolve("http://external.local");
      assert.equal(proxied.viaProxy, true);
      assert.equal(proxied.proxyUrl, "http://proxy.local:8080/");
    }
  );
});

/**
 * @file Tests for proxy agent factory behavior.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
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

type PacConnectRequest = EventEmitter & {
  path: string;
  getHeader: (headerName: string) => string | undefined;
};

function createPacConnectRequest(path = "/proxy-target"): PacConnectRequest {
  const request = new EventEmitter() as PacConnectRequest;
  request.path = path;
  request.getHeader = () => undefined;
  return request;
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

test("uses lowercase NO_PROXY over uppercase NO_PROXY", () => {
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
      assert.equal(proxied.viaProxy, false);
      assert.equal(proxied.proxyUrl, null);
    }
  );
});

test("throws invalid_proxy_url for malformed credential-bearing proxy URLs", () => {
  const malformedProxies = [
    "http://user:pass@:8080",
    "socks5://user:pass@:1080",
    "pac+http://user:pass@/proxy.pac"
  ];

  for (const malformedProxy of malformedProxies) {
    const factory = new ProxyAgentFactory({
      settings: {
        httpProxy: null,
        httpsProxy: malformedProxy,
        allProxy: null,
        noProxy: []
      }
    });

    assert.throws(() => factory.resolve("https://example.com"), /invalid_proxy_url/);
  }
});

test("throws for unsupported explicit proxy schemes", () => {
  const factory = new ProxyAgentFactory({
    settings: {
      httpProxy: null,
      httpsProxy: null,
      allProxy: "ftp://proxy.local:21",
      noProxy: []
    }
  });

  assert.throws(
    () => factory.resolve("https://example.com"),
    /unsupported_proxy_protocol:ftp:/
  );
});

test("throws for unsupported target schemes when a proxy is selected", () => {
  const factory = new ProxyAgentFactory({
    settings: {
      httpProxy: null,
      httpsProxy: null,
      allProxy: "http://proxy.local:8080",
      noProxy: []
    }
  });

  assert.throws(
    () => factory.resolve("ftp://example.com/resource"),
    /unsupported_target_protocol:ftp:/
  );
});

test("sets PAC agents to no-direct fallback by default", () => {
  const factory = new ProxyAgentFactory({
    settings: {
      httpProxy: null,
      httpsProxy: null,
      allProxy: "pac+http://proxy-config.local/proxy.pac",
      noProxy: []
    }
  });

  const result = factory.resolve("https://example.com");
  assert.equal(result.viaProxy, true);
  assert.equal(result.agent?.constructor.name, "PacProxyAgent");
  const pacAgent = result.agent as unknown as {
    opts?: { fallbackToDirect?: boolean };
  };
  assert.equal(pacAgent.opts?.fallbackToDirect, false);
});

test("surfaces PAC resolver failures during connect attempts", async () => {
  const invalidPacSource = "function FindProxyForURL(url, host) {";
  const factory = new ProxyAgentFactory({
    settings: {
      httpProxy: null,
      httpsProxy: null,
      allProxy: `pac+data:text/plain,${encodeURIComponent(invalidPacSource)}`,
      noProxy: []
    }
  });

  const result = factory.resolve("https://example.com");
  assert.equal(result.viaProxy, true);
  assert.equal(result.agent?.constructor.name, "PacProxyAgent");

  const pacAgent = result.agent as unknown as {
    connect: (
      request: PacConnectRequest,
      options: { host: string; port: number; secureEndpoint: boolean }
    ) => Promise<unknown>;
  };

  await assert.rejects(
    () =>
      pacAgent.connect(createPacConnectRequest(), {
        host: "example.com",
        port: 443,
        secureEndpoint: true
      }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.ok(error.message.length > 0);
      return true;
    }
  );
});

test("falls back to direct mode when env proxy values are invalid or unsupported", () => {
  withPatchedEnv(
    {
      HTTP_PROXY: "ftp://unsupported.local:2121",
      http_proxy: undefined,
      HTTPS_PROXY: "http://user:pass@:8080",
      https_proxy: undefined,
      ALL_PROXY: "ssh://bastion.local:22",
      all_proxy: undefined,
      NO_PROXY: undefined,
      no_proxy: undefined
    },
    () => {
      const factory = new ProxyAgentFactory();

      const httpResult = factory.resolve("http://example.com");
      assert.equal(httpResult.viaProxy, false);
      assert.equal(httpResult.proxyUrl, null);
      assert.equal(httpResult.agent, null);

      const httpsResult = factory.resolve("https://example.com");
      assert.equal(httpsResult.viaProxy, false);
      assert.equal(httpsResult.proxyUrl, null);
      assert.equal(httpsResult.agent, null);
    }
  );
});

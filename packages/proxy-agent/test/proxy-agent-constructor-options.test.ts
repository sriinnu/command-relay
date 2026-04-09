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

test("createProxyAgent forwards http constructor options for http/ws targets", () => {
  const agent = createProxyAgent("http://proxy.local:8080", "http:", {
    http: {
      headers: { "x-proxy-mode": "http" },
      keepAlive: true
    }
  });

  assert.equal(agent.constructor.name, "HttpProxyAgent");
  const proxyAgent = agent as unknown as {
    keepAlive: boolean;
    proxyHeaders: Record<string, string>;
  };
  assert.equal(proxyAgent.keepAlive, true);
  assert.deepEqual(proxyAgent.proxyHeaders, { "x-proxy-mode": "http" });
});

test("createProxyAgent forwards https constructor options for https/wss targets", () => {
  const agent = createProxyAgent("http://proxy.local:8080", "wss:", {
    https: {
      headers: { "x-proxy-mode": "https" },
      keepAlive: true
    }
  });

  assert.equal(agent.constructor.name, "HttpsProxyAgent");
  const proxyAgent = agent as unknown as {
    keepAlive: boolean;
    proxyHeaders: Record<string, string>;
  };
  assert.equal(proxyAgent.keepAlive, true);
  assert.deepEqual(proxyAgent.proxyHeaders, { "x-proxy-mode": "https" });
});

test("createProxyAgent forwards socks constructor options", () => {
  const agent = createProxyAgent("socks5://127.0.0.1:1080", "https:", {
    socks: {
      timeout: 2500,
      socketOptions: { localAddress: "127.0.0.1" }
    }
  });

  assert.equal(agent.constructor.name, "SocksProxyAgent");
  const proxyAgent = agent as unknown as {
    timeout: number | null;
    socketOptions: { localAddress?: string } | null;
  };
  assert.equal(proxyAgent.timeout, 2500);
  assert.equal(proxyAgent.socketOptions?.localAddress, "127.0.0.1");
});

test("createProxyAgent keeps secure PAC defaults when options are omitted", () => {
  const agent = createProxyAgent("pac+http://proxy-config.local/proxy.pac", "https:");
  assert.equal(agent.constructor.name, "PacProxyAgent");
  const proxyAgent = agent as unknown as {
    opts: { fallbackToDirect?: boolean };
  };
  assert.equal(proxyAgent.opts.fallbackToDirect, false);
});

test("createProxyAgent forwards pac constructor options and allows explicit override", () => {
  const agent = createProxyAgent("pac+https://proxy-config.local/proxy.pac", "https:", {
    pac: {
      fallbackToDirect: true,
      filename: "custom-proxy.pac"
    }
  });

  assert.equal(agent.constructor.name, "PacProxyAgent");
  const proxyAgent = agent as unknown as {
    opts: { fallbackToDirect?: boolean; filename?: string };
  };
  assert.equal(proxyAgent.opts.fallbackToDirect, true);
  assert.equal(proxyAgent.opts.filename, "custom-proxy.pac");
});

test("ProxyAgentFactory forwards branch-specific constructor options by target protocol", () => {
  const factory = new ProxyAgentFactory({
    settings: createSettings({
      httpProxy: "http://proxy.local:8080"
    }),
    agentOptions: {
      http: { headers: { "x-agent-kind": "http" } },
      https: { headers: { "x-agent-kind": "https" } }
    }
  });

  const wsAgent = factory.resolve("ws://example.com").agent;
  const wssAgent = factory.resolve("wss://example.com").agent;
  assert.ok(wsAgent);
  assert.ok(wssAgent);

  const wsProxyAgent = wsAgent as unknown as { proxyHeaders: Record<string, string> };
  const wssProxyAgent = wssAgent as unknown as { proxyHeaders: Record<string, string> };
  assert.equal(wsAgent.constructor.name, "HttpProxyAgent");
  assert.equal(wssAgent.constructor.name, "HttpsProxyAgent");
  assert.deepEqual(wsProxyAgent.proxyHeaders, { "x-agent-kind": "http" });
  assert.deepEqual(wssProxyAgent.proxyHeaders, { "x-agent-kind": "https" });
});

test("ProxyAgentFactory forwards pac constructor options", () => {
  const factory = new ProxyAgentFactory({
    settings: createSettings({
      allProxy: "pac+http://proxy-config.local/proxy.pac"
    }),
    agentOptions: {
      pac: {
        fallbackToDirect: true,
        filename: "factory-proxy.pac"
      }
    }
  });

  const first = factory.resolve("https://example.com");
  const second = factory.resolve("https://another.example");
  assert.ok(first.agent);
  assert.ok(second.agent);
  assert.equal(second.fromCache, true);

  const proxyAgent = first.agent as unknown as {
    opts: { fallbackToDirect?: boolean; filename?: string };
  };
  assert.equal(first.agent.constructor.name, "PacProxyAgent");
  assert.equal(proxyAgent.opts.fallbackToDirect, true);
  assert.equal(proxyAgent.opts.filename, "factory-proxy.pac");
});

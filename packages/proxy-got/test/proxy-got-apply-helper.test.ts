import assert from "node:assert/strict";
import type { Agent } from "node:http";
import test from "node:test";
import { applyProxyGotAgent, ProxyGotAgentResolver } from "../src/index.js";
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

test("apply helper injects protocol-specific agent while preserving existing shape", () => {
  const existingHttpAgent = { tag: "existing-http" } as unknown as Agent;
  const existingHttp2Agent = { tag: "existing-http2" };

  const resolver = new ProxyGotAgentResolver({
    settings: createSettings({
      httpsProxy: "http://secure-proxy.local:8443"
    })
  });

  const result = applyProxyGotAgent(
    {
      url: "health",
      prefixUrl: "https://api.example.com/v1",
      agent: {
        http: existingHttpAgent,
        http2: existingHttp2Agent
      }
    },
    resolver
  );

  assert.equal(result.targetUrl.toString(), "https://api.example.com/v1/health");
  assert.equal(result.protocol, "https");
  assert.equal(result.viaProxy, true);
  assert.equal(result.proxyUrl, "http://secure-proxy.local:8443");
  assert.equal(result.options.agent?.http, existingHttpAgent);
  assert.equal(result.options.agent?.http2, existingHttp2Agent);
  assert.equal(result.options.agent?.https?.constructor.name, "HttpsProxyAgent");
});

test("apply helper leaves existing agent map intact for direct routes", () => {
  const existingHttpsAgent = { tag: "existing-https" } as unknown as Agent;
  const resolver = new ProxyGotAgentResolver({
    settings: createSettings({})
  });

  const result = applyProxyGotAgent(
    {
      url: "https://api.example.com/health",
      agent: {
        https: existingHttpsAgent
      }
    },
    resolver
  );

  assert.equal(result.viaProxy, false);
  assert.equal(result.proxyUrl, null);
  assert.equal(result.options.agent?.https, existingHttpsAgent);
});

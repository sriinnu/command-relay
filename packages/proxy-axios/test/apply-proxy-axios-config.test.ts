import assert from "node:assert/strict";
import { Agent } from "node:http";
import test from "node:test";
import {
  ProxyAxiosAgentResolver,
  applyProxyAgentToAxiosConfig,
  resolveAxiosRequestTarget,
  type ProxyAxiosRequestConfig
} from "../src/index.js";

test("apply helper mutates config by default and wires proxy agent safely", () => {
  const resolver = new ProxyAxiosAgentResolver({
    env: {
      http_proxy: "http://proxy-http.local:8080"
    }
  });

  const config: ProxyAxiosRequestConfig & { requestId: string } = {
    baseURL: "http://service.local",
    url: "/orders",
    method: "GET",
    requestId: "req-1",
    proxy: {
      host: "legacy-proxy.local"
    }
  };

  const applied = applyProxyAgentToAxiosConfig(config, resolver);

  assert.equal(applied.config, config);
  assert.equal(applied.target.href, "http://service.local/orders");
  assert.equal(applied.routing.viaProxy, true);
  assert.equal(applied.routing.proxyUrl, "http://proxy-http.local:8080/");
  assert.equal(applied.routing.fromCache, false);

  assert.equal(config.proxy, false);
  assert.equal(config.httpAgent?.constructor.name, "HttpProxyAgent");
  assert.equal(config.httpsAgent, undefined);
  assert.equal(config.requestId, "req-1");

  resolver.destroy();
});

test("apply helper returns cloned config when mutate=false and leaves original untouched", () => {
  const resolver = new ProxyAxiosAgentResolver({
    env: {
      https_proxy: "http://proxy-https.local:8443",
      no_proxy: "internal.local"
    }
  });

  const existingAgent = new Agent();
  const original: ProxyAxiosRequestConfig = {
    baseURL: "https://api.internal.local",
    url: "/health",
    method: "GET",
    proxy: {
      host: "legacy-proxy.local"
    },
    httpsAgent: existingAgent,
    metadata: {
      traceId: "trace-1"
    }
  };

  const applied = applyProxyAgentToAxiosConfig(original, resolver, {
    mutate: false
  });

  assert.notEqual(applied.config, original);
  assert.equal(applied.target.href, "https://api.internal.local/health");
  assert.equal(applied.routing.viaProxy, false);
  assert.equal(applied.routing.proxyUrl, null);

  assert.deepEqual(original.proxy, {
    host: "legacy-proxy.local"
  });
  assert.equal(original.httpsAgent, existingAgent);

  assert.equal(applied.config.proxy, false);
  assert.equal(applied.config.httpsAgent, existingAgent);

  resolver.destroy();
});

test("resolveAxiosRequestTarget throws for relative URL without baseURL", () => {
  assert.throws(
    () => resolveAxiosRequestTarget({ url: "/relative-only" }),
    /relative_url_requires_baseURL/
  );
});

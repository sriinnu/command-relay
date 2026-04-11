import assert from "node:assert/strict";
import test from "node:test";

import { explainProxyRoutes } from "../src/route-explainer.js";
import type { ProxyAgentRouteResolver } from "../src/types.js";

test("explains proxy and no_proxy routing decisions", async () => {
  const result = await explainProxyRoutes(
    [
      "https://public.example.com",
      "https://api.internal.local",
      "wss://secure.internal.local",
      "http://[::1]"
    ],
    {
      env: {
        https_proxy: "http://secure-proxy.local:8443",
        http_proxy: "http://proxy.local:8080",
        no_proxy: "internal.local,[::1]"
      },
      enableAgent: false
    }
  );

  assert.equal(result.agentSupport, "disabled");

  const publicRoute = result.routes[0];
  assert.equal(publicRoute?.decision, "proxy");
  assert.equal(publicRoute?.proxySource, "httpsProxy");

  const internalRoute = result.routes[1];
  assert.equal(internalRoute?.decision, "direct");
  assert.equal(internalRoute?.matchedNoProxyRule?.host, "internal.local");

  const secureInternalRoute = result.routes[2];
  assert.equal(secureInternalRoute?.decision, "direct");
  assert.equal(secureInternalRoute?.matchedNoProxyRule?.host, "internal.local");

  const loopbackRoute = result.routes[3];
  assert.equal(loopbackRoute?.decision, "direct");
  assert.equal(loopbackRoute?.matchedNoProxyRule?.host, "::1");
});

test("returns error decision for invalid URLs", async () => {
  const result = await explainProxyRoutes(["this-is-not-a-url"], {
    env: {
      http_proxy: "http://proxy.local:8080"
    },
    enableAgent: false
  });

  assert.equal(result.routes.length, 1);
  assert.equal(result.routes[0]?.decision, "error");
  assert.equal(result.routes[0]?.error, "invalid_target_url");
});

test("supports injected agent resolver", async () => {
  const resolver: ProxyAgentRouteResolver = {
    async resolve(target) {
      return {
        adapter: "test-adapter",
        agentClass: "HttpProxyAgent",
        viaProxy: true,
        proxyUrl: "http://proxy.local:8080/",
        error: null
      };
    }
  };

  const result = await explainProxyRoutes(["http://example.com"], {
    env: {
      http_proxy: "http://proxy.local:8080"
    },
    enableAgent: true,
    agentResolver: resolver
  });

  assert.equal(result.agentSupport, "enabled");
  assert.equal(result.routes[0]?.agent?.adapter, "test-adapter");
  assert.equal(result.routes[0]?.agent?.agentClass, "HttpProxyAgent");
});

test("reports unavailable agent support when resolver is explicitly null", async () => {
  const result = await explainProxyRoutes(["http://example.com"], {
    env: {
      http_proxy: "http://proxy.local:8080"
    },
    enableAgent: true,
    agentResolver: null
  });

  assert.equal(result.agentSupport, "unavailable");
  assert.equal(result.routes[0]?.agent, null);
});

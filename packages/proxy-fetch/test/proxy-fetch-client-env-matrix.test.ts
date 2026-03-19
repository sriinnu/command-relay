import assert from "node:assert/strict";
import test from "node:test";
import { InvalidUrlError, ProxyFetchClient, type ProxyEnvironment } from "../src/index.js";

interface MatrixExpectation {
  readonly target: string;
  readonly viaProxy: boolean;
  readonly proxyUrl: string | null;
}

interface MatrixScenario {
  readonly name: string;
  readonly env: ProxyEnvironment;
  readonly expectations: readonly MatrixExpectation[];
}

interface FakeDispatcher {
  readonly kind: "direct" | "proxy";
  readonly key: string;
}

interface AdapterHarness {
  readonly adapter: {
    createDirect: () => never;
    createProxy: (proxyUrl: string) => never;
  };
  readonly directDispatchers: FakeDispatcher[];
  readonly proxyDispatchers: Array<{ proxyUrl: string; dispatcher: FakeDispatcher }>;
}

function createAdapterHarness(): AdapterHarness {
  const directDispatchers: FakeDispatcher[] = [];
  const proxyDispatchers: Array<{ proxyUrl: string; dispatcher: FakeDispatcher }> = [];

  return {
    adapter: {
      createDirect: () => {
        const dispatcher: FakeDispatcher = {
          kind: "direct",
          key: `direct:${directDispatchers.length + 1}`
        };
        directDispatchers.push(dispatcher);
        return dispatcher as never;
      },
      createProxy: (proxyUrl: string) => {
        const dispatcher: FakeDispatcher = {
          kind: "proxy",
          key: `proxy:${proxyUrl}:${proxyDispatchers.length + 1}`
        };
        proxyDispatchers.push({ proxyUrl, dispatcher });
        return dispatcher as never;
      }
    },
    directDispatchers,
    proxyDispatchers
  };
}

const MATRIX_SCENARIOS: readonly MatrixScenario[] = [
  {
    name: "no proxy env uses direct dispatcher",
    env: {},
    expectations: [
      { target: "http://service.local/health", viaProxy: false, proxyUrl: null },
      { target: "https://service.local/health", viaProxy: false, proxyUrl: null }
    ]
  },
  {
    name: "lowercase protocol-specific proxies route by protocol",
    env: {
      http_proxy: "http://http-lower.local:8080",
      https_proxy: "http://https-lower.local:8443"
    },
    expectations: [
      {
        target: "http://public.local/health",
        viaProxy: true,
        proxyUrl: "http://http-lower.local:8080/"
      },
      {
        target: "https://public.local/health",
        viaProxy: true,
        proxyUrl: "http://https-lower.local:8443/"
      }
    ]
  },
  {
    name: "all_proxy fallback applies when specific proxies are absent",
    env: {
      all_proxy: "http://fallback.local:9000"
    },
    expectations: [
      {
        target: "http://fallback-http.local/health",
        viaProxy: true,
        proxyUrl: "http://fallback.local:9000/"
      },
      {
        target: "https://fallback-https.local/health",
        viaProxy: true,
        proxyUrl: "http://fallback.local:9000/"
      }
    ]
  },
  {
    name: "https falls back to http proxy when https proxy is missing",
    env: {
      http_proxy: "http://http-only.local:3128"
    },
    expectations: [
      {
        target: "http://http-only-target.local/health",
        viaProxy: true,
        proxyUrl: "http://http-only.local:3128/"
      },
      {
        target: "https://https-fallback.local/health",
        viaProxy: true,
        proxyUrl: "http://http-only.local:3128/"
      }
    ]
  },
  {
    name: "lowercase http and https proxies override uppercase variants",
    env: {
      http_proxy: "http://http-lower.local:8080",
      HTTP_PROXY: "http://http-upper.local:18080",
      https_proxy: "http://https-lower.local:8443",
      HTTPS_PROXY: "http://https-upper.local:18443"
    },
    expectations: [
      {
        target: "http://precedence-http.local/health",
        viaProxy: true,
        proxyUrl: "http://http-lower.local:8080/"
      },
      {
        target: "https://precedence-https.local/health",
        viaProxy: true,
        proxyUrl: "http://https-lower.local:8443/"
      }
    ]
  },
  {
    name: "uppercase proxies are used when lowercase variables are absent",
    env: {
      HTTP_PROXY: "http://http-upper.local:18080",
      HTTPS_PROXY: "http://https-upper.local:18443"
    },
    expectations: [
      {
        target: "http://upper-http.local/health",
        viaProxy: true,
        proxyUrl: "http://http-upper.local:18080/"
      },
      {
        target: "https://upper-https.local/health",
        viaProxy: true,
        proxyUrl: "http://https-upper.local:18443/"
      }
    ]
  },
  {
    name: "cgi request method ignores uppercase HTTP_PROXY for http targets",
    env: {
      REQUEST_METHOD: "GET",
      HTTP_PROXY: "http://ignored-http.local:18080",
      HTTPS_PROXY: "http://https-cgi.local:18443",
      ALL_PROXY: "http://all-cgi.local:19000"
    },
    expectations: [
      {
        target: "http://cgi-http.local/health",
        viaProxy: true,
        proxyUrl: "http://all-cgi.local:19000/"
      },
      {
        target: "https://cgi-https.local/health",
        viaProxy: true,
        proxyUrl: "http://https-cgi.local:18443/"
      }
    ]
  },
  {
    name: "lowercase no_proxy bypasses matching host suffix",
    env: {
      https_proxy: "http://https-proxy.local:8443",
      no_proxy: "internal.local"
    },
    expectations: [
      {
        target: "https://api.internal.local/health",
        viaProxy: false,
        proxyUrl: null
      },
      {
        target: "https://api.external.local/health",
        viaProxy: true,
        proxyUrl: "http://https-proxy.local:8443/"
      }
    ]
  },
  {
    name: "lowercase no_proxy wins over uppercase NO_PROXY",
    env: {
      https_proxy: "http://https-proxy.local:8443",
      NO_PROXY: "blocked.local",
      no_proxy: "ignored.local"
    },
    expectations: [
      {
        target: "https://api.ignored.local/health",
        viaProxy: false,
        proxyUrl: null
      },
      {
        target: "https://api.blocked.local/health",
        viaProxy: true,
        proxyUrl: "http://https-proxy.local:8443/"
      }
    ]
  },
  {
    name: "lowercase all_proxy overrides uppercase ALL_PROXY",
    env: {
      all_proxy: "http://all-lower.local:9000",
      ALL_PROXY: "http://all-upper.local:19000"
    },
    expectations: [
      {
        target: "http://all-precedence-http.local/health",
        viaProxy: true,
        proxyUrl: "http://all-lower.local:9000/"
      },
      {
        target: "https://all-precedence-https.local/health",
        viaProxy: true,
        proxyUrl: "http://all-lower.local:9000/"
      }
    ]
  }
];

test("ProxyFetchClient env matrix resolves routing metadata and dispatcher injection deterministically", async () => {
  for (const scenario of MATRIX_SCENARIOS) {
    const harness = createAdapterHarness();
    const capturedDispatchers: unknown[] = [];
    const seenRouteKeys = new Set<string>();

    const client = new ProxyFetchClient({
      env: scenario.env,
      adapter: harness.adapter,
      fetchImplementation: async (_input, init) => {
        capturedDispatchers.push((init as { dispatcher?: unknown } | undefined)?.dispatcher);
        return new Response('{"ok":true}', {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
    });

    try {
      let index = 0;
      for (const expectation of scenario.expectations) {
        const result = await client.fetchJson<{ ok: boolean }>(expectation.target);
        const dispatcher = capturedDispatchers[index] as FakeDispatcher | undefined;
        const routeKey = expectation.proxyUrl ?? "direct";
        const expectedFromCache = seenRouteKeys.has(routeKey);

        assert.equal(result.routing.viaProxy, expectation.viaProxy, `${scenario.name} viaProxy`);
        assert.equal(result.routing.proxyUrl, expectation.proxyUrl, `${scenario.name} proxyUrl`);
        assert.equal(
          result.routing.fromCache,
          expectedFromCache,
          `${scenario.name} fromCache sequence`
        );
        assert.deepEqual(result.body, { ok: true }, `${scenario.name} response body`);
        assert.ok(dispatcher, `${scenario.name} dispatcher is defined`);
        assert.equal(dispatcher?.kind, expectation.viaProxy ? "proxy" : "direct");

        seenRouteKeys.add(routeKey);
        index += 1;
      }

      assert.equal(capturedDispatchers.length, scenario.expectations.length, `${scenario.name} calls`);

      const expectedProxyUrls = new Set(
        scenario.expectations
          .map((entry) => entry.proxyUrl)
          .filter((entry): entry is string => entry !== null)
      );
      assert.equal(
        harness.proxyDispatchers.length,
        expectedProxyUrls.size,
        `${scenario.name} proxy dispatcher creations`
      );
      const expectedDirectCreated = scenario.expectations.some((entry) => !entry.viaProxy) ? 1 : 0;
      assert.equal(
        harness.directDispatchers.length,
        expectedDirectCreated,
        `${scenario.name} direct dispatcher creations`
      );
    } finally {
      client.destroy();
    }
  }
});

test("ProxyFetchClient rejects ws and wss targets before dispatch resolution", async () => {
  const harness = createAdapterHarness();
  let fetchCalls = 0;
  const client = new ProxyFetchClient({
    env: {
      http_proxy: "http://http-proxy.local:8080",
      https_proxy: "http://https-proxy.local:8443",
      all_proxy: "http://fallback.local:9000"
    },
    adapter: harness.adapter,
    fetchImplementation: async () => {
      fetchCalls += 1;
      return new Response("{}", {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  });

  try {
    await assert.rejects(
      () => client.fetch("ws://socket.local/live"),
      (error: unknown) => {
        assert.equal(error instanceof InvalidUrlError, true);
        if (!(error instanceof InvalidUrlError)) {
          return false;
        }
        assert.equal(error.cause, "unsupported_protocol:ws:");
        return true;
      }
    );

    await assert.rejects(
      () => client.fetchJson("wss://secure-socket.local/live"),
      (error: unknown) => {
        assert.equal(error instanceof InvalidUrlError, true);
        if (!(error instanceof InvalidUrlError)) {
          return false;
        }
        assert.equal(error.cause, "unsupported_protocol:wss:");
        return true;
      }
    );

    assert.equal(fetchCalls, 0);
    assert.equal(harness.directDispatchers.length, 0);
    assert.equal(harness.proxyDispatchers.length, 0);
  } finally {
    client.destroy();
  }
});

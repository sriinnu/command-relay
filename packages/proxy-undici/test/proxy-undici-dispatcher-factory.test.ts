import assert from "node:assert/strict";
import test from "node:test";
import {
  loadProxySettings,
  ProxyUndiciDispatcherFactory,
  type UndiciDispatcherAdapter
} from "../src/index.js";
import {
  InvalidProxyUrlError,
  InvalidTargetUrlError,
  UnsupportedProxyProtocolError,
  UnsupportedTargetProtocolError
} from "../src/errors.js";

interface FakeDispatcher {
  readonly id: string;
  destroy: () => void;
  close: () => void;
}

function createFakeDispatcher(id: string, destroyed: string[]): FakeDispatcher {
  return {
    id,
    destroy: () => destroyed.push(`${id}:destroy`),
    close: () => destroyed.push(`${id}:close`)
  };
}

function createNoopDispatcher(): FakeDispatcher {
  return {
    id: "noop",
    destroy: () => {},
    close: () => {}
  };
}

test("interoperability matrix resolves deterministic env proxy routing for http/https targets", () => {
  interface MatrixCase {
    name: string;
    env: Record<string, string>;
    target: string;
    expectedProxyUrl: string | null;
  }

  const cases: MatrixCase[] = [
    {
      name: "no proxy vars -> direct for http target",
      env: {},
      target: "http://service.local",
      expectedProxyUrl: null
    },
    {
      name: "http_proxy routes http target",
      env: { http_proxy: "http://proxy-http.local:8080" },
      target: "http://service.local",
      expectedProxyUrl: "http://proxy-http.local:8080/"
    },
    {
      name: "http_proxy fallback routes https target",
      env: { http_proxy: "http://proxy-http.local:8080" },
      target: "https://service.local",
      expectedProxyUrl: "http://proxy-http.local:8080/"
    },
    {
      name: "https_proxy does not route http target",
      env: { https_proxy: "http://proxy-https.local:8443" },
      target: "http://service.local",
      expectedProxyUrl: null
    },
    {
      name: "https_proxy routes https target",
      env: { https_proxy: "http://proxy-https.local:8443" },
      target: "https://service.local",
      expectedProxyUrl: "http://proxy-https.local:8443/"
    },
    {
      name: "all_proxy routes http target",
      env: { all_proxy: "http://proxy-all.local:9000" },
      target: "http://service.local",
      expectedProxyUrl: "http://proxy-all.local:9000/"
    },
    {
      name: "all_proxy routes https target",
      env: { all_proxy: "http://proxy-all.local:9000" },
      target: "https://service.local",
      expectedProxyUrl: "http://proxy-all.local:9000/"
    },
    {
      name: "https_proxy takes precedence over http_proxy for https target",
      env: {
        http_proxy: "http://proxy-http.local:8080",
        https_proxy: "http://proxy-https.local:8443"
      },
      target: "https://service.local",
      expectedProxyUrl: "http://proxy-https.local:8443/"
    },
    {
      name: "http_proxy takes precedence over all_proxy for http target",
      env: {
        http_proxy: "http://proxy-http.local:8080",
        all_proxy: "http://proxy-all.local:9000"
      },
      target: "http://service.local",
      expectedProxyUrl: "http://proxy-http.local:8080/"
    },
    {
      name: "lowercase proxy variable wins over uppercase",
      env: {
        http_proxy: "http://proxy-lower.local:8080",
        HTTP_PROXY: "http://proxy-upper.local:8080"
      },
      target: "http://service.local",
      expectedProxyUrl: "http://proxy-lower.local:8080/"
    },
    {
      name: "cgi REQUEST_METHOD ignores uppercase HTTP_PROXY",
      env: {
        REQUEST_METHOD: "GET",
        HTTP_PROXY: "http://proxy-upper.local:8080"
      },
      target: "http://service.local",
      expectedProxyUrl: null
    },
    {
      name: "no_proxy bypass wins over matching proxy",
      env: {
        https_proxy: "http://proxy-https.local:8443",
        no_proxy: "service.local"
      },
      target: "https://service.local",
      expectedProxyUrl: null
    }
  ];

  for (const matrixCase of cases) {
    let directCreateCount = 0;
    let proxyCreateCount = 0;
    const factory = new ProxyUndiciDispatcherFactory({
      env: matrixCase.env,
      adapter: {
        createDirect: () => {
          directCreateCount += 1;
          return createNoopDispatcher() as unknown as never;
        },
        createProxy: () => {
          proxyCreateCount += 1;
          return createNoopDispatcher() as unknown as never;
        }
      }
    });

    const result = factory.resolve(matrixCase.target);
    const expectProxy = matrixCase.expectedProxyUrl !== null;
    assert.equal(result.fromCache, false, matrixCase.name);
    assert.equal(result.viaProxy, expectProxy, matrixCase.name);
    assert.equal(result.proxyUrl, matrixCase.expectedProxyUrl, matrixCase.name);
    assert.equal(directCreateCount, expectProxy ? 0 : 1, matrixCase.name);
    assert.equal(proxyCreateCount, expectProxy ? 1 : 0, matrixCase.name);
  }
});

test("resolve returns direct dispatcher when no proxy is configured", () => {
  const destroyed: string[] = [];
  let directCreated = 0;
  const directDispatcher = createFakeDispatcher("direct", destroyed);
  const adapter: UndiciDispatcherAdapter = {
    createDirect: () => {
      directCreated += 1;
      return directDispatcher as unknown as never;
    },
    createProxy: () => {
      throw new Error("proxy_not_expected");
    }
  };
  const factory = new ProxyUndiciDispatcherFactory({
    settings: loadProxySettings({}),
    adapter
  });

  const first = factory.resolve("https://service.local");
  const second = factory.resolve("https://service.local/v2");
  assert.equal(first.viaProxy, false);
  assert.equal(first.fromCache, false);
  assert.equal(first.proxyUrl, null);
  assert.equal(second.fromCache, true);
  assert.equal(first.dispatcher, second.dispatcher);
  assert.equal(directCreated, 1);

  factory.destroy();
  assert.ok(
    destroyed.includes("direct:destroy") || destroyed.includes("direct:close")
  );
});

test("resolve returns proxy dispatcher and reuses cache", () => {
  let proxyCreated = 0;
  const adapter: UndiciDispatcherAdapter = {
    createDirect: () => {
      throw new Error("direct_not_expected");
    },
    createProxy: () => {
      proxyCreated += 1;
      return { destroy: () => {}, close: () => {} } as unknown as never;
    }
  };
  const factory = new ProxyUndiciDispatcherFactory({
    settings: loadProxySettings({ https_proxy: "http://proxy.local:8080" }),
    adapter
  });

  const first = factory.resolve("https://api.example.com");
  const second = factory.resolve("https://api.example.com/v1");

  assert.equal(first.viaProxy, true);
  assert.equal(first.fromCache, false);
  assert.equal(first.proxyUrl, "http://proxy.local:8080/");
  assert.equal(second.fromCache, true);
  assert.equal(first.dispatcher, second.dispatcher);
  assert.equal(proxyCreated, 1);
});

test("no_proxy bypass keeps direct dispatcher for matching host", () => {
  const adapter: UndiciDispatcherAdapter = {
    createDirect: () => ({ destroy: () => {}, close: () => {} } as unknown as never),
    createProxy: () => {
      throw new Error("proxy_not_expected");
    }
  };
  const factory = new ProxyUndiciDispatcherFactory({
    settings: loadProxySettings({
      https_proxy: "http://proxy.local:8080",
      no_proxy: "example.com"
    }),
    adapter
  });

  const result = factory.resolve("https://api.example.com");
  assert.equal(result.viaProxy, false);
  assert.equal(result.proxyUrl, null);
});

test("evicts least-recently-used proxy dispatcher when cache is full", () => {
  const destroyed: string[] = [];
  let createIndex = 0;
  const adapter: UndiciDispatcherAdapter = {
    createDirect: () => ({ destroy: () => {}, close: () => {} } as unknown as never),
    createProxy: (proxyUrl) =>
      createFakeDispatcher(`${proxyUrl}:${++createIndex}`, destroyed) as unknown as never
  };
  const factory = new ProxyUndiciDispatcherFactory({
    settings: loadProxySettings({
      http_proxy: "http://proxy-http.local:8080",
      https_proxy: "http://proxy-https.local:8080"
    }),
    maxCacheEntries: 1,
    adapter
  });

  const first = factory.resolve("http://service.local");
  const second = factory.resolve("https://service.local");
  const third = factory.resolve("https://service.local/v2");

  assert.equal(first.fromCache, false);
  assert.equal(second.fromCache, false);
  assert.equal(third.fromCache, true);
  assert.equal(factory.cacheSize, 1);
  assert.equal(
    destroyed.some((entry) => entry.startsWith("http://proxy-http.local:8080/")),
    true
  );
});

test("constructor options are forwarded to adapter constructors", () => {
  let capturedDirectOptions: Record<string, unknown> | undefined;
  let capturedProxyOptions: Record<string, unknown> | undefined;
  const factory = new ProxyUndiciDispatcherFactory({
    settings: loadProxySettings({
      https_proxy: "http://proxy.local:8080"
    }),
    directDispatcherOptions: { pipelining: 4 },
    proxyDispatcherOptions: { connectTimeout: 5_000 },
    adapter: {
      createDirect: (options) => {
        capturedDirectOptions = options;
        return { destroy: () => {}, close: () => {} } as unknown as never;
      },
      createProxy: (_proxyUrl, options) => {
        capturedProxyOptions = options;
        return { destroy: () => {}, close: () => {} } as unknown as never;
      }
    }
  });

  factory.resolve("http://service.local");
  factory.resolve("https://service.local");

  assert.deepEqual(capturedDirectOptions, { pipelining: 4 });
  assert.deepEqual(capturedProxyOptions, { connectTimeout: 5_000 });
});

test("updateSettings and reloadFromEnvironment reset routing and cache", () => {
  let directCreateCount = 0;
  let proxyCreateCount = 0;
  const factory = new ProxyUndiciDispatcherFactory({
    settings: loadProxySettings({}),
    adapter: {
      createDirect: () => {
        directCreateCount += 1;
        return { destroy: () => {}, close: () => {} } as unknown as never;
      },
      createProxy: () => {
        proxyCreateCount += 1;
        return { destroy: () => {}, close: () => {} } as unknown as never;
      }
    }
  });

  factory.resolve("https://service.local");
  factory.updateSettings(loadProxySettings({ https_proxy: "http://proxy.local:8080" }));
  factory.resolve("https://service.local");
  factory.reloadFromEnvironment({});
  factory.resolve("https://service.local");

  assert.equal(proxyCreateCount, 1);
  assert.equal(directCreateCount, 2);
});

test("throws typed errors for invalid targets and unsupported protocols", () => {
  const factory = new ProxyUndiciDispatcherFactory({
    settings: loadProxySettings({
      http_proxy: "socks5://proxy.local:1080"
    }),
    adapter: {
      createDirect: () => ({ destroy: () => {}, close: () => {} } as unknown as never),
      createProxy: () => ({ destroy: () => {}, close: () => {} } as unknown as never)
    }
  });

  assert.throws(() => factory.resolve("://invalid"), (error: unknown) => error instanceof InvalidTargetUrlError);
  assert.throws(() => factory.resolve("ws://service.local"), (error: unknown) => error instanceof UnsupportedTargetProtocolError);
  assert.throws(() => factory.resolve("http://service.local"), (error: unknown) => error instanceof UnsupportedProxyProtocolError);

  const invalidProxyFactory = new ProxyUndiciDispatcherFactory({
    settings: {
      httpProxy: "http:// proxy",
      httpsProxy: null,
      allProxy: null,
      noProxy: []
    },
    adapter: {
      createDirect: () => ({ destroy: () => {}, close: () => {} } as unknown as never),
      createProxy: () => ({ destroy: () => {}, close: () => {} } as unknown as never)
    }
  });
  assert.throws(
    () => invalidProxyFactory.resolve("http://service.local"),
    (error: unknown) => error instanceof InvalidProxyUrlError
  );
});

test("socks and pac proxies are explicitly unsupported (chaining not supported)", () => {
  const baseAdapter: UndiciDispatcherAdapter = {
    createDirect: () => createNoopDispatcher() as unknown as never,
    createProxy: () => createNoopDispatcher() as unknown as never
  };

  const socksFactory = new ProxyUndiciDispatcherFactory({
    settings: loadProxySettings({
      http_proxy: "socks5://proxy.local:1080"
    }),
    adapter: baseAdapter
  });

  assert.throws(() => socksFactory.resolve("http://service.local"), (error: unknown) => {
    assert.ok(error instanceof UnsupportedProxyProtocolError);
    assert.equal(error.message, "unsupported_proxy_protocol:socks5:");
    return true;
  });

  const pacFactory = new ProxyUndiciDispatcherFactory({
    settings: loadProxySettings({
      http_proxy: "pac+http://proxy-config.local/proxy.pac"
    }),
    adapter: baseAdapter
  });

  assert.throws(() => pacFactory.resolve("http://service.local"), (error: unknown) => {
    assert.ok(error instanceof UnsupportedProxyProtocolError);
    assert.equal(error.message, "unsupported_proxy_protocol:pac+http:");
    return true;
  });
});

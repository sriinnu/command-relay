/**
 * @file Deterministic proxy interoperability matrix tests across env permutations.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { ProxyAgentFactory } from "./proxy-agent-factory.js";
import { loadProxySettings, resolveProxyForUrl } from "./proxy-router.js";

type Protocol = "http" | "https" | "ws" | "wss";
type ProxyEnvPatch = Readonly<Record<string, string | undefined>>;
type ProtocolExpectations = Readonly<Record<Protocol, string | null>>;

interface MatrixCase {
  readonly name: string;
  readonly host: string;
  readonly env: ProxyEnvPatch;
  readonly expected: ProtocolExpectations;
}

const PROTOCOLS: readonly Protocol[] = ["http", "https", "ws", "wss"];
const PROXY_ENV_KEYS = [
  "HTTP_PROXY",
  "http_proxy",
  "HTTPS_PROXY",
  "https_proxy",
  "ALL_PROXY",
  "all_proxy",
  "NO_PROXY",
  "no_proxy"
] as const;

const CLEAN_PROXY_ENV: Record<string, undefined> = Object.fromEntries(
  PROXY_ENV_KEYS.map((key) => [key, undefined])
) as Record<string, undefined>;

const MATRIX_CASES: readonly MatrixCase[] = [
  {
    name: "HTTP_PROXY only routes all protocols via HTTP fallback",
    host: "matrix-public.local",
    env: {
      HTTP_PROXY: "http://upper-http-proxy.local:8080"
    },
    expected: {
      http: "http://upper-http-proxy.local:8080/",
      https: "http://upper-http-proxy.local:8080/",
      ws: "http://upper-http-proxy.local:8080/",
      wss: "http://upper-http-proxy.local:8080/"
    }
  },
  {
    name: "HTTP_PROXY and HTTPS_PROXY split insecure and secure protocols",
    host: "matrix-public.local",
    env: {
      HTTP_PROXY: "http://upper-http-proxy.local:8080",
      HTTPS_PROXY: "http://upper-https-proxy.local:8443"
    },
    expected: {
      http: "http://upper-http-proxy.local:8080/",
      https: "http://upper-https-proxy.local:8443/",
      ws: "http://upper-http-proxy.local:8080/",
      wss: "http://upper-https-proxy.local:8443/"
    }
  },
  {
    name: "HTTPS_PROXY with ALL_PROXY falls back to ALL_PROXY for http/ws",
    host: "matrix-public.local",
    env: {
      HTTPS_PROXY: "http://upper-https-proxy.local:8443",
      ALL_PROXY: "socks5://upper-all-proxy.local:1080"
    },
    expected: {
      http: "socks5://upper-all-proxy.local:1080",
      https: "http://upper-https-proxy.local:8443/",
      ws: "socks5://upper-all-proxy.local:1080",
      wss: "http://upper-https-proxy.local:8443/"
    }
  },
  {
    name: "lowercase proxies are used when uppercase variants are empty",
    host: "matrix-public.local",
    env: {
      HTTP_PROXY: "",
      http_proxy: "http://lower-http-proxy.local:8081",
      HTTPS_PROXY: "",
      https_proxy: "http://lower-https-proxy.local:8444",
      ALL_PROXY: "",
      all_proxy: "socks5://lower-all-proxy.local:1081"
    },
    expected: {
      http: "http://lower-http-proxy.local:8081/",
      https: "http://lower-https-proxy.local:8444/",
      ws: "http://lower-http-proxy.local:8081/",
      wss: "http://lower-https-proxy.local:8444/"
    }
  },
  {
    name: "lowercase proxy vars win when both variants are present",
    host: "matrix-public.local",
    env: {
      HTTP_PROXY: "http://upper-http-proxy.local:8080",
      http_proxy: "http://lower-http-proxy.local:8081",
      HTTPS_PROXY: "http://upper-https-proxy.local:8443",
      https_proxy: "http://lower-https-proxy.local:8444",
      ALL_PROXY: "socks5://upper-all-proxy.local:1080",
      all_proxy: "socks5://lower-all-proxy.local:1081"
    },
    expected: {
      http: "http://lower-http-proxy.local:8081/",
      https: "http://lower-https-proxy.local:8444/",
      ws: "http://lower-http-proxy.local:8081/",
      wss: "http://lower-https-proxy.local:8444/"
    }
  },
  {
    name: "lowercase NO_PROXY wins over uppercase wildcard entry",
    host: "matrix-public.local",
    env: {
      HTTP_PROXY: "http://upper-http-proxy.local:8080",
      HTTPS_PROXY: "http://upper-https-proxy.local:8443",
      NO_PROXY: "bypass.matrix.local",
      no_proxy: "*"
    },
    expected: {
      http: null,
      https: null,
      ws: null,
      wss: null
    }
  },
  {
    name: "lowercase no_proxy is used when NO_PROXY is empty",
    host: "bypass.matrix.local",
    env: {
      HTTP_PROXY: "http://upper-http-proxy.local:8080",
      HTTPS_PROXY: "http://upper-https-proxy.local:8443",
      NO_PROXY: "",
      no_proxy: "bypass.matrix.local"
    },
    expected: {
      http: null,
      https: null,
      ws: null,
      wss: null
    }
  },
  {
    name: "NO_PROXY port rules bypass default ports for all protocols",
    host: "ports.matrix.local",
    env: {
      HTTP_PROXY: "http://upper-http-proxy.local:8080",
      HTTPS_PROXY: "http://upper-https-proxy.local:8443",
      NO_PROXY: "ports.matrix.local:80,ports.matrix.local:443"
    },
    expected: {
      http: null,
      https: null,
      ws: null,
      wss: null
    }
  }
];

function withPatchedEnv<T>(patch: ProxyEnvPatch, run: () => T): T {
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
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
        continue;
      }
      process.env[key] = value;
    }
  }
}

function targetUrl(protocol: Protocol, host: string): string {
  return protocol === "http" || protocol === "https"
    ? `${protocol}://${host}/resource`
    : `${protocol}://${host}/socket`;
}

function expectedAgentClass(proxyUrl: string, protocol: Protocol): string {
  const proxyProtocol = new URL(proxyUrl).protocol.toLowerCase();
  if (proxyProtocol.startsWith("socks")) {
    return "SocksProxyAgent";
  }
  if (proxyProtocol.startsWith("pac+")) {
    return "PacProxyAgent";
  }
  return protocol === "http" || protocol === "ws" ? "HttpProxyAgent" : "HttpsProxyAgent";
}

test("resolveProxyForUrl matrix covers proxy env permutations across protocols", () => {
  for (const matrixCase of MATRIX_CASES) {
    const settings = loadProxySettings({
      ...CLEAN_PROXY_ENV,
      ...matrixCase.env
    });

    for (const protocol of PROTOCOLS) {
      const actual = resolveProxyForUrl(targetUrl(protocol, matrixCase.host), settings);
      assert.equal(
        actual,
        matrixCase.expected[protocol],
        `${matrixCase.name} (${protocol}) expected ${matrixCase.expected[protocol]}`
      );
    }
  }
});

test("ProxyAgentFactory matrix resolves direct-vs-proxy consistently across protocols", () => {
  for (const matrixCase of MATRIX_CASES) {
    withPatchedEnv(
      {
        ...CLEAN_PROXY_ENV,
        ...matrixCase.env
      },
      () => {
        const factory = new ProxyAgentFactory();
        for (const protocol of PROTOCOLS) {
          const expectedProxy = matrixCase.expected[protocol];
          const result = factory.resolve(targetUrl(protocol, matrixCase.host));

          assert.equal(
            result.viaProxy,
            expectedProxy !== null,
            `${matrixCase.name} (${protocol}) viaProxy mismatch`
          );
          assert.equal(
            result.proxyUrl,
            expectedProxy,
            `${matrixCase.name} (${protocol}) proxyUrl mismatch`
          );

          if (expectedProxy === null) {
            assert.equal(result.agent, null, `${matrixCase.name} (${protocol}) should be direct`);
            continue;
          }

          assert.equal(
            result.agent?.constructor.name,
            expectedAgentClass(expectedProxy, protocol),
            `${matrixCase.name} (${protocol}) agent class mismatch`
          );
        }
      }
    );
  }
});

import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import * as nodeHttp from "node:http";
import test from "node:test";
import {
  loadProxySettings,
  resolveProxyForUrl,
  type ProxyEnvironment
} from "@commandrelay/proxy-core";
import {
  requestJson,
  type JsonRequestTransport,
  type ProxyAgentResolver
} from "../src/index.js";

type TargetProtocol = "http:" | "https:";

interface ResolutionRecord {
  target: string;
  proxyUrl: string | null;
  bypassed: boolean;
}

class FakeClientRequest extends EventEmitter {
  readonly options: nodeHttp.RequestOptions;
  private readonly callback: (response: nodeHttp.IncomingMessage) => void;

  constructor(
    options: nodeHttp.RequestOptions,
    callback: (response: nodeHttp.IncomingMessage) => void
  ) {
    super();
    this.options = options;
    this.callback = callback;
  }

  end(): void {
    const response = new EventEmitter() as nodeHttp.IncomingMessage;
    (response as { statusCode?: number }).statusCode = 200;
    (response as { headers: nodeHttp.IncomingHttpHeaders }).headers = {
      "content-type": "application/json"
    };

    this.callback(response);
    response.emit("data", Buffer.from('{"ok":true}', "utf8"));
    response.emit("end");
  }

  destroy(error?: Error): this {
    if (error) {
      this.emit("error", error);
    }
    return this;
  }
}

test("requestJson applies proxy-agent-style protocol selection for http and https", async () => {
  const harness = createTransportHarness();
  const resolverHarness = createProxyAgentSemanticResolver({
    http_proxy: "http://proxy-http.local:8080",
    https_proxy: "http://proxy-https.local:8443"
  });

  await requestJson("http://service.local/http-route", {
    proxyResolver: resolverHarness.resolver,
    transport: harness.transport
  });
  await requestJson("https://service.local/https-route", {
    proxyResolver: resolverHarness.resolver,
    transport: harness.transport
  });

  const httpRequest = harness.requireRequestAt(0).options;
  const httpsRequest = harness.requireRequestAt(1).options;

  assert.equal(httpRequest.protocol, "http:");
  assert.equal(httpsRequest.protocol, "https:");
  assert.equal(
    httpRequest.agent,
    resolverHarness.requireCachedAgent("http://proxy-http.local:8080/", "http:")
  );
  assert.equal(
    httpsRequest.agent,
    resolverHarness.requireCachedAgent("http://proxy-https.local:8443/", "https:")
  );
  assert.deepEqual(
    resolverHarness.records.map((record) => record.proxyUrl),
    ["http://proxy-http.local:8080/", "http://proxy-https.local:8443/"]
  );
});

test("requestJson keeps protocol-scoped agents when https falls back to http_proxy", async () => {
  const harness = createTransportHarness();
  const resolverHarness = createProxyAgentSemanticResolver({
    http_proxy: "http://shared-proxy.local:8080"
  });

  await requestJson("http://service.local/http-fallback", {
    proxyResolver: resolverHarness.resolver,
    transport: harness.transport
  });
  await requestJson("https://service.local/https-fallback", {
    proxyResolver: resolverHarness.resolver,
    transport: harness.transport
  });

  const sharedProxyUrl = "http://shared-proxy.local:8080/";
  const httpAgent = resolverHarness.requireCachedAgent(sharedProxyUrl, "http:");
  const httpsAgent = resolverHarness.requireCachedAgent(sharedProxyUrl, "https:");
  const httpRequest = harness.requireRequestAt(0).options;
  const httpsRequest = harness.requireRequestAt(1).options;

  assert.equal(httpRequest.agent, httpAgent);
  assert.equal(httpsRequest.agent, httpsAgent);
  assert.notEqual(httpAgent, httpsAgent);
  assert.deepEqual(
    resolverHarness.records.map((record) => record.proxyUrl),
    [sharedProxyUrl, sharedProxyUrl]
  );
});

test("requestJson forwards NO_PROXY bypass as direct agentless request options", async () => {
  const harness = createTransportHarness();
  const resolverHarness = createProxyAgentSemanticResolver({
    http_proxy: "http://proxy-http.local:8080",
    https_proxy: "http://proxy-https.local:8443",
    no_proxy: "bypass-http.local,bypass-https.local"
  });

  await requestJson("http://bypass-http.local/direct-http", {
    proxyResolver: resolverHarness.resolver,
    transport: harness.transport
  });
  await requestJson("https://bypass-https.local/direct-https", {
    proxyResolver: resolverHarness.resolver,
    transport: harness.transport
  });
  await requestJson("https://external.local/proxied-https", {
    proxyResolver: resolverHarness.resolver,
    transport: harness.transport
  });

  const bypassHttpRequest = harness.requireRequestAt(0).options;
  const bypassHttpsRequest = harness.requireRequestAt(1).options;
  const proxiedHttpsRequest = harness.requireRequestAt(2).options;

  assert.equal(bypassHttpRequest.agent, undefined);
  assert.equal(bypassHttpsRequest.agent, undefined);
  assert.equal(
    proxiedHttpsRequest.agent,
    resolverHarness.requireCachedAgent("http://proxy-https.local:8443/", "https:")
  );
  assert.deepEqual(
    resolverHarness.records.map((record) => record.bypassed),
    [true, true, false]
  );
});

function createTransportHarness(): {
  transport: JsonRequestTransport;
  requireRequestAt: (index: number) => FakeClientRequest;
} {
  const capturedRequests: FakeClientRequest[] = [];

  const requestMock = (
    options: nodeHttp.RequestOptions,
    callback: (response: nodeHttp.IncomingMessage) => void
  ): nodeHttp.ClientRequest => {
    const request = new FakeClientRequest(options, callback);
    capturedRequests.push(request);
    return request as unknown as nodeHttp.ClientRequest;
  };

  return {
    transport: {
      httpRequest: requestMock,
      httpsRequest: requestMock
    },
    requireRequestAt(index: number): FakeClientRequest {
      const request = capturedRequests[index];
      if (!request) {
        throw new Error(`expected_captured_request_at_${index}`);
      }
      return request;
    }
  };
}

function createProxyAgentSemanticResolver(env: ProxyEnvironment): {
  resolver: ProxyAgentResolver;
  records: ResolutionRecord[];
  requireCachedAgent: (proxyUrl: string, protocol: TargetProtocol) => nodeHttp.Agent;
} {
  const settings = loadProxySettings(env);
  const records: ResolutionRecord[] = [];
  const cachedAgents = new Map<string, nodeHttp.Agent>();

  const resolver: ProxyAgentResolver = {
    resolve(target: URL) {
      const proxyUrl = resolveProxyForUrl(target, settings);
      records.push({
        target: target.toString(),
        proxyUrl,
        bypassed: proxyUrl === null
      });

      if (!proxyUrl) {
        return { agent: null };
      }

      // Match proxy-agent cache behavior: same proxy URL with different target protocol
      // yields separate agent instances.
      const cacheKey = `${proxyUrl}|${target.protocol}`;
      let agent = cachedAgents.get(cacheKey);
      if (!agent) {
        agent = new nodeHttp.Agent();
        cachedAgents.set(cacheKey, agent);
      }

      return { agent };
    }
  };

  return {
    resolver,
    records,
    requireCachedAgent(proxyUrl: string, protocol: TargetProtocol): nodeHttp.Agent {
      const agent = cachedAgents.get(`${proxyUrl}|${protocol}`);
      if (!agent) {
        throw new Error(`expected_cached_agent:${proxyUrl}:${protocol}`);
      }
      return agent;
    }
  };
}
